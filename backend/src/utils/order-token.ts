import jwt from 'jsonwebtoken'
import { env } from '../config/env'

/**
 * Order Access Tokens.
 *
 * Anonymous checkout creates a throwaway CUSTOMER account and attaches the order
 * to it, but the browser is never handed that account's credentials. Razorpay
 * initiation, verification and order/invoice reads all require authentication,
 * so a guest who paid with a real gateway had no way to complete (or even look
 * up) their own order after refreshing the page.
 *
 * These tokens bridge that gap without weakening the user session:
 *
 * - They are minted exclusively in the checkout response, signed with the same
 *   HS256 JWT secret, and carry `tokenType: 'order'` (distinct from `'access'`,
 *   so a stolen access/refresh token is never interchangeable with one).
 * - They are bound to one internal order AND its guest account, and expire
 *   shortly after checkout (1 hour) — long enough to complete payment but not
 *   a standing credential.
 * - They hold no roles or permissions. The order-auth middleware synthesises a
 *   bare CUSTOMER identity, so the existing userId/customerEmail ownership
 *   checks resolve to the guest account and nothing else.
 */
const ORDER_TOKEN_EXPIRY_SECONDS = 60 * 60

export interface OrderAccessTokenClaims {
  userId: string
  email: string
  orderId: string
  tokenType: 'order'
}

/** Ensures a guest order bearer remains bound to the order that minted it. */
export function orderAccessTokenMatchesOrder(
  claims: OrderAccessTokenClaims | undefined,
  orderId: string
): boolean {
  return !claims || claims.orderId === orderId
}

export function signOrderAccessToken(input: {
  orderId: string
  userId: string
  email: string
}): string {
  return jwt.sign(
    {
      userId: input.userId,
      email: input.email,
      orderId: input.orderId,
      tokenType: 'order',
    },
    env.JWT_SECRET,
    { expiresIn: ORDER_TOKEN_EXPIRY_SECONDS, algorithm: 'HS256' }
  )
}

/** Returns the parsed claims when the token is a valid, unexpired order token. */
export function verifyOrderAccessToken(token: string): OrderAccessTokenClaims | null {
  try {
    const decoded: any = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] })
    if (
      decoded?.tokenType !== 'order' ||
      typeof decoded.userId !== 'string' ||
      typeof decoded.email !== 'string' ||
      typeof decoded.orderId !== 'string'
    ) {
      return null
    }
    return {
      userId: decoded.userId,
      email: decoded.email,
      orderId: decoded.orderId,
      tokenType: 'order',
    }
  } catch {
    return null
  }
}
