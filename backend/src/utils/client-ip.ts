import { Request } from 'express'

/**
 * Canonical client IP resolution.
 *
 * SECURITY: this function replaces five separate hand-rolled parsers, each of
 * which read the *leftmost* `X-Forwarded-For` entry:
 *
 *   req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress
 *
 * The leftmost entry is the one written by the **originating client**, not by any
 * trusted infrastructure. A well-behaved proxy *appends* its own view to the
 * right, so the leftmost value is attacker-controlled in exactly the deployments
 * where the header matters. Taking `[0]` therefore recorded a spoofable value for
 * login-attempt records, refresh-token IP binding and audit-log attribution, and
 * it did so regardless of the `trust proxy` setting — the parser simply ignored it.
 *
 * `req.ip` is the value Express derives *after* applying the `trust proxy`
 * configuration in `app.ts`: the furthest-right untrusted hop. That is the only
 * entry any of these call sites actually wanted.
 *
 * It is also a fixed point — once the topology is declared, `req.ip` is correct
 * in both the proxied and directly-exposed cases, so no call site has to know
 * which one it is running in.
 */
export function getClientIp(req: Request): string | null {
  const fromExpress = (req as Request & { ip?: string | null }).ip

  if (typeof fromExpress === 'string' && fromExpress.trim()) {
    return fromExpress.trim()
  }

  const socketAddress = req.socket?.remoteAddress
  return socketAddress ? socketAddress.trim() : null
}