/**
 * Unified transport layer.
 *
 * Connects to the Vedhic Foods Node.js/TypeScript backend REST API.
 * Base URL comes from VITE_API_URL; production builds are pinned to the
 * load-balanced backend by the guard in vite.config.ts.
 * Automatically injects JWT Bearer tokens for authenticated requests.
 */

import { tokenStore } from './tokenStore'

/**
 * Resolves the API base URL, failing loudly rather than silently degrading.
 *
 * SECURITY / CORRECTNESS: the previous form was
 *
 *   export const API_BASE_URL =
 *     (import.meta.env.VITE_API_URL as string) || 'http://localhost:5000/api/v1'
 *
 * which makes the *failure mode of a production deploy* "silently point the
 * storefront at the customer's own machine". The site renders, the catalogue
 * appears from the fallback data, and login, cart, checkout and payment all fail
 * with no message explaining why. A missing build variable is a build-time error
 * (vite.config.ts refuses the build); this check is the runtime backstop for a
 * bundle produced some other way.
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
        `Refusing to call the API over ${parsed.protocol}// from a production build. ` +
          'Credentials and session tokens would cross the network in plaintext. ' +
          'Serve the API over HTTPS (ACM certificate on the load balancer).',
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
   * Anonymous order-access token minted by the checkout response. Sent as
   * `X-Order-Token` so a guest can initiate/verify payment and read their own
   * order and invoice without account credentials. Ignored when an
   * `Authorization` header is already present.
   */
  orderToken?: string | null
  /** Internal: set after a successful token refresh to stop the retry loop. */
  __retried?: boolean
}

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

export interface ResolvedAuth {
  token: string | null
  /** Which session supplied the token — only `customer` can self-refresh. */
  source: 'admin' | 'customer' | null
}

/**
 * Get stored JWT access token (admin or customer) and where it came from.
 */
export function resolveAuth(): ResolvedAuth {
  try {
    const adminSession = localStorage.getItem('vedhic.admin.session.v1')
    if (adminSession) {
      const parsed = JSON.parse(adminSession)
      if (parsed.token) return { token: parsed.token, source: 'admin' }
    }
    const tempAdmin = localStorage.getItem('vedhic.admin.session.temp.v1')
    if (tempAdmin) {
      const parsed = JSON.parse(tempAdmin)
      if (parsed.token) return { token: parsed.token, source: 'admin' }
    }
    const customerToken = tokenStore.getAccessToken()
    if (customerToken) return { token: customerToken, source: 'customer' }
  } catch {
    // ignore JSON parse errors
  }
  return { token: null, source: null }
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
 * Exchanges the HttpOnly refresh cookie for a new access token (single-flight, so
 * a burst of 401s produces exactly one rotation). Returns false when there is
 * no refresh token or the rotation was rejected — the caller then surfaces the
 * original 401 and AuthContext clears the session.
 */
let inflightRefresh: Promise<boolean> | null = null

function rotateCustomerSession(): Promise<boolean> {
  if (!inflightRefresh) {
    inflightRefresh = (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        })
        if (!response.ok) {
          // Provider outages, rate limits and timeouts are recoverable. Only
          // a definite credential rejection should end the local session.
          if (response.status < 500 && response.status !== 408 && response.status !== 429) {
            tokenStore.clear()
            tokenStore.emitExpired()
          }
          return false
        }
        const json = (await response.json()) as { accessToken?: string; token?: string }
        const accessToken = json.accessToken || json.token
        if (!accessToken) {
          tokenStore.clear()
          tokenStore.emitExpired()
          return false
        }
        tokenStore.setTokens(accessToken)
        return true
      } catch {
        // Network failure: keep the session — the next request will retry.
        return false
      } finally {
        inflightRefresh = null
      }
    })()
  }
  return inflightRefresh
}

interface CustomerRefreshLockManager {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

let crossTabRefresh: Promise<boolean> | null = null

function refreshCustomerSession(failedAccessToken: string | null): Promise<boolean> {
  if (crossTabRefresh) return crossTabRefresh

  const rotate = async (): Promise<boolean> => {
    // Another tab may have completed the cookie rotation while this request
    // waited for the cross-tab lock. Reuse its access token instead.
    const currentToken = resolveAuth().token
    if (failedAccessToken && currentToken && currentToken !== failedAccessToken) return true
    return rotateCustomerSession()
  }
  const locks =
    typeof navigator !== 'undefined'
      ? (navigator as unknown as { locks?: CustomerRefreshLockManager }).locks
      : undefined

  crossTabRefresh = (locks ? locks.request('vedhic:customer:refresh', rotate) : rotate()).finally(() => {
    crossTabRefresh = null
  })
  return crossTabRefresh
}

/** Real HTTP client to communicate with the Vedhic Foods backend. */
export async function apiFetch<T>(
  endpoint: string,
  init?: RequestInit,
  options?: RequestOptions,
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`

  const requestId = crypto.randomUUID()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-request-id': requestId,
    ...(init?.headers as Record<string, string>),
  }

  const token = resolveAuth().token
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`
  }
  // Guest order access: a checkout-minted token authorises this one order when
  // the caller holds no account session.
  if (options?.orderToken && !headers['Authorization']) {
    headers['X-Order-Token'] = options.orderToken
  }

  const controller = new AbortController()
  // Remote Supabase queries can legitimately take 10–30s; 15s aborted valid
  // storefront requests. 60s mirrors the admin client budget.
  const timeoutId = setTimeout(() => controller.abort(), 60_000)

  try {
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        headers,
        credentials: 'include',
        signal: options?.signal || controller.signal,
      })
    } catch (error) {
      // Surface a human message instead of the raw browser string "Failed to fetch".
      if (error instanceof Error && error.name === 'AbortError') {
        if (options?.signal?.aborted) {
          throw new ServiceError('CANCELLED', 'The request was cancelled.')
        }
        throw new ServiceError('TIMEOUT', 'This is taking longer than expected. Please try again.')
      }
      throw new ServiceError('NETWORK', 'We could not reach the server. Check your connection and try again.')
    }

    clearTimeout(timeoutId)

    if (!response.ok) {
      // A customer access token that merely expired should be rotated, not
      // reported as "Authentication required" half-way through a checkout.
      if (
        response.status === 401 &&
        resolveAuth().source === 'customer' &&
        !options?.__retried
      ) {
        const refreshed = await refreshCustomerSession(token)
        if (refreshed) {
          return apiFetch<T>(endpoint, init, { ...(options ?? {}), __retried: true })
        }
      }

      let errMsg = `Request failed with status ${response.status}`
      try {
        errMsg = extractErrorMessage(await response.json(), errMsg)
      } catch {
        // response wasn't JSON
      }
      throw new ServiceError(String(response.status), errMsg)
    }

    // 204 No Content (and any empty body) is valid for void/DELETE endpoints;
    // `response.json()` would reject on the empty stream.
    if (response.status === 204) return undefined as T

    const raw = await response.text()
    if (!raw) return undefined as T

    const result = JSON.parse(raw) as unknown
    // If backend wraps in standard format { success: true, data: ... }
    if (result && typeof result === 'object' && 'data' in result) {
      return (result as { data: T }).data
    }
    return result as T
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Fetches a binary response (e.g. a streamed invoice PDF).
 *
 * Mirrors `apiFetch`'s auth injection (bearer token or `X-Order-Token`) and its
 * single retry after a customer token refresh. Use this rather than opening a
 * storage URL directly: it keeps document downloads working when object storage
 * is unavailable (the dev fallback returned a URL to a non-existent bucket,
 * which the browser rendered as an S3 `NoSuchBucket` XML page).
 */
export async function apiFetchBlob(
  endpoint: string,
  init?: RequestInit,
  options?: RequestOptions,
): Promise<Blob> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`
  const requestId = crypto.randomUUID()

  const headers: Record<string, string> = {
    'x-request-id': requestId,
    ...(init?.headers as Record<string, string>),
  }

  const token = resolveAuth().token
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (options?.orderToken && !headers['Authorization']) {
    headers['X-Order-Token'] = options.orderToken
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60_000)

  try {
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        headers,
        credentials: 'include',
        signal: options?.signal || controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (options?.signal?.aborted) {
          throw new ServiceError('CANCELLED', 'The request was cancelled.')
        }
        throw new ServiceError('TIMEOUT', 'This is taking longer than expected. Please try again.')
      }
      throw new ServiceError('NETWORK', 'We could not reach the server. Check your connection and try again.')
    }

    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 401 && resolveAuth().source === 'customer' && !options?.__retried) {
        const refreshed = await refreshCustomerSession(token)
        if (refreshed) {
          return apiFetchBlob(endpoint, init, { ...(options ?? {}), __retried: true })
        }
      }

      let errMsg = `Request failed with status ${response.status}`
      try {
        errMsg = extractErrorMessage(await response.json(), errMsg)
      } catch {
        // response wasn't JSON
      }
      throw new ServiceError(String(response.status), errMsg)
    }

    return response.blob()
  } finally {
    clearTimeout(timeoutId)
  }
}
