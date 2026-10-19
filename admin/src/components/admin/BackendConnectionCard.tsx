import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Icon } from '../common'
import {
  formatUptime,
  probeBackend,
  type BackendHealth,
  type BackendState,
} from '@/services/healthService'

/**
 * Live "is the console actually talking to the backend?" indicator.
 *
 * This is a genuine round trip to `GET /api/v1/health/ready` rather than a read of
 * the configured URL, because the failure it is meant to catch is precisely a
 * console that renders normally while every write it performs is being dropped.
 * A configured URL proves intent; only a 200 proves a working chain.
 *
 * `aria-live="polite"` is deliberate: an operator watching this while a deploy
 * runs should hear the state change without the page stealing focus.
 */

/** Steady poll while the backend is reachable. */
const ONLINE_INTERVAL_MS = 30_000
/** First retry delay once a probe fails; doubles on each consecutive failure. */
const OFFLINE_BACKOFF_BASE_MS = 10_000
/** Upper bound on the offline retry delay. */
const OFFLINE_BACKOFF_MAX_MS = 120_000
/** Consecutive failures are capped so the backoff math cannot overflow. */
const MAX_TRACKED_FAILURES = 6

const STATE_TONE: Record<BackendState, 'success' | 'warning' | 'danger' | 'info'> = {
  online: 'success',
  degraded: 'warning',
  offline: 'danger',
  checking: 'info',
}

const STATE_LABEL: Record<BackendState, string> = {
  online: 'Connected',
  degraded: 'Degraded',
  offline: 'Unreachable',
  checking: 'Checking',
}

export function BackendConnectionCard() {
  const [health, setHealth] = useState<BackendHealth | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<number | null>(null)
  const failuresRef = useRef(0)
  // Lets the scheduled retry call the *latest* probe without the scheduling
  // callback depending on itself.
  const probeRef = useRef<() => Promise<void>>(async () => {})

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const runProbe = useCallback(async () => {
    clearTimer()
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const result = await probeBackend(controller.signal)
    // A superseded probe must not overwrite a newer result.
    if (controller.signal.aborted) return
    setHealth(result)

    failuresRef.current =
      result.state === 'online' ? 0 : Math.min(failuresRef.current + 1, MAX_TRACKED_FAILURES)

    // Schedule the next probe from this result rather than on a fixed interval:
    // an unreachable backend is retried with a growing backoff instead of every
    // 30s forever, which is what filled the console during an API restart.
    const delay =
      result.state === 'online'
        ? ONLINE_INTERVAL_MS
        : Math.min(
            OFFLINE_BACKOFF_MAX_MS,
            OFFLINE_BACKOFF_BASE_MS * 2 ** Math.max(0, failuresRef.current - 1),
          )

    // While the tab is hidden nobody is reading the indicator, so skip the poll;
    // `visibilitychange` resumes it immediately on return.
    if (typeof document !== 'undefined' && document.hidden) return

    timerRef.current = window.setTimeout(() => {
      void probeRef.current()
    }, delay)
  }, [clearTimer])

  useEffect(() => {
    probeRef.current = runProbe
  }, [runProbe])

  useEffect(() => {
    void runProbe()

    const onVisibility = () => {
      if (!document.hidden) void runProbe()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimer()
      abortRef.current?.abort()
    }
  }, [runProbe, clearTimer])

  const state: BackendState = health?.state ?? 'checking'

  return (
    <article className="admin-card admin-card--wide">
      <header className="admin-card__head">
        <h2>Backend connection</h2>
        <Badge tone={STATE_TONE[state]} dot>
          {STATE_LABEL[state]}
        </Badge>
      </header>

      <p aria-live="polite" className="admin-card__hint">
        {health?.detail || 'Contacting the API…'}
      </p>

      <dl className="m-kv">
        <div className="m-kv__row">
          <dt>API endpoint</dt>
          <dd>
            <code>{health?.apiHost ?? '…'}</code>
          </dd>
        </div>
        <div className="m-kv__row">
          <dt>Environment</dt>
          <dd>
            {health?.environment ? (
              // A production console pointed at a non-production backend is a
              // misconfiguration worth surfacing loudly rather than in a tooltip.
              <Badge tone={health.environment === 'production' ? 'success' : 'warning'}>
                {health.environment}
              </Badge>
            ) : (
              'unknown'
            )}
          </dd>
        </div>
        <div className="m-kv__row">
          <dt>Database</dt>
          <dd>
            <StatusDot
              ok={health?.database === 'connected'}
              unknown={!health || health.database === 'unknown'}
              okLabel="Connected"
              badLabel="Disconnected"
            />
          </dd>
        </div>
        <div className="m-kv__row">
          <dt>Round trip</dt>
          <dd>{health?.latencyMs !== null && health?.latencyMs !== undefined ? `${health.latencyMs} ms` : '—'}</dd>
        </div>
        <div className="m-kv__row">
          <dt>API uptime</dt>
          <dd>{formatUptime(health?.uptimeSeconds ?? null)}</dd>
        </div>
      </dl>

      <button type="button" className="link-button is-ghost" onClick={() => void runProbe()}>
        <Icon name="refresh" size={14} /> Check now
      </button>
    </article>
  )
}

function StatusDot({
  ok,
  unknown,
  okLabel,
  badLabel,
}: {
  ok: boolean
  unknown: boolean
  okLabel: string
  badLabel: string
}) {
  if (unknown) return <span className="type-caption">unknown</span>
  return (
    <Badge tone={ok ? 'success' : 'danger'} dot>
      {ok ? okLabel : badLabel}
    </Badge>
  )
}