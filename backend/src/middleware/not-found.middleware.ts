import { Request, Response, NextFunction } from 'express'
import { NotFoundError } from '../utils/errors'
import { logger } from '../config/logger'

/**
 * Terminal 404 handler.
 *
 * SECURITY: the requested URL is logged but not echoed to the client. The old
 * message interpolated `req.originalUrl` verbatim, which reflected attacker
 * input into a JSON error body (rendered as HTML by any client that interpolates
 * `error` unsafely) and republished the query string — which on endpoints like
 * `/auth/verify-email` carries a live one-time account token.
 */
export function notFoundMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const url = req.originalUrl || req.url || ''
  const path = url.split('?')[0]

  logger.warn({ method: req.method, path }, 'Route not found')

  next(new NotFoundError(`Route ${req.method} ${path} not found`))
}