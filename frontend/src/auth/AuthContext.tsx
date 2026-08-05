import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import * as client from '../api/client'
import type { User } from '../api/client'

interface AuthState {
  user: User | null
  isAdmin: boolean
  loading: boolean
  login: (email: string, password: string) => Promise<{ requires2fa: true; mfaToken: string } | undefined>
  login2FA: (mfaToken: string, code: string) => Promise<void>
  demoLogin: () => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  // Bootstrap: the refresh cookie survives reloads; exchange it for a session.
  useEffect(() => {
    client
      .tryRefresh()
      .then((auth) => {
        setUser(auth?.user ?? null)
        setIsAdmin(auth?.isAdmin ?? false)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const auth = await client.login(email, password)
    if ('requires2fa' in auth) return auth
    setUser(auth.user)
    setIsAdmin(auth.isAdmin ?? false)
    return undefined
  }, [])

  const login2FA = useCallback(async (mfaToken: string, code: string) => {
    const auth = await client.login2FA(mfaToken, code)
    setUser(auth.user)
    setIsAdmin(auth.isAdmin ?? false)
  }, [])

  const demoLogin = useCallback(async () => {
    const auth = await client.demoLogin()
    setUser(auth.user)
    setIsAdmin(auth.isAdmin ?? false)
  }, [])

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const auth = await client.register(email, password, displayName)
    setUser(auth.user)
  }, [])

  const logout = useCallback(async () => {
    await client.logout()
    setUser(null)
    setIsAdmin(false)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, login, login2FA, demoLogin, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
