/** Customer session state. Bearer credentials are memory-only; the API holds
 * the rotating refresh credential in an HttpOnly, SameSite cookie. */

const ACCESS_TOKEN_KEY = 'vedhic.auth.token'
const REFRESH_TOKEN_KEY = 'vedhic.auth.refresh'
const SESSION_USER_KEY = 'vedhic.auth.user'
let accessTokenInMemory: string | null = null

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

export const AUTH_EXPIRED_EVENT = 'vedhic:auth:expired'

function readRaw(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeRaw(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* storage may be disabled */ }
}

function removeRaw(key: string): void {
  try { window.localStorage.removeItem(key) } catch { /* storage may be disabled */ }
}

function clearLegacyTokens(): void {
  removeRaw(ACCESS_TOKEN_KEY)
  removeRaw(REFRESH_TOKEN_KEY)
}

// Remove bearer credentials saved by earlier builds. A valid HttpOnly cookie
// restores the session; otherwise the customer signs in again.
clearLegacyTokens()

export const tokenStore = {
  getAccessToken(): string | null { return accessTokenInMemory },
  getRefreshToken(): string | null { return null },
  hasSession(): boolean { return Boolean(this.getUser()) },

  setTokens(accessToken: string, _refreshToken?: string | null): void {
    accessTokenInMemory = accessToken
    clearLegacyTokens()
  },

  setUser(user: SessionUser | null): void {
    if (user) writeRaw(SESSION_USER_KEY, JSON.stringify(user))
    else removeRaw(SESSION_USER_KEY)
  },

  getUser(): SessionUser | null {
    const raw = readRaw(SESSION_USER_KEY)
    if (!raw) return null
    try { return JSON.parse(raw) as SessionUser } catch { return null }
  },

  setSession(accessToken: string, _refreshToken: string | null | undefined, user: SessionUser): void {
    this.setTokens(accessToken)
    this.setUser(user)
  },

  clear(): void {
    accessTokenInMemory = null
    clearLegacyTokens()
    removeRaw(SESSION_USER_KEY)
  },

  emitExpired(): void {
    try { window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT)) } catch { /* non-browser environment */ }
  },
}
