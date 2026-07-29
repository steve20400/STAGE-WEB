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
import { clearSessionToken } from "../data/session-auth"
import { drainOfflineOutbox } from "../services/messages-service"
import {
  enregistrerAppareilCourant,
  getOrCreateWebDeviceId,
} from "../services/appareils-service"
import { subscribeToSessionRevoked } from "../services/websocket-service"
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
  deleteAccount: (password: string) => Promise<void>
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

  // Renvoie les messages ecrits hors ligne des qu'une session est active et que
  // le reseau revient (au montage aussi : le navigateur a pu etre ferme entre-temps).
  useEffect(() => {
    if (!user) return

    const drain = () => void drainOfflineOutbox()

    drain()
    window.addEventListener("online", drain)

    return () => window.removeEventListener("online", drain)
  }, [user])

  // Inscrit ce navigateur au registre des appareils du compte, et le signale
  // vivant a chaque retour en ligne. L'appel est idempotent cote serveur : il
  // met a jour la ligne existante au lieu d'en creer une seconde.
  useEffect(() => {
    if (!user) return

    const signaler = () => void enregistrerAppareilCourant()

    signaler()
    window.addEventListener("online", signaler)

    return () => window.removeEventListener("online", signaler)
  }, [user])

  const login = useCallback(async (payload: LoginPayload) => {
    const nextUser = storeAuthenticatedSession(await loginWithPassword(payload))
    saveSessionUser(nextUser)
    setUser(nextUser)
    setIsReady(true)
    return nextUser
  }, [])

  const register = useCallback(async (draft: RegistrationDraft, otp: string) => {
    const nextUser = storeAuthenticatedSession(await completeRegistration(draft, otp))
    saveSessionUser(nextUser)
    setUser(nextUser)
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

  // Deconnexion a distance : une autre session du compte a revoque un appareil.
  // Chaque client compare l'identifiant recu au sien ; seul le vise s'efface.
  //
  // Place APRES `logout` : le tableau de dependances est evalue au rendu, donc
  // referencer la fonction plus haut leverait une erreur de zone morte.
  //
  // La revocation en base reste la garantie de fond — cet evenement evite
  // simplement d'attendre l'expiration du jeton d'acces (15 min).
  useEffect(() => {
    if (!user) return

    return subscribeToSessionRevoked((deviceId) => {
      if (deviceId !== getOrCreateWebDeviceId()) return
      void logout()
    })
  }, [user, logout])

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

  const deleteAccount = useCallback(
    async (password: string) => {
      const currentUser = user
      try {
        const { unregisterPush } = await import("../services/push-service")
        await unregisterPush()
      } catch (e) {
        console.error("[Auth] Failed to unregister push during deleteAccount:", e)
      }
      // Laisse remonter l'erreur : un mot de passe refuse ne doit pas passer
      // pour une suppression reussie.
      await deleteCurrentAccount(password)
      if (currentUser) {
        deletePrototypeAccount(currentUser.phone)
      }
      clearSessionUser()
      setUser(null)
      setIsReady(true)
    },
    [user]
  )

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
