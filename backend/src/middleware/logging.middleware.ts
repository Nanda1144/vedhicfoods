import pinoHttp from 'pino-http'
import type { IncomingMessage } from 'http'
import { logger } from '../config/logger'
import { REQUEST_ID_HEADER } from './request-id.middleware'

/**
 * Returns the request path with the query string removed.
 *
 * SECURITY: one-time account tokens are delivered through links of the form
 * `/auth/verify-email?token=<64 hex chars>`. Logging `req.url` verbatim wrote
 * every live verification and reset token into CloudWatch, where it persisted
 * for the retention period and was readable by every principal with log-read
 * access — turning "check your inbox" into a durable credential leak.
 *
 * The path alone is sufficient for operational debugging.
 */
function pathOnly(req: IncomingMessage): string {
  const url = req.url || ''
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : url.slice(0, queryIndex)
}

export const httpLoggerMiddleware = pinoHttp({
  logger,
  genReqId: (req) => (req.headers[REQUEST_ID_HEADER] as string) || req.id,
  // Drop the query string from the serialized request object as well, since
  // pino-http otherwise attaches `req.url` including its query.
  serializers: {
    req: (req: IncomingMessage & { url?: string }) => ({
      method: req.method,
      url: pathOnly(req),
      remoteAddress: req.socket?.remoteAddress,
    }),
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'info'
  },
  customSuccessMessage: (req, res) =>
    `${req.method} ${pathOnly(req)} completed with status ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${pathOnly(req)} failed with status ${res.statusCode}: ${err.message}`,
})