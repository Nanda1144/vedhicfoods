import { emailTransport } from '../integrations/email/email-transport'
import { isRetryableEmailError } from '../integrations/email/email-errors'
import { logger } from '../config/logger'
import { env } from '../config/env'
import { BRANDING } from '../config/branding'
import { EmailTemplates, TemplateVariables } from '../templates/email-templates'
import { deliverQueuedEmail, isAnyRecipientSuppressed } from './email-delivery'
import { EmailOutboxService } from './email-outbox.service'

/**
 * Whether queued mail is persisted to the durable outbox.
 *
 * Defaults on in every environment except unit tests, which run without a
 * database and must exercise the in-memory queue created by `EmailQueue.enqueue`.
 */
function isOutboxEnabled(): boolean {
  return env.EMAIL_OUTBOX_ENABLED ?? env.NODE_ENV !== 'test'
}

export interface QueuedEmail {
  id: string
  to: string | string[]
  /** Display name for the recipient; falls back to the address. */
  toName?: string
  subject: string
  htmlBody: string
  textBody?: string
  fromEmail?: string
  templateName: string
  variables: TemplateVariables
  attempts: number
  maxAttempts: number
  createdAt: Date
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'duplicate'
  sentAt?: Date
  error?: string
  /** Idempotency key; a second enqueue with the same key is dropped. */
  dedupeKey?: string
  /**
   * Optional file attached to the message (base64 content). Present only for
   * invoice emails; a queued message with an attachment is delivered through the
   * attachment transport, which SES implements with `SendRawEmail`.
   */
  attachment?: { name: string; content: string }
}

export interface EmailEvent {
  eventId: string
  type: 'order_confirmation' | 'payment_confirmation' | 'invoice' | 'shipment' | 'delivery' | 'welcome' | 'verification' | 'password_reset' | 'admin_notification' | 'order_processing' | 'out_for_delivery' | 'payment_failure' | 'order_cancelled' | 'refund'
  payload: TemplateVariables
  userId?: string
  orderId?: string
  recipient?: string
  recipientName?: string
  metadata?: Record<string, any>
}

const MAX_RETRY_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 30000

/** Mutable only through the test seam below; never in production. */
let retryBaseDelayMs = BASE_RETRY_DELAY_MS

/** Test seam: shrinks the backoff so retry assertions do not sleep for seconds. */
export function __setEmailRetryDelayForTests(ms: number): void {
  retryBaseDelayMs = ms
}

/** How long a dedupe key is remembered. Longer than any realistic redelivery. */
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * In-process email retry queue.
 *
 * Only used when the durable outbox is disabled (`EMAIL_OUTBOX_ENABLED=false`,
 * or `NODE_ENV=test`, which has no database). When the outbox is enabled,
 * `EmailQueue.enqueue` persists the message and `EmailOutboxWorker` performs the
 * retries instead of the loop below.
 *
 * MULTI-INSTANCE LIMITATION (in-memory path only): `queue`, `isProcessing` and
 * `processingTimeout` are module-level, so this queue is **per-instance and
 * non-durable**:
 *
 *  - Emails enqueued by instance A are invisible to instance B. That is fine
 *    because a given request is handled by exactly one instance and the queue
 *    drains on that same instance.
 *  - But any email still queued (or in backoff) when instance A is replaced by
 *    a rolling deploy, evicted, or OOM-killed is **lost permanently**. There is no
 *    copy in the database, so a crashed task silently drops password-reset,
 *    order-confirmation and invoice emails.
 *  - `processingTimeout.unref()` means a pending batch will not hold the process
 *    open on its own; shutdown will simply abandon it.
 *
 * Acceptable for transactional mail at current volume, but it must not be
 * mistaken for a durable or distributed queue. If mail becomes
 * delivery-guaranteed, move this behind BullMQ/SQS and persist the outbox row
 * (or add an `EmailLog` table with a `PENDING` status swept by a single
 * worker/leader-elected task).
 */
export class EmailQueue {
  private static queue: QueuedEmail[] = []
  private static isProcessing = false
  private static processingTimeout?: NodeJS.Timeout

  /**
   * In-memory idempotency ledger. Duplicate transaction email is the most
   * common customer complaint ("I got the order confirmation twice"), and it is
   * structural here: `verifyAndConfirmPayment` and the `payment.captured`
   * webhook can both fire for the same capture, and a delivery status can be
   * retried by the admin UI. Keying dispatch on the logical event id collapses
   * those into a single send.
   */
  private static recentlySent = new Map<string, number>()

  /** Diagnostic surface for the multi-instance health endpoint. */
  static stats() {
    return { pending: EmailQueue.queue.length, isProcessing: EmailQueue.isProcessing }
  }

  private static calculateExponentialBackoff(attempt: number): number {
    const delay = Math.min(retryBaseDelayMs * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS)
    const jitter = Math.random() * 0.1 * delay
    return delay + jitter
  }

  /**
   * Claims a dedupe key. Returns false when the key was already claimed within
   * the TTL window, i.e. the notification has already been dispatched.
   */
  private static claimDedupe(key: string): boolean {
    const now = Date.now()
    for (const [existingKey, claimedAt] of EmailQueue.recentlySent) {
      if (now - claimedAt > DEDUPE_TTL_MS) EmailQueue.recentlySent.delete(existingKey)
    }
    if (EmailQueue.recentlySent.has(key)) return false
    EmailQueue.recentlySent.set(key, now)
    return true
  }

  private static async processQueue(): Promise<void> {
    if (EmailQueue.isProcessing) return
    
    EmailQueue.isProcessing = true
    
    try {
      while (EmailQueue.queue.length > 0) {
        const email = EmailQueue.queue[0]
        EmailQueue.queue.shift()
        
        if (email.status === 'duplicate') {
          logger.info({ id: email.id, template: email.templateName }, 'Skipping duplicate email')
          continue
        }

        // A hard-bounced or complaint-reported recipient stays suppressed until
        // an operator clears it; re-sending only further damages sender
        // reputation.
        if (await EmailQueue.anySuppressed(email.to)) {
          email.status = 'failed'
          email.error = 'Recipient suppressed (hard bounce or complaint)'
          logger.warn({ id: email.id, recipient: email.to }, 'Email skipped: recipient suppressed')
          continue
        }

        email.status = 'processing'
        email.attempts += 1

        try {
          // A single attempt per pass. The retry policy lives here alone; an
          // earlier build also looped inside `sendWithRetry`, so the two loops
          // multiplied and one transient outage produced up to maxAttempts²
          // sends.
          await EmailQueue.attemptSend(email)
          email.status = 'sent'
          email.sentAt = new Date()
          logger.info({ id: email.id, recipient: email.to }, 'Email sent successfully')
        } catch (error: any) {
          email.error = error.message

          const retryable = isRetryableEmailError(error)

          if (!retryable) {
            email.status = 'failed'
            logger.error(
              { id: email.id, error: error.message, template: email.templateName },
              'Email permanently rejected — not retrying'
            )
            // Release the dedupe claim so an operator-triggered resend can go
            // through after the underlying (configuration) fault is fixed.
            if (email.dedupeKey) EmailQueue.recentlySent.delete(email.dedupeKey)
          } else if (email.attempts >= email.maxAttempts) {
            email.status = 'failed'
            logger.error({ id: email.id, error: error.message, attempts: email.attempts }, 'Email failed after max retries')
            // A failed delivery must not reserve its idempotency key forever;
            // an operator or a later lifecycle dispatch can retry after the
            // provider problem has been corrected.
            if (email.dedupeKey) EmailQueue.recentlySent.delete(email.dedupeKey)
          } else {
            email.status = 'pending'
            const delay = EmailQueue.calculateExponentialBackoff(email.attempts)
            EmailQueue.queue.push(email)
            logger.warn({ id: email.id, delay, nextAttempt: email.attempts }, 'Email retry scheduled')
            await sleep(delay)
          }
        }
      }
    } finally {
      EmailQueue.isProcessing = false
    }
  }

  /** True when any recipient of the message is on the suppression list. */
  private static async anySuppressed(to: string | string[]): Promise<boolean> {
    return isAnyRecipientSuppressed(to)
  }

  private static async attemptSend(email: QueuedEmail): Promise<void> {
    return deliverQueuedEmail({
      to: email.to,
      toName: email.toName,
      subject: email.subject,
      htmlBody: email.htmlBody,
      textBody: email.textBody,
      fromEmail: email.fromEmail,
      attachment: email.attachment,
    })
  }

  public static async enqueue(
    email: Omit<QueuedEmail, 'id' | 'attempts' | 'createdAt' | 'status' | 'sentAt' | 'maxAttempts'> & {
      maxAttempts?: number
    },
  ): Promise<string> {
    const id = `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // Durable path: persist before returning so a restart cannot lose the mail.
    if (isOutboxEnabled()) {
      const persistedId = await EmailOutboxService.enqueue({
        to: email.to,
        toName: email.toName,
        subject: email.subject,
        htmlBody: email.htmlBody,
        textBody: email.textBody,
        fromEmail: email.fromEmail,
        templateName: email.templateName,
        maxAttempts: email.maxAttempts,
        dedupeKey: email.dedupeKey,
        attachment: email.attachment,
      })

      if (persistedId === null) {
        logger.info(
          { dedupeKey: email.dedupeKey, template: email.templateName },
          'Duplicate email suppressed (idempotency key)'
        )
        return id
      }

      logger.info({ id: persistedId, template: email.templateName, recipient: email.to }, 'Email queued (durable outbox)')
      return persistedId
    }

    if (email.dedupeKey && !EmailQueue.claimDedupe(email.dedupeKey)) {
      logger.info(
        { dedupeKey: email.dedupeKey, template: email.templateName },
        'Duplicate email suppressed (idempotency key)'
      )
      return id
    }

    const queuedEmail: QueuedEmail = {
      id,
      to: email.to,
      toName: email.toName,
      subject: email.subject,
      htmlBody: email.htmlBody,
      textBody: email.textBody,
      fromEmail: email.fromEmail,
      templateName: email.templateName,
      variables: email.variables,
      attempts: 0,
      maxAttempts: email.maxAttempts ?? MAX_RETRY_ATTEMPTS,
      createdAt: new Date(),
      status: 'pending',
      dedupeKey: email.dedupeKey,
      attachment: email.attachment,
    }

    this.queue.push(queuedEmail)
    
    if (!this.isProcessing) {
      setImmediate(() => this.processQueue())
    }

    logger.info({ id, template: email.templateName, recipient: email.to }, 'Email queued')
    return id
  }

  public static async sendImmediate(
    to: string | string[],
    subject: string,
    htmlBody: string,
    textBody?: string,
    fromEmail?: string,
    maxAttempts = MAX_RETRY_ATTEMPTS,
    dedupeKey?: string
  ): Promise<string> {
    if (dedupeKey && !EmailQueue.claimDedupe(dedupeKey)) {
      logger.info({ dedupeKey, subject }, 'Duplicate email suppressed (idempotency key)')
      return 'duplicate'
    }

    if (await EmailQueue.anySuppressed(to)) {
      if (dedupeKey) EmailQueue.recentlySent.delete(dedupeKey)
      logger.warn({ to, subject }, 'Email skipped: recipient suppressed (hard bounce or complaint)')
      return 'suppressed'
    }

    if (emailTransport.isSimulating()) {
      logger.info({ to, subject }, '[EMAIL SIMULATION] Transactional email prepared (no provider call)')
      return 'simulated'
    }

    let lastError: Error | undefined

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const id = await emailTransport.sendTransactionalEmail({
          to,
          subject,
          htmlContent: htmlBody,
          textContent: textBody,
          fromEmail,
        })
        logger.info({ to, subject, messageId: id, provider: emailTransport.providerName() }, 'Email sent')
        return id
      } catch (error: any) {
        lastError = error
        logger.warn({ to, subject, attempt, error: error.message }, `Send attempt ${attempt} failed`)

        // A permanent rejection (invalid address, unverified sender) will fail
        // identically on every retry; stop and surface it immediately.
        if (!isRetryableEmailError(error)) break

        if (attempt < maxAttempts) {
          await sleep(EmailQueue.calculateExponentialBackoff(attempt))
        }
      }
    }

    if (dedupeKey) EmailQueue.recentlySent.delete(dedupeKey)
    throw lastError
  }

  public static getQueue(): QueuedEmail[] {
    return [...this.queue]
  }

  public static clearQueue(): void {
    this.queue = []
    logger.warn('Email queue cleared')
  }

  public static queueSize(): number {
    return this.queue.length
  }

  /** Test seam: clears the idempotency ledger between cases. */
  public static __resetDedupeForTests(): void {
    EmailQueue.recentlySent.clear()
  }
}

const EMAIL_EVENT_HANDLERS: Record<string, (variables: TemplateVariables) => { subject: string; html: string; text: string }> = {
  order_confirmation: EmailTemplates.orderConfirmation,
  payment_confirmation: EmailTemplates.paymentConfirmation,
  invoice: EmailTemplates.invoiceEmail,
  shipment: EmailTemplates.shipping,
  delivery: EmailTemplates.deliveryComplete,
  welcome: EmailTemplates.welcome,
  verification: EmailTemplates.emailVerification,
  password_reset: EmailTemplates.passwordReset,
  admin_notification: EmailTemplates.adminNotification,
  order_processing: EmailTemplates.orderProcessing,
  out_for_delivery: EmailTemplates.outForDelivery,
  payment_failure: EmailTemplates.paymentFailure,
  order_cancelled: EmailTemplates.orderCancelled,
  refund: EmailTemplates.refundProcessed,
}

export class EmailService {
  public static async sendOrderConfirmation(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.orderConfirmation(variables)
    
    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendPaymentConfirmation(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.paymentConfirmation(variables)
    
    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendInvoice(variables: TemplateVariables, invoiceId?: string): Promise<void> {
    const vars = {
      ...variables,
      invoiceId: invoiceId || variables.invoiceId,
    }
    const { subject, html, text } = EmailTemplates.invoiceEmail(vars)

    await EmailQueue.sendImmediate(vars.customerEmail, subject, html, text)
  }

  public static async sendShipment(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.shipping(variables)
    
    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendDelivery(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.deliveryComplete(variables)
    
    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendOrderProcessing(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.orderProcessing(variables)
    
    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendOutForDelivery(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.outForDelivery(variables)
    
    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendWelcome(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.welcome(variables)
    
    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendVerification(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.emailVerification(variables)
    
    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendPasswordReset(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.passwordReset(variables)
    
    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendPaymentFailure(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.paymentFailure(variables)
    
    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendOrderCancelled(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.orderCancelled(variables)

    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  public static async sendRefund(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.refundProcessed(variables)

    await EmailQueue.sendImmediate(variables.customerEmail, subject, html, text, undefined, undefined, dedupeKey)
  }

  /**
   * Where operational alert mail is addressed. Prefers an explicit
   * `ADMIN_NOTIFICATION_EMAIL`, then the SES/Brevo sender inbox the deployment
   * already configured, so no new variable is mandatory.
   */
  public static adminRecipient(): string {
    return (
      env.ADMIN_NOTIFICATION_EMAIL ||
      env.SES_SENDER_EMAIL ||
      env.BREVO_SENDER_EMAIL
    )
  }

  public static async sendAdminNotification(variables: TemplateVariables, dedupeKey?: string): Promise<void> {
    const { subject, html, text } = EmailTemplates.adminNotification(variables)
    
    await EmailQueue.sendImmediate(
      EmailService.adminRecipient(),
      subject,
      html,
      text,
      undefined,
      undefined,
      dedupeKey
    )
  }

  public static async handleEvent(event: EmailEvent): Promise<string | null> {
    const handler = EMAIL_EVENT_HANDLERS[event.type]
    
    if (!handler) {
      logger.warn({ type: event.type }, 'Unknown email event type')
      return null
    }

    const { subject, html, text } = handler(event.payload)
    
    const recipient = event.recipient ?? event.payload.customerEmail
    if (!recipient) {
      logger.warn({ eventId: event.eventId }, 'No recipient for email event')
      return null
    }

    const queued = await EmailQueue.enqueue({
      to: recipient,
      subject,
      htmlBody: html,
      textBody: text,
      templateName: event.type,
      variables: event.payload,
      maxAttempts: MAX_RETRY_ATTEMPTS,
      dedupeKey: `${event.type}:${event.eventId}:${recipient}`,
    })
    return queued
  }
}

export function getBranding() {
  return BRANDING
}
