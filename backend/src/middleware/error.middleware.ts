import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import { AppError } from '../utils/errors'
import { sendError } from '../utils/api-response'
import { HTTP_STATUS, ERROR_CODES } from '../constants'
import { logger } from '../config/logger'
import { env } from '../config/env'

export function errorHandlerMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isProduction = env.NODE_ENV === 'production'
  const requestId = req.id

  // 1. Handled AppError instances
  if (err instanceof AppError) {
    if (!isProduction || !err.isOperational) {
      logger.error({ requestId, err }, `AppError: ${err.message}`)
    }
    // SECURITY: `details` frequently carries upstream payloads, object keys,
    // SQL fragments or provider responses. It is logged, never returned in
    // production.
    sendError(res, err.message, err.statusCode, err.code, isProduction ? undefined : err.details)
    return
  }

  // 2. Zod validation errors
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      code: e.code,
    }))
    logger.warn({ requestId, details }, 'Request validation failed')
    const primaryMessage = details.length > 0 ? details[0].message : 'Validation failed'
    sendError(
      res,
      primaryMessage,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
      details
    )
    return
  }

  // 3. Prisma Database Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    logger.error({ requestId, prismaCode: err.code, err }, 'Prisma Database Error')

    if (err.code === 'P2002') {
      const metaTarget = err.meta?.target
      const target = Array.isArray(metaTarget) ? metaTarget.join(', ') : 'field'
      sendError(
        res,
        `A record with this ${target} already exists`,
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.CONFLICT
      )
      return
    }

    if (err.code === 'P2025') {
      sendError(
        res,
        'Requested record could not be found',
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      )
      return
    }

    sendError(
      res,
      'Database operation failed',
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ERROR_CODES.DATABASE_ERROR
    )
    return
  }

  // 4. Body-parser / http-errors rejections.
  //
  // `express.json()` raises a family of errors that are all *client* faults but
  // none of which is an `AppError`: malformed JSON (`entity.parse.failed`, 400),
  // a body over the configured limit (`entity.too.large`, 413), unsupported
  // charset/encoding (415) and aborted or invalid-length requests. Handled only
  // for `SyntaxError` (the malformed-JSON case) they fell through to branch 5
  // and were reported to the client as 500 — a server fault for what is really
  // a bad request, which also trains operators to ignore real 500s.
  const parserType = (err as { type?: string }).type
  const parserStatus = (err as { status?: number; statusCode?: number }).status ??
    (err as { statusCode?: number }).statusCode
  const isBodyParserError =
    typeof parserStatus === 'number' &&
    parserStatus >= 400 &&
    parserStatus < 500 &&
    (typeof parserType === 'string'
      ? parserType.startsWith('entity.') ||
        parserType.startsWith('request.') ||
        parserType.startsWith('charset.') ||
        parserType.startsWith('encoding.')
      : err instanceof SyntaxError)

  if (isBodyParserError) {
    const isTooLarge = parserType === 'entity.too.large' || parserStatus === HTTP_STATUS.PAYLOAD_TOO_LARGE
    const isMalformed = parserType === 'entity.parse.failed' || err instanceof SyntaxError
    const message = isTooLarge
      ? 'Request payload is too large'
      : isMalformed
        ? 'Malformed JSON payload in request body'
        : 'Invalid request payload'
    logger.warn({ requestId, type: parserType, status: parserStatus }, 'Request payload rejected')
    sendError(
      res,
      message,
      parserStatus as number,
      isTooLarge ? ERROR_CODES.PAYLOAD_TOO_LARGE : ERROR_CODES.BAD_REQUEST
    )
    return
  }

  // 5. Unhandled unexpected errors
  logger.error(
    {
      requestId,
      err: {
        message: err.message,
        stack: err.stack,
        name: err.name,
      },
    },
    'Unhandled Server Exception'
  )

  const message = isProduction
    ? 'An unexpected error occurred. Please try again later.'
    : err.message

  sendError(
    res,
    message,
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    ERROR_CODES.INTERNAL_SERVER_ERROR,
    !isProduction ? { stack: err.stack } : undefined
  )
}
