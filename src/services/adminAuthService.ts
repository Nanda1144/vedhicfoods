import { adminStore } from './adminStore'
import type { Permission, RoleName } from '@/types'
import { mockRequest, ServiceError, type RequestOptions } from './http'
import { storage } from '@/utils/storage'

export interface AdminSession {
  id: string
  name: string
  email: string
  role: RoleName
  title: string
  permissions: Permission[]
  isOwner: boolean
  token: string
  remember: boolean
  signedInAt: string
}

const SESSION_KEY = 'vedhi.admin.session.v1'
const TEMP_SESSION_KEY = 'vedhi.admin.session.temp.v1'

/**
 * Prototype auth — mirrors POST /auth/login and the following backend flow:
 *
 *   Login → authenticate → role → permissions → API authorization → database
 *
 * Passwords are never stored plain-text; the prototype accepts the shared demo
 * password. In production this service calls a real auth endpoint that returns
 * a signed token; authorization MUST also be enforced server-side (401/403),
 * never by hiding UI. Frontend permission checks here are UX only.
 */
export const adminAuthService = {
  DEMO_PASSWORD: 'demo123',

  async login(email: string, password: string, remember = true, options?: RequestOptions): Promise<AdminSession> {
    const normalised = email.trim().toLowerCase()
    await mockRequest(() => null, { delay: 650, ...options })

    const roles = adminStore.roles()
    const account = adminStore.staff().find((member) => member.email.toLowerCase() === normalised)

    if (!account) {
      throw new ServiceError('INVALID_CREDENTIALS', 'No admin account found for this email.')
    }
    if (account.status === 'suspended') {
      throw new ServiceError('FORBIDDEN', 'This account is suspended. Contact the owner to reactivate it.')
    }
    if (account.status === 'invited' && password !== this.DEMO_PASSWORD) {
      throw new ServiceError('INVALID_CREDENTIALS', 'This invitation has not been activated yet.')
    }
    if (password !== this.DEMO_PASSWORD) {
      throw new ServiceError('INVALID_CREDENTIALS', 'Incorrect password. Try again or reset it.')
    }

    const role = roles.find((candidate) => candidate.name === account.role)
    const permissions: Permission[] =
      account.permissions && account.permissions.length > 0
        ? [...account.permissions]
        : [...(role?.permissions ?? [])]
    const isOwner = account.role === 'owner'

    const session: AdminSession = {
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.role,
      title: account.title ?? role?.label ?? account.role,
      permissions,
      isOwner,
      token: `demo-token-${account.id}`,
      remember,
      signedInAt: new Date().toISOString(),
    }

    this.persist(session, remember)
    adminStore.log({
      actor: session.name,
      actorRole: session.role,
      action: 'login',
      entity: 'Admin session',
      entityId: account.id,
      summary: 'Signed in to the admin console',
      tone: 'info',
    })
    return session
  },

  logout(): void {
    const session = this.session()
    if (session) {
      adminStore.log({
        actor: session.name,
        actorRole: session.role,
        action: 'logout',
        entity: 'Admin session',
        entityId: session.id,
        summary: 'Signed out of the admin console',
        tone: 'neutral',
      })
    }
    storage.remove(SESSION_KEY)
    storage.remove(TEMP_SESSION_KEY)
  },

  persist(session: AdminSession, remember: boolean): void {
    if (remember) {
      storage.set(SESSION_KEY, session)
      storage.remove(TEMP_SESSION_KEY)
    } else {
      storage.set(TEMP_SESSION_KEY, session)
    }
  },

  /** Restores session from temp (non-remembered) or persistent storage. */
  session(): AdminSession | null {
    const temp = storage.get<AdminSession | null>(TEMP_SESSION_KEY, null)
    if (temp) return temp
    return storage.get<AdminSession | null>(SESSION_KEY, null)
  },

  isAuthenticated(): boolean {
    return Boolean(this.session())
  },

  async forgotPassword(email: string, options?: RequestOptions): Promise<void> {
    const normalised = email.trim().toLowerCase()
    await mockRequest(() => null, { delay: 600, ...options })
    const account = adminStore.staff().find((member) => member.email.toLowerCase() === normalised)
    if (!account) {
      throw new ServiceError('NOT_FOUND', 'No account matches that email address.')
    }
    adminStore.log({
      actor: account.name,
      actorRole: account.role,
      action: 'update',
      entity: 'Password reset',
      entityId: account.id,
      summary: 'Password reset link requested',
      tone: 'warning',
    })
  },

  /** Prototype password change. Validates shape; real hashing is server-side. */
  async changePassword(current: string, next: string, options?: RequestOptions): Promise<void> {
    const session = this.session()
    if (!session) throw new ServiceError('UNAUTHORIZED', 'You must be signed in.')
    await mockRequest(() => null, { delay: 520, ...options })
    if (!next || next.length < 8) {
      throw new ServiceError('BAD_REQUEST', 'New password must be at least 8 characters.')
    }
    if (current !== this.DEMO_PASSWORD) {
      throw new ServiceError('BAD_REQUEST', 'Current password is incorrect.')
    }
    adminStore.log({
      actor: session.name,
      actorRole: session.role,
      action: 'update',
      entity: 'Security',
      entityId: session.id,
      summary: 'Password changed',
      tone: 'success',
    })
  },

  /** UI / route-level guard helper. Owner bypasses every check. */
  can(session: AdminSession | null, permission: Permission): boolean {
    if (!session) return false
    if (session.isOwner || session.role === 'owner') return true
    return session.permissions.includes(permission)
  },
}