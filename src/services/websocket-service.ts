import { WS_URL } from "../config/runtime"
import { loadSessionToken } from "../data/session-auth"
import { tryRefreshTokens } from "../lib/api-client"
import { ringtoneUrl } from "./ringtones"
import { appareilCourantId } from "./appareils-service"
import { langueInitiale, traduire } from "../i18n"

/**
 * Client WebSocket pour le serveur temps reel d'Alanya (ws-server.mjs) :
 * - connexion unique authentifiee via ?token=<accessToken> ;
 * - enveloppes JSON { type: "message" | "typing" | "read" | ... } ;
 * - envoi des messages de chat via { type: "send", tempId } (le POST REST
 *   ne declenche PAS de diffusion temps reel sur ce backend).
 */

/* ----------------- Types des evenements serveur ----------------- */

export interface WsMediaPayload {
  id: string
  url: string
  filename: string
  mimeType: string
  sizeBytes: number
  durationMs: number | null
}

export interface WsMessagePayload {
  id: string
  convId: string
  senderId: string
  content: string | null
  type: string
  status: string
  createdAt: string
  replyToId?: string | null
  replyTo?: {
    id: string
    senderId: string
    type: string
    content: string | null
    isDeleted: boolean
  } | null
  media?: WsMediaPayload[]
}

interface ServerEvent {
  type: string
  message?: WsMessagePayload
  tempId?: string
  convId?: string
  userId?: string
  isTyping?: boolean
  at?: string
  [key: string]: unknown
}

/* ----------------- Etat de connexion ----------------- */

type Listener = (event: ServerEvent) => void

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()
const pendingSends: string[] = []

/**
 * Fermeture voulue par l'application (deconnexion). Tant qu'il est leve, aucune
 * tentative de reconnexion ne part : ni le minuteur de `onclose`, ni le retour
 * de visibilite, ni un envoi en attente. Un nouvel abonnement le rabaisse, ce
 * qui rouvre naturellement le temps reel a la connexion suivante.
 */
let intentionalClose = false

/* ----------------- Robustesse de la connexion -----------------
 * Deux pieges en production :
 * 1. le serveur WebSocket Cloudflare Workers s'endort apres ~15 min sans trafic HTTP,
 *    ce qui tue toutes les connexions ;
 * 2. les NAT/proxies coupent silencieusement les WebSocket inactifs : le
 *    navigateur croit etre connecte mais ne recoit plus rien (messages plus
 *    en direct, sonneries d'appel perdues).
 */

const APP_PING_INTERVAL_MS = 25_000 // trafic sortant : garde le NAT ouvert, detecte les liens morts
const KEEP_AWAKE_INTERVAL_MS = 8 * 60_000 // GET HTTP : empeche Render de s'endormir
const CONNECT_TIMEOUT_MS = 12_000 // handshake bloque (cold start) : on coupe et on retente
const RESYNC_THROTTLE_MS = 15_000
const TOKEN_REFRESH_THROTTLE_MS = 60_000

let lastTokenRefreshAt = 0

let pingTimer: ReturnType<typeof setInterval> | null = null
let keepAwakeTimer: ReturnType<typeof setInterval> | null = null
let connectWatchdog: ReturnType<typeof setTimeout> | null = null
let lifecycleHandlersRegistered = false
let lastResyncAt = 0

/** La connexion temps reel est-elle reellement ouverte ? */
export function isSocketOpen(): boolean {
  return socket !== null && socket.readyState === WebSocket.OPEN
}

/* Le serveur envoie { type: "ready" } des que la connexion est authentifiee.
 * Sans ce "ready", la connexion est un "trou noir" : ouverte en apparence
 * mais jamais enregistree cote serveur -> aucun evenement ne sera recu. */
const READY_WATCHDOG_MS = 10_000
let readyReceived = false
let readyWatchdog: ReturnType<typeof setTimeout> | null = null
let lastEventAt = 0

export interface RealtimeState {
  /** Socket ouverte au sens navigateur. */
  connected: boolean
  /** Le serveur a confirme la connexion ({ type: "ready" }). */
  ready: boolean
  /** Horodatage du dernier evenement recu du serveur (ms epoch), 0 si aucun. */
  lastEventAt: number
}

/** Etat temps reel observable (affiche dans Parametres > A propos). */
export function getRealtimeState(): RealtimeState {
  return { connected: isSocketOpen(), ready: readyReceived, lastEventAt }
}

/** Previent tous les ecrans abonnes qu'il faut se resynchroniser. */
function dispatchResync() {
  const now = Date.now()
  if (now - lastResyncAt < RESYNC_THROTTLE_MS) return
  lastResyncAt = now
  for (const listener of listeners) listener({ type: "ws_connected" })
}

/** GET periodique vers le serveur Render pour l'empecher de s'endormir. */
function startKeepAwake() {
  if (keepAwakeTimer || typeof window === "undefined") return
  const httpUrl = WS_URL.replace(/^ws/, "http")
  keepAwakeTimer = setInterval(() => {
    if (listeners.size === 0) return
    void fetch(httpUrl, { method: "GET", mode: "no-cors", cache: "no-store" }).catch(
      () => undefined
    )
  }, KEEP_AWAKE_INTERVAL_MS)
}

/** Reconnexion immediate quand l'onglet redevient visible / le reseau revient. */
function registerLifecycleHandlers() {
  if (lifecycleHandlersRegistered || typeof window === "undefined") return
  lifecycleHandlersRegistered = true

  const wakeUp = () => {
    if (listeners.size === 0) return
    if (isSocketOpen()) {
      // Connecte en apparence… mais peut-etre mort : on force une resync des
      // ecrans, et le prochain ping detectera un lien casse le cas echeant.
      dispatchResync()
    } else {
      connect()
    }
  }

  window.addEventListener("online", wakeUp)
  window.addEventListener("focus", wakeUp)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wakeUp()
  })
}

interface PendingAck {
  resolve: (message: WsMessagePayload) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
const pendingAcks = new Map<string, PendingAck>()

function connect() {
  if (intentionalClose) return
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  const token = loadSessionToken()
  if (!token) return

  const ws = new WebSocket(`${WS_URL}/?token=${encodeURIComponent(token)}`)
  socket = ws

  // Cold start Render : si le handshake ne se termine pas, on coupe et
  // l'onclose planifiera une nouvelle tentative.
  if (connectWatchdog) clearTimeout(connectWatchdog)
  connectWatchdog = setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) ws.close()
  }, CONNECT_TIMEOUT_MS)

  let opened = false

  ws.onopen = () => {
    opened = true
    if (connectWatchdog) {
      clearTimeout(connectWatchdog)
      connectWatchdog = null
    }

    // Trou noir : socket ouverte mais serveur muet (pas de "ready").
    // On coupe pour declencher une reconnexion propre plutot que de rester
    // branche sur une connexion que le serveur n'a jamais enregistree.
    readyReceived = false
    if (readyWatchdog) clearTimeout(readyWatchdog)
    readyWatchdog = setTimeout(() => {
      if (!readyReceived && ws.readyState === WebSocket.OPEN) {
        // eslint-disable-next-line no-console
        console.warn(
          "[ws] connexion ouverte mais aucun 'ready' du serveur en 10s — " +
            "le serveur temps reel ne traite pas les connexions ; reconnexion."
        )
        ws.close()
      }
    }, READY_WATCHDOG_MS)

    /**
     * Annonce de l'appareil, avant tout le reste.
     *
     * Le serveur doit savoir quelle socket appartient a quel poste : c'est ce
     * qui lui permet de ne faire sonner que le detenteur d'une conversation
     * reservee. Envoye a chaque (re)connexion, puisqu'une socket neuve ne
     * porte encore aucune identite.
     */
    const monAppareil = appareilCourantId()
    if (monAppareil !== null) {
      ws.send(JSON.stringify({ type: "device", appareilId: monAppareil }))
    }

    while (pendingSends.length) {
      const data = pendingSends.shift()
      if (data) ws.send(data)
    }

    // Ping applicatif periodique (ignore par le serveur) : maintient le NAT
    // ouvert et fait echouer rapidement un lien TCP mort -> reconnexion.
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "ping" }))
        } catch {
          ws.close()
        }
      }
    }, APP_PING_INTERVAL_MS)

    // Evenement synthetique : permet aux ecrans de se resynchroniser apres
    // une (re)connexion (messages arrives pendant la coupure).
    lastResyncAt = 0
    dispatchResync()
  }

  function getMyUserIdFromToken(): string | null {
    const token = loadSessionToken()
    if (!token) return null
    try {
      const parts = token.split(".")
      if (parts.length < 2) return null
      const payload = JSON.parse(window.atob(parts[1]))
      return payload.sub || null
    } catch {
      return null
    }
  }

  ws.onmessage = (frame) => {
    let event: ServerEvent
    try {
      event = JSON.parse(String(frame.data)) as ServerEvent
    } catch {
      return
    }

    lastEventAt = Date.now()
    if (event.type === "ready") {
      readyReceived = true
      if (readyWatchdog) {
        clearTimeout(readyWatchdog)
        readyWatchdog = null
      }
    }

    // Reconciliation des envois optimistes (ack porteur du tempId).
    if (event.type === "message" && event.tempId && pendingAcks.has(event.tempId)) {
      const pending = pendingAcks.get(event.tempId)!
      pendingAcks.delete(event.tempId)
      clearTimeout(pending.timer)
      if (event.message) pending.resolve(event.message)
    }
    if (event.type === "error" && event.tempId && pendingAcks.has(event.tempId)) {
      const pending = pendingAcks.get(event.tempId)!
      pendingAcks.delete(event.tempId)
      clearTimeout(pending.timer)
      pending.reject(
        new Error(String(event.message ?? traduire(langueInitiale(), "core_send_refused")))
      )
      return
    }

    // Joue le son de notification pour les nouveaux messages des autres utilisateurs
    if (event.type === "message" && event.message) {
      const msg = event.message
      const myId = getMyUserIdFromToken()
      if (myId && msg.senderId !== myId) {
        const soundsEnabled = localStorage.getItem("notif_sounds") !== "false"
        if (soundsEnabled) {
          const audio = new Audio(ringtoneUrl("message"))
          audio.play().catch((err) => {
            console.warn("[ws] Failed to play message sound:", err)
          })
        }
      }
    }

    for (const listener of listeners) listener(event)
  }

  ws.onclose = async (event) => {
    if (socket === ws) socket = null
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
    if (connectWatchdog) {
      clearTimeout(connectWatchdog)
      connectWatchdog = null
    }
    if (readyWatchdog) {
      clearTimeout(readyWatchdog)
      readyWatchdog = null
    }
    readyReceived = false
    // eslint-disable-next-line no-console
    console.info(`[ws] connexion fermee (code ${event.code}) — reconnexion dans 4s`)

    // Handshake rejete (token expire, entre autres) : le serveur ferme avec
    // 4001 mais le navigateur ne transmet qu'un 1006 generique. Des que la
    // connexion echoue AVANT d'avoir ete ouverte, on rafraichit le token
    // (au plus une fois par minute) puis on retente aussitot.
    if (intentionalClose) return

    const handshakeRejected = event.code === 4001 || !opened
    if (handshakeRejected && Date.now() - lastTokenRefreshAt > TOKEN_REFRESH_THROTTLE_MS) {
      lastTokenRefreshAt = Date.now()
      // "ok" seulement : un serveur injoignable n est pas une raison de
      // renoncer, la reconnexion periodique s en charge.
      const refreshed = await tryRefreshTokens()
      if (refreshed === "ok") {
        connect()
        return
      }
    }

    if (listeners.size > 0 && !reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, 4000)
    }
  }

  ws.onerror = () => {
    // onclose suit toujours ; rien a faire ici.
  }
}

function sendRaw(payload: object) {
  const data = JSON.stringify(payload)
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(data)
  } else {
    pendingSends.push(data)
    connect()
  }
}

function addListener(listener: Listener): () => void {
  intentionalClose = false
  listeners.add(listener)
  registerLifecycleHandlers()
  startKeepAwake()
  connect()
  return () => {
    listeners.delete(listener)
  }
}

/* ----------------- Public API ----------------- */

/**
 * Ferme le temps reel et interdit toute reconnexion automatique.
 *
 * Appelee a la deconnexion. Sans elle, la socket restait ouverte avec le jeton
 * de l'ancien compte : apres une deconnexion suivie d'une connexion sur un autre
 * compte dans le meme onglet, ce navigateur continuait de recevoir les messages
 * et les appels du compte precedent. Le mobile, lui, coupe explicitement
 * (`auth_controller.dart` : `_realtime?.disconnect()`).
 */
export function disconnectRealtime() {
  intentionalClose = true

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (connectWatchdog) {
    clearTimeout(connectWatchdog)
    connectWatchdog = null
  }
  if (readyWatchdog) {
    clearTimeout(readyWatchdog)
    readyWatchdog = null
  }
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
  }
  readyReceived = false

  // Rien de l'ancienne session ne doit partir sur la prochaine connexion.
  pendingSends.length = 0
  for (const ack of pendingAcks.values()) {
    clearTimeout(ack.timer)
    ack.reject(new Error("Session fermee."))
  }
  pendingAcks.clear()

  const closing = socket
  socket = null
  closing?.close(1000, "logout")
}

/** S'abonne aux nouveaux messages d'une conversation. Le handler recoit le message serialise. */
export function subscribeToConversation(
  conversationId: string,
  handler: (message: WsMessagePayload) => void
): () => void {
  return addListener((event) => {
    if (event.type === "message" && event.message?.convId === conversationId) {
      handler(event.message)
    }
  })
}

/**
 * S'abonne a TOUS les nouveaux messages (toutes conversations).
 * Utilise par la liste des conversations et le dashboard pour se rafraichir en direct.
 */
export function subscribeToAllMessages(handler: (message: WsMessagePayload) => void): () => void {
  return addListener((event) => {
    if (event.type === "message" && event.message) handler(event.message)
  })
}

/** S'abonne aux (re)connexions du WebSocket — utile pour resynchroniser l'ecran. */
export function subscribeToWsConnected(handler: () => void): () => void {
  return addListener((event) => {
    if (event.type === "ws_connected") handler()
  })
}

export interface TypingEvent {
  userId: string
  isTyping: boolean
}

/** S'abonne aux evenements "X est en train d'ecrire" d'une conversation. */
export function subscribeToTyping(
  conversationId: string,
  handler: (event: TypingEvent) => void
): () => void {
  return addListener((event) => {
    if (event.type === "typing" && event.convId === conversationId) {
      handler({ userId: String(event.userId ?? ""), isTyping: Boolean(event.isTyping) })
    }
  })
}

/** Publie un evenement "je suis en train d'ecrire" (ou j'ai arrete). */
export function publishTyping(conversationId: string, isTyping: boolean) {
  sendRaw({ type: "typing", convId: conversationId, isTyping })
}

export interface PresenceEvent {
  userId: string
  isOnline: boolean
}

/**
 * S'abonne aux changements de presence. Le serveur temps reel diffuse
 * { type: "presence", userId, isOnline } a la connexion/deconnexion d'un
 * contact, et envoie un instantane des contacts en ligne a l'ouverture.
 */
export function subscribeToPresence(handler: (event: PresenceEvent) => void): () => void {
  return addListener((event) => {
    if (event.type !== "presence") return
    const userId = String(event.userId ?? "")
    if (!userId) return
    handler({ userId, isOnline: Number(event.isOnline) === 1 || event.isOnline === true })
  })
}

/**
 * Annonce aux autres sessions du compte qu'un appareil vient d'etre deconnecte.
 *
 * C'est le client qui relaie, et non l'API : celle-ci tourne dans un process
 * distinct du serveur temps reel, sans canal entre eux. Le serveur rediffuse
 * uniquement aux sockets du meme compte — on ne peut donc deconnecter que ses
 * propres appareils.
 */
/** Raison portee par `session_revoked` quand c'est une connexion ailleurs. */
export const RAISON_EVICTION = "eviction"

/**
 * @param raison `"eviction"` quand une connexion sur un autre appareil de la
 *   meme famille ferme cette session ; absente quand l'utilisateur deconnecte
 *   lui-meme un poste depuis « Sessions actives ». L'appareil vise s'en sert
 *   pour dire la verite plutot que d'annoncer une intrusion a quelqu'un qui
 *   vient simplement de ranger ses appareils.
 */
export function sendSessionRevoked(deviceId: string, raison?: string) {
  sendRaw({ type: "session_revoked", deviceId, ...(raison ? { raison } : {}) })
}

/**
 * S'abonne a la revocation d'une session. Le handler recoit l'identifiant de
 * l'appareil vise — a chaque client de le comparer au sien — et la raison.
 */
export function subscribeToSessionRevoked(
  handler: (deviceId: string, raison: string | null) => void
): () => void {
  return addListener((event) => {
    if (event.type !== "session_revoked") return
    const deviceId = String(event.deviceId ?? "")
    const raison = typeof event.raison === "string" ? event.raison : null
    if (deviceId) handler(deviceId, raison)
  })
}

export interface StatusEvent {
  /** UUID de l'utilisateur qui a lu la conversation. */
  readBy: string
  /**
   * JUSQU'OU il a lu, en millisecondes.
   *
   * Le serveur l'envoie depuis toujours et on le jetait. Sans lui, on sait QUE
   * quelqu'un a lu, jamais JUSQU'OU : impossible de dire combien de personnes
   * ont lu un message donne dans un groupe. C'est cette date qui rend le
   * compteur possible sans une seule requete de plus.
   */
  at?: number
}

/** S'abonne aux accuses de lecture d'une conversation (l'autre a tout lu). */
export function subscribeToStatus(
  conversationId: string,
  handler: (event: StatusEvent) => void
): () => void {
  return addListener((event) => {
    if (event.type === "read" && event.convId === conversationId) {
      const brut = event.at
      const quand =
        typeof brut === "number" ? brut : typeof brut === "string" ? Date.parse(brut) : NaN
      handler({
        readBy: String(event.userId ?? ""),
        at: Number.isFinite(quand) ? quand : undefined,
      })
    }
  })
}

/** Notifie le serveur que la conversation a ete lue (diffuse aux autres participants). */
export function publishRead(conversationId: string) {
  sendRaw({ type: "read", convId: conversationId })
}

/* ----------------- Appels (WebRTC) ----------------- */

/** Evenement d'appel brut du serveur (incoming_call, call_signal, call_state). */
export interface CallServerEvent {
  type: string
  [key: string]: unknown
}

// ⚠️ Liste FILTRANTE : un type absent d'ici n'atteint jamais le gestionnaire
// d'appels, sans le moindre message d'erreur. Les trois evenements du standard
// (centre d'appels) doivent donc y figurer, sinon l'appelant reste sur
// « Sonnerie » alors que le serveur lui a envoye le menu.
const CALL_EVENT_TYPES = new Set([
  "incoming_call",
  "call_signal",
  "call_state",
  "ivr_menu",
  "ivr_hold",
  // ⚠️ Centre vocal (18/08/2026). Cette liste FILTRE : un type absent n'atteint
  // jamais le gestionnaire d'appels, et sans la moindre erreur. Oublier
  // `ivr_play` ici aurait donne un menu vocal ou aucune touche ne joue rien,
  // impossible a diagnostiquer depuis le code du standard.
  "ivr_play",
  // ⚠️ Plainte vocale sur la touche 0 (20/08/2026). Meme piege que `ivr_play`
  // ci-dessus : sans cette ligne, l'appelant appuierait sur 0, le serveur
  // ouvrirait bien la session d'enregistrement de son cote, et le web ne
  // montrerait RIEN — sans la moindre erreur, ni ici ni dans la console.
  "ivr_record",
  "ivr_error",
  "queue_rating_available",
])

/**
 * LA COMPOSITION DE LA REUNION A CHANGE — le verbe de salle qui l'annonce.
 *
 * POURQUOI CE VERBE EXISTE. L'API Next.js et le serveur temps reel sont deux
 * PROCESSUS distincts : une route REST qui ajoute quelqu'un n'a aucun acces aux
 * sockets et ne peut prevenir que des APPAREILS, par notification poussee — les
 * nouveaux invites, donc, et eux seuls. Ceux qui etaient deja dans la salle ne
 * voyaient bouger ni le nombre de participants ni la liste, et devaient sortir
 * et revenir. Le serveur ouvre desormais un pont : la route previent le serveur
 * temps reel, qui diffuse CE verbe a toute la salle.
 *
 * IL NE PORTE PAS LA NOUVELLE LISTE, et c'est voulu : il DIT qu'elle a change,
 * le client la RELIT. Une liste transportee ici aurait sa propre forme, a garder
 * d'accord avec celle de `GET /api/meetings/:id` — deux verites pour une seule
 * reunion.
 *
 * UN SEUL VERBE POUR TOUS LES CAS, le motif etant DANS la trame — c'est la
 * decision du serveur, et elle protege les clients deja deployes : celui qui ne
 * connait pas encore un motif relit quand meme, la ou un type inconnu serait
 * tombe dans le filtre ci-dessous sans laisser de trace. L'exclusion et le
 * changement de role emprunteront donc ce chemin sans une ligne de plus ici.
 *
 * Le nom est celui que porte `VERBE_COMPOSITION` dans le backend
 * (`src/lib/salle-temps-reel.ts`) ; c'est la seule source a suivre s'il change.
 */
const VERBE_COMPOSITION = "meeting_participants_changed"

const MEETING_EVENT_TYPES = new Set([
  "meeting_signal",
  "meeting_joined",
  "meeting_user_left",
  "meeting_user_joined",
  "meeting_extended",
  "meeting_message",
  "meeting_hand",
  // ⚠️ Cette liste FILTRE, comme celle des appels : un type absent n'atteint
  // jamais le gestionnaire de salle, et sans la moindre erreur. Oublier
  // `meeting_screen` ici donnerait un partage d'ecran qui part bien chez les
  // autres mais qu'aucun d'eux ne reconnait comme un ecran — il s'afficherait
  // en vignette de visage, sans que rien dans le code du partage ne cloche.
  "meeting_screen",
  // Meme piege : sans `meeting_mute` ici, la demande de coupure partirait bien
  // depuis l'organisateur et serait bien relayee par le serveur, mais tomberait
  // dans le vide chez le destinataire — son micro resterait ouvert sans que rien
  // dans le code de la coupure ne cloche.
  "meeting_mute",
  // Le meme piege, une troisieme fois : sans ce type ici, le pont ouvert par le
  // serveur pour annoncer un ajout ou une exclusion aboutirait a un mur, et la
  // salle continuerait de n'apprendre les arrivees qu'en sortant et revenant.
  VERBE_COMPOSITION,
  // Une quatrieme et une cinquieme fois. Terminer une reunion et exclure
  // quelqu'un agissent sur la BASE ; le maillage WebRTC, lui, vit entre les
  // navigateurs et ne la consulte jamais. Sans ces deux verbes ici, la reunion
  // se termine et l'exclusion se prononce pendant que les images et les voix
  // continuent de circuler — le plus long a diagnostiquer, puisque tout le
  // reste du chemin est juste.
  "meeting_ended",
  "meeting_kicked",
])

/** S'abonne aux evenements d'appel (toutes conversations confondues). */
export function subscribeToCallEvents(handler: (event: CallServerEvent) => void): () => void {
  return addListener((event) => {
    if (CALL_EVENT_TYPES.has(event.type)) handler(event as CallServerEvent)
  })
}

/** S'abonne aux evenements de réunion WebRTC (signalisation, participants). */
export function subscribeToMeetingEvents(handler: (event: ServerEvent) => void): () => void {
  return addListener((event) => {
    if (MEETING_EVENT_TYPES.has(event.type)) return handler(event)
    // LE REFUS DE LA SALLE PASSE PAR « error », ET IL DOIT PASSER.
    //
    // Quand la salle est pleine, le serveur repond une trame d'erreur et non un
    // verbe meeting_*. Le filtre ci-dessus la jetait, et la branche generique des
    // erreurs exige un `tempId` que cette trame ne porte pas : le refus
    // disparaissait donc sans laisser de trace. Celui qu'on refusait restait
    // seul dans une salle fantome, camera et micro ouverts, sans un mot.
    //
    // On ne laisse passer que les erreurs QUI DESIGNENT UNE REUNION : les autres
    // n'ont rien a faire dans le gestionnaire de salle.
    if (event.type === "error" && (event as { meetingId?: unknown }).meetingId != null) {
      handler(event)
    }
  })
}

/** Ce que porte l'annonce d'un changement de composition. */
export interface MeetingRosterEvent {
  /** La reunion visee. */
  meetingId: number
  /**
   * CE QUI a change, en CODE — jamais une phrase : le serveur ne rend aucun
   * texte affichable, et cette application parle neuf langues.
   *
   * Le serveur emet aujourd'hui `PARTICIPANTS_ADDED`, `PARTICIPANT_REMOVED` et
   * `ROLE_CHANGED`. Le type reste une chaine libre A DESSEIN : un motif inconnu
   * ne doit pas empecher la relecture, qui reste juste quoi qu'il arrive.
   */
  motif: string | null
  /** Qui a provoque le changement. Deja connu de toute la salle. */
  parUserId: string | null
  /** Combien de lignes bougent. Un nombre, pas une liste : rien a fusionner. */
  nombre: number | null
}

/**
 * S'abonne aux changements de composition d'une reunion.
 *
 * L'appelant n'a rien a en tirer sinon un ordre : RELIRE. Le motif, l'auteur et
 * le nombre sont la pour l'ecran qui voudra un jour NOMMER le changement — « X
 * vient d'ajouter deux personnes » —, ce qu'aucun ne fait aujourd'hui, faute de
 * cle au catalogue.
 *
 * PASSE PAR `subscribeToMeetingEvents`, et non par un branchement direct sur la
 * socket : il n'y a qu'UNE porte pour les evenements de salle, et c'est elle. Un
 * second chemin marcherait tout aussi bien, mais laisserait `MEETING_EVENT_TYPES`
 * croire que le verbe y est facultatif — c'est exactement l'oubli qui a deja
 * coute deux defauts dans ce fichier.
 *
 * @param meetingId la reunion a suivre, ou `null` pour TOUTES — ce que veut la
 *   liste des reunions, qui n'en regarde aucune en particulier.
 */
export function subscribeToMeetingRoster(
  meetingId: number | null,
  handler: (event: MeetingRosterEvent) => void
): () => void {
  return subscribeToMeetingEvents((event) => {
    /*
     * TROIS VERBES, PAS UN SEUL.
     *
     * `meeting_participants_changed` annonce ce que l'API a change — un ajout,
     * une exclusion. Mais il ne dit RIEN de qui entre ou sort de la salle : ces
     * deux mouvements-la naissent des sockets, et n'ont jamais touche l'API.
     *
     * On ne suivait donc que la moitie des changements : la liste montrait
     * fidelement les CONVIES et se trompait sur les PRESENTS. Il fallait quitter
     * la reunion et y revenir pour voir qu'un participant etait arrive — sur
     * chaque appareil, ce qui defait tout l'interet d'une liste vivante.
     *
     * L'entree et la sortie declenchent donc la meme relecture. La reaction
     * etant « relire » et non « appliquer ce qu'on m'annonce », suivre trois
     * verbes plutot qu'un ne coute rien de plus qu'une lecture de trop.
     */
    const suivi =
      event.type === VERBE_COMPOSITION ||
      event.type === "meeting_user_joined" ||
      event.type === "meeting_user_left"
    if (!suivi) return
    // Une trame sans reunion identifiable ne peut declencher aucune relecture
    // sensee : on ne devine pas de quelle salle il s'agit.
    const cible = Number(event.meetingId)
    if (!Number.isFinite(cible)) return
    if (meetingId !== null && cible !== meetingId) return
    handler({
      meetingId: cible,
      motif:
        typeof event.motif === "string"
          ? event.motif
          : event.type === "meeting_user_joined"
            ? "PARTICIPANT_JOINED"
            : event.type === "meeting_user_left"
              ? "PARTICIPANT_LEFT"
              : null,
      parUserId: typeof event.parUserId === "string" ? event.parUserId : null,
      nombre: typeof event.nombre === "number" ? event.nombre : null,
    })
  })
}

/** Fait sonner les autres participants apres POST /api/calls. */
export function sendCallRing(callId: string) {
  sendRaw({ type: "call_ring", callId })
}

/** Relaie un signal WebRTC (offer / answer / ICE) a un participant precis. */
export function sendCallSignal(callId: string, toUserId: string, signal: object) {
  sendRaw({ type: "call_signal", callId, toUserId, signal })
}

/** Relaie un signal WebRTC pour une réunion (offer / answer / ICE). */
export function sendMeetingSignal(meetingId: number, toUserId: string, signal: object) {
  sendRaw({ type: "meeting_signal", meetingId, toUserId, signal })
}

/**
 * Entre dans le salon de la reunion.
 *
 * Le verbe compte : le serveur n'accepte que `meeting_join`. Le client envoyait
 * `meeting_joined` — qui est la REPONSE du serveur, pas une demande. La trame
 * ne trouvait donc aucun traitement et tombait dans le vide : le web n'entrait
 * jamais reellement dans le salon, et restait invisible des autres
 * participants, mobile compris.
 *
 * En reponse, le serveur renvoie `meeting_joined` avec la liste de ceux qui
 * sont deja la, et previent les autres par `meeting_user_joined`.
 */
export function sendMeetingJoin(meetingId: number) {
  sendRaw({ type: "meeting_join", meetingId })
}

/** Quitte le salon : le serveur clot la duree du participant et previent les autres. */
export function sendMeetingLeave(meetingId: number) {
  sendRaw({ type: "meeting_leave", meetingId })
}

/**
 * Prolonge la duree prevue de la reunion.
 *
 * Reserve a l'organisateur, et le serveur refuse toute valeur qui la
 * raccourcirait : deux appareils de l'organisateur, ou un message rejoue apres
 * une reconnexion, ramèneraient sinon la reunion a une duree deja depassee.
 */
export function sendMeetingExtend(meetingId: number, dureeSecondes: number) {
  sendRaw({ type: "meeting_extend", meetingId, duree: dureeSecondes })
}

/**
 * Leve ou baisse la main.
 *
 * Rien n'est affiche localement en attendant : le serveur renvoie l'etat a
 * l'auteur comme aux autres, donc tout le monde voit la meme main au meme
 * moment. L'etat n'est pas conserve — qui arrive ensuite ne voit pas les mains
 * deja levees.
 */
export function sendMeetingHand(meetingId: number, levee: boolean) {
  sendRaw({ type: "meeting_hand", meetingId, levee })
}

/**
 * Ecrit dans le fil de la salle.
 *
 * On n'affiche rien localement en attendant : le serveur renvoie le message a
 * son auteur comme aux autres, et c'est son ordre qui fait foi. Poser la bulle
 * tout de suite la placerait ailleurs chez soi que chez les autres.
 *
 * Le fil est ephemere — rien n'est conserve, et qui arrive en cours de route ne
 * voit pas ce qui a ete dit avant.
 */
export function sendMeetingMessage(meetingId: number, texte: string) {
  sendRaw({ type: "meeting_message", meetingId, text: texte })
}

/**
 * Annonce le debut ou la fin de MON partage d'ecran a la salle.
 *
 * POURQUOI UN VERBE ALORS QUE L'IMAGE PASSE DEJA. La piste d'un ecran emprunte
 * exactement le meme tuyau que celle d'une camera : elle est substituee chez
 * tous les pairs sans renegocier, et rien dans WebRTC ne dit ce qu'elle montre.
 * Sans cette annonce, l'ecran partage arriverait chez les autres comme une
 * vignette de visage — rognee au cadre du visage et retournee en miroir.
 *
 * On n'envoie pas d'expediteur : le serveur pose `fromUserId` lui-meme, sinon
 * n'importe qui declarerait un partage au nom d'un autre. Il rediffuse ensuite
 * a TOUTE la salle, l'auteur compris — c'est sa reponse, et non notre propre
 * foi, qui allume la presentation chez tout le monde au meme instant.
 *
 * Le serveur retient qui presente et rejoue l'annonce a celui qui entre en
 * cours de route ; il l'eteint aussi de lui-meme quand le presentateur quitte
 * la salle ou perd sa socket. Rien de tout cela n'est a refaire ici.
 */
export function sendMeetingScreen(meetingId: number, partage: boolean) {
  sendRaw({ type: "meeting_screen", meetingId, partage })
}

/**
 * DEMANDE a un participant de couper son micro ou sa camera.
 *
 * UNE DEMANDE, ET NON UNE COMMANDE, et ce n'est pas une nuance de vocabulaire :
 * le flux appartient a l'APPAREIL du participant. Rien ici, ni sur le serveur,
 * ne touche a sa piste — c'est SON application qui recoit la trame et se coupe
 * elle-meme. Un participant dont le client ignore ce verbe continuera de parler,
 * et c'est la limite du procede, la meme chez Zoom, Meet et Teams.
 *
 * QUI A LE DROIT SE VERIFIE SUR LE SERVEUR, jamais ici. Ce module se contente
 * d'ecrire sur le fil ; l'ecran ne montre les boutons qu'a l'organisateur, mais
 * ce n'est qu'une politesse d'interface. N'importe qui peut forger cette trame
 * depuis une console — c'est le serveur qui doit refuser quiconque n'est pas
 * l'organisateur, sinon un participant fait taire toute la salle.
 *
 * On n'envoie pas d'expediteur : le serveur pose `fromUserId` lui-meme, comme
 * pour le partage d'ecran, sinon on couperait un micro au nom d'un autre.
 *
 * Le serveur relaie a TOUTE la salle et pas au seul destinataire : les autres
 * doivent pouvoir montrer que ce participant vient d'etre coupe, sans quoi son
 * micro s'eteint au milieu d'une phrase et personne ne comprend pourquoi.
 *
 * COUPER N'EST PAS VERROUILLER : le participant peut se rallumer aussitot avec
 * le bouton de sa barre. Le verbe sert au micro oublie, pas au baillon.
 */
export function sendMeetingMute(meetingId: number, toUserId: string, media: "audio" | "video") {
  sendRaw({ type: "meeting_mute", meetingId, toUserId, media })
}

/** Diffuse un changement d'etat d'appel (joined / left / rejected / ended...). */
export function sendCallState(
  callId: string,
  state: string,
  userId?: string,
  displayName?: string | null
) {
  sendRaw({ type: "call_state", callId, state, userId, displayName })
}

/* ----------------- Verrou de conversation ----------------- */

/**
 * Etat du verrou d'une conversation, tel que le serveur le diffuse.
 *
 * Le verrou se joue entre appareils d'un MEME compte : il reserve l'ecriture a
 * celui qui l'a pose. Il ne coupe rien d'autre — les autres appareils
 * continuent de tout recevoir et de tout lire.
 */
export interface EtatVerrou {
  convId: string
  locked: boolean
  appareilId: number | null
  detenteur: string | null
  expiresAt: string | null
}

/** Pose ou retire le verrou d'une conversation pour ce compte. */
export function envoyerVerrou(
  convId: string,
  lock: boolean,
  appareilId: number | null,
  detenteur: string | null
) {
  sendRaw({ type: "conversation_lock", convId, lock, appareilId, detenteur })
}

/**
 * S'abonne aux changements de verrou. Le serveur les diffuse a toutes les
 * sockets du compte, y compris celle qui vient de poser le verrou : l'appareil
 * detenteur apprend donc son propre etat par le meme chemin que les autres, et
 * il n'y a pas deux sources de verite a garder d'accord.
 */
export function subscribeToConversationLocks(handler: (etat: EtatVerrou) => void): () => void {
  const relais = (event: ServerEvent) => {
    if (event.type !== "conversation_lock") return
    handler({
      convId: String(event.convId ?? ""),
      locked: Boolean(event.locked),
      appareilId: typeof event.appareilId === "number" ? event.appareilId : null,
      detenteur: typeof event.detenteur === "string" ? event.detenteur : null,
      expiresAt: typeof event.expiresAt === "string" ? event.expiresAt : null,
    })
  }
  return addListener(relais)
}

/**
 * Fait entrer un utilisateur, designe par son numero public, dans un appel deja
 * en cours : le serveur le fait sonner et l'ajoute aux participants.
 *
 * Meme message que l'application mobile (`callInvite`) — c'est le seul que le
 * backend comprend, et les deux clients doivent parler la meme langue pour
 * qu'une invitation lancee du web arrive sur un telephone.
 */
export function sendCallInvite(callId: string, publicNumber: string) {
  sendRaw({ type: "call_invite", callId, publicNumber })
}

/** Touche tapee dans le menu d'un standard (centre d'appels). */
export function sendIvrDtmf(callId: string, digit: number) {
  sendRaw({ type: "ivr_dtmf", callId, digit })
}

/**
 * « Retour a l'accueil » d'un centre vocal : coupe le son en cours et redemande
 * le menu, que le serveur renvoie par un `ivr_menu`.
 */
export function sendIvrBack(callId: string) {
  sendRaw({ type: "ivr_back", callId })
}

// 8 s : sur une 4G lente, l'aller-retour peut depasser 5 s ; un timeout trop
// court fait basculer en REST (persiste mais NE DIFFUSE PAS en temps reel).
const SEND_ACK_TIMEOUT_MS = 8000

/**
 * Envoie un message via le WebSocket et attend l'ack du serveur (tempId).
 * Rejette si la connexion n'aboutit pas ou si l'ack n'arrive pas a temps —
 * l'appelant peut alors retomber sur le POST REST.
 */
export function sendMessageOverSocket(
  conversationId: string,
  options: {
    content?: string
    msgType: string
    tempId: string
    mediaId?: string
    replyToId?: string
  }
): Promise<WsMessagePayload> {
  const { content, msgType, tempId, mediaId, replyToId } = options
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAcks.delete(tempId)
      reject(new Error(traduire(langueInitiale(), "core_no_realtime_reply")))
    }, SEND_ACK_TIMEOUT_MS)

    pendingAcks.set(tempId, { resolve, reject, timer })
    // L'appareil emetteur voyage avec le message : il etiquette la bulle du
    // pseudo de cet appareil, visible seulement par les autres appareils du
    // meme compte. Le serveur verifie l'appartenance, on ne fait que declarer.
    sendRaw({
      type: "send",
      convId: conversationId,
      content,
      msgType,
      tempId,
      mediaId,
      replyToId,
      appareilId: appareilCourantId(),
    })
  })
}

/* ----------------- Suppression & transfert de messages ----------------- */

export interface MessageDeletedEvent {
  messageId: string
  convId: string
  scope: "me" | "everyone"
}

/** S'abonne aux suppressions de messages d'une conversation. */
export function subscribeToMessageDeleted(
  conversationId: string,
  handler: (event: MessageDeletedEvent) => void
): () => void {
  return addListener((event) => {
    if (event.type === "message_deleted" && event.convId === conversationId) {
      handler({
        messageId: String(event.messageId ?? ""),
        convId: conversationId,
        scope: event.scope === "everyone" ? "everyone" : "me",
      })
    }
  })
}

/** Supprime un message : "me" (masque local) ou "everyone" (efface pour tous). */
export function sendDeleteMessage(messageId: string, scope: "me" | "everyone") {
  sendRaw({ type: "delete_message", messageId, scope })
}

/* ----------------- Edition de messages ----------------- */

export interface MessageEditedEvent {
  messageId: string
  convId: string
  content: string
  editedAt: Date
}

/**
 * S'abonne aux EDITIONS de messages d'une conversation.
 *
 * Pourquoi cet abonnement a manque si longtemps. Le serveur diffuse
 * `message_edited` a TOUS les participants depuis toujours (`ws-server.mjs`,
 * `handleEditMessage`), et le mobile le traite. Le web, lui, ne connaissait que
 * `message_deleted` : un message modifie gardait donc son ancien texte a
 * l'ecran jusqu'a ce qu'on rouvre la conversation, qui la rechargeait alors en
 * REST — ou `editedAt` et le nouveau contenu sont pourtant presents. D'ou le
 * symptome « il faut rafraichir pour voir la modification », qui ne venait ni
 * du serveur, ni de l'emetteur, mais de ce seul trou d'ecoute.
 */
/** Un message vient d'etre epingle, ou detache. */
export interface MessagePinnedEvent {
  convId: string
  /**
   * Le message epingle, ou `null` pour un DETACHEMENT.
   *
   * ⚠️ `null` EST UNE VALEUR VALIDE, et non une trame incomplete a jeter. Le
   * serveur detache en diffusant ce meme verbe avec `messageId: null` — copier
   * le garde-fou de `subscribeToMessageEdited`, qui refuse une trame sans
   * contenu, donnerait un epinglage qui marche et un detachement qui ne se
   * propage JAMAIS. Le bandeau resterait alors chez tous les autres.
   */
  messageId: string | null
}

/**
 * S'abonne aux epinglages d'une conversation.
 *
 * ⚠️ RIEN A AJOUTER DANS `CALL_EVENT_TYPES` NI `MEETING_EVENT_TYPES` : ces deux
 * ensembles filtrent les appels et les salles, pas les messages. La reception
 * generale, elle, ne filtre rien — le verbe arrivait donc deja dans le
 * navigateur, et personne ne l'ecoutait. C'est tout le defaut : `message_pinned`
 * n'apparaissait dans AUCUN fichier du depot web, alors que l'API, la base et le
 * mobile le traitent depuis toujours.
 */
export function subscribeToMessagePinned(
  conversationId: string,
  handler: (event: MessagePinnedEvent) => void
): () => void {
  return addListener((event) => {
    if (event.type !== "message_pinned" || event.convId !== conversationId) return
    const brut = event.messageId
    handler({
      convId: conversationId,
      messageId: typeof brut === "string" && brut.length > 0 ? brut : null,
    })
  })
}

/** Epingle un message, ou detache celui qui l'est (`null`). */
export function publishPinMessage(conversationId: string, messageId: string | null) {
  sendRaw({ type: "pin_message", convId: conversationId, messageId })
}

export function subscribeToMessageEdited(
  conversationId: string,
  handler: (event: MessageEditedEvent) => void
): () => void {
  return addListener((event) => {
    if (event.type !== "message_edited" || event.convId !== conversationId) return

    const messageId = String(event.messageId ?? "")
    // Le serveur refuse deja un contenu vide : `handleEditMessage` sort AVANT
    // d'ecrire quand le texte est vide. Une trame sans texte est donc anormale,
    // et l'accepter viderait la bulle a l'ecran alors que la base, elle, n'a pas
    // bouge — l'affichage mentirait jusqu'au prochain rechargement.
    const content = typeof event.content === "string" ? event.content : null
    if (!messageId || content === null) return

    const brut = event.editedAt
    const datee = typeof brut === "string" ? new Date(brut) : null

    handler({
      messageId,
      convId: conversationId,
      content,
      // Une date illisible ne doit pas faire disparaitre la mention « modifie » :
      // on retombe sur l'instant de reception, qui n'en differe que de quelques
      // millisecondes. Le fait QU'IL Y AIT eu edition compte plus que l'heure.
      editedAt: datee && !Number.isNaN(datee.getTime()) ? datee : new Date(),
    })
  })
}

/**
 * Transfere un message vers plusieurs conversations.
 * Resout avec les resultats renvoyes par l'evenement "forwarded".
 */
export function forwardMessageOverSocket(
  messageId: string,
  targetConvIds: string[]
): Promise<Array<{ convId: string; messageId: string }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(traduire(langueInitiale(), "core_no_transfer_ack")))
    }, SEND_ACK_TIMEOUT_MS)

    const unsubscribe = addListener((event) => {
      if (event.type === "forwarded") {
        clearTimeout(timer)
        unsubscribe()
        resolve((event.results as Array<{ convId: string; messageId: string }>) ?? [])
      }
    })

    sendRaw({ type: "forward_message", messageId, targetConvIds })
  })
}
