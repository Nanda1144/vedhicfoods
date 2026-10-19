import type { Permission, RoleName } from '@/types'
import { apiFetch, refreshAdminSession, ServiceError, type RequestOptions } from './http'
import {
  clearAdminSession,
  getAdminAccessToken,
  persistAdminSession,
  readAdminSession,
} from './adminSessionStore'

export interface AdminSession {
  id: string
  name: string
  email: string
  role: RoleName
  title: string
  permissions: Permission[]
  token: string
  refreshToken?: string
  remember: boolean
  signedInAt: string
}

/**
 * Admin authentication against the real backend.
 *
 * SECURITY: this service used to be a client-only prototype:
 *
 *   DEMO_PASSWORD: 'demo123'
 *   if (password !== this.DEMO_PASSWORD) throw …      // compared in the browser
 *   token: `demo-token-${account.id}`                // not a credential
 *   can() { if (session.isOwner) return true }       // bypasses every check
 *
 * The bundle shipped a single shared password, the "session" was a fabricated
 * string, and `isOwner` short-circuited all authorization. Anyone who could guess
 * a staff email address — they are enumerable through the public storefront — held
 * a session the UI treated as fully privileged. A password never left the page,
 * so there was nothing for the backend to rate limit, audit or revoke, and the
 * comment claiming real enforcement ("authorization MUST also be enforced
 * server-side") described behaviour that did not exist.
 *
 * Authorization is now derived from what the server returns. `can()` is a UX
 * affordance for hiding controls — the API independently returns 401/403, and
 * every admin route is guarded by `authenticate` + `requirePermission`.
 */
interface AdminLoginResponse {
  success?: boolean
  token?: string
  accessToken?: string
  refreshToken?: string
  user?: {
    id: string
    name?: string
    email: string
    role?: string
    roles?: string[]
    permissions?: string[]
  }
}

interface AdminMeResponse {
  id: string
  name?: string
  email: string
  role?: string
  roles?: string[]
  permissions?: string[]
}

/** Normalises the backend's role casing onto the admin console's vocabulary. */
function toRoleName(value: string | undefined): RoleName {
  const normalised = String(value ?? '').toLowerCase()

  switch (normalised) {
    case 'owner':
      return 'owner'
    case 'admin':
      return 'admin'
    case 'staff':
      return 'staff'
    default:
      return 'customer'
  }
}

function toPermissions(value: string[] | undefined): Permission[] {
  return (value ?? []) as Permission[]
}

/**
 * Roles the admin console will accept as a session at all.
 *
 * A CUSTOMER holding a valid customer token is a legitimate API principal but must
 * never be granted a console session — otherwise the admin SPA would be reachable
 * by any signed-up shopper.
 */
const CONSOLE_ROLES: RoleName[] = ['owner', 'admin', 'staff']

export const adminAuthService = {
  async login(
    email: string,
    password: string,
    remember = true,
    options?: RequestOptions
  ): Promise<AdminSession> {
    const normalised = email.trim().toLowerCase()

    if (!normalised) {
      throw new ServiceError('BAD_REQUEST', 'Email address is required.')
    }
    if (!password) {
      throw new ServiceError('BAD_REQUEST', 'Password is required.')
    }

    let response: AdminLoginResponse

    try {
      response = await apiFetch<AdminLoginResponse>(
        '/admin/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email: normalised, password }),
        },
        options
      )
    } catch (error: any) {
      // Collapse every authentication failure into one message. Distinguishing
      // "unknown account" from "wrong password" would let an unauthenticated
      // caller enumerate staff email addresses.
      if (error instanceof ServiceError) {
        if (error.code === '401' || error.code === '403') {
          throw new ServiceError('INVALID_CREDENTIALS', 'Incorrect email or password.')
        }
        throw error
      }
      throw new ServiceError('NETWORK', 'Unable to reach the server. Try again in a moment.')
    }

    const token = response?.accessToken ?? response?.token
    const user = response?.user

    if (!token || !user?.email) {
      throw new ServiceError('INVALID_RESPONSE', 'The server returned an unexpected response.')
    }

    const role = toRoleName(user.role ?? user.roles?.[0])

    if (!CONSOLE_ROLES.includes(role)) {
      // Signed in successfully, but this is not a staff account. Refuse rather than
      // storing a session the console would render with an empty permission set.
      throw new ServiceError('FORBIDDEN', 'This account does not have admin console access.')
    }

    const permissions = toPermissions(user.permissions)

    const session: AdminSession = {
      id: user.id,
      name: user.name || user.email,
      email: user.email,
      role,
      title: user.name || role,
      permissions,
      token,
      remember,
      signedInAt: new Date().toISOString(),
    }

    this.persist(session, remember)

    return session
  },

  logout(): void {
    clearAdminSession()
    // The HttpOnly refresh cookie revokes this session; browser state is dropped
    // immediately even if the network request cannot reach the API.
    void apiFetch('/admin/auth/logout', { method: 'POST' }).catch(() => undefined)
  },

  persist(session: AdminSession, remember: boolean): void {
    persistAdminSession(session, remember)
  },

  /** Restores session from temp (non-remembered) or persistent storage. */
  session(): AdminSession | null {
    return readAdminSession()
  },

  isAuthenticated(): boolean {
    return Boolean(this.session())
  },

  /**
   * Confirms a restored session is still accepted by the server.
   *
   * A token in localStorage proves nothing on its own: it may be expired,
   * revoked by a password change, or belong to an account that has since been
   * deactivated. Without this check the console renders a full-privilege UI for a
   * session the API would reject on first click.
   *
   * Returns the refreshed session, or null when the token is no longer usable.
   */
  async validateSession(options?: RequestOptions): Promise<AdminSession | null> {
    let session = this.session()
    if (!session) return null

    try {
      // Access tokens are memory-only. After a reload, restore one from the
      // HttpOnly admin refresh cookie before asking the server for permissions.
      if (!getAdminAccessToken()) {
        const restored = await refreshAdminSession()
        if (!restored) {
          // The refresh helper clears persisted identity only on a definitive
          // 401/403. Keep it through network, timeout, 429 and 5xx failures.
          return this.session()
        }
        session = this.session() ?? session
      }

      const me = await apiFetch<AdminMeResponse>(
        '/admin/auth/me',
        { method: 'GET' },
        options
      )

      const role = toRoleName(me?.role ?? me?.roles?.[0] ?? session.role)

      if (!CONSOLE_ROLES.includes(role)) {
        this.logout()
        return null
      }

      // Re-derive permissions on every restore. Keeping the stale copy from login
      // would let a revoked grant keep rendering privileged controls.
      //
      // The tokens are re-read from storage, not copied from `session`: the
      // transport rotates an expired access token during the `/me` call above, and
      // persisting the pre-call copy would write the expired token straight back
      // and re-arm the 15-minute logout.
      const refreshed: AdminSession = {
        ...session,
        token: getAdminAccessToken() ?? session.token,
        refreshToken: undefined,
        id: me.id ?? session.id,
        name: me.name || session.name,
        email: me.email || session.email,
        role,
        permissions: toPermissions(me.permissions ?? session.permissions),
      }

      this.persist(refreshed, session.remember)
      return refreshed
    } catch (error) {
      // Only a definitive credential rejection (401/403) ends the session. An
      // aborted probe (component unmount / navigation) or a transient network or
      // timeout failure must leave the stored session and token untouched —
      // otherwise a momentary outage or a route change signs the operator out.
      if (error instanceof ServiceError && (error.code === '401' || error.code === '403')) {
        this.logout()
        return null
      }
      return session
    }
  },

  async forgotPassword(email: string, options?: RequestOptions): Promise<void> {
    const normalised = email.trim().toLowerCase()

    // The backend responds identically whether or not the account exists, which is
    // the intended behaviour: this endpoint must not confirm who holds an account.
    await apiFetch<{ success: boolean }>(
      '/auth/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify({ email: normalised }),
      },
      options
    )
  },

  /**
   * Changes the signed-in account's password.
   *
   * The current password is required by the server, not merely checked here —
   * requiring proof of the existing credential stops an attacker holding a
   * hijacked console session from locking the real owner out.
   */
  async changePassword(current: string, next: string, options?: RequestOptions): Promise<void> {
    const session = this.session()
    if (!session) throw new ServiceError('UNAUTHORIZED', 'You must be signed in.')

    await apiFetch<{ success: boolean }>(
      '/auth/change-password',
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      },
      options
    )

    // Every refresh-token session was revoked server-side, including this one.
    clearAdminSession()
  },

  /**
   * UI / route-level guard helper.
   *
   * Purely cosmetic: it decides whether to *render* a control. It reflects the
   * permission slugs the server granted and holds no privileges of its own — the
   * absence of the previous `isOwner` bypass is deliberate, so an owner account
   * whose grants were narrowed is treated like any other caller.
   */
  can(session: AdminSession | null, permission: Permission): boolean {
    if (!session) return false
    const permissions = session.permissions || []
    return permissions.includes(permission)
  },
}
