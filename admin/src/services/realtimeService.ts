import { API_BASE_URL, getAuthToken } from './http'

/**
 * Server-Sent Events client for the admin console.
 *
 * The backend exposes `GET /api/v1/events` as a dependency-free SSE stream.
 * `EventSource` cannot set an `Authorization` header, so the access token is
 * passed as a `?token=` query parameter (the route accepts it there for exactly
 * this reason). Staff console identities receive order, notification, content
 * and subscriber channels; the server derives that from the token, not from
 * anything this client claims.
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'error'

export interface RealtimeEvent {
  channel: string
  data: unknown
}

/**
 * Channels the console subscribes to. The SSE route emits *named* events, so a
 * listener must be registered for each channel — an unnamed `message` listener
 * would never fire.
 */
export const REALTIME_CHANNELS = [
  'order.created',
  'order.updated',
  'notification.created',
  'content.updated',
  'subscriber.created',
  'subscriber.updated',
] as const

export interface RealtimeHandlers {
  onEvent: (event: RealtimeEvent) => void
  onStatus?: (status: RealtimeStatus) => void
}

function parse(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

/** Longest wait between reconnect attempts. */
const MAX_BACKOFF_MS = 60_000
/** First retry delay after a drop; doubles on each consecutive failure. */
const BASE_BACKOFF_MS = 1_000
/**
 * A stream that drops sooner than this is treated as "the backend is still
 * failing" rather than "a healthy connection blipped", so the backoff keeps
 * growing. The backend dev server restarts on every file save; without this the
 * `open` -> immediate reset cycle kept resetting the counter and produced a
 * reconnect every couple of seconds.
 */
const STABLE_CONNECTION_MS = 15_000

/**
 * Exponential backoff with full jitter. The jitter keeps a fleet of consoles
 * from reconnecting in lockstep after an outage, which would otherwise look like
 * a self-inflicted thundering herd against the API.
 */
function backoffDelay(attempt: number): number {
  const capped = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempt, 6))
  return Math.round(capped / 2 + Math.random() * (capped / 2))
}

/**
 * Opens the SSE stream and keeps it alive across token rotation and transient
 * network drops. Returns a teardown function; call it on unmount.
 *
 * The browser's own EventSource auto-reconnect reuses the *original* URL, which
 * would keep an expired token forever — so on error the stream is closed and
 * re-opened with whatever token is current, with exponential backoff.
 */
export function connectRealtime(handlers: RealtimeHandlers): () => void {
  let closed = false
  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let attempt = 0

  const open = () => {
    if (closed) return

    const token = getAuthToken()
    const url = `${API_BASE_URL}/events${token ? `?token=${encodeURIComponent(token)}` : ''}`
    handlers.onStatus?.('connecting')

    const es = new EventSource(url)
    source = es

    let openedAt = 0

    es.addEventListener('open', () => {
      openedAt = Date.now()
      handlers.onStatus?.('open')
    })

    for (const channel of REALTIME_CHANNELS) {
      es.addEventListener(channel, (event) => {
        handlers.onEvent({ channel, data: parse((event as MessageEvent).data) })
      })
    }

    es.addEventListener('error', () => {
      handlers.onStatus?.('error')
      es.close()
      if (source === es) source = null
      if (closed) return
      // Only a connection that stayed up long enough counts as recovered; a
      // stream that opens and immediately resets is still a failing backend.
      if (openedAt && Date.now() - openedAt >= STABLE_CONNECTION_MS) attempt = 0
      attempt += 1
      reconnectTimer = setTimeout(open, backoffDelay(attempt))
    })
  }

  open()

  return () => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    source?.close()
    source = null
  }
}