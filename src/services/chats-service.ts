import { loadLocalConversations } from "../data/local-conversations"
import { loadLocalGroups, toConversationMock } from "../data/local-groups"
import { type ConversationMock, type MessageType } from "../mocks/chat-data"
import { toInitials } from "../data/session-user"
import { apiRequest } from "../lib/api-client"

/**
 * Aggregation purement locale (localStorage + groupes crees en local).
 * Conserve pour le dashboard tant qu'il n'a pas son propre endpoint.
 */
export function getChatConversations(): ConversationMock[] {
  const localConversations = loadLocalConversations()
  const groupFallbacks = loadLocalGroups()
    .map(toConversationMock)
    .filter(
      (conversation) =>
        !localConversations.some((localConversation) => localConversation.id === conversation.id)
    )
  return [...localConversations, ...groupFallbacks]
}

/** Conversation telle que renvoyee par GET /api/conversations. */
interface BackendConversation {
  id: string
  isGroup: boolean
  title: string | null
  avatarUrl?: string | null
  members?: Array<{ id: string; pseudo: string | null; publicNumber: string }>
  lastMessage?: {
    id: string
    content: string | null
    type: string
    senderId: string
    createdAt: string
  } | null
  unread?: number
  updatedAt?: string
}

function mapLastMessageType(type?: string): MessageType {
  const t = (type ?? "").toUpperCase()
  if (t === "IMAGE") return "image"
  if (t === "AUDIO") return "audio"
  if (t === "FILE" || t === "VIDEO") return "file"
  return "text"
}

function formatTime(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
}

function pickColorIdx(id: string): number {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return sum % 5
}

function toFrontConversation(c: BackendConversation): ConversationMock {
  const name = c.title ?? "Conversation"
  return {
    id: c.id,
    name,
    initials: toInitials(name),
    colorIdx: pickColorIdx(c.id),
    lastMessage: c.lastMessage?.content ?? "",
    lastMessageType: mapLastMessageType(c.lastMessage?.type),
    time: formatTime(c.updatedAt ?? c.lastMessage?.createdAt),
    unread: c.unread ?? 0,
    online: false, // pas d'info de presence via REST sur ce backend
    isGroup: Boolean(c.isGroup),
    members: c.members?.map((m) => toInitials(m.pseudo ?? m.publicNumber)),
    avatar: c.avatarUrl ?? null,
  }
}

/**
 * GET /api/conversations — Liste des conversations de l'utilisateur.
 * En cas d'erreur, retombe sur les conversations locales (pas sur des mocks).
 */
export async function fetchChatConversations(): Promise<ConversationMock[]> {
  try {
    const response = await apiRequest<{ conversations: BackendConversation[] }>(
      "/api/conversations"
    )
    return (response.conversations ?? []).map(toFrontConversation)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[chats] fetch a echoue", error)
    return getChatConversations()
  }
}

/**
 * POST /api/conversations — Cree (ou recupere si elle existe deja) une conversation
 * directe avec le numero Alanya (6 ou 8 chiffres) du contact. Renvoie l'id backend.
 */
export async function createPrivateChat(publicNumber: string): Promise<{ id: string }> {
  const response = await apiRequest<{ id: string; isGroup: boolean }>("/api/conversations", {
    method: "POST",
    body: { publicNumber },
  })
  return { id: response.id }
}

/**
 * POST /api/conversations — Cree un groupe avec les membres listes
 * (numeros Alanya, en plus du createur ajoute automatiquement).
 */
export async function createGroupChat(
  name: string,
  memberNumbers: string[]
): Promise<{ id: string }> {
  const response = await apiRequest<{ id: string; isGroup: boolean }>("/api/conversations", {
    method: "POST",
    body: { name, memberNumbers },
  })
  return { id: response.id }
}

/**
 * Recupere une conversation precise par son id en filtrant la liste backend.
 * Utilise par la page chat pour reconstituer les infos d'une conv ouverte.
 */
export async function fetchConversationById(
  conversationId: string
): Promise<ConversationMock | null> {
  const all = await fetchChatConversations()
  return all.find((c) => c.id === conversationId) ?? null
}
