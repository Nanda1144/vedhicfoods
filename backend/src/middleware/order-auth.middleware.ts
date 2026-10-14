import { Request, Response, NextFunction } from 'express'
import { RoleName } from '@prisma/client'
import { AuthService } from '../services/auth.service'
import { verifyOrderAccessToken, OrderAccessTokenClaims } from '../utils/order-token'
import { authenticate } from './auth.middleware'

/**
 * Authenticates a caller against an order-owned resource.
 *
 * The caller may be either:
 *
 *  1. A signed-in customer presenting `Authorization: Bearer <access token>` —
 *     delegated to the standard `authenticate` middleware unchanged, so
 *     existing behaviour is preserved bit-for-bit.
 *  2. An anonymous customer who just placed an order, presenting
 *     `X-Order-Token: <jwt>`. The token is verified (HS256, `tokenType: 'order'`,
 *     bound to one order + its guest account) and a bare CUSTOMER identity is
 *     synthesised onto `req.user` so downstream ownership checks resolve to the
 *     guest account. No roles or permissions are granted — an order token can
 *     never reach a staff/admin path.
 */
export async function authenticateOrderAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticate(req, res, next)
  }

  const raw = req.headers['x-order-token']
  const token = Array.isArray(raw) ? raw[0] : raw

  if (!token) {
    res
      .status(401)
      .json({ error: 'Authentication required. Sign in or provide an order access token.' })
    return
  }

  const claims = verifyOrderAccessToken(token)
  if (!claims) {
    res.status(401).json({ error: 'Invalid or expired order access token.' })
    return
  }

  // The guest account that owns the order must still exist and be in good
  // standing — an order token is not free licence to act as a deleted user.
  try {
    const { exists, isActive, isDeleted } = await AuthService.resolveUserPermissions(
      claims.userId
    )
    AuthService.assertAccountCanAuthenticate({ exists, isActive, isDeleted })
  } catch {
    res
      .status(401)
      .json({ error: 'Authentication failed. This order access token is no longer valid.' })
    return
  }

  req.orderAccess = claims
  req.user = {
    id: claims.userId,
    email: claims.email,
    fullName: claims.email,
    role: RoleName.CUSTOMER,
    roles: [RoleName.CUSTOMER],
    permissions: [],
  }

  next()
}

export type { OrderAccessTokenClaims }