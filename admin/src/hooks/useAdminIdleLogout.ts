import { useEffect } from 'react'
import {
  ADMIN_IDLE_TIMEOUT_MS,
  isAdminIdleExpired,
  recordAdminActivity,
} from '@/services/adminSessionStore'

/**
 * Signs the operator out after the admin console has seen no activity for the
 * idle window (24 hours).
 *
 * WHY: the backend expires a console refresh token 24 hours after its last use,
 * so an abandoned session can never be silently resumed — but the server only
 * learns of the gap when a request finally arrives. A tab left open overnight
 * would otherwise sit on a fully rendered dashboard indefinitely, long after the
 * session behind it had died. This watcher closes that gap: it records user
 * activity and, on a timer, drops the session the moment the window lapses.
 *
 * Only real user interaction counts. Mousemove is deliberately excluded — a
 * nudged desk or a drifting cursor should not keep a session alive — and
 * `recordAdminActivity` is called at most once a minute regardless of how many
 * events fire.
 *
 * @param enabled  Whether a session is currently active. The watcher is inert
 *                 while signed out so it never competes with the login screen.
 * @param onIdle   Invoked once when the window lapses; should clear the session
 *                 and return the console to the login screen.
 */
export function useAdminIdleLogout(enabled: boolean, onIdle: () => void): void {
  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return

    // A restored session may already be past the window — e.g. the tab was
    // reopened after a weekend. Fire before wiring listeners.
    if (isAdminIdleExpired()) {
      onIdle()
      return
    }

    const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focus'] as const

    let lastWrite = 0
    const WRITE_THROTTLE_MS = 60_000

    const markActivity = (): void => {
      const now = Date.now()
      if (now - lastWrite < WRITE_THROTTLE_MS) return
      lastWrite = now
      recordAdminActivity(now)
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActivity, { passive: true })
    }

    /**
     * Checked often enough to be punctual but rarely enough to be free while
     * idle. `isAdminIdleExpired` reads localStorage, so a one-minute cadence is
     * negligible.
     */
    const interval = window.setInterval(() => {
      if (isAdminIdleExpired()) onIdle()
    }, 60_000)

    // A backgrounded tab has its timers throttled; re-check the moment it is
    // brought forward so returning after the window logs out immediately rather
    // than after the next tick.
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible' && isAdminIdleExpired()) onIdle()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActivity)
      }
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, onIdle])
}

export { ADMIN_IDLE_TIMEOUT_MS }
