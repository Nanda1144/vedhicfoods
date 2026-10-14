import type { Permission, RoleName } from '@/types'
import { apiFetch, ServiceError, type RequestOptions } from './http'
import { storage } from '@/utils/storage'

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

const SESSION_KEY = 'vedhic.admin.session.v1'
const TEMP_SESSION_KEY = 'vedhic.admin.session.temp.v1'

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
      refreshToken: response?.refreshToken,
      remember,
      signedInAt: new Date().toISOString(),
    }

    this.persist(session, remember)

    return session
  },

  logout(): void {
    const session = this.session()
    const refreshToken = session?.refreshToken

    storage.remove(SESSION_KEY)
    storage.remove(TEMP_SESSION_KEY)

    // Revoke server-side. The token is read from storage before it is cleared so
    // the request still carries an Authorization header; failure is non-fatal
    // because the local session is already gone.
    if (session?.token) {
      void apiFetch('/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      }).catch(() => undefined)
    }
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
    const session = this.session()
    if (!session?.token) return null

    try {
      const me = await apiFetch<AdminMeResponse>(
        '/admin/auth/me',
        { method: 'GET', headers: { Authorization: `Bearer ${session.token}` } },
        options
      )

      const role = toRoleName(me?.role ?? me?.roles?.[0] ?? session.role)

      if (!CONSOLE_ROLES.includes(role)) {
        this.logout()
        return null
      }

      // Re-derive permissions on every restore. Keeping the stale copy from login
      // would let a revoked grant keep rendering privileged controls.
      const refreshed: AdminSession = {
        ...session,
        id: me.id ?? session.id,
        name: me.name || session.name,
        email: me.email || session.email,
        role,
        permissions: toPermissions(me.permissions ?? session.permissions),
      }

      this.persist(refreshed, session.remember)
      return refreshed
    } catch {
      this.logout()
      return null
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
    storage.remove(SESSION_KEY)
    storage.remove(TEMP_SESSION_KEY)
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