import { apiFetch, type RequestOptions } from './http'
import { tokenStore, type SessionUser } from './tokenStore'

/**
 * Customer authentication against `POST /api/v1/auth/*`.
 *
 * Error bodies from these endpoints are `{ error: 'string' }` (or
 * `{ success: false, error }`); `apiFetch` converts them into a `ServiceError`
 * whose `.message` is the backend's own copy, so callers can surface it
 * directly.
 */

export interface RegisterInput {
  fullName: string
  email: string
  password: string
  phone?: string
}

export interface LoginInput {
  email: string
  password: string
}

/** Shape returned by `GET /auth/me` (no wrapper — the profile is the body). */
export interface AuthProfile extends SessionUser {
  primaryRole?: string
  profile?: {
    phone?: string | null
    [key: string]: unknown
  }
}

export interface AuthSession {
  accessToken: string
  refreshToken: string | null
  user: SessionUser
}

/** Maps any backend user/profile payload onto the shape the UI renders. */
export function normalizeSessionUser(raw: any): SessionUser {
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? raw?.fullName ?? ''),
    email: String(raw?.email ?? ''),
    phone: raw?.phone ?? raw?.profile?.phone ?? null,
    role: raw?.role ? String(raw.role).toLowerCase() : undefined,
    roles: Array.isArray(raw?.roles) ? raw.roles : undefined,
    permissions: Array.isArray(raw?.permissions) ? raw.permissions : undefined,
    isVerified: typeof raw?.isVerified === 'boolean' ? raw.isVerified : undefined,
  }
}

export const authService = {
  async register(input: RegisterInput, options?: RequestOptions): Promise<AuthSession> {
    const body = await apiFetch<any>(
      '/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({
          fullName: input.fullName.trim(),
          email: input.email.trim().toLowerCase(),
          password: input.password,
          ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
        }),
      },
      options,
    )

    const session: AuthSession = {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken ?? null,
      user: normalizeSessionUser(body.user),
    }
    tokenStore.setSession(session.accessToken, session.refreshToken, session.user)
    return session
  },

  async login(input: LoginInput, options?: RequestOptions): Promise<AuthSession> {
    const body = await apiFetch<any>(
      '/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({
          email: input.email.trim().toLowerCase(),
          password: input.password,
        }),
      },
      options,
    )

    const session: AuthSession = {
      accessToken: body.accessToken || body.token,
      refreshToken: body.refreshToken ?? null,
      user: normalizeSessionUser(body.user),
    }
    tokenStore.setSession(session.accessToken, session.refreshToken, session.user)
    return session
  },

  /** Current profile from the server — the authority on who is signed in. */
  async me(options?: RequestOptions): Promise<AuthProfile> {
    return apiFetch<AuthProfile>('/auth/me', { method: 'GET' }, options)
  },

  /** Restore an access token from the HttpOnly refresh cookie, then verify it. */
  async restoreSession(options?: RequestOptions): Promise<AuthProfile> {
    const refreshed = await apiFetch<{ accessToken?: string; token?: string }>(
      '/auth/refresh',
      { method: 'POST' },
      options,
    )
    const accessToken = refreshed?.accessToken || refreshed?.token
    if (!accessToken) throw new Error('The saved session could not be restored.')
    tokenStore.setTokens(accessToken)
    return this.me(options)
  },

  /** Best-effort revocation; local state is cleared regardless of the outcome. */
  async logout(options?: RequestOptions): Promise<void> {
    try {
      await apiFetch(
        '/auth/logout',
        { method: 'POST' },
        options,
      )
    } catch {
      /* the local session is dropped either way */
    }
  },

  async changePassword(
    input: { currentPassword: string; newPassword: string },
    options?: RequestOptions,
  ): Promise<{ message: string }> {
    return apiFetch<any>(
      '/auth/change-password',
      { method: 'PUT', body: JSON.stringify(input) },
      options,
    )
  },

  async forgotPassword(email: string, options?: RequestOptions): Promise<{ message: string }> {
    return apiFetch<any>(
      '/auth/forgot-password',
      { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }) },
      options,
    )
  },

  async resetPassword(
    input: { token: string; newPassword: string },
    options?: RequestOptions,
  ): Promise<{ message: string }> {
    return apiFetch<any>(
      '/auth/reset-password',
      { method: 'POST', body: JSON.stringify(input) },
      options,
    )
  },
}
