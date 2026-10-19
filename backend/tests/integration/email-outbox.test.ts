import './_safety'
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { prisma } from '../../src/config/database'
import {
  EmailOutboxService,
  EmailOutboxWorker,
  type OutboxEnqueueInput,
} from '../../src/services/email-outbox.service'
import { emailTransport } from '../../src/integrations/email/email-transport'
import { EmailDeliveryError } from '../../src/integrations/email/email-errors'

const ts = Date.now()
const templateName = `itest_outbox_${ts}`

/**
 * Durable email outbox.
 *
 * The in-memory queue loses anything still pending when an instance is replaced
 * during a rolling deploy. These cases pin the replacement's contract: a message
 * is persisted before enqueue returns, a single worker tick claims and delivers
 * it, retryable failures are rescheduled instead of dropped, permanent failures
 * are surfaced, and duplicate dedupe keys do not send twice.
 */
describe('Durable email outbox — persist, claim, retry', () => {
  const reset = async () => {
    await prisma.emailOutbox.deleteMany({ where: { templateName } })
  }

  const baseInput = (overrides: Partial<OutboxEnqueueInput> = {}): OutboxEnqueueInput => ({
    to: `outbox-${Math.random().toString(36).slice(2)}@example.com`,
    subject: 'Outbox test',
    htmlBody: '<p>outbox</p>',
    templateName,
    ...overrides,
  })

  beforeEach(async () => {
    await reset()
    vi.spyOn(emailTransport, 'isSimulating').mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await reset()
  })

  it('persists a message and delivers it on the next worker tick', async () => {
    const send = vi.spyOn(emailTransport, 'sendTransactionalEmail').mockResolvedValue('message-1')

    const id = await EmailOutboxService.enqueue(baseInput())
    expect(id).toBeTruthy()

    // The row exists before any delivery attempt — this is what survives a crash.
    const queued = await prisma.emailOutbox.findUnique({ where: { id: id! } })
    expect(queued?.status).toBe('PENDING')

    const result = await EmailOutboxWorker.runOnce()
    expect(result.sent).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)

    const row = await prisma.emailOutbox.findUnique({ where: { id: id! } })
    expect(row?.status).toBe('SENT')
    expect(row?.sentAt).toBeInstanceOf(Date)
    expect(row?.lastError).toBeNull()
  })

  it('suppresses a duplicate dedupe key instead of sending twice', async () => {
    const input = baseInput({ dedupeKey: `dup-${ts}` })

    const first = await EmailOutboxService.enqueue(input)
    const second = await EmailOutboxService.enqueue(input)

    expect(first).toBeTruthy()
    expect(second).toBeNull()
    expect(await prisma.emailOutbox.count({ where: { templateName } })).toBe(1)
  })

  it('reschedules a retryable failure with backoff instead of dropping it', async () => {
    vi.spyOn(emailTransport, 'sendTransactionalEmail').mockRejectedValue(
      new EmailDeliveryError('provider timeout', {
        provider: 'ses',
        retryable: true,
        cause: { name: 'TimeoutError' },
      })
    )

    const id = await EmailOutboxService.enqueue(baseInput({ maxAttempts: 3 }))
    const result = await EmailOutboxWorker.runOnce()

    expect(result.failed).toBe(0)
    const row = await prisma.emailOutbox.findUnique({ where: { id: id! } })
    expect(row?.status).toBe('PENDING')
    expect(row?.attempts).toBe(1)
    expect(row?.lockedAt).toBeNull()
    expect(row?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
    expect(row?.lastError).toContain('provider timeout')
  })

  it('marks a permanent rejection FAILED and releases its dedupe key', async () => {
    vi.spyOn(emailTransport, 'sendTransactionalEmail').mockRejectedValue(
      new EmailDeliveryError('invalid recipient', { provider: 'ses', retryable: false })
    )

    const id = await EmailOutboxService.enqueue(baseInput({ dedupeKey: `perm-${ts}` }))
    const result = await EmailOutboxWorker.runOnce()

    expect(result.failed).toBe(1)
    const row = await prisma.emailOutbox.findUnique({ where: { id: id! } })
    expect(row?.status).toBe('FAILED')
    expect(row?.dedupeKey).toBeNull()
    expect(row?.lastError).toContain('invalid recipient')
  })

  it('recovers a row abandoned in PROCESSING by a dead worker', async () => {
    const id = await EmailOutboxService.enqueue(baseInput())
    await prisma.emailOutbox.update({
      where: { id: id! },
      data: { status: 'PROCESSING', lockedAt: new Date(Date.now() - 10 * 60 * 1000) },
    })

    const reclaimed = await EmailOutboxService.reclaimStaleLocks()
    expect(reclaimed).toBeGreaterThanOrEqual(1)

    const row = await prisma.emailOutbox.findUnique({ where: { id: id! } })
    expect(row?.status).toBe('PENDING')
    expect(row?.lockedAt).toBeNull()
  })
})
