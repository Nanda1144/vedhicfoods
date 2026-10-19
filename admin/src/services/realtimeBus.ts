import type { RealtimeEvent } from './realtimeService'

/**
 * In-process fan-out for realtime events.
 *
 * The console opens exactly one SSE connection, and it lives in `AdminLayout`
 * (via `useRealtime`) so it survives navigation and outlives any single page.
 * Pages cannot open their own stream — that would multiply connections per tab
 * and defeat the throttling the service does — so `AdminLayout` publishes every
 * event it receives here and pages subscribe to the subset they care about.
 *
 * Kept separate from `realtimeService` so consumers (and tests) do not have to
 * pull in the HTTP/session modules just to pass events around.
 */

export type RealtimeListener = (event: RealtimeEvent) => void

const listeners = new Set<RealtimeListener>()

/** Registers a listener; returns the unsubscribe function. */
export function subscribeRealtime(listener: RealtimeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Delivers an event to every subscriber. A subscriber that throws must not take
 * down the stream (or the other subscribers), so each call is isolated. The
 * listener set is copied first for the same reason: a handler that subscribes or
 * unsubscribes while iterating cannot corrupt the walk.
 */
export function publishRealtime(event: RealtimeEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // Realtime is best-effort; a bad handler must never surface as a crash.
    }
  }
}
