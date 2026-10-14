import type { IncomingMessage, ServerResponse } from 'http'
import type { Request } from 'express'

/**
 * Canonical path of the Razorpay webhook endpoint, relative to the API mount.
 * Kept here so the raw-body capture in `app.ts` and the consumer in
 * `payment.controller.ts` cannot drift apart.
 */
export const RAZORPAY_WEBHOOK_PATH = '/payments/razorpay/webhook'

/**
 * Requests whose body must be preserved byte-for-byte for HMAC verification.
 *
 * SECURITY: Razorpay signs the exact bytes it transmitted. Re-serializing a
 * parsed body (`JSON.stringify(req.body)`) changes key order and whitespace, so
 * the recomputed digest will never match. The raw bytes must therefore be
 * captured *inside* the JSON body parser, while the stream is still unread.
 */
export function requiresRawBody(req: { originalUrl?: string; url?: string }): boolean {
  const url = req.originalUrl || req.url || ''
  const path = url.split('?')[0]
  return path.endsWith(RAZORPAY_WEBHOOK_PATH)
}

/**
 * `verify` hook for `express.json()`. Runs before the parsed body is assigned,
 * which is the only point where the original bytes are still available.
 *
 * Typed against Node's `IncomingMessage`/`ServerResponse` because that is what
 * body-parser hands to `verify`, not Express's `Request`/`Response`.
 */
export function captureRawBody(
  req: IncomingMessage,
  _res: ServerResponse,
  buf: Buffer
): void {
  if (!requiresRawBody(req)) return

  // SECURITY: stored as a Buffer, not a decoded string. The HMAC must be computed
  // over the bytes Razorpay actually transmitted. `buf.toString('utf8')` followed by
  // an implicit re-encode inside `createHmac(...).update(str)` is a lossy round
  // trip: any byte sequence that is not valid UTF-8 is replaced with U+FFFD, so the
  // digest would be computed over different bytes than were signed and legitimate
  // webhooks would fail verification — a signature check that cannot be trusted
  // either way. Keeping the Buffer makes the operation exact by construction.
  ;(req as IncomingMessage & { rawBody?: Buffer }).rawBody = Buffer.from(buf)
}

/**
 * Reads the preserved raw body. Returns undefined when absent so callers fail
 * closed rather than verifying against a reconstructed body.
 */
export function getRawBody(req: Request): Buffer | undefined {
  const raw = (req as Request & { rawBody?: unknown }).rawBody
  return Buffer.isBuffer(raw) && raw.length > 0 ? raw : undefined
}