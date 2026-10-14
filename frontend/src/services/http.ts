/**
 * Unified transport layer.
 *
 * Connects to the Vedhic Foods Node.js/TypeScript backend REST API.
 * Base URL comes from VITE_API_URL; production builds are pinned to the
 * load-balanced backend by the guard in vite.config.ts.
 * Automatically injects JWT Bearer tokens for authenticated requests.
 * No automatic mock fallback — callers explicitly choose skipApi/fallback behavior.
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
  /** Simulated network latency in ms (used during fallback). */
  delay?: number
  /** 0–1 chance of a simulated failure. */
  failRate?: number
  /** AbortSignal lets callers cancel in-flight requests. */
  signal?: AbortSignal
  /** Skip real API and force local mock execution. */
  skipApi?: boolean
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new ServiceError('ABORTED', 'Request was cancelled.'))
    })
  })
}

/** Resolves with a deep-ish clone so callers cannot mutate the mock store. */
export async function mockRequest<T>(
  resolver: () => T,
  { delay = 260, failRate = 0 }: RequestOptions = {},
): Promise<T> {
  await sleep(delay)
  if (failRate > 0 && Math.random() < failRate) {
    throw new ServiceError('NETWORK', 'Something went wrong. Please try again.')
  }
  const value = resolver()
  return (typeof structuredClone === 'function' ? structuredClone(value) : value) as T
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

/** Get stored JWT access token (admin or customer). */
export function getAuthToken(): string | null {
  return resolveAuth().token
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
 * Exchanges the stored refresh token for a new access token (single-flight, so
 * a burst of 401s produces exactly one rotation). Returns false when there is
 * no refresh token or the rotation was rejected — the caller then surfaces the
 * original 401 and AuthContext clears the session.
 */
let inflightRefresh: Promise<boolean> | null = null

function refreshCustomerSession(): Promise<boolean> {
  if (!inflightRefresh) {
    inflightRefresh = (async () => {
      const refreshToken = tokenStore.getRefreshToken()
      if (!refreshToken) return false

      try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        })
        if (!response.ok) {
          tokenStore.clear()
          tokenStore.emitExpired()
          return false
        }
        const json = (await response.json()) as { accessToken?: string; token?: string; refreshToken?: string }
        const accessToken = json.accessToken || json.token
        if (!accessToken) {
          tokenStore.clear()
          tokenStore.emitExpired()
          return false
        }
        tokenStore.setTokens(accessToken, json.refreshToken || refreshToken)
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
    const response = await fetch(url, {
      ...init,
      headers,
      signal: options?.signal || controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      // A customer access token that merely expired should be rotated, not
      // reported as "Authentication required" half-way through a checkout.
      if (
        response.status === 401 &&
        resolveAuth().source === 'customer' &&
        tokenStore.getRefreshToken() &&
        !options?.__retried
      ) {
        const refreshed = await refreshCustomerSession()
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

    const result = await response.json()
    // If backend wraps in standard format { success: true, data: ... }
    if (result && typeof result === 'object' && 'data' in result) {
      return result.data as T
    }
    return result as T
  } finally {
    clearTimeout(timeoutId)
  }
}
