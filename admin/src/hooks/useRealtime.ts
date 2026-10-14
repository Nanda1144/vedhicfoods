import { useEffect, useRef, useState } from 'react'
import { connectRealtime, type RealtimeEvent, type RealtimeStatus } from '@/services/realtimeService'

/**
 * Connects the console to the SSE stream while `token` is present and reports
 * the live connection status. Reconnects whenever the token changes (fresh
 * login) or when the connection drops.
 *
 * `onEvent` is held in a ref so an inline handler does not tear down and rebuild
 * the stream on every render.
 */
export function useRealtime(
  token: string | null | undefined,
  onEvent: (event: RealtimeEvent) => void,
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('idle')
  const handlerRef = useRef(onEvent)

  useEffect(() => {
    handlerRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!token) {
      setStatus('idle')
      return
    }

    return connectRealtime({
      onEvent: (event) => handlerRef.current(event),
      onStatus: setStatus,
    })
  }, [token])

  return status
}