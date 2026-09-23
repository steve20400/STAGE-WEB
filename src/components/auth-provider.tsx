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
import { viderFileStatuts } from "../services/outbox-statuts"
import {
  enregistrerAppareilCourant,
  getOrCreateWebDeviceId,
} from "../services/appareils-service"
import {
  RAISON_EVICTION,
  disconnectRealtime,
  subscribeToSessionRevoked,
  subscribeToWsConnected,
} from "../services/websocket-service"
import { MESSAGE_EVICTION, poseMessageDeconnexion } from "../data/session-message"
import { claimLocalCaches, purgeLocalAccountData } from "../services/session-reset"
import { oublierCetAppareil, preparerCetAppareil } from "../services/e2ee-service"
import { refermer as refermerSauvegarde, vider as viderSauvegarde } from "../services/e2ee-sauvegarde"
import {
  deletePrototypeAccount,
  migrateLegacyPrototypeAccounts,
  updatePrototypeAccountProfile,
} from "../data/prototype-auth"
import {
  completeRegistration,
  registerSansEmail,
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
  /** Inscription sans adresse : rend AUSSI le code de recuperation, montre une seule fois. */
  registerWithoutEmail: (
    draft: Omit<RegistrationDraft, "email">,
  ) => Promise<{ user: SessionUser; idRecuperation: string }>
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
        // Voir `publierMesCles` : la reprise de session est le SEUL chemin
        // d'un compte déjà connecté avant cette version.
        void preparerCetAppareil().catch(() => undefined)
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

    // Les deux files partent ensemble : elles attendent le meme reseau.
    const drain = () => {
      void drainOfflineOutbox()
      void viderFileStatuts()
    }

    drain()
    window.addEventListener("online", drain)

    /*
     * ⚠️ LA RECONNEXION DU WEBSOCKET EST LE SIGNAL FIABLE, pas `online`.
     *
     * L'evenement `online` du navigateur dit seulement « une interface reseau
     * est montee » — pas « le serveur repond ». Un portail captif d'hotel, un
     * Wi-Fi sans Internet, un backend redemarre : dans ces trois cas il ne se
     * declenche JAMAIS, et la file d'attente resterait pleine indefiniment
     * pendant que l'ecran promet un envoi differe.
     *
     * Le WebSocket, lui, ne se declare connecte qu'apres avoir parle au serveur.
     * Les deux signaux coexistent : `online` est plus rapide quand il marche,
     * celui-ci est le seul a marcher a tous les coups.
     */
    const stopWs = subscribeToWsConnected(drain)

    return () => {
      window.removeEventListener("online", drain)
      stopWs()
    }
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

  /*
   * ══════ PUBLIER LES CLÉS DE CET APPAREIL ══════
   *
   * 🐛 RIEN NE LES PUBLIAIT EN USAGE NORMAL. Seule la page d'essai
   * `/e2ee-test` appelait `preparerCetAppareil`. Résultat : aucun compte
   * ordinaire n'avait de clés, et le cadenas d'une conversation restait
   * définitivement grisé sur « un participant n'a pas publié ses clés » —
   * message exact, mais dont personne ne pouvait rien faire, puisque rien
   * dans l'application ne permettait de les publier.
   *
   * ⚠️ À CHAQUE ENTRÉE EN SESSION, et non une seule fois : connexion,
   * inscription, ET reprise de session au chargement. Un compte déjà connecté
   * quand cette version arrive ne passerait par aucune des deux premières, et
   * n'aurait jamais de clés.
   *
   * ⚠️ IDEMPOTENTE ET SANS DANGER : `preparerCetAppareil` ne régénère pas
   * l'identité si elle existe. La rappeler ne coûte qu'un aller-retour, et
   * c'est ce qui réapprovisionne le stock de pré-clés au passage.
   *
   * ⚠️ NE BLOQUE JAMAIS L'ENTRÉE EN SESSION. Un échec de publication — réseau,
   * serveur trop ancien — doit laisser l'application parfaitement utilisable
   * en clair. Le chiffrement est un supplément, pas une condition.
   */
  const publierMesCles = useCallback(() => {
    void preparerCetAppareil().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[e2ee] clés non publiées pour cet appareil", e)
    })
  }, [])

  const login = useCallback(async (payload: LoginPayload) => {
    const nextUser = storeAuthenticatedSession(await loginWithPassword(payload))
    await claimLocalCaches(accountKey(nextUser))
    saveSessionUser(nextUser)
    setUser(nextUser)
    setIsReady(true)
    publierMesCles()
    return nextUser
  }, [publierMesCles])

  const register = useCallback(async (draft: RegistrationDraft, otp: string) => {
    const nextUser = storeAuthenticatedSession(await completeRegistration(draft, otp))
    await claimLocalCaches(accountKey(nextUser))
    saveSessionUser(nextUser)
    setUser(nextUser)
    setIsReady(true)
    publierMesCles()
    return nextUser
  }, [publierMesCles])

  /**
   * Inscription SANS adresse : le compte est cree sans code de confirmation.
   *
   * Rend le CODE DE RECUPERATION avec la session — il n'est montre qu'une fois,
   * et c'est le seul moyen de reprendre ce compte. L'appelant DOIT le presenter
   * avant de laisser l'utilisateur entrer dans l'application.
   *
   * ⚠️ La session est installee AVANT que le code soit montre, volontairement :
   * si l'ecran suivant echouait, l'utilisateur serait au moins connecte et
   * pourrait retrouver son code dans les reglages. L'inverse — montrer d'abord,
   * connecter ensuite — laisserait un compte cree et inaccessible en cas de
   * pepin.
   */
  const registerWithoutEmail = useCallback(
    async (draft: Omit<RegistrationDraft, "email">) => {
      const { session, idRecuperation } = await registerSansEmail(draft)
      const nextUser = storeAuthenticatedSession(session)
      await claimLocalCaches(accountKey(nextUser))
      saveSessionUser(nextUser)
      setUser(nextUser)
      setIsReady(true)
      return { user: nextUser, idRecuperation }
    },
    [],
  )

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
    /*
     * 🔴 RETIRER L IDENTITE CHIFFREE AVANT TOUT LE RESTE.
     *
     * Sans ce geste, elle reste publiee POUR TOUJOURS : les correspondants
     * continuent de chiffrer pour un appareil qui ne lira plus rien — un
     * exemplaire de trop par message, une pre-cle consommee pour rien, et des
     * enveloppes que personne ne relevera jamais.
     *
     * ⚠️ AVANT , QUI EFFACE LE JETON : sans jeton, la
     * route de retrait repondrait 401 et l identite survivrait a la
     * deconnexion.
     *
     * ⚠️ NE LEVE JAMAIS — une deconnexion ne doit pas echouer parce que le
     * reseau est coupe. Le balayage du serveur rattrapera au bout de trente
     * jours de silence.
     */
    /*
     * ⚠️ ON DÉPOSE CE QUI ATTEND AVANT DE REFERMER, et l'ordre compte.
     *
     * Le tampon garde jusqu'à dix messages en mémoire. Refermer sans vider
     * les perdrait pour l'archive — et ce sont les DERNIERS échangés, donc
     * ceux dont on se souvient le mieux et dont l'absence se remarquerait.
     *
     * ⚠️ NE DOIT PAS EMPÊCHER LA DÉCONNEXION : `vider` ne lève jamais, et si
     * le réseau est coupé on referme quand même. Rester connecté parce qu'une
     * sauvegarde a échoué serait le pire des deux maux.
     */
    await viderSauvegarde().catch(() => undefined)
    refermerSauvegarde()
    await oublierCetAppareil()
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

    return subscribeToSessionRevoked((deviceId, raison) => {
      if (deviceId !== getOrCreateWebDeviceId()) return
      // Deux causes passent par le meme evenement, et elles n'appellent pas le
      // meme message : une connexion ailleurs, ou un menage que l'utilisateur a
      // fait lui-meme depuis « Sessions actives ». Sans la raison, on
      // annoncerait une intrusion a quelqu'un qui vient de ranger ses appareils.
      if (raison === RAISON_EVICTION) poseMessageDeconnexion(MESSAGE_EVICTION)
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
      registerWithoutEmail,
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
