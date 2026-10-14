import pino from 'pino'
import { env } from './env'

const isProduction = env.NODE_ENV === 'production'

export const logger = pino({
  level: env.LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  /**
   * Redaction list.
   *
   * Every entry here corresponds to a credential or bearer token that, once
   * written to CloudWatch, is readable by anyone with `logs:FilterLogEvents`
   * and retained for the life of the log group. Note the wildcards: the same
   * secret appears under many different keys depending on the call site
   * (`body.token`, `params.token`, `metadata.resetToken`, ...), and enumerating
   * only the paths observed so far silently misses new ones.
   */
  redact: {
    paths: [
      // Request/response headers
      'req.headers.authorization',
      'req.headers.Authorization',
      'req.headers.cookie',
      'req.headers.Cookie',
      'req.headers["x-razorpay-signature"]',
      'res.headers["set-cookie"]',

      // Request bodies (any nesting level)
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.confirmPassword',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.verificationToken',
      '*.resetToken',
      '*.secret',
      '*.keySecret',
      '*.apiSecret',
      '*.razorpaySignature',
      '*.razorpay_signature',
      '*.creditCard',
      '*.cardNumber',
      '*.card_number',
      '*.cvv',
      '*.cvc',

      // Encrypted credential blobs decrypted back into memory for API calls
      '*.keySecretDecrypted',
      '*.webhookSecret',

      // Environment / config
      '*.JWT_SECRET',
      '*.RAZORPAY_KEY_SECRET',
      '*.RAZORPAY_WEBHOOK_SECRET',
      '*.ENCRYPTION_KEY',
      '*.DATABASE_URL',

      // AWS credentials
      '*.secretAccessKey',
      '*.sessionToken',

      // Nested metadata objects on audit records
      'metadata.token',
      'metadata.resetToken',
      'metadata.verificationToken',
      'metadata.secret',
    ],
    censor: '[Redacted]',
  },
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
})