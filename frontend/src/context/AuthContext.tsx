import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authService, normalizeSessionUser } from '@/services/authService'
import { AUTH_EXPIRED_EVENT, tokenStore, type SessionUser } from '@/services/tokenStore'
import { useToast } from './ToastContext'

interface SignInInput {
  email: string
  password: string
}

interface RegisterInput {
  fullName: string
  email: string
  password: string
  phone?: string
}

interface AuthContextValue {
  user: SessionUser | null
  /** True once the initial `/auth/me` bootstrap has settled. */
  ready: boolean
  signIn: (input: SignInInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { push } = useToast()
  const [user, setUser] = useState<SessionUser | null>(() => tokenStore.getUser())
  const [ready, setReady] = useState(!tokenStore.hasSession())

  const clearSession = useCallback(() => {
    tokenStore.clear()
    setUser(null)
  }, [])

  useEffect(() => {
    if (!tokenStore.hasSession()) return

    let cancelled = false
    async function bootstrap() {
      try {
        const profile = await authService.me()
        if (cancelled) return
        const next = normalizeSessionUser(profile)
        tokenStore.setUser(next)
        setUser(next)
      } catch {
        if (cancelled) return
        // `apiFetch` already tried a refresh on 401; a failed bootstrap means the
        // session is genuinely gone.
        clearSession()
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [clearSession])

  useEffect(() => {
    const onExpired = () => {
      setUser((current) => {
        if (current) {
          push({
            title: 'Session expired',
            description: 'Please sign in again to continue.',
            tone: 'warning',
          })
        }
        return null
      })
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [push])

  const signIn = useCallback(async (input: SignInInput) => {
    const session = await authService.login(input)
    setUser(session.user)
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    const session = await authService.register(input)
    setUser(session.user)
  }, [])

  const signOut = useCallback(async () => {
    try {
      await authService.logout()
    } catch {
      /* local state is cleared regardless */
    } finally {
      clearSession()
    }
  }, [clearSession])

  const refresh = useCallback(async () => {
    const profile = await authService.me()
    const next = normalizeSessionUser(profile)
    tokenStore.setUser(next)
    setUser(next)
  }, [])

  const value = useMemo(
    () => ({ user, ready, signIn, register, signOut, refresh }),
    [user, ready, signIn, register, signOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}