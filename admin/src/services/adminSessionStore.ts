/**
 * Admin console session storage.
 *
 * This is the single source of truth for the admin session record and its
 * tokens. It exists so that the transport layer (`http.ts`) can read the access
 * token and rotate it on a 401 without importing `adminAuthService` — which
 * imports the transport — and creating an import cycle.
 *
 * Two events are published on `window`:
 *
 *   ADMIN_SESSION_EXPIRED_EVENT  a refresh was rejected, so the session was
 *                                cleared and the console must return to login.
 *   ADMIN_SESSION_UPDATED_EVENT  the access/refresh tokens were rotated in place;
 *                                consumers holding a copy of the session should
 *                                re-read it so they never send a stale token.
 *
 * `AdminSession` is imported as a *type* only. Type imports are erased at build
 * time, so this module has no runtime dependency on `adminAuthService`.
 */

import { storage } from '@/utils/storage'
import type { AdminSession } from './adminAuthService'

export const SESSION_KEY = 'vedhic.admin.session.v1'
export const TEMP_SESSION_KEY = 'vedhic.admin.session.temp.v1'

/** Timestamp of the last observed operator activity (ms since epoch). */
export const LAST_ACTIVITY_KEY = 'vedhic.admin.lastActivity.v1'

/**
 * Idle window for the admin console, in milliseconds.
 *
 * Mirrors `AuthService.CONSOLE_SESSION_IDLE_TTL_HOURS` on the backend: the
 * server expires a console refresh token 24 hours after its last use, so a
 * session left untouched for longer than this can no longer be recovered. This
 * client-side constant paces the proactive watcher so an idle tab is dropped to
 * the login screen at the same moment rather than waiting for the next request
 * to fail.
 */
export const ADMIN_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000

/** Fired when the session can no longer be recovered (refresh rejected). */
export const ADMIN_SESSION_EXPIRED_EVENT = 'vedhic:admin:auth:expired'

/** Fired when the tokens were rotated in place and consumers should re-read. */
export const ADMIN_SESSION_UPDATED_EVENT = 'vedhic:admin:auth:updated'
let accessTokenInMemory: string | null = null

// Remove the pre-migration shared customer/admin bearer key. Refresh cookies
// now restore the session; leaving a readable token behind serves no purpose.
if (isBrowser()) {
  try {
    window.localStorage.removeItem('vedhic.auth.token')
    window.localStorage.removeItem('vedhi.auth.token')
  } catch {
    /* storage may be disabled */
  }
}

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

/**
 * Reads the persisted session.
 *
 * A non-remembered ("session") login is stored under `TEMP_SESSION_KEY` and
 * takes precedence, matching the previous behaviour: a temp session and a
 * remembered one cannot legitimately coexist, and the temp record is the more
 * recent intent.
 */
export function readAdminSession(): AdminSession | null {
  const temp = storage.get<AdminSession | null>(TEMP_SESSION_KEY, null)
  const persisted = temp ?? storage.get<AdminSession | null>(SESSION_KEY, null)
  if (!persisted) return null

  // Migrate previous builds by removing any browser-readable bearer tokens.
  const safe = { ...persisted, token: '', refreshToken: undefined }
  if (persisted.token || persisted.refreshToken) {
    if (temp) storage.set(TEMP_SESSION_KEY, safe)
    else storage.set(SESSION_KEY, safe)
  }
  return { ...safe, token: accessTokenInMemory ?? '' }
}

/** Persists the session under the key implied by "remember me". */
export function persistAdminSession(session: AdminSession, remember: boolean): void {
  accessTokenInMemory = session.token || null
  const safeSession: AdminSession = { ...session, token: '', refreshToken: undefined }
  if (remember) {
    storage.set(SESSION_KEY, safeSession)
    storage.remove(TEMP_SESSION_KEY)
  } else {
    storage.set(TEMP_SESSION_KEY, safeSession)
  }

  // Persisting a session — at login or after a successful restore — is itself
  // activity, so (re)start the idle window from now.
  recordAdminActivity()
}

/** Removes both session records and the activity marker. */
export function clearAdminSession(): void {
  accessTokenInMemory = null
  storage.remove(SESSION_KEY)
  storage.remove(TEMP_SESSION_KEY)
  storage.remove(LAST_ACTIVITY_KEY)
}

/**
 * Records the current time as the last operator activity.
 *
 * Called on login, on token rotation (any successful authenticated request is
 * itself activity), and on user input events tracked by the idle watcher.
 */
export function recordAdminActivity(now: number = Date.now()): void {
  storage.set(LAST_ACTIVITY_KEY, now)
}

/** Last recorded activity timestamp, or null when there is no marker. */
export function getAdminLastActivity(): number | null {
  const value = storage.get<number | null>(LAST_ACTIVITY_KEY, null)
  return typeof value === 'number' ? value : null
}

/**
 * True when a session exists but has seen no activity for the idle window.
 *
 * An absent marker is treated as *not* idle: a session persisted by an older
 * build has no timestamp, and guessing "idle" from that would sign the operator
 * out on the first load after an upgrade. The server's refresh-token TTL
 * remains the enforcement boundary in that case.
 */
export function isAdminIdleExpired(now: number = Date.now()): boolean {
  if (!readAdminSession()) return false
  const last = getAdminLastActivity()
  if (last === null) return false
  return now - last >= ADMIN_IDLE_TIMEOUT_MS
}

export function getAdminAccessToken(): string | null {
  return accessTokenInMemory
}

export function getAdminRefreshToken(): string | null { return null }

/**
 * Replaces the tokens inside whichever record currently holds the session.
 *
 * Used by the transport after a successful refresh. The session's identity and
 * permissions are untouched — only the credentials change — so the console
 * keeps rendering the same user without a re-login.
 */
export function updateAdminTokens(accessToken: string, _refreshToken?: string | null): void {
  accessTokenInMemory = accessToken

  emitAdminSessionUpdated()
}

export function hasAdminSession(): boolean {
  return Boolean(readAdminSession())
}

export function emitAdminSessionUpdated(): void {
  if (!isBrowser()) return
  try {
    window.dispatchEvent(new Event(ADMIN_SESSION_UPDATED_EVENT))
  } catch {
    /* non-browser or blocked environment */
  }
}

export function emitAdminSessionExpired(): void {
  if (!isBrowser()) return
  try {
    window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT))
  } catch {
    /* non-browser or blocked environment */
  }
}
