/**
 * Unified transport layer.
 *
 * Connects to the Vedhic Foods Node.js/TypeScript backend REST API.
 * Base URL comes from VITE_API_URL; production builds are pinned to the
 * load-balanced backend by the guard in vite.config.ts.
 * Automatically injects JWT Bearer tokens for authenticated customer and admin requests.
 * No automatic mock fallback — callers explicitly choose skipApi/fallback behavior.
 */

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
  /** Simulated network latency in ms (used during fallback). */
  delay?: number
  /** 0–1 chance of a simulated failure. */
  failRate?: number
  /** AbortSignal lets callers cancel in-flight requests. */
  signal?: AbortSignal
  /** Skip real API and force local mock execution. */
  skipApi?: boolean
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

/**
 * Get stored JWT access token (admin or customer).
 */
export function getAuthToken(): string | null {
  try {
    const adminSession = localStorage.getItem('vedhic.admin.session.v1')
    if (adminSession) {
      const parsed = JSON.parse(adminSession)
      if (parsed.token) return parsed.token
    }
    const tempAdmin = localStorage.getItem('vedhic.admin.session.temp.v1')
    if (tempAdmin) {
      const parsed = JSON.parse(tempAdmin)
      if (parsed.token) return parsed.token
    }
    const customerToken = localStorage.getItem('vedhic.auth.token')
    if (customerToken) return customerToken
  } catch {
    // ignore JSON parse errors
  }
  return null
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
export async function apiFetchRaw<T>(
  endpoint: string,
  init?: RequestInit,
  options?: RequestOptions,
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`

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
      signal: controller.signal,
    })
  } catch (error) {
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
    let errMsg = `Request failed with status ${response.status}`
    try {
      const errJson = await response.json()
      const nested = typeof errJson.error === 'object' ? errJson.error?.message : errJson.error
      errMsg = errJson.message || nested || errMsg
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
