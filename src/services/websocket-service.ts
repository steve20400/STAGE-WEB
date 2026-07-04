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
let hasTriedRefresh = false
const listeners = new Set<Listener>()
const pendingSends: string[] = []

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

  ws.onopen = () => {
    hasTriedRefresh = false
    while (pendingSends.length) {
      const data = pendingSends.shift()
      if (data) ws.send(data)
    }
    // Evenement synthetique : permet aux ecrans de se resynchroniser apres
    // une (re)connexion (messages arrives pendant la coupure).
    for (const listener of listeners) listener({ type: "ws_connected" })
  }

  ws.onmessage = (frame) => {
    let event: ServerEvent
    try {
      event = JSON.parse(String(frame.data)) as ServerEvent
    } catch {
      return
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

    for (const listener of listeners) listener(event)
  }

  ws.onclose = async (event) => {
    if (socket === ws) socket = null
    // eslint-disable-next-line no-console
    console.info(`[ws] connexion fermee (code ${event.code}) — reconnexion dans 4s`)

    // 4001 = token invalide/expire -> on tente un refresh une fois avant de reessayer.
    if (event.code === 4001 && !hasTriedRefresh) {
      hasTriedRefresh = true
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

const SEND_ACK_TIMEOUT_MS = 5000

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
