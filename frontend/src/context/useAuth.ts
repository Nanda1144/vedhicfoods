import { createContext, useContext } from 'react'
import type { SessionUser } from '@/services/tokenStore'

export interface SignInInput {
  email: string
  password: string
}

export interface RegisterInput {
  fullName: string
  email: string
  password: string
  phone?: string
}

export interface AuthContextValue {
  user: SessionUser | null
  /** True once the initial `/auth/me` bootstrap has settled. */
  ready: boolean
  signIn: (input: SignInInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
