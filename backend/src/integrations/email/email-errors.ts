import { AppError } from '../../utils/errors'
import { ERROR_CODES, HTTP_STATUS } from '../../constants'

/**
 * A provider-reported email delivery failure, tagged with whether a retry could
 * plausibly succeed.
 *
 * Retrying a *permanent* rejection (a malformed address, an unverified sender,
 * an account whose sending is paused) only multiplies the work and the log
 * noise for an outcome that cannot change. The retry loop therefore needs the
 * classification attached to the error rather than re-deriving it from a status
 * code it no longer has.
 */
export class EmailDeliveryError extends AppError {
  public readonly provider: string
  public readonly retryable: boolean

  constructor(
    message: string,
    options: {
      provider: string
      retryable: boolean
      statusCode?: number
      code?: string
      cause?: unknown
    }
  ) {
    super(
      message,
      options.statusCode ?? HTTP_STATUS.INTERNAL_SERVER_ERROR,
      options.code ?? ERROR_CODES.EMAIL_SERVICE_ERROR
    )
    this.name = 'EmailDeliveryError'
    this.provider = options.provider
    this.retryable = options.retryable
    if (options.cause !== undefined) {
      ;(this as { cause?: unknown }).cause = options.cause
    }
  }
}

/**
 * Decides whether an error thrown by a transport is worth retrying.
 *
 * Defaults to `true`: an unrecognised failure is treated as transient so the
 * queue's backoff gets a chance, which matches the previous blanket-retry
 * behaviour and never silently drops mail the first time it hiccups.
 */
export function isRetryableEmailError(error: unknown): boolean {
  if (error instanceof EmailDeliveryError) return error.retryable
  return true
}

/**
 * SES error names that can never succeed on retry. The SDK surfaces these as
 * `err.name`; `$metadata.httpStatusCode` is retained as a cross-check.
 */
const PERMANENT_SES_ERRORS = new Set([
  'MessageRejected',
  'MailFromDomainNotVerifiedException',
  'EmailAddressNotVerifiedException',
  'InvalidParameterValue',
  'InvalidParameterValueException',
  'AccountSendingPausedException',
  'ConfigurationSetDoesNotExistException',
  'AccessDeniedException',
  'SignatureDoesNotMatch',
  'AuthorizationError',
])

/** SES error names that are transient and should be retried with backoff. */
const RETRYABLE_SES_ERRORS = new Set([
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailable',
  'ServiceUnavailableException',
  'RequestTimeout',
  'RequestTimeoutException',
  'InternalFailure',
  'InternalServiceError',
  'TimeoutError',
  'NetworkingError',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'EAI_AGAIN',
])

/** Classifies an AWS SDK SES error into retryable vs permanent. */
export function isRetryableSesError(error: any): boolean {
  const name: string = error?.name || ''
  if (PERMANENT_SES_ERRORS.has(name)) return false
  if (RETRYABLE_SES_ERRORS.has(name)) return true

  const status = error?.$metadata?.httpStatusCode
  if (typeof status === 'number') {
    // 429 Too Many Requests and 5xx are transient; 4xx are caller/permanent.
    return status === 429 || status >= 500
  }
  return true
}

/**
 * Classifies a Brevo HTTP response/transport failure. `status` is undefined for
 * network-level failures (DNS, reset, timeout), which are always retryable.
 */
export function isRetryableBrevoStatus(status?: number): boolean {
  if (status === undefined) return true
  return status === 429 || status >= 500
}
