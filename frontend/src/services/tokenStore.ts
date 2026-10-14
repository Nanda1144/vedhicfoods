/**
 * Customer session token storage.
 *
 * The access token is stored as a plain string under `vedhic.auth.token` — that
 * is the exact key `getAuthToken()` reads, so keeping the format unchanged
 * matters: a JSON-wrapped value would be sent as `Bearer {"accessToken":…}`.
 * The refresh token lives beside it and never leaves the browser except to
 * `POST /auth/refresh`.
 */

const ACCESS_TOKEN_KEY = 'vedhic.auth.token'
const REFRESH_TOKEN_KEY = 'vedhic.auth.refresh'
const SESSION_USER_KEY = 'vedhic.auth.user'

/** The subset of the backend profile the storefront UI actually renders. */
export interface SessionUser {
  id: string
  name: string
  email: string
  phone?: string | null
  role?: string
  roles?: string[]
  permissions?: string[]
  isVerified?: boolean
}

/** Fired when a refresh attempt fails — AuthContext listens and drops state. */
export const AUTH_EXPIRED_EVENT = 'vedhic:auth:expired'

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* quota / privacy mode — an unwritable session must not crash the app */
  }
}

function removeRaw(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export const tokenStore = {
  getAccessToken(): string | null {
    return readRaw(ACCESS_TOKEN_KEY)
  },

  getRefreshToken(): string | null {
    return readRaw(REFRESH_TOKEN_KEY)
  },

  hasSession(): boolean {
    return Boolean(readRaw(ACCESS_TOKEN_KEY))
  },

  setTokens(accessToken: string, refreshToken?: string | null): void {
    writeRaw(ACCESS_TOKEN_KEY, accessToken)
    if (refreshToken) writeRaw(REFRESH_TOKEN_KEY, refreshToken)
  },

  setUser(user: SessionUser | null): void {
    if (user) writeRaw(SESSION_USER_KEY, JSON.stringify(user))
    else removeRaw(SESSION_USER_KEY)
  },

  /** Restored synchronously so the first paint can show the signed-in name. */
  getUser(): SessionUser | null {
    const raw = readRaw(SESSION_USER_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as SessionUser
    } catch {
      return null
    }
  },

  setSession(accessToken: string, refreshToken: string | null | undefined, user: SessionUser): void {
    this.setTokens(accessToken, refreshToken)
    this.setUser(user)
  },

  clear(): void {
    removeRaw(ACCESS_TOKEN_KEY)
    removeRaw(REFRESH_TOKEN_KEY)
    removeRaw(SESSION_USER_KEY)
  },

  emitExpired(): void {
    try {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    } catch {
      /* non-browser environment */
    }
  },
}
