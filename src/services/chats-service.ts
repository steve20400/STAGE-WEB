import { loadLocalConversations } from "../data/local-conversations"
import { loadLocalGroups, toConversationMock } from "../data/local-groups"
import { type ConversationMock, type MessageType } from "../mocks/chat-data"
import { toInitials } from "../data/session-user"
import { apiRequest } from "../lib/api-client"
import {
  cacheConversations,
  loadCachedConversations,
  loadCachedConversation,
} from "./indexeddb-cache"

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
    membersInfo: c.members,
    avatar: c.avatarUrl ?? null,
  }
}

/**
 * GET /api/conversations — Liste des conversations de l'utilisateur.
 * Persiste le résultat dans IndexedDB pour un affichage instantané au prochain chargement.
 * En cas d'erreur, retombe sur le cache IndexedDB puis sur les conversations locales.
 */
export async function fetchChatConversations(): Promise<ConversationMock[]> {
  try {
    const response = await apiRequest<{ conversations: BackendConversation[] }>(
      "/api/conversations"
    )
    const conversations = (response.conversations ?? []).map(toFrontConversation)

    // Persiste en IndexedDB pour le cache-first
    void cacheConversations(
      (response.conversations ?? []).map((c) => ({
        id: c.id,
        isGroup: c.isGroup,
        title: c.title,
        avatarUrl: c.avatarUrl,
        members: c.members,
        lastMessage: c.lastMessage,
        unread: c.unread,
        updatedAt: c.updatedAt ? new Date(c.updatedAt).getTime() : Date.now(),
      }))
    )

    return conversations
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[chats] fetch a echoue, tentative cache IndexedDB", error)
    // Tentative de fallback IndexedDB
    try {
      const cached = await loadCachedConversations()
      if (cached.length > 0) {
        return cached.map((c) =>
          toFrontConversation(c as unknown as BackendConversation)
        )
      }
    } catch {
      // IndexedDB indisponible, on continue
    }
    return getChatConversations()
  }
}

/**
 * Stratégie cache-first pour les conversations :
 * 1. Appelle onCached() immédiatement avec les données IndexedDB (~2ms)
 * 2. Fetch le backend en arrière-plan
 * 3. Appelle onFresh() avec les données fraîches
 *
 * Utilisée par chats.tsx pour un affichage instantané.
 */
export async function fetchChatConversationsCacheFirst(
  onCached: (conversations: ConversationMock[]) => void,
  onFresh: (conversations: ConversationMock[]) => void
): Promise<void> {
  // Étape 1 : lecture cache instantanée
  try {
    const cached = await loadCachedConversations()
    if (cached.length > 0) {
      onCached(
        cached.map((c) => toFrontConversation(c as unknown as BackendConversation))
      )
    }
  } catch {
    // IndexedDB indisponible, on attend le réseau
  }

  // Étape 2 : fetch réseau si en ligne
  if (!navigator.onLine) return

  try {
    const fresh = await fetchChatConversations()
    onFresh(fresh)
  } catch {
    // Erreur réseau — le cache est déjà affiché
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
 * Recupere une conversation precise par son id.
 * Essaie d'abord le cache IndexedDB pour un résultat instantané,
 * puis la liste backend pour les données les plus fraîches.
 */
export async function fetchConversationById(
  conversationId: string
): Promise<ConversationMock | null> {
  // Essai cache IndexedDB d'abord
  try {
    const cached = await loadCachedConversation(conversationId)
    if (cached) {
      // On lance quand même le fetch backend en fond pour mettre à jour
      void fetchChatConversations().catch(() => undefined)
      return toFrontConversation(cached as unknown as BackendConversation)
    }
  } catch {
    // IndexedDB indisponible
  }

  const all = await fetchChatConversations()
  return all.find((c) => c.id === conversationId) ?? null
}

/**
 * POST /api/conversations/:id/members — Ajoute des membres a un groupe existant.
 * Envoie les numeros Alanya des nouveaux membres.
 */
export async function addMembersToGroup(
  convId: string,
  memberNumbers: string[]
): Promise<void> {
  await apiRequest<void>(`/api/conversations/${convId}/members`, {
    method: "POST",
    body: { memberNumbers },
  })
}
