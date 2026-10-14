import { Request } from 'express'
import { RoleName } from '@prisma/client'
import { UnauthorizedError } from './errors'
import { getClientIp as resolveClientIp } from './client-ip'
import { ActorContext } from '../services/support.service'
import { RequestUser } from '../types'

const PRIVILEGED_ROLES: RoleName[] = [RoleName.OWNER, RoleName.ADMIN]

export function isPrivilegedUser(user?: RequestUser): boolean {
  if (!user) return false
  return (
    PRIVILEGED_ROLES.includes(user.role as RoleName) ||
    (user.roles ?? []).some((role) => PRIVILEGED_ROLES.includes(role as RoleName))
  )
}

/**
 * Builds the ActorContext consumed by the support/contact services.
 * The authenticated user has already been verified by `authenticate`, so a
 * missing req.user here means the route was mounted without auth — that is a
 * wiring bug and must fail loudly rather than fall through as anonymous.
 */
export function requireActorContext(req: Request): ActorContext {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required.')
  }

  return {
    userId: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName || req.user.email,
    isPrivileged: isPrivilegedUser(req.user),
    permissions: req.user.permissions ?? [],
  }
}

/**
 * Client IP honouring the reverse-proxy hop already trusted in app.ts.
 *
 * SECURITY: the docblock claimed this honoured the trusted hop, but the body took
 * `x-forwarded-for.split(',')[0]` — the *client-supplied* leftmost entry, which no
 * proxy configuration constrains. Delegating to the shared helper makes the claim
 * true: `req.ip` is the furthest-right untrusted hop once `trust proxy` is applied.
 */
export function getClientIp(req: Request): string | null {
  return resolveClientIp(req)
}

export function getUserAgent(req: Request): string | null {
  const agent = req.headers['user-agent']
  return typeof agent === 'string' ? agent : null
}