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
  normalizePhoneNumber,
  saveSessionUser,
  type SessionUser,
} from "../data/session-user"
import { clearSessionToken, loadRefreshToken, loadSessionToken } from "../data/session-auth"
import { drainOfflineOutbox } from "../services/messages-service"
import {
  enregistrerAppareilCourant,
  getOrCreateWebDeviceId,
} from "../services/appareils-service"
import { disconnectRealtime, subscribeToSessionRevoked } from "../services/websocket-service"
import { claimLocalCaches, purgeLocalAccountData } from "../services/session-reset"
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
  revokeSession,
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

/**
 * Identifiant stable du compte, pour le verrou des caches locaux.
 *
 * C'est l'Alanya ID qui sert de cle, et non l'UUID backend : `phone` est toujours
 * renseigne dans une session, alors que `id` est optionnel et absent de certains
 * chemins de restauration. Une cle qui change de nature d'un chemin a l'autre
 * ferait croire a un changement de compte et purgerait les caches de
 * l'utilisateur lui-meme — constate en test : le verrou voyait « compte-A » a la
 * connexion et l'Alanya ID a la restauration. Deux comptes ont toujours deux
 * Alanya ID distincts, la protection reste donc entiere.
 */
function accountKey(user: SessionUser) {
  return normalizePhoneNumber(user.phone) || (user.id ?? "")
}

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
        // Un onglet ferme sans se deconnecter, un plantage ou une session expiree
        // laissent les caches en place : le verrou de proprietaire rattrape ces
        // cas-la, que la purge de la deconnexion ne peut pas couvrir.
        await claimLocalCaches(accountKey(restoredUser))
        if (!isMounted) return
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
    await claimLocalCaches(accountKey(nextUser))
    saveSessionUser(nextUser)
    setUser(nextUser)
    setIsReady(true)
    return nextUser
  }, [])

  const register = useCallback(async (draft: RegistrationDraft, otp: string) => {
    const nextUser = storeAuthenticatedSession(await completeRegistration(draft, otp))
    await claimLocalCaches(accountKey(nextUser))
    saveSessionUser(nextUser)
    setUser(nextUser)
    setIsReady(true)
    return nextUser
  }, [])

  /**
   * Quitte la session localement, et immediatement : temps reel coupe, jetons et
   * profil effaces, caches du compte purges. Renvoie les jetons retires du
   * stockage, dont les appels d'adieu au serveur ont besoin.
   *
   * L'ordre precedent attendait trois allers-retours reseau — desinscription
   * push, puis revocation — AVANT de vider l'etat local : l'utilisateur restait
   * visuellement connecte pendant tout ce temps, la socket continuait de
   * recevoir, et rien ne bornait l'attente.
   */
  const leaveSessionLocally = useCallback(() => {
    const tokens = { accessToken: loadSessionToken(), refreshToken: loadRefreshToken() }

    disconnectRealtime()
    clearSessionToken()
    clearSessionUser()
    setUser(null)
    setIsReady(true)

    // Sans cette purge, le compte suivant qui se connecte dans ce navigateur voit
    // les conversations, messages et contacts du precedent, servis par le chemin
    // cache-first.
    void purgeLocalAccountData()

    return tokens
  }, [])

  /**
   * Appels d'adieu au serveur, lances sans etre attendus. Les deux sont deja
   * traites comme facultatifs par le code : un echec reseau y est tolere, et le
   * jeton finira de toute facon par expirer.
   */
  const notifyServerOfDeparture = useCallback(
    (
      tokens: { accessToken: string | null; refreshToken: string | null },
      revoke: (tokens: { accessToken: string | null; refreshToken: string | null }) => Promise<void>
    ) => {
      void (async () => {
        try {
          const { unregisterPush } = await import("../services/push-service")
          await unregisterPush(tokens.accessToken)
        } catch (e) {
          console.warn("[Auth] desinscription push impossible :", e)
        }
        try {
          await revoke(tokens)
        } catch (e) {
          console.warn("[Auth] revocation de session impossible :", e)
        }
      })()
    },
    []
  )

  const logout = useCallback(async () => {
    notifyServerOfDeparture(leaveSessionLocally(), revokeSession)
  }, [leaveSessionLocally, notifyServerOfDeparture])

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
    notifyServerOfDeparture(leaveSessionLocally(), logoutAllSessions)
  }, [leaveSessionLocally, notifyServerOfDeparture])

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
        await unregisterPush(loadSessionToken())
      } catch (e) {
        console.error("[Auth] Failed to unregister push during deleteAccount:", e)
      }
      // Laisse remonter l'erreur : un mot de passe refuse ne doit pas passer
      // pour une suppression reussie.
      await deleteCurrentAccount(password)
      if (currentUser) {
        deletePrototypeAccount(currentUser.phone)
      }
      // Le compte n'existe plus : ses caches locaux ne doivent pas lui survivre.
      leaveSessionLocally()
    },
    [leaveSessionLocally, user]
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
