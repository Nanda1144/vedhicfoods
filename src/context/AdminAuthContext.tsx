import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { adminAuthService, type AdminSession } from '@/services/adminAuthService'
import type { Permission } from '@/types'

interface AdminAuthValue {
  session: AdminSession | null
  loading: boolean
  login: (email: string, password: string, remember?: boolean) => Promise<AdminSession>
  logout: () => void
  /** Owner always passes; otherwise checks the session permission list. */
  can: (permission: Permission) => boolean
  /** Refresh session after permissions change (owner editing staff). */
  refresh: () => void
  setSession: (session: AdminSession | null) => void
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(() => adminAuthService.session())
  const [loading, setLoading] = useState(false)

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

  const refresh = useCallback(() => {
    setSession(adminAuthService.session())
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