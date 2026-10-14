import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  EmailQueue,
  EmailService,
  __setEmailRetryDelayForTests,
} from '../../src/services/email.service'
import { emailTransport } from '../../src/integrations/email/email-transport'
import { EmailDeliveryError } from '../../src/integrations/email/email-errors'
import { EmailSuppressionService } from '../../src/integrations/email/email-suppression.service'
import { captureEmailTransport, type EmailTransportCapture } from '../integration/helpers/email-capture'

/**
 * Retry policy and idempotency of the transactional mail queue.
 *
 * Two real defects are pinned here: the retry loop used to live in *two* places
 * (the queue and `sendWithRetry`), so a transient outage produced up to
 * maxAttempts² sends; and the `duplicate` status was declared but never set, so
 * the same logical event could be mailed twice.
 */
describe('EmailQueue retry policy and idempotency', () => {
  let cap: EmailTransportCapture | undefined

  beforeEach(() => {
    EmailQueue.clearQueue()
    EmailQueue.__resetDedupeForTests()
    // Seed an empty suppression map so the send path never touches the database
    // from a unit test.
    EmailSuppressionService.__seedForTests({})
    __setEmailRetryDelayForTests(1)
  })

  afterEach(() => {
    cap?.restore()
    cap = undefined
    EmailQueue.clearQueue()
    EmailQueue.__resetDedupeForTests()
    EmailSuppressionService.__resetCacheForTests()
    vi.restoreAllMocks()
  })

  it('suppresses a second send with the same idempotency key', async () => {
    cap = captureEmailTransport()

    await EmailService.sendVerification(
      { customerEmail: 'customer@example.com', customerName: 'C', verificationToken: 'tok' },
      'verification:user-1'
    )
    await EmailService.sendVerification(
      { customerEmail: 'customer@example.com', customerName: 'C', verificationToken: 'tok' },
      'verification:user-1'
    )

    expect(cap.emails).toHaveLength(1)
  })

  it('retries a transient failure and eventually succeeds', async () => {
    let attempts = 0
    vi.spyOn(emailTransport, 'isSimulating').mockReturnValue(false)
    vi.spyOn(emailTransport, 'sendTransactionalEmail').mockImplementation(async () => {
      attempts += 1
      if (attempts < 3) {
        throw new EmailDeliveryError('throttled', { provider: 'ses', retryable: true })
      }
      return 'ok'
    })

    const id = await EmailQueue.sendImmediate('a@example.com', 's', '<p>x</p>', undefined, undefined, 3)
    expect(id).toBe('ok')
    expect(attempts).toBe(3)
  })

  it('does not retry a permanent rejection', async () => {
    let attempts = 0
    vi.spyOn(emailTransport, 'isSimulating').mockReturnValue(false)
    vi.spyOn(emailTransport, 'sendTransactionalEmail').mockImplementation(async () => {
      attempts += 1
      throw new EmailDeliveryError('not verified', { provider: 'ses', retryable: false })
    })

    await expect(
      EmailQueue.sendImmediate('a@example.com', 's', '<p>x</p>', undefined, undefined, 3)
    ).rejects.toBeInstanceOf(EmailDeliveryError)
    expect(attempts).toBe(1)
  })

  it('stops after maxAttempts when failures are retryable', async () => {
    let attempts = 0
    vi.spyOn(emailTransport, 'isSimulating').mockReturnValue(false)
    vi.spyOn(emailTransport, 'sendTransactionalEmail').mockImplementation(async () => {
      attempts += 1
      throw new EmailDeliveryError('unavailable', { provider: 'ses', retryable: true })
    })

    await expect(
      EmailQueue.sendImmediate('a@example.com', 's', '<p>x</p>', undefined, undefined, 3)
    ).rejects.toBeInstanceOf(EmailDeliveryError)
    expect(attempts).toBe(3)
  })

  it('short-circuits to a simulation marker without calling the provider', async () => {
    vi.spyOn(emailTransport, 'isSimulating').mockReturnValue(true)
    const send = vi.spyOn(emailTransport, 'sendTransactionalEmail')

    const id = await EmailQueue.sendImmediate('a@example.com', 's', '<p>x</p>')
    expect(id).toBe('simulated')
    expect(send).not.toHaveBeenCalled()
  })

  it('drops a duplicate lifecycle event enqueue keyed on event id', async () => {
    cap = captureEmailTransport()

    EmailService.handleEvent({
      eventId: 'order-confirmed-1',
      type: 'order_confirmation',
      payload: { customerEmail: 'a@example.com', customerName: 'A', orderNumber: 'VF-1' },
    })
    EmailService.handleEvent({
      eventId: 'order-confirmed-1',
      type: 'order_confirmation',
      payload: { customerEmail: 'a@example.com', customerName: 'A', orderNumber: 'VF-1' },
    })

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(cap.emails).toHaveLength(1)
  })
})
