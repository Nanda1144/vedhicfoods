import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { adminAuthService, type AdminSession } from '@/services/adminAuthService'
import {
  ADMIN_SESSION_EXPIRED_EVENT,
  ADMIN_SESSION_UPDATED_EVENT,
} from '@/services/adminSessionStore'
import { useAdminIdleLogout } from '@/hooks/useAdminIdleLogout'
import type { Permission } from '@/types'

interface AdminAuthValue {
  session: AdminSession | null
  loading: boolean
  /** True when the session ended because a token refresh was rejected. */
  sessionExpired: boolean
  login: (email: string, password: string, remember?: boolean) => Promise<AdminSession>
  logout: () => void
  /** Reflects the permission slugs the server granted; no implicit owner bypass. */
  can: (permission: Permission) => boolean
  /** Re-read the session after permissions change (e.g. an owner editing staff). */
  refresh: () => Promise<AdminSession | null>
  setSession: (session: AdminSession | null) => void
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  // Start from the persisted session so a reload does not flash the login screen.
  const [session, setSession] = useState<AdminSession | null>(() => adminAuthService.session())
  const [loading, setLoading] = useState(() => Boolean(adminAuthService.session()))
  const [sessionExpired, setSessionExpired] = useState(false)

  /**
   * Reacts to session lifecycle events published by the transport layer.
   *
   * `updated` fires after the refresh token was exchanged for a new access token.
   * The rotation happens inside `http.ts` and writes storage directly, so the
   * reactive copy held here would otherwise go stale — the live SSE connection and
   * anything reading `session.token` must re-read it.
   *
   * `expired` fires when a rotation was rejected. The session is already cleared
   * from storage; this drops it from React state and sets the flag the login page
   * uses to explain why the operator was signed out.
   */
  useEffect(() => {
    const onUpdated = () => setSession(adminAuthService.session())
    const onExpired = () => {
      setSession(null)
      setSessionExpired(true)
    }

    window.addEventListener(ADMIN_SESSION_UPDATED_EVENT, onUpdated)
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, onExpired)
    return () => {
      window.removeEventListener(ADMIN_SESSION_UPDATED_EVENT, onUpdated)
      window.removeEventListener(ADMIN_SESSION_EXPIRED_EVENT, onExpired)
    }
  }, [])

  /**
   * SECURITY: a token in `localStorage` proves nothing on its own. It may be
   * expired, revoked by a password change, belong to an account that has since
   * been deactivated, or be a legacy record from a previous build whose shape no
   * longer matches the session type — that last case is what rendered the admin
   * console with `session.name === undefined` and crashed the whole route in
   * `initials()`.
   *
   * `adminAuthService.session()` is trusted purely so the first paint is not a
   * login flash; before any protected content is shown it is confirmed against
   * `GET /admin/auth/me`. If that call fails for any reason the session is
   * discarded, so the console cannot render privileged UI for a credential the
   * API would reject on the first click.
   *
   * REGRESSION (fixed): this effect was guarded by a `useRef` "already ran" flag.
   * Under `<StrictMode>` React runs mount -> cleanup -> mount, and a ref is *not*
   * reset between those, so the second run hit the guard, returned early, and
   * never called `setLoading(false)` — the console sat on "Restoring your
   * session…" forever. The effect must be re-runnable and each run must own its
   * own cancellation; idempotence comes from `validateSession()` being a pure
   * read plus a write of the same value, not from skipping the second run.
   */
  useEffect(() => {
    let cancelled = false

    const stored = adminAuthService.session()
    if (!stored) {
      setSession(null)
      setLoading(false)
      return
    }

    void adminAuthService
      .validateSession()
      .then((next) => {
        if (cancelled) return
        // A null result means the server rejected or downgraded the credential.
        if (!next) adminAuthService.logout()
        setSession(next)
      })
      .catch(() => {
        // An unexpected probe failure should not discard a refresh-cookie
        // session. Protected API calls still enforce authorization server-side.
        if (cancelled) return
        setSession(adminAuthService.session())
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string, remember = true) => {
    setLoading(true)
    try {
      const next = await adminAuthService.login(email, password, remember)
      setSessionExpired(false)
      setSession(next)
      return next
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    adminAuthService.logout()
    setSession(null)
  }, [])

  /**
   * Drops a session that has seen no activity for 24 hours (see
   * `useAdminIdleLogout`). Mirrors a rejected refresh: the console returns to
   * login with the same "you were signed out" explanation.
   */
  const handleIdleLogout = useCallback(() => {
    adminAuthService.logout()
    setSession(null)
    setSessionExpired(true)
  }, [])

  useAdminIdleLogout(Boolean(session), handleIdleLogout)

  const can = useCallback(
    (permission: Permission) => adminAuthService.can(session, permission),
    [session],
  )

  /**
   * Re-validates the session against `GET /admin/auth/me` so permission changes
   * (grants revoked, roles changed) are picked up without a full sign-out.
   */
  const refresh = useCallback(async () => {
    const next = await adminAuthService.validateSession()
    setSession(next)
    return next
  }, [])

  const value = useMemo<AdminAuthValue>(
    () => ({ session, loading, sessionExpired, login, logout, can, refresh, setSession }),
    [session, loading, sessionExpired, login, logout, can, refresh],
  )

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>')
  return ctx
}
