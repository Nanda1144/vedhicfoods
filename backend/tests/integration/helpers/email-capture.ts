import { vi } from 'vitest'
import { emailTransport } from '../../../src/integrations/email/email-transport'
import type {
  SendAttachmentEmailOptions,
  SendTransactionalEmailOptions,
} from '../../../src/integrations/email/email-provider.types'

/**
 * Intercepts every outbound email at the transport boundary.
 *
 * The suite asserts on *what the application decided to send* (recipient,
 * subject, body, attachment) without reaching Brevo or SES. This is the highest
 * seam that is still provider-agnostic: `EmailService`, `SupportNotificationService`,
 * `InvoiceEmailService` and the lifecycle notifiers all funnel through
 * `emailTransport`, so one spy observes every path.
 */
export interface EmailTransportCapture {
  emails: SendTransactionalEmailOptions[]
  attachments: SendAttachmentEmailOptions[]
  to(recipient: string): SendTransactionalEmailOptions[]
  subjectContains(fragment: string): SendTransactionalEmailOptions[]
  restore(): void
}

export function captureEmailTransport(): EmailTransportCapture {
  const emails: SendTransactionalEmailOptions[] = []
  const attachments: SendAttachmentEmailOptions[] = []

  const tx = vi
    .spyOn(emailTransport, 'sendTransactionalEmail')
    .mockImplementation(async (options) => {
      emails.push(options)
      return 'msg_test_1'
    })

  const at = vi
    .spyOn(emailTransport, 'sendAttachmentEmail')
    .mockImplementation(async (options) => {
      attachments.push(options)
      return true
    })

  const sim = vi.spyOn(emailTransport, 'isSimulating').mockReturnValue(false)
  const prov = vi.spyOn(emailTransport, 'providerName').mockReturnValue('capture')

  return {
    emails,
    attachments,
    to: (recipient: string) =>
      emails.filter((e) =>
        (Array.isArray(e.to) ? e.to : [e.to]).some((a) => a.toLowerCase() === recipient.toLowerCase())
      ),
    subjectContains: (fragment: string) =>
      emails.filter((e) => e.subject.toLowerCase().includes(fragment.toLowerCase())),
    restore: () => {
      tx.mockRestore()
      at.mockRestore()
      sim.mockRestore()
      prov.mockRestore()
    },
  }
}
