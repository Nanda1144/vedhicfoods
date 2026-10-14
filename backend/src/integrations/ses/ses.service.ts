import {
  SESClient,
  SendEmailCommand,
  SendRawEmailCommand,
  type SESClientConfig,
} from '@aws-sdk/client-ses'
import { env } from '../../config/env'
import { logger } from '../../config/logger'
import { AppError } from '../../utils/errors'
import { ERROR_CODES, HTTP_STATUS } from '../../constants'
import { EmailDeliveryError, isRetryableSesError } from '../email/email-errors'
import type {
  EmailProvider,
  SendAttachmentEmailOptions,
  SendTransactionalEmailOptions,
} from '../email/email-provider.types'

/**
 * Amazon SES transactional email transport.
 *
 * Chosen over Brevo for production because it is in the same AWS account and
 * region as the rest of the stack: IAM-scoped (no long-lived API key to leak or
 * rotate), billed through the same account, CloudWatch-capturable via
 * SES event publishing, and deliverable from an SES-verified domain without
 * third-party DNS delegation.
 *
 * Brevo is retained as a supported provider because it is already integrated and
 * is the only option that works from a local development machine without AWS
 * credentials. Selection is by `EMAIL_PROVIDER`.
 */

/**
 * Module-level singleton, matching the existing S3 client.
 *
 * Reused deliberately: the SDK client owns an HTTP connection pool and TLS
 * sessions, so constructing one per request would add a TLS handshake to every
 * email and exhaust sockets under load.
 */
let sesClient: SESClient | null = null

function getSesClient(): SESClient {
  if (sesClient) return sesClient

  // The region is resolved from AWS_REGION by the SDK's default provider chain;
  // it is only pinned when SES_REGION is set explicitly, so the client follows
  // the task's configured region instead of a hardcoded one.
  const config: SESClientConfig = {}
  const region = env.SES_REGION || env.AWS_REGION
  if (region) config.region = region

  sesClient = new SESClient(config)
  return sesClient
}

/** Test seam: drops the cached client. */
export function __resetSesClientForTests(): void {
  sesClient = null
}

/**
 * Test seam: injects a stub client so the suite can assert the *command shape*
 * (raw MIME vs simple send, recipients, subject, attachment) and simulate
 * provider failures without reaching AWS.
 */
export function __setSesClientForTests(client: SESClient | null): void {
  sesClient = client
}

/** Encodes a header value that may contain non-ASCII as an RFC 2047 word. */
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

export class SesEmailService implements EmailProvider {
  public static readonly name = 'ses'

  public static readonly instance: EmailProvider = new SesEmailService()

  public readonly name = SesEmailService.name

  /**
   * SES is configured when a sender address is known. Credentials are NOT
   * checked here on purpose: on ECS/Fargate they come from the task role, and
   * requiring static keys would push operators toward baking credentials into
   * the environment.
   */
  public isConfigured(): boolean {
    return Boolean(env.SES_SENDER_EMAIL)
  }

  public shouldSimulate(): boolean {
    if (env.NODE_ENV === 'test') return true
    return env.NODE_ENV === 'development' && !this.isConfigured()
  }

  /**
   * SES takes RFC 5322 address strings, not the `{ Email, Name }` objects Brevo
   * uses, so the display name has to be encoded into the address itself.
   */
  private formatAddress(email: string, name?: string): string {
    if (!name) return email
    // A non-ASCII display name must be a MIME encoded-word; SES rejects the
    // raw UTF-8 form, so it is encoded rather than sent malformed.
    return `${encodeHeaderValue(name)} <${email}>`
  }

  public async sendTransactionalEmail(options: SendTransactionalEmailOptions): Promise<string> {
    const to = (Array.isArray(options.to) ? options.to : [options.to]).filter(Boolean)
    if (!to.length) throw new AppError('No recipients supplied', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR)

    if (this.shouldSimulate()) {
      logger.info(
        { to, subject: options.subject },
        '[SES SIMULATION] Transactional email prepared (no provider call)'
      )
      return 'simulated'
    }

    const fromEmail = options.fromEmail || env.SES_SENDER_EMAIL
    const fromName = options.fromName || env.SES_SENDER_NAME

    const command = new SendEmailCommand({
      Source: this.formatAddress(fromEmail!, fromName),
      Destination: {
        // Recipients are bare addresses. The previous code put the *sender's*
        // display name on every recipient, so a customer's inbox showed
        // "Vedhic Foods" as the name of the person the mail was addressed to.
        ToAddresses: to,
      },
      // `ReplyToAddresses` is a top-level SendEmail field, not a member of
      // `Destination`. Nesting it there (as the original code did) meant the
      // reply-to was silently discarded by SES.
      ...(options.replyTo ? { ReplyToAddresses: [options.replyTo] } : {}),
      Message: {
        Subject: { Charset: 'UTF-8', Data: options.subject },
        Body: {
          Html: { Charset: 'UTF-8', Data: options.htmlContent },
          ...(options.textContent
            ? { Text: { Charset: 'UTF-8', Data: options.textContent } }
            : {}),
        },
      },
      // Ties every send to a CloudWatch metric/dimension set, which is what
      // makes bounce and complaint rates alertable.
      ...(env.SES_CONFIGURATION_SET ? { ConfigurationSetName: env.SES_CONFIGURATION_SET } : {}),
    })

    try {
      const result = await getSesClient().send(command)
      return result.MessageId ?? 'sent'
    } catch (err: any) {
      logger.error(
        { error: err?.message, name: err?.name, subject: options.subject },
        'Exception while calling SES SendEmail'
      )
      throw new EmailDeliveryError('Email notification service failed', {
        provider: 'ses',
        retryable: isRetryableSesError(err),
        cause: err,
      })
    }
  }

  /** Builds a multipart/mixed RFC 5322 message with an HTML body + attachment. */
  private buildRawMime(options: SendAttachmentEmailOptions, fromEmail: string, fromName: string): string {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const htmlBase64 = Buffer.from(options.htmlContent, 'utf8').toString('base64')

    const lines = [
      `From: ${this.formatAddress(fromEmail, fromName)}`,
      `To: ${this.formatAddress(options.toEmail, options.toName)}`,
      `Subject: ${encodeHeaderValue(options.subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      htmlBase64,
      `--${boundary}`,
      `Content-Type: application/octet-stream; name="${options.attachment.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${options.attachment.name}"`,
      '',
      options.attachment.content,
      `--${boundary}--`,
      '',
    ]

    return lines.join('\r\n')
  }

  /**
   * Best-effort send with an attachment. Returns false rather than throwing.
   *
   * Uses `SendRawEmail` because SES's simple `SendEmail` API has no attachment
   * field: the previous implementation silently dropped the PDF invoice and
   * sent only the HTML body, so every customer received an "invoice attached"
   * email with nothing attached.
   */
  public async sendAttachmentEmail(options: SendAttachmentEmailOptions): Promise<boolean> {
    if (this.shouldSimulate()) {
      logger.info(
        { to: options.toEmail, subject: options.subject, attachment: options.attachment?.name },
        '[SES SIMULATION] Email with attachment prepared (no provider call)'
      )
      return true
    }

    const fromEmail = env.SES_SENDER_EMAIL!
    const fromName = env.SES_SENDER_NAME
    const raw = this.buildRawMime(options, fromEmail, fromName)

    const command = new SendRawEmailCommand({
      Source: this.formatAddress(fromEmail, fromName),
      Destinations: [options.toEmail],
      RawMessage: { Data: Buffer.from(raw, 'utf8') },
      ...(env.SES_CONFIGURATION_SET ? { ConfigurationSetName: env.SES_CONFIGURATION_SET } : {}),
    })

    try {
      await getSesClient().send(command)
      return true
    } catch (err: any) {
      logger.error(
        { error: err?.message, name: err?.name, to: options.toEmail },
        'Exception while calling SES SendRawEmail (attachment)'
      )
      return false
    }
  }
}
