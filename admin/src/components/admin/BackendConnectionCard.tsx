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

const POLL_INTERVAL_MS = 30_000

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

  const runProbe = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const result = await probeBackend(controller.signal)
    // A superseded probe must not overwrite a newer result.
    if (!controller.signal.aborted) setHealth(result)
  }, [])

  useEffect(() => {
    void runProbe()
    const timer = window.setInterval(() => void runProbe(), POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [runProbe])

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