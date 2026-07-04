import { apiRequest } from "../lib/api-client"
import { type ChatMessageMock, type MessageStatus, type MessageType } from "../mocks/chat-data"
import { loadSessionUser } from "../data/session-user"
import {
  forwardMessageOverSocket,
  publishRead,
  sendDeleteMessage,
  sendMessageOverSocket,
  type WsMessagePayload,
} from "./websocket-service"

/** Message tel que renvoye par le backend Next.js (REST et WebSocket). */
export interface BackendMessage {
  id: string
  convId: string
  senderId: string // UUID de l'expediteur
  content: string | null
  type?: string // TEXT | IMAGE | FILE | AUDIO | VIDEO
  status?: string // SENT | DELIVERED | READ
  createdAt?: string
  replyToId?: string | null
  replyTo?: {
    id: string
    senderId: string
    type: string
    content: string | null
    isDeleted: boolean
  } | null
  deletedAt?: string | null
  media?: Array<{
    id: string
    url: string
    filename: string
    mimeType: string
    sizeBytes: number
    durationMs: number | null
  }>
}

interface ListMessagesResponse {
  messages: BackendMessage[]
  nextCursor?: string | null
}

function mapType(type?: string): MessageType {
  const t = (type ?? "").toUpperCase()
  if (t === "IMAGE") return "image"
  if (t === "AUDIO") return "audio"
  if (t === "FILE" || t === "VIDEO") return "file"
  return "text"
}

function mapStatus(status?: string): MessageStatus {
  const s = (status ?? "").toUpperCase()
  if (s === "DELIVERED") return "delivered"
  if (s === "READ") return "read"
  return "sent"
}

function toBackendType(type: MessageType): string {
  if (type === "image") return "IMAGE"
  if (type === "audio") return "AUDIO"
  if (type === "file") return "FILE"
  return "TEXT"
}

function formatBytes(size?: number): string | undefined {
  if (!size || size <= 0) return undefined
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} Ko`
  return `${(size / 1024 / 1024).toFixed(1)} Mo`
}

/** Transforme la reponse backend vers le type front, en distinguant "me" vs autre. */
export function toFrontMessage(
  m: BackendMessage | WsMessagePayload,
  myId: string | null
): ChatMessageMock {
  const isMine = myId !== null && m.senderId === myId
  const media = m.media?.[0]
  const deletedAt = (m as BackendMessage).deletedAt ?? null

  return {
    id: m.id,
    senderId: isMine ? "me" : m.senderId,
    content: m.content ?? "",
    type: mapType(m.type),
    status: mapStatus(m.status),
    timestamp: m.createdAt ? new Date(m.createdAt) : new Date(),
    replyTo: m.replyToId ?? undefined,
    replySnapshot: m.replyTo
      ? {
          senderId: myId !== null && m.replyTo.senderId === myId ? "me" : m.replyTo.senderId,
          content: m.replyTo.content,
          type: mapType(m.replyTo.type),
          isDeleted: m.replyTo.isDeleted,
        }
      : undefined,
    mediaUrl: media?.url,
    mediaMime: media?.mimeType,
    durationMs: media?.durationMs ?? undefined,
    fileName: media?.filename,
    fileSize: formatBytes(media?.sizeBytes),
    isDeleted: Boolean(deletedAt),
  }
}

/** GET /api/conversations/{id}/messages — historique (renvoye du plus recent au plus ancien). */
export async function fetchMessages(chatId: string): Promise<ChatMessageMock[]> {
  const response = await apiRequest<ListMessagesResponse>(
    `/api/conversations/${chatId}/messages?limit=100`
  )
  const myId = loadSessionUser()?.id ?? null
  // Le backend pagine en ordre descendant ; l'UI affiche en ordre chronologique.
  return (response.messages ?? []).map((m) => toFrontMessage(m, myId)).reverse()
}

/** POST /api/conversations/{id}/read + notification temps reel aux autres participants. */
export async function markChatAsRead(chatId: string): Promise<void> {
  publishRead(chatId)
  try {
    await apiRequest<void>(`/api/conversations/${chatId}/read`, { method: "POST" })
  } catch {
    // Pas critique : le pointeur de lecture sera mis a jour a la prochaine ouverture.
  }
}

interface SendOptions {
  replyToId?: string
  mediaId?: string
}

/**
 * Envoie un message. On privilegie le WebSocket ({ type: "send" }) car c'est lui
 * qui declenche la diffusion temps reel aux autres participants sur ce backend ;
 * en cas d'echec, on retombe sur le POST REST (persistance sans broadcast).
 */
export async function sendChatMessage(
  chatId: string,
  content: string,
  type: MessageType = "text",
  options: SendOptions = {}
): Promise<ChatMessageMock> {
  const myId = loadSessionUser()?.id ?? null
  const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const msgType = toBackendType(type)

  try {
    const message = await sendMessageOverSocket(chatId, {
      content: content || undefined,
      msgType,
      tempId,
      mediaId: options.mediaId,
      replyToId: options.replyToId,
    })
    return toFrontMessage(message, myId)
  } catch {
    const response = await apiRequest<BackendMessage>(`/api/conversations/${chatId}/messages`, {
      method: "POST",
      body: {
        content: content || undefined,
        type: msgType,
        mediaId: options.mediaId,
        replyToId: options.replyToId,
      },
    })
    return toFrontMessage(response, myId)
  }
}

/**
 * Supprime un message : "me" masque localement, "everyone" efface pour tous
 * (reserve a l'expediteur). La confirmation arrive via l'evenement message_deleted.
 */
export function deleteChatMessage(messageId: string, scope: "me" | "everyone") {
  sendDeleteMessage(messageId, scope)
}

/** Transfere un message vers d'autres conversations (contenu + medias copies). */
export async function forwardChatMessage(
  messageId: string,
  targetConvIds: string[]
): Promise<number> {
  const results = await forwardMessageOverSocket(messageId, targetConvIds)
  return results.length
}
