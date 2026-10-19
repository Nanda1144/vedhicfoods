/**
 * Unified transport layer.
 *
 * Connects to the Vedhic Foods Node.js/TypeScript backend REST API.
 * Base URL comes from VITE_API_URL; production builds are pinned to the
 * load-balanced backend by the guard in vite.config.ts.
 * Automatically injects JWT Bearer tokens for authenticated admin requests.
 * There is no mock or fallback path — every request goes to the real backend.
 *
 * ---------------------------------------------------------------------------
 * SESSION EXPIRY (this is what the 401 loop was)
 * ---------------------------------------------------------------------------
 * The backend issues a 15-minute access token and a 7-day refresh token. The
 * console stored the refresh token but never used it, so exactly 15 minutes
 * after every sign-in every request failed with
 * "Session expired. Please refresh your token or log in again." and the only
 * recoveries were a manual reload or a full re-login.
 *
 * This transport now mirrors the storefront client: a 401 from an authenticated
 * request with a stored refresh token triggers a single-flight rotation of the
 * access token, and the original request is retried exactly once with the new
 * credential. If the rotation is rejected the session is cleared and an expiry
 * event is published so the console returns to the login screen with an
 * explanation instead of looping on 401s.
 */

import {
  clearAdminSession,
  emitAdminSessionExpired,
  getAdminAccessToken,
  hasAdminSession,
  updateAdminTokens,
} from './adminSessionStore'

/**
 * Resolves the API base URL, failing loudly rather than silently degrading.
 *
 * SECURITY: a production admin bundle pointed at `http://localhost:5000` is worse
 * than an obvious outage. Staff see a working login form and type real credentials
 * into a request that goes nowhere — and if the backend ever accepted an admin
 * origin over plaintext HTTP, a network attacker could rewrite the admin page to
 * post to a host they control and harvest the session token as it is issued.
 *
 * The build-time guard in vite.config.ts is the primary defence; this is the
 * runtime backstop for a bundle produced some other way.
 */
function resolveApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.trim()

  if (import.meta.env.PROD) {
    if (!configured) {
      throw new Error(
        'VITE_API_URL is missing from this production bundle. It must be set at build time ' +
          'to https://api.vedhicfoods.com/api/v1.',
      )
    }

    let parsed: URL
    try {
      parsed = new URL(configured)
    } catch {
      throw new Error(`VITE_API_URL is not a valid URL in this production bundle: ${configured}`)
    }

    if (parsed.protocol !== 'https:') {
      throw new Error(
        `Refusing to send staff credentials to ${parsed.protocol}// from a production build. ` +
          'The admin session token must only ever cross the network over HTTPS.',
      )
    }
  }

  return configured || 'http://localhost:5000/api/v1'
}

export const API_BASE_URL = resolveApiBaseUrl()

export interface RequestOptions {
  /** AbortSignal lets callers cancel in-flight requests. */
  signal?: AbortSignal
  /**
   * Hard deadline in ms. Defaults to `DEFAULT_TIMEOUT_MS`.
   *
   * Without this a request that never settles — a backend that accepted the
   * socket and stopped responding, a proxy that holds the connection open — left
   * every awaiting `.finally()` pending forever, which is what pinned the admin
   * console on "Restoring your session…" indefinitely. Pass 0 to opt out for
   * genuinely long operations such as report generation.
   */
  timeoutMs?: number
  /** Internal: set after a successful token refresh to stop the retry loop. */
  __retried?: boolean
}

/**
 * 60s. The API is backed by a remote, region-distant Postgres (Supabase
 * ap-northeast-1) where a single admin request routinely takes 10–20s, and the
 * dashboard/analytics aggregate several in sequence. The previous 20s budget
 * turned ordinary latency into client-side timeouts that surfaced as "Something
 * went wrong" on otherwise-successful pages.
 */
export const DEFAULT_TIMEOUT_MS = 60_000

export class ServiceError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
  }
}

export function notFound(entity: string, id: string): never {
  throw new ServiceError('NOT_FOUND', `${entity} “${id}” could not be found.`)
}

/**
 * Get stored JWT access token for the admin console.
 *
 * The console only ever holds its own in-memory access token. It must not read
 * customer credentials from shared browser storage.
 */
export function getAuthToken(): string | null {
  return getAdminAccessToken()
}

/**
 * Extracts a human-readable message from the backend's error bodies.
 *
 * Three shapes are in active use: `{ error: 'string' }` (auth + most
 * controllers), `{ success: false, error: 'string' }` (checkout/payments) and
 * `{ message: 'string' }`. Reading `error.message` alone turned every backend
 * rejection into the generic "Request failed with status 400".
 */
function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const body = payload as Record<string, unknown>
  if (typeof body.message === 'string' && body.message) return body.message
  if (typeof body.error === 'string' && body.error) return body.error
  const nested = body.error
  if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).message === 'string') {
    return (nested as Record<string, string>).message
  }
  if (Array.isArray(body.details) && typeof body.details[0] === 'string') return body.details[0]
  return fallback
}

/**
 * Endpoints that must never trigger a token refresh.
 *
 * Refreshing before (or after) a login attempt is meaningless, and a 401 from
 * `/auth/refresh` itself must not recurse. `/admin/auth/me` is deliberately *not*
 * in this list: it is an ordinary authenticated read whose 401 should be
 * recovered by a rotation, not surfaced as a failed session restore.
 */
function isAuthLifecycleEndpoint(endpoint: string): boolean {
  return (
    endpoint.includes('/auth/login') ||
    endpoint.includes('/auth/register') ||
    endpoint.includes('/auth/refresh') ||
    endpoint.includes('/auth/logout') ||
    endpoint.includes('/auth/forgot-password') ||
    endpoint.includes('/auth/reset-password')
  )
}

/**
 * Exchanges the stored refresh token for a new access token.
 *
 * Single-flight within a tab (module-level promise) AND across tabs (Web Locks
 * API where available), so a burst of concurrent 401s or two console tabs
 * produce exactly one rotation. This is a correctness requirement, not an
 * optimisation: presenting an already-rotated token is what the backend's reuse
 * detector reads as theft, and a false positive there revokes every session the
 * user holds.
 */
let inflightRefresh: Promise<boolean> | null = null

/** Minimal shape of the Web Locks API; avoids depending on a specific lib.dom. */
interface RefreshLockManager {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

type RotateResult = { ok: boolean; rejected: boolean }

/**
 * Performs one rotation attempt.
 *
 * `rejected` distinguishes a credential the server explicitly refused (401/403 —
 * the rotation genuinely cannot proceed) from an infrastructure failure
 * (network drop, timeout, 5xx). Only the former may ever end the session:
 * signing an operator out because the database was briefly overloaded turns a
 * transient outage into a forced re-login.
 */
async function attemptRotate(): Promise<RotateResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })

    if (!response.ok) {
      // 400 means the request carried no usable refresh credential at all
      // ("Refresh token is required") - there is nothing left to recover, so
      // clear the session instead of leaving the console in a 401 retry loop.
      return {
        ok: false,
        rejected: response.status === 400 || response.status === 401 || response.status === 403,
      }
    }

    const json = (await response.json()) as { accessToken?: string; token?: string }
    const accessToken = json.accessToken || json.token
    if (!accessToken) return { ok: false, rejected: true }

    updateAdminTokens(accessToken)
    return { ok: true, rejected: false }
  } catch {
    // Network blip: keep the session, the next request retries the rotation.
    return { ok: false, rejected: false }
  }
}

/**
 * Rotates the session under a cross-tab Web Lock. Refresh tokens are strictly
 * single-use; a rejected token signals reuse and the server revokes its active
 * sessions, so a lost refresh response requires a fresh login.
 */
async function runRefresh(): Promise<boolean> {
  if (!hasAdminSession()) return false
  const first = await attemptRotate()
  if (first.ok) return true
  if (first.rejected) {
    clearAdminSession()
    emitAdminSessionExpired()
  }
  return false
}

export function refreshAdminSession(): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh

  const locks =
    typeof navigator !== 'undefined'
      ? (navigator as unknown as { locks?: RefreshLockManager }).locks
      : undefined

  // Serialise refreshes across tabs where the browser supports Web Locks.
  inflightRefresh = (locks ? locks.request('vedhic:admin:refresh', runRefresh) : runRefresh()).finally(
    () => {
      inflightRefresh = null
    },
  )

  return inflightRefresh
}

/** Strips a caller-supplied Authorization header so a retry uses the fresh token. */
function withoutAuthorization(init?: RequestInit): RequestInit | undefined {
  if (!init) return init
  const headers = new Headers(init.headers as HeadersInit | undefined)
  headers.delete('Authorization')
  return { ...init, headers }
}

/**
 * Decodes the `exp` claim (ms since epoch) from a JWT without verifying it.
 *
 * Verification is the server's job; this is only used to decide whether the
 * stored access token is still worth sending. A token that cannot be decoded
 * (opaque or malformed) yields `null`, which callers treat as "unknown" and
 * let the first request discover the truth through the reactive 401 path.
 */
function decodeJwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const json = JSON.parse(atob(padded)) as { exp?: unknown }
    return typeof json.exp === 'number' ? json.exp * 1000 : null
  } catch {
    return null
  }
}

/** Rotate this long before the access token actually lapses (clock skew, latency). */
const REFRESH_SKEW_MS = 30_000

/**
 * Rotates an already-expired (or about-to-expire) access token BEFORE a request
 * is sent.
 *
 * REGRESSION (fixed): the transport only ever refreshed *reactively*, after a
 * request had already been rejected. On every cold load with a lapsed 15-minute
 * access token, `/admin/auth/me` and `/admin/settings` were therefore sent with
 * the dead credential and logged a pair of `401 (Unauthorized)` errors in the
 * console — every time, on every operator's machine — even though the transport
 * then rotated and retried successfully. The recoveries were invisible; only the
 * failures were not. Refreshing up front means the first request already carries
 * a live token and the recovery cycle never has to run.
 *
 * Single-flight with the reactive path (both go through `refreshAdminSession`),
 * so a burst of concurrent requests still produces exactly one rotation.
 */
async function ensureFreshAdminToken(): Promise<void> {
  const token = getAdminAccessToken()
  if (!token) return

  const expiresAt = decodeJwtExpiry(token)
  // Undecodable token: fall through, the reactive 401 path will handle it.
  if (expiresAt === null) return
  if (expiresAt - Date.now() > REFRESH_SKEW_MS) return

  if (hasAdminSession()) {
    await refreshAdminSession()
  }
}

/**
 * Coalesces concurrent identical GET requests into one network round trip.
 *
 * Two things this addresses: React StrictMode's mount -> unmount -> mount double
 * invokes every `useAsync` effect in development, and two mounted components
 * that read the same resource otherwise issue two identical requests. Only
 * signal-free, non-retried, non-auth GETs are coalesced, so a caller's
 * cancellation still aborts its own request and a 401 retry is never served
 * from a pre-refresh response. It shares the in-flight promise, not a cached
 * value, so it can never return stale data.
 */
const inflightGets = new Map<string, Promise<unknown>>()

export function apiFetchRaw<T>(
  endpoint: string,
  init?: RequestInit,
  options?: RequestOptions,
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (
    method !== 'GET' ||
    options?.signal ||
    options?.__retried ||
    isAuthLifecycleEndpoint(endpoint)
  ) {
    return apiFetchRawUncoalesced<T>(endpoint, init, options)
  }

  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`
  const key = `${url}\u0000${getAuthToken() ?? ''}`

  const existing = inflightGets.get(key)
  if (existing) return existing as Promise<T>

  const request = apiFetchRawUncoalesced<T>(endpoint, init, options)
  inflightGets.set(key, request)
  void request
    .finally(() => {
      inflightGets.delete(key)
    })
    .catch(() => {
      // Swallow here only: the awaiting caller observes the rejection. This side
      // exists purely to release the map entry and must not raise its own.
    })
  return request
}

/**
 * Real HTTP client for the Node.js/TypeScript backend.
 *
 * Returns the response body exactly as the server sent it — no envelope
 * unwrapping. Use this for endpoints that return arrays or pagination
 * wrappers (`{items}`, `{data}`, `{deliveries}`, `{coupons}` …).
 *
 * Every request is bounded by an abort deadline and is composed with any
 * caller-supplied `signal`, so no request can hang a screen forever.
 */
async function apiFetchRawUncoalesced<T>(
  endpoint: string,
  init?: RequestInit,
  options?: RequestOptions,
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`

  // Proactively rotate a lapsed access token so the request does not leave with
  // a credential the server will reject. Skipped for the auth lifecycle
  // endpoints (login/refresh/logout) where rotating first is meaningless or
  // recursive.
  if (!isAuthLifecycleEndpoint(endpoint)) {
    await ensureFreshAdminToken()
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string>),
  }

  const token = getAuthToken()
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      : undefined

  // Honour a caller cancellation as well as our own deadline. `AbortSignal.any`
  // is not available on every browser we target, so bridge manually.
  const onCallerAbort = () => controller.abort()
  if (options?.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', onCallerAbort)
  }

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers,
      credentials: 'include',
      signal: controller.signal,
    })
  } catch {
    if (timedOut) {
      throw new ServiceError(
        'TIMEOUT',
        `The server did not respond within ${Math.round(timeoutMs / 1000)}s. Please try again.`,
      )
    }
    if (options?.signal?.aborted) {
      throw new ServiceError('ABORTED', 'Request was cancelled.')
    }
    throw new ServiceError('NETWORK', 'Could not reach the server. Check your connection and try again.')
  } finally {
    if (timer) clearTimeout(timer)
    options?.signal?.removeEventListener('abort', onCallerAbort)
  }

  if (!response.ok) {
    // A merely-expired access token should be rotated, not reported as a dead
    // session half-way through an admin action. Retry the original request once
    // with the fresh credential. Safe for writes: a 401 is produced by the auth
    // middleware before any business logic runs, so nothing was applied.
    if (
      response.status === 401 &&
      !options?.__retried &&
      !isAuthLifecycleEndpoint(endpoint) &&
      hasAdminSession()
    ) {
      const refreshed = await refreshAdminSession()
      if (refreshed) {
        return apiFetchRaw<T>(endpoint, withoutAuthorization(init), { ...(options ?? {}), __retried: true })
      }
    }

    let errMsg = `Request failed with status ${response.status}`
    try {
      errMsg = extractErrorMessage(await response.json(), errMsg)
    } catch {
      // response wasn't JSON
    }
    // 5xx messages are deliberately generic; never surface raw server text.
    if (response.status >= 500) {
      throw new ServiceError(String(response.status), 'Something went wrong on our end. Please try again.')
    }
    throw new ServiceError(String(response.status), errMsg)
  }

  // 204 and other empty bodies resolve as null rather than throwing.
  try {
    return (await response.json()) as T
  } catch {
    return null as T
  }
}

/**
 * Same transport as `apiFetchRaw`, but unwraps the backend's standard
 * `{ success, data }` envelope when present so callers receive the payload.
 */
export async function apiFetch<T>(
  endpoint: string,
  init?: RequestInit,
  options?: RequestOptions,
): Promise<T> {
  const result = await apiFetchRaw<unknown>(endpoint, init, options)
  if (result && typeof result === 'object' && 'data' in result) {
    return (result as { data: T }).data
  }
  return result as T
}

/**
 * Fetches a binary response (e.g. a generated invoice PDF) with the same
 * auth-injection and single-retry-after-refresh behaviour as `apiFetchRaw`.
 *
 * Use this instead of opening a raw storage URL: backend-streamed documents work
 * even when object storage is not provisioned (the dev fallback otherwise
 * returned a URL to a non-existent bucket, which the browser rendered as an S3
 * `NoSuchBucket` XML page).
 */
export async function apiFetchBlob(
  endpoint: string,
  init?: RequestInit,
  options?: RequestOptions,
): Promise<Blob> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`

  if (!isAuthLifecycleEndpoint(endpoint)) {
    await ensureFreshAdminToken()
  }

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  }

  const token = getAuthToken()
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
      : undefined

  const onCallerAbort = () => controller.abort()
  if (options?.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', onCallerAbort)
  }

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers,
      credentials: 'include',
      signal: controller.signal,
    })
  } catch {
    if (timedOut) {
      throw new ServiceError('TIMEOUT', `The server did not respond within ${Math.round(timeoutMs / 1000)}s. Please try again.`)
    }
    if (options?.signal?.aborted) {
      throw new ServiceError('ABORTED', 'Request was cancelled.')
    }
    throw new ServiceError('NETWORK', 'Could not reach the server. Check your connection and try again.')
  } finally {
    if (timer) clearTimeout(timer)
    options?.signal?.removeEventListener('abort', onCallerAbort)
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      !options?.__retried &&
      !isAuthLifecycleEndpoint(endpoint) &&
      hasAdminSession()
    ) {
      const refreshed = await refreshAdminSession()
      if (refreshed) {
        return apiFetchBlob(endpoint, withoutAuthorization(init), { ...(options ?? {}), __retried: true })
      }
    }

    let errMsg = `Request failed with status ${response.status}`
    try {
      errMsg = extractErrorMessage(await response.json(), errMsg)
    } catch {
      // response wasn't JSON
    }
    if (response.status >= 500) {
      throw new ServiceError(String(response.status), 'Something went wrong on our end. Please try again.')
    }
    throw new ServiceError(String(response.status), errMsg)
  }

  return response.blob()
}
