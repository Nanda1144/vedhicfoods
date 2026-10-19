import { logger } from '../../config/logger'
import { env } from '../../config/env'
import { BrevoEmailService } from '../brevo/brevo.service'
import { SesEmailService } from '../ses/ses.service'
import type {
  EmailProvider,
  SendAttachmentEmailOptions,
  SendTransactionalEmailOptions,
} from './email-provider.types'

/**
 * Brevo adapted to the shared `EmailProvider` contract.
 */
const brevoProvider: EmailProvider = {
  name: 'brevo',
  isConfigured: () => BrevoEmailService.isConfigured(),
  shouldSimulate: () => BrevoEmailService.shouldSimulate(),
  sendTransactionalEmail: (options) => BrevoEmailService.sendTransactionalEmail(options),
  sendAttachmentEmail: (options: SendAttachmentEmailOptions) =>
    BrevoEmailService.sendEmail({
      toEmail: options.toEmail,
      toName: options.toName,
      subject: options.subject,
      htmlContent: options.htmlContent,
      attachment: options.attachment,
    }),
}

/**
 * Resolves the active transport.
 *
 * `auto` prefers SES and falls back to Brevo only when SES is unusable, so a
 * developer with no AWS credentials is not blocked while production still gets
 * the IAM-scoped in-region transport. The choice is resolved once at first use
 * and then logged, because "which provider sent this?" is the first question
 * when mail goes missing in production and the answer must not require a
 * debugger.
 */
let resolved: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (resolved) return resolved

  switch (env.EMAIL_PROVIDER) {
    case 'ses':
      resolved = SesEmailService.instance
      break
    case 'brevo':
      resolved = brevoProvider
      break
    case 'auto':
    default:
      resolved = SesEmailService.instance.isConfigured() ? SesEmailService.instance : brevoProvider
      break
  }

  if (env.NODE_ENV === 'production') {
    logger.info(
      { provider: resolved.name, configured: resolved.isConfigured() },
      'Email transport selected'
    )
    if (!resolved.isConfigured()) {
      // Loud on purpose: a production task that cannot send mail will silently
      // drop password resets and order confirmations.
      logger.error(
        { provider: resolved.name },
        'Email provider selected but NOT configured - transactional email will be dropped. ' +
          'Verify the SES sender identity / SES_SENDER_EMAIL, or the Brevo API key.'
      )
    }
  }

  return resolved
}

/** Test seam: forces re-resolution after env changes. */
export function __resetEmailProviderForTests(): void {
  resolved = null
}

export const emailTransport = {
  sendTransactionalEmail: (options: SendTransactionalEmailOptions): Promise<string> =>
    getEmailProvider().sendTransactionalEmail(options),

  sendAttachmentEmail: (options: SendAttachmentEmailOptions): Promise<boolean> =>
    getEmailProvider().sendAttachmentEmail(options),

  isSimulating: (): boolean => getEmailProvider().shouldSimulate(),

  providerName: (): string => getEmailProvider().name,
}

export type { EmailProvider, SendTransactionalEmailOptions, SendAttachmentEmailOptions }
