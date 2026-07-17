import { loadSessionToken } from "../data/session-auth"
import { tryRefreshTokens } from "../lib/api-client"

/**
 * Client WebSocket pour le serveur temps reel d'Alanya (ws-server.mjs) :
 * - connexion unique authentifiee via ?token=<accessToken> ;
 * - enveloppes JSON { type: "message" | "typing" | "read" | ... } ;
 * - envoi des messages de chat via { type: "send", tempId } (le POST REST
 *   ne declenche PAS de diffusion temps reel sur ce backend).
 */

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "")

function defaultWsUrl() {
  // Par defaut : meme hote que l'API, port 3001 (WS_PORT du backend).
  try {
    const url = new URL(API_BASE_URL || "http://localhost:3000")
    const scheme = url.protocol === "https:" ? "wss:" : "ws:"
    return `${scheme}//${url.hostname}:3001`
  } catch {
    return "ws://localhost:3001"
  }
}

const WS_URL = (import.meta.env.VITE_WS_URL ?? defaultWsUrl()).replace(/\/$/, "")

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

/* ----------------- Robustesse de la connexion -----------------
 * Deux pieges en production :
 * 1. le serveur WS (Render gratuit) s'endort apres ~15 min sans trafic HTTP,
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
      pending.reject(new Error(String(event.message ?? "Envoi refuse par le serveur.")))
      return
    }

    // Joue le son de notification pour les nouveaux messages des autres utilisateurs
    if (event.type === "message" && event.message) {
      const msg = event.message
      const myId = getMyUserIdFromToken()
      if (myId && msg.senderId !== myId) {
        const soundsEnabled = localStorage.getItem("notif_sounds") !== "false"
        if (soundsEnabled) {
          const audio = new Audio("/sounds/message.mp3")
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
  listeners.add(listener)
  registerLifecycleHandlers()
  startKeepAwake()
  connect()
  return () => {
    listeners.delete(listener)
  }
}

/* ----------------- Public API ----------------- */

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

const CALL_EVENT_TYPES = new Set(["incoming_call", "call_signal", "call_state"])

/** S'abonne aux evenements d'appel (toutes conversations confondues). */
export function subscribeToCallEvents(handler: (event: CallServerEvent) => void): () => void {
  return addListener((event) => {
    if (CALL_EVENT_TYPES.has(event.type)) handler(event as CallServerEvent)
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

/** Diffuse un changement d'etat d'appel (joined / left / rejected / ended...). */
export function sendCallState(
  callId: string,
  state: string,
  userId?: string,
  displayName?: string | null
) {
  sendRaw({ type: "call_state", callId, state, userId, displayName })
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
      reject(new Error("Pas de reponse du serveur temps reel."))
    }, SEND_ACK_TIMEOUT_MS)

    pendingAcks.set(tempId, { resolve, reject, timer })
    sendRaw({ type: "send", convId: conversationId, content, msgType, tempId, mediaId, replyToId })
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
      reject(new Error("Pas de confirmation du transfert."))
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
