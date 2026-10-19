import { useEffect, useRef } from 'react'
import { subscribeRealtime } from '@/services/realtimeBus'
import type { RealtimeEvent } from '@/services/realtimeService'

/**
 * Default coalescing window for page refreshes.
 *
 * A single order action can emit several channels in quick succession (a status
 * change touches `order.updated` and often `notification.created`), and an
 * import or checkout surge emits many `order.created` events at once. Refetching
 * once per event would hammer the API with an identical query, so the leading
 * event fires immediately and the rest of a burst are collapsed into one trailing
 * call.
 */
const DEFAULT_THROTTLE_MS = 500

export interface UseRealtimeEventsOptions {
  /** Minimum gap between handler invocations. Pass 0 to invoke on every event. */
  throttleMs?: number
}

/**
 * Subscribes to realtime events on the given channels.
 *
 * The handler is held in a ref, so an inline arrow (as pages naturally write)
 * does not tear down and rebuild the subscription on every render. Channels are
 * compared by their joined value, so an inline array literal is also stable.
 */
export function useRealtimeEvents(
  channels: ReadonlyArray<RealtimeEvent['channel']>,
  handler: (event: RealtimeEvent) => void,
  options: UseRealtimeEventsOptions = {},
): void {
  const { throttleMs = DEFAULT_THROTTLE_MS } = options
  const handlerRef = useRef(handler)
  const latestRef = useRef<RealtimeEvent | null>(null)
  const lastRunRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  const channelKey = channels.join('|')

  useEffect(() => {
    const wanted = new Set(channelKey.split('|'))

    const flush = () => {
      timerRef.current = null
      lastRunRef.current = Date.now()
      const event = latestRef.current
      if (event) handlerRef.current(event)
    }

    const unsubscribe = subscribeRealtime((event) => {
      if (!wanted.has(event.channel)) return
      latestRef.current = event

      if (throttleMs <= 0) {
        handlerRef.current(event)
        return
      }

      const elapsed = Date.now() - lastRunRef.current
      if (elapsed >= throttleMs) {
        lastRunRef.current = Date.now()
        handlerRef.current(event)
      } else if (timerRef.current === null) {
        timerRef.current = setTimeout(flush, throttleMs - elapsed)
      }
    })

    return () => {
      unsubscribe()
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [channelKey, throttleMs])
}
