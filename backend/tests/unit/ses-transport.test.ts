import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SesEmailService,
  __setSesClientForTests,
  __resetSesClientForTests,
} from '../../src/integrations/ses/ses.service'
import { EmailDeliveryError, isRetryableSesError } from '../../src/integrations/email/email-errors'
import { env } from '../../src/config/env'

/**
 * Unit coverage of the SES transport.
 *
 * The SDK client is replaced with a stub so the suite asserts the *command
 * shape* SES receives — which is exactly where the historical defects lived
 * (recipients carried the sender's display name; attachments were silently
 * dropped because the simple SendEmail API was used) — and simulates provider
 * failures to prove the retry classification.
 */
describe('SES transport', () => {
  const saved = {
    NODE_ENV: env.NODE_ENV,
    SES_SENDER_EMAIL: env.SES_SENDER_EMAIL,
    SES_SENDER_NAME: env.SES_SENDER_NAME,
    SES_CONFIGURATION_SET: env.SES_CONFIGURATION_SET,
  }

  let sendMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Past the test-mode simulation gate. Production-only boot guards have
    // already run at import time, so flipping this afterwards is safe here.
    ;(env as any).NODE_ENV = 'production'
    ;(env as any).SES_SENDER_EMAIL = 'noreply@vedhicfoods.com'
    ;(env as any).SES_SENDER_NAME = 'Vedhic Foods'
    ;(env as any).SES_CONFIGURATION_SET = undefined

    sendMock = vi.fn().mockResolvedValue({ MessageId: 'ses-msg-123' })
    __setSesClientForTests({ send: sendMock } as any)
  })

  afterEach(() => {
    __setSesClientForTests(null)
    __resetSesClientForTests()
    Object.assign(env, saved)
    vi.restoreAllMocks()
  })

  it('marks the service configured when a sender identity is present', () => {
    expect(SesEmailService.instance.isConfigured()).toBe(true)
    ;(env as any).SES_SENDER_EMAIL = undefined
    expect(SesEmailService.instance.isConfigured()).toBe(false)
  })

  it('sends a simple message with BARE recipients and a named source', async () => {
    const id = await SesEmailService.instance.sendTransactionalEmail({
      to: 'customer@example.com',
      subject: 'Order Confirmed',
      htmlContent: '<p>hi</p>',
      textContent: 'hi',
    })

    expect(id).toBe('ses-msg-123')
    const command: any = sendMock.mock.calls[0][0]
    expect(command.constructor.name).toBe('SendEmailCommand')
    expect(command.input.Source).toBe('Vedhic Foods <noreply@vedhicfoods.com>')
    // Regression: the sender display name used to be (wrongly) attached to the
    // recipient address, so the customer's inbox showed "Vedhic Foods" as the
    // person the mail was addressed to.
    expect(command.input.Destination.ToAddresses).toEqual(['customer@example.com'])
    expect(command.input.Message.Subject.Data).toBe('Order Confirmed')
    expect(command.input.Message.Body.Html.Data).toBe('<p>hi</p>')
    expect(command.input.Message.Body.Text.Data).toBe('hi')
  })

  it('adds ReplyToAddresses and the configuration set when configured', async () => {
    ;(env as any).SES_CONFIGURATION_SET = 'vedhic-txn'

    await SesEmailService.instance.sendTransactionalEmail({
      to: 'a@example.com',
      subject: 's',
      htmlContent: '<p>x</p>',
      replyTo: 'support@vedhicfoods.com',
    })

    const command: any = sendMock.mock.calls[0][0]
    expect(command.input.ReplyToAddresses).toEqual(['support@vedhicfoods.com'])
    expect(command.input.ConfigurationSetName).toBe('vedhic-txn')
  })

  it('uses SendRawEmail with a MIME attachment for the invoice path', async () => {
    const attachmentBase64 = Buffer.from('PDF-CONTENT').toString('base64')

    const ok = await SesEmailService.instance.sendAttachmentEmail({
      toEmail: 'customer@example.com',
      toName: 'Jane Doe',
      subject: 'Your Invoice',
      htmlContent: '<p>Invoice attached</p>',
      attachment: { name: 'Invoice-VF-1.pdf', content: attachmentBase64 },
    })

    expect(ok).toBe(true)
    const command: any = sendMock.mock.calls[0][0]
    expect(command.constructor.name).toBe('SendRawEmailCommand')
    expect(command.input.Destinations).toEqual(['customer@example.com'])

    const raw = command.input.RawMessage.Data.toString('utf8')
    expect(raw).toContain('multipart/mixed')
    expect(raw).toContain('filename="Invoice-VF-1.pdf"')
    expect(raw).toContain(attachmentBase64)
    // The recipient's own name is used, not the sender's.
    expect(raw).toContain('To: Jane Doe <customer@example.com>')
    expect(raw).toContain('Subject: Your Invoice')
    expect(raw).toContain(Buffer.from('<p>Invoice attached</p>', 'utf8').toString('base64'))
  })

  it('preserves permanent SES rejection classification for attachment failures', async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error('Attachment rejected'), { name: 'MessageRejected' }))

    await expect(
      SesEmailService.instance.sendAttachmentEmail({
        toEmail: 'customer@example.com',
        toName: 'Jane Doe',
        subject: 'Your Invoice',
        htmlContent: '<p>attached</p>',
        attachment: { name: 'Invoice.pdf', content: Buffer.from('x').toString('base64') },
      })
    ).rejects.toSatisfy((err: unknown) => err instanceof EmailDeliveryError && err.retryable === false)
  })

  it('preserves transient throttling classification for attachment failures', async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' }))

    await expect(
      SesEmailService.instance.sendAttachmentEmail({
        toEmail: 'customer@example.com',
        toName: 'Jane Doe',
        subject: 'Your Invoice',
        htmlContent: '<p>attached</p>',
        attachment: { name: 'Invoice.pdf', content: Buffer.from('x').toString('base64') },
      })
    ).rejects.toSatisfy((err: unknown) => err instanceof EmailDeliveryError && err.retryable === true)
  })

  it('rejects a send with no recipients before contacting the provider', async () => {
    await expect(
      SesEmailService.instance.sendTransactionalEmail({
        to: [],
        subject: 's',
        htmlContent: '<p>x</p>',
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('returns a simulation marker under NODE_ENV=test without calling SES', async () => {
    ;(env as any).NODE_ENV = 'test'
    const id = await SesEmailService.instance.sendTransactionalEmail({
      to: 'a@example.com',
      subject: 's',
      htmlContent: '<p>x</p>',
    })
    expect(id).toBe('simulated')
    expect(sendMock).not.toHaveBeenCalled()
  })

  describe('failure classification', () => {
    it('classifies throttling as retryable', async () => {
      sendMock.mockRejectedValueOnce(
        Object.assign(new Error('Rate exceeded'), {
          name: 'ThrottlingException',
          $metadata: { httpStatusCode: 400 },
        })
      )

      await expect(
        SesEmailService.instance.sendTransactionalEmail({ to: 'a@example.com', subject: 's', htmlContent: '<p>x</p>' })
      ).rejects.toSatisfy((err: unknown) => err instanceof EmailDeliveryError && err.retryable === true)
    })

    it('classifies MessageRejected as permanent (not retryable)', async () => {
      sendMock.mockRejectedValueOnce(
        Object.assign(new Error('Email address is not verified'), {
          name: 'MessageRejected',
          $metadata: { httpStatusCode: 400 },
        })
      )

      await expect(
        SesEmailService.instance.sendTransactionalEmail({ to: 'a@example.com', subject: 's', htmlContent: '<p>x</p>' })
      ).rejects.toSatisfy((err: unknown) => err instanceof EmailDeliveryError && err.retryable === false)
    })

    it('classifies a 5xx gateway failure as retryable', () => {
      expect(isRetryableSesError({ name: 'UnknownError', $metadata: { httpStatusCode: 503 } })).toBe(true)
    })

    it('classifies a 4xx client failure as permanent', () => {
      expect(isRetryableSesError({ name: 'UnknownError', $metadata: { httpStatusCode: 400 } })).toBe(false)
    })

    it('defaults unknown errors to retryable', () => {
      expect(isRetryableSesError(new Error('socket hang up'))).toBe(true)
    })
  })
})
