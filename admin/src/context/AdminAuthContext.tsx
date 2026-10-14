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
import type { Permission } from '@/types'

interface AdminAuthValue {
  session: AdminSession | null
  loading: boolean
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

    setLoading(true)

    void adminAuthService
      .validateSession()
      .then((next) => {
        if (cancelled) return
        // A null result means the server rejected or downgraded the credential.
        if (!next) adminAuthService.logout()
        setSession(next)
      })
      .catch(() => {
        // Network error, 5xx, or an aborted request. Never leave a half-trusted
        // session in place, and never leave the console spinning.
        if (cancelled) return
        adminAuthService.logout()
        setSession(null)
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
    () => ({ session, loading, login, logout, can, refresh, setSession }),
    [session, loading, login, logout, can, refresh],
  )

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>')
  return ctx
}