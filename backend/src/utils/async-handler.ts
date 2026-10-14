import { Request, Response, NextFunction, RequestHandler } from 'express'

/**
 * Wraps an async route handler so rejected promises are forwarded to the
 * Express error pipeline.
 *
 * Express 4 does not await handler return values, so without this a thrown
 * AppError inside an async controller becomes an unhandled rejection and the
 * request hangs instead of returning a proper error response.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next)
  }
}