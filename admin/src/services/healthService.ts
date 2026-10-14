import { API_BASE_URL } from './http'

/**
 * Live backend connectivity probe for the admin console.
 *
 * WHY THIS IS A REAL CALL AND NOT A CONFIGURATION READ: the question this answers
 * is "is the admin dashboard actually talking to the backend, or is it rendering
 * from local data?". Only a round trip can tell you, and it has to be the
 * readiness endpoint rather than `/health`, because liveness returns `healthy`
 * unconditionally — it never touches the database. A dashboard that renders while
 * the database is unreachable looks identical to a working one otherwise.
 *
 * The probe covers the whole chain the operator actually cares about:
 *
 *   admin SPA (browser) -> DNS -> ALB (TLS) -> ECS task -> PostgreSQL
 *
 * A green result therefore proves CORS allowed this origin, the certificate
 * validated, and the database pool is working. A red result does not say which
 * link broke, which is why the failure reason is preserved below.
 */

export type BackendState = 'online' | 'degraded' | 'offline' | 'checking'

export interface BackendHealth {
  state: BackendState
  /** Round-trip time for the probe itself, in milliseconds. */
  latencyMs: number | null
  /** Base URL the console is configured against. */
  apiBaseUrl: string
  /** Hostname only, for compact display. */
  apiHost: string
  /** `development` | `test` | `staging` | `production`, as reported by the server. */
  environment: string | null
  /** Server-side uptime, so a task that keeps restarting is visible. */
  uptimeSeconds: number | null
  database: 'connected' | 'disconnected' | 'unknown'
  /** Human-readable failure cause. Never contains a token or a response body. */
  detail: string
  checkedAt: string
}

/** Readiness payload. Every field is optional because a proxy error has no body. */
interface ReadinessBody {
  success?: boolean
  data?: {
    status?: 'healthy' | 'degraded' | 'unhealthy'
    environment?: string
    uptimeSeconds?: number
    checks?: { database?: 'connected' | 'disconnected' }
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Distinguishes "the network failed" from "the server answered".
 *
 * These are different incidents with different responses: a `fetch` rejection is
 * DNS, TLS, CORS or the task being down, while an HTTP error means the request
 * completed and the backend deliberately refused. Reporting both as "offline"
 * sends an operator to the wrong system.
 */
function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    // `fetch` rejects with an opaque TypeError for DNS, TLS and CORS failures, so
    // the message is the only signal available. It is intentionally not echoed to
    // the UI verbatim beyond this short form.
    return error.name === 'AbortError' ? 'Request timed out' : `Unreachable (${error.message})`
  }
  return 'Unreachable'
}

export async function probeBackend(signal?: AbortSignal): Promise<BackendHealth> {
  const startedAt = performance.now()
  const apiHost = hostOf(API_BASE_URL)

  const base: BackendHealth = {
    state: 'offline',
    latencyMs: null,
    apiBaseUrl: API_BASE_URL,
    apiHost,
    environment: null,
    uptimeSeconds: null,
    database: 'unknown',
    detail: '',
    checkedAt: new Date().toISOString(),
  }

  try {
    const response = await fetch(`${API_BASE_URL}/health/ready`, {
      method: 'GET',
      // No Authorization header. The readiness endpoint is deliberately public so
      // the ALB health check and this probe share one code path; attaching the
      // session token would also mean a 401 here is ambiguous between "backend
      // down" and "token expired".
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    })

    const latencyMs = Math.round(performance.now() - startedAt)

    if (!response.ok) {
      return {
        ...base,
        latencyMs,
        detail: `Readiness returned HTTP ${response.status}`,
      }
    }

    const body = (await response.json()) as ReadinessBody
    const data = body?.data ?? {}
    const database = data.checks?.database ?? 'unknown'
    const serverStatus = data.status ?? 'degraded'

    // `unhealthy` from the server means it reached the database check and it
    // failed. That is "degraded" from the console's point of view: the API answers
    // but cannot serve data, which is a different fix from an unreachable task.
    const state: BackendState =
      serverStatus === 'healthy' && database === 'connected'
        ? 'online'
        : serverStatus === 'unhealthy'
          ? 'degraded'
          : 'degraded'

    return {
      ...base,
      state,
      latencyMs,
      environment: data.environment ?? null,
      uptimeSeconds: typeof data.uptimeSeconds === 'number' ? data.uptimeSeconds : null,
      database,
      detail:
        state === 'online'
          ? 'API and database responding'
          : database === 'disconnected'
            ? 'API reachable but the database is not'
            : `Server reports "${serverStatus}"`,
      checkedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      ...base,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: describeFailure(error),
      checkedAt: new Date().toISOString(),
    }
  }
}

/** Formats an uptime in seconds as a compact human duration. */
export function formatUptime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'unknown'

  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}