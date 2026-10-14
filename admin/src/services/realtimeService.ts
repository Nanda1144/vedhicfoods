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

    es.addEventListener('open', () => {
      attempt = 0
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
      attempt += 1
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
      reconnectTimer = setTimeout(open, delay)
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