import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { env } from '../config/env'
import { emailTransport } from '../integrations/email/email-transport'
import { isRetryableEmailError } from '../integrations/email/email-errors'
import { deliverQueuedEmail, isAnyRecipientSuppressed, type DeliverableEmail } from './email-delivery'

export interface OutboxEnqueueInput extends DeliverableEmail {
  templateName: string
  maxAttempts?: number
  dedupeKey?: string
}

/** Raw shape returned by the `FOR UPDATE SKIP LOCKED` claim query. */
interface OutboxRow {
  id: string
  toAddress: string
  toName: string | null
  subject: string
  htmlBody: string
  textBody: string | null
  fromEmail: string | null
  templateName: string
  attachmentName: string | null
  attachmentContent: string | null
  attempts: number
  maxAttempts: number
}

const MAX_RETRY_DELAY_MS = 30_000
/** A `PROCESSING` row older than this is assumed abandoned by a dead worker. */
const LOCK_STALE_MS = 5 * 60 * 1000

/**
 * Durable transactional email outbox.
 *
 * Replaces the "enqueue into a module-level array" behaviour when
 * `EMAIL_OUTBOX_ENABLED` is on: the message is written to the `email_outbox`
 * table before the request returns, so a rolling deploy, eviction or crash no
 * longer silently drops password-reset, order-confirmation or invoice mail. Any
 * worker instance can pick the row up and deliver it, which also removes the
 * per-instance blindness of the in-memory queue.
 */
export class EmailOutboxService {
  /**
   * Persists a message for asynchronous delivery.
   *
   * Returns the row id, or `null` when the `dedupeKey` was already claimed —
   * the caller treats `null` exactly like the in-memory queue treats a dropped
   * duplicate.
   */
  static async enqueue(input: OutboxEnqueueInput): Promise<string | null> {
    try {
      const row = await prisma.emailOutbox.create({
        data: {
          toAddress: Array.isArray(input.to) ? input.to.join(',') : input.to,
          toName: input.toName ?? null,
          subject: input.subject,
          htmlBody: input.htmlBody,
          textBody: input.textBody ?? null,
          fromEmail: input.fromEmail ?? null,
          templateName: input.templateName,
          attachmentName: input.attachment?.name ?? null,
          attachmentContent: input.attachment?.content ?? null,
          maxAttempts: input.maxAttempts ?? 3,
          dedupeKey: input.dedupeKey ?? null,
        },
      })
      return row.id
    } catch (error: any) {
      if (error?.code === 'P2002') {
        logger.info(
          { dedupeKey: input.dedupeKey, template: input.templateName },
          'Duplicate email suppressed (durable dedupe key)'
        )
        return null
      }
      throw error
    }
  }

  /** Returns abandoned `PROCESSING` rows to the queue (crash recovery). */
  static async reclaimStaleLocks(): Promise<number> {
    const staleBefore = new Date(Date.now() - LOCK_STALE_MS)
    const result = await prisma.emailOutbox.updateMany({
      where: { status: 'PROCESSING', lockedAt: { lt: staleBefore } },
      data: { status: 'PENDING', lockedAt: null },
    })
    return result.count
  }

  /**
   * Atomically claims up to `limit` due rows for this worker.
   *
   * `FOR UPDATE SKIP LOCKED` means concurrent workers never hand the same row
   * to two deliveries; combined with the partial claim this makes the outbox
   * safe to run on every instance.
   */
  static async claimBatch(limit: number): Promise<OutboxRow[]> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT
          id,
          to_address        AS "toAddress",
          to_name           AS "toName",
          subject,
          html_body         AS "htmlBody",
          text_body         AS "textBody",
          from_email        AS "fromEmail",
          template_name     AS "templateName",
          attachment_name   AS "attachmentName",
          attachment_content AS "attachmentContent",
          attempts,
          max_attempts      AS "maxAttempts"
        FROM email_outbox
        WHERE status = 'PENDING' AND next_attempt_at <= now()
        ORDER BY next_attempt_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `
      if (rows.length === 0) return rows

      const ids = rows.map((row) => row.id)
      await tx.emailOutbox.updateMany({
        where: { id: { in: ids } },
        data: { status: 'PROCESSING', lockedAt: new Date(), attempts: { increment: 1 } },
      })
      return rows
    })
  }

  static async markSent(id: string): Promise<void> {
    await prisma.emailOutbox.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(), lockedAt: null, lastError: null },
    })
  }

  /**
   * Terminal failure. The dedupe key is released so an operator-triggered or
   * later lifecycle resend can go through once the underlying fault is fixed,
   * mirroring the in-memory queue's behaviour.
   */
  static async markFailed(id: string, error: string): Promise<void> {
    await prisma.emailOutbox.update({
      where: { id },
      data: { status: 'FAILED', lastError: error.slice(0, 1000), lockedAt: null, dedupeKey: null },
    })
  }

  static async markRetry(id: string, error: string, delayMs: number): Promise<void> {
    await prisma.emailOutbox.update({
      where: { id },
      data: {
        status: 'PENDING',
        lastError: error.slice(0, 1000),
        lockedAt: null,
        nextAttemptAt: new Date(Date.now() + delayMs),
      },
    })
  }

  static async stats(): Promise<{ pending: number; failed: number }> {
    const [pending, failed] = await Promise.all([
      prisma.emailOutbox.count({ where: { status: 'PENDING' } }),
      prisma.emailOutbox.count({ where: { status: 'FAILED' } }),
    ])
    return { pending, failed }
  }

  /** Exponential backoff with jitter, capped at `MAX_RETRY_DELAY_MS`. */
  static backoff(attempt: number): number {
    const delay = Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), MAX_RETRY_DELAY_MS)
    return delay + Math.random() * 0.1 * delay
  }
}

export interface OutboxTickResult {
  claimed: number
  sent: number
  failed: number
}

/**
 * Drains the durable outbox. Runs on every instance (safe by SKIP LOCKED) and
 * is started from `server.ts`, never from request handlers.
 */
export class EmailOutboxWorker {
  private static timer?: NodeJS.Timeout
  private static running = false

  static start(intervalMs: number): void {
    if (EmailOutboxWorker.timer) return
    EmailOutboxWorker.timer = setInterval(() => {
      void EmailOutboxWorker.runOnce().catch((error: any) =>
        logger.error({ error: error?.message }, 'Email outbox worker tick failed')
      )
    }, intervalMs)
    EmailOutboxWorker.timer.unref()
    logger.info({ intervalMs }, 'Email outbox worker started')
  }

  static stop(): void {
    if (!EmailOutboxWorker.timer) return
    clearInterval(EmailOutboxWorker.timer)
    EmailOutboxWorker.timer = undefined
  }

  /** Test seam: runs one drain pass synchronously-resolvable. */
  static async runOnce(batchSize = env.EMAIL_OUTBOX_BATCH_SIZE): Promise<OutboxTickResult> {
    if (EmailOutboxWorker.running) return { claimed: 0, sent: 0, failed: 0 }
    EmailOutboxWorker.running = true
    try {
      await EmailOutboxService.reclaimStaleLocks()

      const rows = await EmailOutboxService.claimBatch(batchSize)
      let sent = 0
      let failed = 0

      for (const row of rows) {
        const attemptNumber = row.attempts + 1
        try {
          if (emailTransport.isSimulating()) {
            await EmailOutboxService.markSent(row.id)
            sent++
            continue
          }

          const recipients = row.toAddress.includes(',') ? row.toAddress.split(',') : row.toAddress
          if (await isAnyRecipientSuppressed(recipients)) {
            await EmailOutboxService.markFailed(row.id, 'Recipient suppressed (hard bounce or complaint)')
            failed++
            continue
          }

          await deliverQueuedEmail({
            to: recipients,
            toName: row.toName ?? undefined,
            subject: row.subject,
            htmlBody: row.htmlBody,
            textBody: row.textBody ?? undefined,
            fromEmail: row.fromEmail ?? undefined,
            attachment:
              row.attachmentName && row.attachmentContent
                ? { name: row.attachmentName, content: row.attachmentContent }
                : undefined,
          })
          await EmailOutboxService.markSent(row.id)
          sent++
        } catch (error: any) {
          const retryable = isRetryableEmailError(error)
          if (!retryable || attemptNumber >= row.maxAttempts) {
            await EmailOutboxService.markFailed(row.id, error?.message ?? 'Unknown delivery error')
            failed++
            logger.error(
              { id: row.id, attempt: attemptNumber, error: error?.message, template: row.templateName },
              'Email permanently failed'
            )
          } else {
            const delay = EmailOutboxService.backoff(attemptNumber)
            await EmailOutboxService.markRetry(row.id, error?.message ?? 'Unknown delivery error', delay)
            logger.warn({ id: row.id, attempt: attemptNumber, delay }, 'Email retry scheduled')
          }
        }
      }

      return { claimed: rows.length, sent, failed }
    } finally {
      EmailOutboxWorker.running = false
    }
  }
}
