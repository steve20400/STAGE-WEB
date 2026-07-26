import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  clearSessionUser,
  loadSessionUser,
  saveSessionUser,
  type SessionUser,
} from "../data/session-user"
import { registerCurrentDevice } from "../services/device-session-service"
import { clearSessionToken } from "../data/session-auth"
import {
  deletePrototypeAccount,
  migrateLegacyPrototypeAccounts,
  updatePrototypeAccountProfile,
} from "../data/prototype-auth"
import {
  completeRegistration,
  deleteCurrentAccount,
  loginWithPassword,
  logoutAllSessions,
  logoutCurrentSession,
  type LoginPayload,
  type RegistrationDraft,
  restoreAuthenticatedUser,
  storeAuthenticatedSession,
} from "../services/auth-api"

interface AuthContextValue {
  isReady: boolean
  user: SessionUser | null
  isAuthenticated: boolean
  login: (payload: LoginPayload) => Promise<SessionUser>
  register: (draft: RegistrationDraft, otp: string) => Promise<SessionUser>
  logout: () => Promise<void>
  logoutEverywhere: () => Promise<void>
  updateUser: (user: SessionUser) => void
  deleteAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function hydrateSession() {
      await migrateLegacyPrototypeAccounts()
      const cachedUser = loadSessionUser()

      if (!cachedUser) {
        if (isMounted) {
          setUser(null)
          setIsReady(true)
        }
        return
      }

      const restoredUser = await restoreAuthenticatedUser()

      if (!isMounted) return

      if (restoredUser) {
        saveSessionUser(restoredUser)
        setUser(restoredUser)
        void registerCurrentDevice().catch(() => undefined)
      } else {
        clearSessionToken()
        clearSessionUser()
        setUser(null)
      }

      setIsReady(true)
    }

    void hydrateSession()

    return () => {
      isMounted = false
    }
  }, [])

  const login = useCallback(async (payload: LoginPayload) => {
    const nextUser = storeAuthenticatedSession(await loginWithPassword(payload))
    saveSessionUser(nextUser)
    setUser(nextUser)
    void registerCurrentDevice().catch(() => undefined)
    setIsReady(true)
    return nextUser
  }, [])

  const register = useCallback(async (draft: RegistrationDraft, otp: string) => {
    const nextUser = storeAuthenticatedSession(await completeRegistration(draft, otp))
    saveSessionUser(nextUser)
    setUser(nextUser)
    void registerCurrentDevice().catch(() => undefined)
    setIsReady(true)
    return nextUser
  }, [])

  const logout = useCallback(async () => {
    try {
      const { unregisterPush } = await import("../services/push-service")
      await unregisterPush()
    } catch (e) {
      console.error("[Auth] Failed to unregister push during logout:", e)
    }
    await logoutCurrentSession()
    clearSessionUser()
    setUser(null)
    setIsReady(true)
  }, [])

  const logoutEverywhere = useCallback(async () => {
    try {
      const { unregisterPush } = await import("../services/push-service")
      await unregisterPush()
    } catch (e) {
      console.error("[Auth] Failed to unregister push during logout:", e)
    }
    await logoutAllSessions()
    clearSessionUser()
    setUser(null)
    setIsReady(true)
  }, [])

  const updateUser = useCallback((nextUser: SessionUser) => {
    saveSessionUser(nextUser)
    updatePrototypeAccountProfile(nextUser)
    setUser(nextUser)
    setIsReady(true)
  }, [])

  const deleteAccount = useCallback(async () => {
    const currentUser = user
    try {
      const { unregisterPush } = await import("../services/push-service")
      await unregisterPush()
    } catch (e) {
      console.error("[Auth] Failed to unregister push during deleteAccount:", e)
    }
    await deleteCurrentAccount()
    if (currentUser) {
      deletePrototypeAccount(currentUser.phone)
    }
    clearSessionUser()
    setUser(null)
    setIsReady(true)
  }, [user])

  const value = useMemo<AuthContextValue>(
    () => ({
      isReady,
      user,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      logoutEverywhere,
      updateUser,
      deleteAccount,
    }),
    [deleteAccount, isReady, login, logout, logoutEverywhere, register, updateUser, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>")
  }

  return context
}
