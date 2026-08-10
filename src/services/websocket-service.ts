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
      const refreshed = await tryRefreshTokens()
      if (refreshed) {
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
export function sendSessionRevoked(deviceId: string) {
  sendRaw({ type: "session_revoked", deviceId })
}

/**
 * S'abonne a la revocation d'une session. Le handler recoit l'identifiant de
 * l'appareil vise : a chaque client de le comparer au sien.
 */
export function subscribeToSessionRevoked(handler: (deviceId: string) => void): () => void {
  return addListener((event) => {
    if (event.type !== "session_revoked") return
    const deviceId = String(event.deviceId ?? "")
    if (deviceId) handler(deviceId)
  })
}

export interface StatusEvent {
  /** UUID de l'utilisateur qui a lu la conversation. */
  readBy: string
}

/** S'abonne aux accuses de lecture d'une conversation (l'autre a tout lu). */
export function subscribeToStatus(
  conversationId: string,
  handler: (event: StatusEvent) => void
): () => void {
  return addListener((event) => {
    if (event.type === "read" && event.convId === conversationId) {
      handler({ readBy: String(event.userId ?? "") })
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
  "ivr_error",
])
const MEETING_EVENT_TYPES = new Set([
  "meeting_signal",
  "meeting_joined",
  "meeting_user_left",
  "meeting_user_joined",
  "meeting_extended",
  "meeting_message",
  "meeting_hand",
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
    if (MEETING_EVENT_TYPES.has(event.type)) handler(event)
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
