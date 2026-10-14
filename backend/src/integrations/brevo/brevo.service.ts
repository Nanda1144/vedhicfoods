import { env } from '../../config/env'
import { logger } from '../../config/logger'
import { AppError } from '../../utils/errors'
import { ERROR_CODES, HTTP_STATUS } from '../../constants'
import { EmailDeliveryError, isRetryableBrevoStatus } from '../email/email-errors'

export interface SendBrevoEmailOptions {
  toEmail: string
  toName: string
  subject: string
  htmlContent: string
  attachment?: {
    name: string
    content: string // Base64 encoded string
  }
}

/**
 * Provider-agnostic shape used by the transactional callers (auth, support,
 * checkout). Brevo is the single email transport for this service.
 */
export interface SendTransactionalEmailOptions {
  to: string | string[]
  subject: string
  htmlContent: string
  textContent?: string
  fromEmail?: string
  fromName?: string
}

export class BrevoEmailService {
  private static readonly apiUrl = 'https://api.brevo.com/v3/smtp/email'

  /**
   * True when a Brevo API key is available. Callers use this to decide between
   * a simulated dispatch (local dev / unconfigured) and a real one.
   */
  public static isConfigured(): boolean {
    return Boolean(env.BREVO_API_KEY)
  }

  /**
   * True when the transport must not reach the provider.
   *
   * Under NODE_ENV=test this is unconditional: a valid BREVO_API_KEY in .env
   * would otherwise let integration tests send real mail, burn the daily
   * transactional quota and depend on sender verification. In development it
   * applies only while no API key is configured.
   */
  public static shouldSimulate(): boolean {
    if (env.NODE_ENV === 'test') return true
    return env.NODE_ENV === 'development' && !this.isConfigured()
  }

  /**
   * Single low-level Brevo POST shared by every email path.
   * Throws AppError on rejection so callers can apply their own retry and
   * failure-recording policy.
   */
  private static async dispatch(payload: Record<string, any>, recipientCount: number): Promise<string> {
    const apiKey = env.BREVO_API_KEY

    if (!apiKey) {
      throw new AppError(
        'Email provider is not configured (BREVO_API_KEY missing)',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.EMAIL_SERVICE_ERROR
      )
    }

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error({ status: response.status, error: errorText }, 'Brevo email dispatch failed')
      throw new EmailDeliveryError('Email notification service failed', {
        provider: 'brevo',
        retryable: isRetryableBrevoStatus(response.status),
      })
    }

    const resData: any = await response.json()
    logger.info(
      { messageId: resData.messageId, recipientCount },
      'Transactional email successfully sent via Brevo!'
    )
    return resData.messageId || 'dispatched'
  }

  private static buildRecipients(to: string | string[]): { email: string }[] {
    return (Array.isArray(to) ? to : [to]).map((email) => ({ email }))
  }

  /**
   * Dispatches a transactional email through the Brevo (Sendinblue) API v3 and
   * returns the provider message id. Used by auth, support and checkout mail.
   */
  public static async sendTransactionalEmail(options: SendTransactionalEmailOptions): Promise<string> {
    const recipients = this.buildRecipients(options.to)

    if (this.shouldSimulate()) {
      logger.info(
        { to: options.to, subject: options.subject },
        '[BREVO SIMULATION] Transactional email prepared (no provider call)'
      )
      return 'simulated'
    }

    const payload: Record<string, any> = {
      sender: {
        name: options.fromName || env.BREVO_SENDER_NAME,
        email: options.fromEmail || env.BREVO_SENDER_EMAIL,
      },
      to: recipients,
      subject: options.subject,
      htmlContent: options.htmlContent,
    }

    if (options.textContent) {
      payload.textContent = options.textContent
    }

    try {
      return await this.dispatch(payload, recipients.length)
    } catch (err: any) {
      if (err instanceof AppError) throw err
      logger.error({ error: err.message }, 'Exception while calling Brevo API')
      throw new EmailDeliveryError('Email notification service failed', {
        provider: 'brevo',
        // Network-level failures (DNS, reset, timeout) have no HTTP status and
        // are transient; give the queue a chance to retry them.
        retryable: true,
        cause: err,
      })
    }
  }

  /**
   * Dispatches a transactional email directly through the Brevo (Sendinblue) API v3.
   * Returns false instead of throwing, for callers that treat delivery as
   * best-effort and already handle a missing key by simulating.
   */
  public static async sendEmail(options: SendBrevoEmailOptions): Promise<boolean> {
    // Never contact the provider in local dev without a key, or under test.
    if (this.shouldSimulate()) {
      logger.info(
        {
          to: options.toEmail,
          subject: options.subject,
          hasAttachment: Boolean(options.attachment),
        },
        '[BREVO SIMULATION] Email prepared with A4 PDF invoice (Set BREVO_API_KEY in .env to send live)'
      )
      return true
    }

    try {
      const payload: Record<string, any> = {
        sender: {
          name: env.BREVO_SENDER_NAME,
          email: env.BREVO_SENDER_EMAIL,
        },
        to: [
          {
            email: options.toEmail,
            name: options.toName,
          },
        ],
        subject: options.subject,
        htmlContent: options.htmlContent,
      }

      if (options.attachment) {
        payload.attachment = [options.attachment]
      }

      await this.dispatch(payload, 1)
      return true
    } catch (err: any) {
      logger.error({ error: err.message }, 'Exception while calling Brevo API')
      return false
    }
  }
}
