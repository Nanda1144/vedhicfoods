import { Response } from 'express'
import { ZodError } from 'zod'
import { HTTP_STATUS, ERROR_CODES } from '../constants'
import { ApiResponse } from '../types'
import { AppError } from './errors'
import { env } from '../config/env'

export function sendSuccess<T>(
  res: Response,
  data?: T,
  message: string = 'Request successful',
  statusCode: number = HTTP_STATUS.OK
): Response {
  const responseBody: ApiResponse<T> = {
    success: true,
    message,
    data,
  }
  return res.status(statusCode).json(responseBody)
}

export function sendError(
  res: Response,
  message: string = 'An error occurred',
  statusCode: number = HTTP_STATUS.INTERNAL_SERVER_ERROR,
  code: string = 'ERROR',
  details?: unknown
): Response {
  const responseBody = {
    success: false,
    message,
    error: message,
    code,
    details,
  }
  return res.status(statusCode).json(responseBody)
}

/**
 * Emits an error response from a controller catch block without leaking internals.
 *
 * SECURITY: a broad set of handlers used the pattern
 *
 *   res.status(error.statusCode || 500).json({ error: error.message })
 *
 * which forwards whatever the failure was — a Prisma constraint name, a
 * gateway SDK message, a file path, a SQL fragment — straight to the client and
 * bypasses the scrubbing in `errorHandlerMiddleware` entirely.
 *
 * Behaviour:
 * - `AppError` instances are operational and authored deliberately, so their
 *   message and status are preserved in every environment.
 * - Any other error is unexpected. In production only a generic message and the
 *   request id are returned; the real message is left to the server log.
 */
export function sendControllerError(
  res: Response,
  error: unknown,
  fallbackMessage: string,
  // `req.id` is typed as `ReqId` (string | number | object) by
  // express-request-id, so it is normalized to a string below.
  requestId?: unknown
): Response {
  const isProduction = env.NODE_ENV === 'production'

  if (error instanceof AppError) {
    return sendError(
      res,
      error.message,
      error.statusCode,
      error.code,
      isProduction ? undefined : error.details
    )
  }

  // A schema violation raised by a `.parse()` call inside a controller's
  // `try` block reaches this helper rather than the central error middleware.
  // Without this branch it fell through as an unexpected exception and was
  // reported as 500 — the same status a genuine server fault produces — which
  // is both wrong for the client and makes real outages indistinguishable from
  // a bad query parameter.
  if (error instanceof ZodError) {
    const details = error.errors.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }))
    return sendError(
      res,
      details[0]?.message ?? 'Validation failed',
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      details
    )
  }

  const message = isProduction
    ? fallbackMessage
    : error instanceof Error
      ? error.message
      : fallbackMessage

  const body: Record<string, unknown> = {
    success: false,
    error: message,
    message,
  }

  // Lets a user quote the request id to support without exposing internals.
  if (typeof requestId === 'string' || typeof requestId === 'number') {
    body.requestId = String(requestId)
  }

  const statusCode =
    error && typeof (error as any).statusCode === 'number'
      ? (error as any).statusCode
      : HTTP_STATUS.INTERNAL_SERVER_ERROR

  return res.status(statusCode).json(body)
}
