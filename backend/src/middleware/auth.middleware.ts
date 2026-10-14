import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { RoleName } from '@prisma/client'
import { env } from '../config/env'
import { AuthService } from '../services/auth.service'
import { logger } from '../config/logger'
import { AppError } from '../utils/errors'

/**
 * Primary authentication middleware.
 * Verifies JWT token, ensures user is active, resolves effective RBAC permissions,
 * and attaches AuthenticatedUser context to req.user.
 *
 * SECURITY: only `Authorization: Bearer` is honoured. An earlier version also
 * read `req.cookies.accessToken`, but no cookie parser is mounted, so that
 * branch could never fire — while leaving a cookie-based authentication path in
 * the code. Cookies would have made every state-changing endpoint CSRF-reachable
 * (the API sends `Access-Control-Allow-Credentials: true`), so the branch is
 * removed rather than left dormant. Tokens must be sent in a header, which the
 * browser attaches only after an explicit script-driven request.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization
    let token: string | undefined

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1]
    }

    if (!token) {
      res.status(401).json({ error: 'Authentication required. No authorization token provided.' })
      return
    }

    // A JWT is three dot-separated base64url segments. Reject obvious garbage
    // before invoking the verifier.
    if (token.length > 4096 || !/^[A-Za-z0-9._-]+$/.test(token)) {
      res.status(401).json({ error: 'Invalid or malformed authorization token.' })
      return
    }

    let decoded: any
    try {
      decoded = jwt.verify(token, env.JWT_SECRET, {
        // Pin the accepted algorithms. Without this, `jsonwebtoken` can be
        // coerced into treating an attacker-supplied token as an unsecured or
        // differently-signed token ("algorithm confusion").
        algorithms: ['HS256'],
      })
    } catch (jwtError: any) {
      if (jwtError.name === 'TokenExpiredError') {
        res.status(401).json({ error: 'Session expired. Please refresh your token or log in again.' })
        return
      }
      res.status(401).json({ error: 'Invalid or malformed authorization token.' })
      return
    }

    // Access tokens and refresh tokens are signed with the same secret, so the
    // subject claim is checked explicitly: a refresh token presented as a
    // bearer credential must never authenticate a request.
    if (!decoded.userId || !decoded.tokenType || decoded.tokenType !== 'access') {
      res.status(401).json({ error: 'Malformed token payload.' })
      return
    }

    // Resolve up-to-date roles and permissions from database
    const { roles, permissions, primaryRole, exists, isActive, isDeleted } =
      await AuthService.resolveUserPermissions(decoded.userId)

    // SECURITY: an unexpired access token is not on its own proof that the
    // account is still in good standing. Revoking refresh tokens on
    // deactivation leaves every already-issued access token valid for the
    // remainder of its lifetime (15 minutes by default), so a suspended or
    // deleted employee kept full RBAC privileges in that window — and a deleted
    // user whose row was removed still authenticated, silently degraded to
    // CUSTOMER. Offboarding is only immediate once account state is checked on
    // every request rather than inferred from token validity.
    AuthService.assertAccountCanAuthenticate({ exists, isActive, isDeleted })

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      fullName: decoded.fullName || decoded.email,
      role: primaryRole,
      roles,
      permissions,
    }

    next()
  } catch (error) {
    // Only a deliberate authentication/authorization decision keeps its own
    // status. `assertAccountCanAuthenticate` throws an `UnauthorizedError` when
    // the account was deactivated after the token was issued; that is a genuine
    // 401 and its message is safe to return.
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code })
      return
    }

    // Anything else here is infrastructure: `resolveUserPermissions` timed out
    // or the Prisma pool was exhausted. Reporting a database failure as 401
    // tells the client its credential is invalid, so the console logs the
    // operator out and the real outage is disguised as an auth problem. Surface
    // it as a retryable 503 instead and keep the diagnostic in the server log.
    logger.error({ err: error }, 'Authentication failed due to an unexpected error')
    res.status(503).json({ error: 'Service temporarily unavailable. Please retry shortly.' })
  }
}

export const requireAuth = authenticate

/**
 * Optional authentication middleware for public storefront endpoints where guest
 * users are allowed, but authenticated users receive personalized context.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization
  let token: string | undefined

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1]
  }

  if (!token) {
    return next()
  }

  try {
    const decoded: any = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] })
    if (decoded?.userId && decoded?.tokenType === 'access') {
      const { roles, permissions, primaryRole, exists, isActive, isDeleted } =
        await AuthService.resolveUserPermissions(decoded.userId)

      // Same lifecycle enforcement as `authenticate`: an optional-auth endpoint
      // must not hand personalised, permission-bearing context to a suspended or
      // deleted account, otherwise "optional" quietly becomes "authenticated".
      if (exists && isActive && !isDeleted) {
        req.user = {
          id: decoded.userId,
          email: decoded.email,
          fullName: decoded.fullName || decoded.email,
          role: primaryRole,
          roles,
          permissions,
        }
      }
    }
  } catch {
    // Ignore invalid optional tokens
  }

  next()
}

/**
 * Role-Based Access Control (RBAC) middleware.
 * Verifies that the authenticated user possesses at least one of the specified roles.
 * Returns 403 Forbidden when unauthorized.
 */
export function requireRole(...allowedRoles: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    // OWNER has superadmin access
    if (req.user.roles.includes(RoleName.OWNER) || req.user.role === RoleName.OWNER) {
      return next()
    }

    const hasRole = allowedRoles.some(
      role => req.user?.roles.includes(role) || req.user?.role === role
    )

    if (!hasRole) {
      // SECURITY: this response used to interpolate `allowedRoles` into the error
      // body. A 403 that lists the roles a resource requires tells an unauthenticated
      // or under-privileged caller the platform's entire privilege taxonomy, and by
      // omission exactly which roles are *not* required — a free reconnaissance aid.
      // The permission-based guard below was already fixed this way; this one was
      // missed.
      logger.warn(
        { userId: req.user.id, resourceRoles: allowedRoles },
        'RBAC denied: actor lacks the required role'
      )
      res.status(403).json({ error: 'Forbidden: insufficient role for this resource.' })
      return
    }

    next()
  }
}

/**
 * Granular Permission-Based Access Control middleware.
 * Verifies that the authenticated user possesses the specific permission(s).
 * Returns 403 Forbidden when unauthorized.
 */
export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    // OWNER and ADMIN roles automatically bypass granular checks
    if (
      req.user.roles.includes(RoleName.OWNER) ||
      req.user.role === RoleName.OWNER ||
      req.user.roles.includes(RoleName.ADMIN) ||
      req.user.role === RoleName.ADMIN
    ) {
      return next()
    }

    const missingPermissions = requiredPermissions.filter(
      p => !req.user?.permissions.includes(p)
    )

if (missingPermissions.length > 0) {
      // Log the specific slugs for operators; do not echo them to the client.
      // The response enumerates the application's internal permission model,
      // which is reconnaissance for an attacker probing for over-broad roles.
      logger.warn(
        {
          userId: req.user.id,
          roles: req.user.roles,
          required: missingPermissions,
        },
        'Permission denied'
      )
      res.status(403).json({
        error: 'Forbidden: you do not have permission to perform this action.',
      })
      return
    }

    next()
  }
}

/**
 * Resource-Level Authorization middleware for Customer Data Isolation.
 * Ensures customers can ONLY access their own resources (orders, profile, addresses).
 * Platform administrators and operational staff with read permissions bypass this check.
 */
export function requireResourceOwnership(
  getResourceOwnerId: (req: Request) => string | undefined | Promise<string | undefined>,
  bypassPermission?: string
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    // Admin & Owner bypass customer isolation
    if (
      req.user.roles.includes(RoleName.OWNER) ||
      req.user.roles.includes(RoleName.ADMIN) ||
      (bypassPermission && req.user.permissions.includes(bypassPermission))
    ) {
      return next()
    }

    const ownerId = await getResourceOwnerId(req)

    if (!ownerId || ownerId !== req.user.id) {
      res.status(403).json({
        error: 'Forbidden: You do not have permission to access this resource.',
      })
      return
    }

    next()
  }
}
