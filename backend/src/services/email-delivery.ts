import { emailTransport } from '../integrations/email/email-transport'
import { EmailDeliveryError } from '../integrations/email/email-errors'
import { EmailSuppressionService } from '../integrations/email/email-suppression.service'

/**
 * The minimal shape needed to actually hand a message to the provider.
 *
 * Shared by the in-memory retry queue (`EmailQueue.attemptSend`) and the
 * durable outbox worker so both paths deliver identically — one retry policy,
 * one suppression check, one attachment code path.
 */
export interface DeliverableEmail {
  to: string | string[]
  toName?: string
  subject: string
  htmlBody: string
  textBody?: string
  fromEmail?: string
  attachment?: { name: string; content: string }
}

/** True when any recipient of the message is on the suppression list. */
export async function isAnyRecipientSuppressed(to: string | string[]): Promise<boolean> {
  const recipients = Array.isArray(to) ? to : [to]
  for (const address of recipients) {
    if (address && (await EmailSuppressionService.isSuppressed(address))) return true
  }
  return false
}

/**
 * Performs a single delivery attempt. Throws on failure; the caller owns the
 * retry/backoff decision via `isRetryableEmailError`.
 */
export async function deliverQueuedEmail(email: DeliverableEmail): Promise<void> {
  if (email.attachment) {
    const toEmail = Array.isArray(email.to) ? email.to[0] : email.to
    const sent = await emailTransport.sendAttachmentEmail({
      toEmail,
      toName: email.toName ?? toEmail,
      subject: email.subject,
      htmlContent: email.htmlBody,
      attachment: email.attachment,
    })
    if (!sent) {
      throw new EmailDeliveryError('Email attachment delivery failed', {
        provider: emailTransport.providerName(),
        retryable: true,
      })
    }
    return
  }

  await emailTransport.sendTransactionalEmail({
    to: email.to,
    subject: email.subject,
    htmlContent: email.htmlBody,
    textContent: email.textBody,
    fromEmail: email.fromEmail,
  })
}
