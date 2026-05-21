import { Client, type StompSubscription } from "@stomp/stompjs"
import SockJS from "sockjs-client"
import { loadSessionToken } from "../data/session-auth"

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "")
const WS_URL = `${API_BASE_URL}/api/ws`

let client: Client | null = null
let isConnected = false
// Subscriptions en attente que la connexion s'ouvre
const pendingActions: Array<() => void> = []

function ensureClient(): Client {
  if (client) return client

  client = new Client({
    webSocketFactory: () => new SockJS(WS_URL),
    connectHeaders: {
      Authorization: `Bearer ${loadSessionToken() ?? ""}`,
    },
    reconnectDelay: 5000,
    debug: () => {
      // Silencieux. Active si tu debug : (msg) => console.log("[ws]", msg)
    },
    onConnect: () => {
      isConnected = true
      while (pendingActions.length) {
        const fn = pendingActions.shift()
        if (fn) fn()
      }
    },
    onDisconnect: () => {
      isConnected = false
    },
    onStompError: (frame) => {
      // eslint-disable-next-line no-console
      console.warn("[ws] STOMP error", frame.headers["message"])
    },
  })

  client.activate()
  return client
}

function subscribe(topic: string, handler: (data: unknown) => void): () => void {
  const c = ensureClient()
  let subscription: StompSubscription | null = null
  let cancelled = false

  const doSubscribe = () => {
    if (cancelled) return
    subscription = c.subscribe(topic, (frame) => {
      try {
        handler(JSON.parse(frame.body))
      } catch {
        // ignore
      }
    })
  }

  if (isConnected) {
    doSubscribe()
  } else {
    pendingActions.push(doSubscribe)
  }

  return () => {
    cancelled = true
    if (subscription) {
      subscription.unsubscribe()
      subscription = null
    }
  }
}

function publish(destination: string, body: unknown) {
  const c = ensureClient()
  const doPublish = () => {
    c.publish({ destination, body: JSON.stringify(body) })
  }
  if (isConnected) {
    doPublish()
  } else {
    pendingActions.push(doPublish)
  }
}

/* ----------------- Public API ----------------- */

/** S'abonne aux nouveaux messages d'une conversation. */
export function subscribeToConversation(
  conversationId: string,
  handler: (data: unknown) => void
): () => void {
  return subscribe(`/topic/chats/${conversationId}`, handler)
}

export interface TypingEvent {
  phone: string
  isTyping: boolean
}

/** S'abonne aux evenements "X est en train d'ecrire" d'une conversation. */
export function subscribeToTyping(
  conversationId: string,
  handler: (event: TypingEvent) => void
): () => void {
  return subscribe(`/topic/chats/${conversationId}/typing`, (data) => handler(data as TypingEvent))
}

/** Publie un evenement "je suis en train d'ecrire" (ou j'ai arrete). */
export function publishTyping(conversationId: string, phone: string, isTyping: boolean) {
  publish(`/app/chats/${conversationId}/typing`, { phone, isTyping })
}

export interface StatusEvent {
  readBy: string // phone
  messageIds: string[]
}

/** S'abonne aux mises a jour de statut (messages lus) d'une conversation. */
export function subscribeToStatus(
  conversationId: string,
  handler: (event: StatusEvent) => void
): () => void {
  return subscribe(`/topic/chats/${conversationId}/status`, (data) => handler(data as StatusEvent))
}
