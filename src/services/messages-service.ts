import { apiRequest } from "../lib/api-client"
import { type ChatMessageMock, type MessageStatus, type MessageType } from "../mocks/chat-data"
import { loadSessionUser, normalizePhoneNumber } from "../data/session-user"

export interface BackendMessage {
  id: string
  conversationId: string
  senderId: string // phone du sender
  content: string
  type?: string
  status?: string
  createdAt?: string
}

interface ListMessagesResponse {
  messages: BackendMessage[]
}

interface SendMessageResponse {
  message: BackendMessage
}

function mapType(type?: string): MessageType {
  if (type === "image") return "image"
  if (type === "audio") return "audio"
  if (type === "file") return "file"
  return "text"
}

function mapStatus(status?: string): MessageStatus {
  if (status === "sending") return "sending"
  if (status === "delivered") return "delivered"
  if (status === "read") return "read"
  return "sent"
}

/** Transforme la reponse backend vers le type front, en distinguant "me" vs autre. */
export function toFrontMessage(m: BackendMessage, myPhone: string | null): ChatMessageMock {
  const isMine =
    myPhone !== null && normalizePhoneNumber(m.senderId) === normalizePhoneNumber(myPhone)
  return {
    id: m.id,
    senderId: isMine ? "me" : m.senderId,
    content: m.content,
    type: mapType(m.type),
    status: mapStatus(m.status),
    timestamp: m.createdAt ? new Date(m.createdAt) : new Date(),
  }
}

/** GET /api/chats/{chatId}/messages */
export async function fetchMessages(chatId: string): Promise<ChatMessageMock[]> {
  const response = await apiRequest<ListMessagesResponse>(`/api/chats/${chatId}/messages`)
  const myPhone = loadSessionUser()?.phone ?? null
  return (response.messages ?? []).map((m) => toFrontMessage(m, myPhone))
}

/** POST /api/chats/{chatId}/read — marque tous les messages non-lus comme lus. */
export async function markChatAsRead(chatId: string): Promise<void> {
  try {
    await apiRequest<void>(`/api/chats/${chatId}/read`, { method: "POST" })
  } catch {
    // Pas critique : on ignore l'erreur (le broadcast WS ne partira juste pas)
  }
}

/** POST /api/chats/{chatId}/messages */
export async function sendChatMessage(
  chatId: string,
  content: string,
  type: MessageType = "text"
): Promise<ChatMessageMock> {
  const response = await apiRequest<SendMessageResponse>(`/api/chats/${chatId}/messages`, {
    method: "POST",
    body: { content, type },
  })
  const myPhone = loadSessionUser()?.phone ?? null
  return toFrontMessage(response.message, myPhone)
}
