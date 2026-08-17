import { ApiError, apiRequest } from "../lib/api-client"
import { langueInitiale, traduire } from "../i18n"
import { type ChatMessageMock, type MessageStatus, type MessageType } from "../mocks/chat-data"
import { getMyUserId } from "../data/session-user"
import {
  forwardMessageOverSocket,
  publishRead,
  sendDeleteMessage,
  sendMessageOverSocket,
  type WsMessagePayload,
} from "./websocket-service"
import {
  cacheMessages,
  cacheMessage,
  dequeueOffline,
  getOfflineQueue,
  loadCachedMessages,
  removeMessageFromCache,
  enqueueOffline,
} from "./indexeddb-cache"

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
  // VIDEO etait replie sur "file" : une video envoyee depuis le mobile
  // s'affichait donc comme une piece jointe, sans lecteur.
  if (t === "VIDEO") return "video"
  if (t === "FILE") return "file"
  if (t === "SYSTEM") return "system"
  // Sans ces deux lignes, une fiche de contact ou une position reçue retombait
  // sur "text" et affichait sa charge JSON brute dans la bulle.
  if (t === "CONTACT") return "contact"
  if (t === "LOCATION") return "location"
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
  // "video" manquait : il retombait sur le return final, donc une video
  // partait etiquetee TEXT. Le mobile affichait alors « [TEXT] », et le
  // serveur WebSocket rejetait meme le message en silence, car il refuse un
  // TEXT sans contenu (ws-server.mjs, handleSend).
  if (type === "video") return "VIDEO"
  if (type === "file") return "FILE"
  if (type === "system") return "SYSTEM"
  if (type === "contact") return "CONTACT"
  if (type === "location") return "LOCATION"
  return "TEXT"
}

/**
 * Taille d'une piece jointe, telle qu'elle s'affiche sous la bulle.
 *
 * L'unite se traduit : « Ko » et « Mo » sont des abreviations francaises, et
 * elles restaient telles quelles pour un lecteur anglophone ou russophone.
 */
export function formatBytes(size?: number): string | undefined {
  if (!size || size <= 0) return undefined
  const langue = langueInitiale()
  if (size < 1024 * 1024) {
    return traduire(langue, "v2_size_kb", { taille: Math.max(1, Math.round(size / 1024)) })
  }
  return traduire(langue, "v2_size_mb", { taille: (size / 1024 / 1024).toFixed(1) })
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
    type: media?.mimeType?.startsWith("video/") ? "video" : mapType(m.type),
    status: mapStatus(m.status),
    // Le serveur ne met ce champ que dans la charge des appareils du compte
    // emetteur : le recevoir suffit a avoir le droit de l'afficher.
    nomAgent: (m as { nomAgent?: string | null }).nomAgent ?? null,
    appareilId: (m as { appareilId?: number | null }).appareilId ?? null,
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

/**
 * Taille du premier lot.
 *
 * Etait a 100, ce qui retardait le premier affichage et faisait rendre cent
 * bulles d'un coup. Les messages arrivent du plus recent au plus ancien : trente
 * suffisent a remplir plusieurs hauteurs d'ecran, le reste vient au defilement.
 */
export const INITIAL_PAGE_SIZE = 30

/** Taille des pages suivantes, chargees en remontant l'historique. */
export const OLDER_PAGE_SIZE = 30

/** Enregistre un lot du backend dans IndexedDB, pour le cache-first. */
function cacheBackendMessages(backendMessages: BackendMessage[]): void {
  void cacheMessages(
    backendMessages.map((m) => ({
      id: m.id,
      conversationId: m.convId,
      senderId: m.senderId,
      content: m.content,
      type: m.type,
      status: m.status,
      createdAt: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
      replyToId: m.replyToId,
      replyTo: m.replyTo,
      deletedAt: m.deletedAt,
      media: m.media,
    }))
  )
}

/** GET /api/conversations/{id}/messages — historique (renvoye du plus recent au plus ancien).
 *  Persiste les messages dans IndexedDB pour le cache-first. */
export async function fetchMessages(chatId: string): Promise<ChatMessageMock[]> {
  const response = await apiRequest<ListMessagesResponse>(
    `/api/conversations/${chatId}/messages?limit=${INITIAL_PAGE_SIZE}`
  )
  const myId = getMyUserId()
  const backendMessages = response.messages ?? []

  cacheBackendMessages(backendMessages)

  // Le backend pagine en ordre descendant ; l'UI affiche en ordre chronologique.
  return backendMessages.map((m) => toFrontMessage(m, myId)).reverse()
}

/**
 * Page precedente de l'historique, en remontant.
 *
 * Le curseur est l'identifiant du plus ancien message deja affiche, exactement
 * comme le mobile (`chat_repository.dart`) : le backend accepte donc ce parametre,
 * et le web n'avait simplement jamais fait de pagination — il demandait un gros
 * lot unique et n'offrait aucun moyen de remonter plus loin.
 *
 * Renvoie les messages en ordre chronologique, et un lot vide quand on a atteint
 * le debut de la conversation.
 */
export async function fetchOlderMessages(
  chatId: string,
  cursor: string
): Promise<ChatMessageMock[]> {
  const response = await apiRequest<ListMessagesResponse>(
    `/api/conversations/${chatId}/messages?cursor=${encodeURIComponent(cursor)}&limit=${OLDER_PAGE_SIZE}`
  )
  const myId = getMyUserId()
  const backendMessages = response.messages ?? []

  cacheBackendMessages(backendMessages)

  return backendMessages.map((m) => toFrontMessage(m, myId)).reverse()
}

/**
 * Stratégie cache-first pour les messages :
 * 1. Appelle onCached() immédiatement avec les messages IndexedDB (~2ms)
 * 2. Fetch le backend en arrière-plan
 * 3. Appelle onFresh() avec les messages frais
 *
 * Utilisée par chat.tsx pour un affichage instantané de l'historique.
 */
export async function fetchMessagesCacheFirst(
  chatId: string,
  onCached: (messages: ChatMessageMock[]) => void,
  onFresh: (messages: ChatMessageMock[]) => void
): Promise<void> {
  const myId = getMyUserId()

  // Étape 1 : lecture cache instantanée
  try {
    const cached = await loadCachedMessages(chatId, INITIAL_PAGE_SIZE)
    if (cached.length > 0) {
      onCached(cached.map((m) => toFrontMessage(m as unknown as BackendMessage, myId)))
    }
  } catch {
    // IndexedDB indisponible, on attend le réseau
  }

  // Étape 2 : fetch réseau si en ligne
  if (!navigator.onLine) return

  try {
    const fresh = await fetchMessages(chatId)
    onFresh(fresh)
  } catch {
    // Erreur réseau — le cache est déjà affiché
  }
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

interface DeliveryPayload {
  content?: string
  msgType: string
  tempId: string
  mediaId?: string
  replyToId?: string
}

/**
 * Achemine un message : d'abord le WebSocket ({ type: "send" }), car c'est lui
 * qui declenche la diffusion temps reel aux autres participants sur ce backend ;
 * a defaut, le POST REST (persistance sans broadcast).
 */
async function deliverMessage(
  chatId: string,
  payload: DeliveryPayload
): Promise<BackendMessage | WsMessagePayload> {
  try {
    return await sendMessageOverSocket(chatId, payload)
  } catch {
    return await apiRequest<BackendMessage>(`/api/conversations/${chatId}/messages`, {
      method: "POST",
      body: {
        content: payload.content,
        type: payload.msgType,
        mediaId: payload.mediaId,
        replyToId: payload.replyToId,
      },
    })
  }
}

/** Persiste en IndexedDB un message confirme par le backend. */
function cacheDeliveredMessage(message: BackendMessage | WsMessagePayload): void {
  void cacheMessage({
    id: message.id,
    conversationId: message.convId,
    senderId: message.senderId,
    content: message.content,
    type: message.type,
    status: message.status,
    createdAt: message.createdAt ? new Date(message.createdAt).getTime() : Date.now(),
    replyToId: message.replyToId,
    replyTo: message.replyTo,
    deletedAt: (message as BackendMessage).deletedAt ?? null,
    media: message.media,
  })
}

/**
 * Envoie un message. On privilegie le WebSocket ({ type: "send" }) car c'est lui
 * qui declenche la diffusion temps reel aux autres participants sur ce backend ;
 * en cas d'echec, on retombe sur le POST REST (persistance sans broadcast).
 * Si complètement hors ligne, le message est mis en file d'attente (outbox).
 */
export async function sendChatMessage(
  chatId: string,
  content: string,
  type: MessageType = "text",
  options: SendOptions = {}
): Promise<ChatMessageMock> {
  const myId = getMyUserId()
  const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const msgType = toBackendType(type)

  // Hors ligne → outbox pour envoi ultérieur
  if (!navigator.onLine) {
    const pending = await enqueueOffline({
      conversationId: chatId,
      senderId: myId ?? undefined,
      content: content || undefined,
      type: msgType,
      mediaId: options.mediaId,
      replyToId: options.replyToId,
    })
    // Persiste le message optimiste en cache pour affichage immédiat
    await cacheMessage({
      id: pending.tempId,
      conversationId: chatId,
      senderId: myId ?? "",
      content: content || null,
      type: msgType,
      status: "PENDING",
      createdAt: pending.createdAt,
    })
    return {
      id: pending.tempId,
      senderId: "me",
      content: content ?? "",
      type,
      status: "sending",
      timestamp: new Date(pending.createdAt),
    }
  }

  let message: BackendMessage | WsMessagePayload
  try {
    message = await deliverMessage(chatId, {
      content: content || undefined,
      msgType,
      tempId,
      mediaId: options.mediaId,
      replyToId: options.replyToId,
    })
  } catch (err) {
    /**
     * Blocage : le message reste « en cours d'envoi », pour toujours.
     *
     * C'est le comportement demande — ni confirmation, ni erreur. L'expediteur
     * ne doit pas apprendre qu'il a ete bloque (sauf avis systeme, decide par
     * le serveur selon les accuses de lecture du bloque).
     *
     * On s'appuie sur le refus du serveur plutot que sur une liste locale : lui
     * seul fait autorite, et cela evite de promener l'etat de blocage dans tout
     * l'ecran de discussion. Le message n'est PAS mis en file d'attente : la
     * file reessaie au retour du reseau, et il repartirait indefiniment.
     */
    if (estRefusPourBlocage(err)) {
      await cacheMessage({
        id: tempId,
        conversationId: chatId,
        senderId: myId ?? "",
        content: content || null,
        type: msgType,
        status: "PENDING",
        createdAt: Date.now(),
      })
      return {
        id: tempId,
        senderId: "me",
        content: content ?? "",
        type,
        status: "sending",
        timestamp: new Date(),
      }
    }
    throw err
  }
  cacheDeliveredMessage(message)
  return toFrontMessage(message, myId)
}

/**
 * Le serveur refuse-t-il ce message parce que les deux personnes sont bloquees ?
 *
 * Le code `BLOCKED` est la reponse de la route REST, celle sur laquelle le
 * client bascule quand le WebSocket n'acquitte pas — ce qui est precisement ce
 * qui se passe entre deux personnes bloquees.
 */
function estRefusPourBlocage(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 403) return false
  // Le code voyage dans la charge : { error: { message, code } }.
  const charge = err.payload as { error?: { code?: unknown } } | undefined
  return charge?.error?.code === "BLOCKED"
}

/** Un seul drain a la fois : "online" et le montage peuvent se declencher ensemble. */
let draining = false

/**
 * Renvoie les messages ecrits hors ligne (outbox IndexedDB). Sans ce drain, la
 * file d'attente grossit sans jamais partir : le message reste affiche comme
 * « en cours d'envoi » indefiniment. Retourne le nombre de messages envoyes.
 */
export async function drainOfflineOutbox(): Promise<number> {
  if (draining || !navigator.onLine) return 0
  draining = true
  let sent = 0

  try {
    const pending = await getOfflineQueue()
    // Ordre chronologique : les messages doivent arriver dans l'ordre d'ecriture.
    pending.sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0))

    for (const item of pending) {
      const chatId = typeof item.conversationId === "string" ? item.conversationId : ""
      const tempId = typeof item.tempId === "string" ? item.tempId : ""
      if (!tempId) continue
      if (!chatId) {
        // Entree corrompue : inutile de bloquer la file dessus.
        await dequeueOffline(tempId)
        continue
      }

      try {
        const message = await deliverMessage(chatId, {
          content: typeof item.content === "string" ? item.content : undefined,
          msgType: typeof item.type === "string" ? item.type : "TEXT",
          tempId,
          mediaId: typeof item.mediaId === "string" ? item.mediaId : undefined,
          replyToId: typeof item.replyToId === "string" ? item.replyToId : undefined,
        })
        cacheDeliveredMessage(message)
      } catch {
        // Reseau encore instable : on reprendra au prochain retour en ligne.
        break
      }

      await dequeueOffline(tempId)
      // Retire le message optimiste : il est remplace par celui du backend.
      await removeMessageFromCache(tempId)
      sent += 1
    }
  } catch {
    // IndexedDB indisponible : rien a renvoyer.
  } finally {
    draining = false
  }

  return sent
}

/**
 * Supprime un message : "me" masque localement, "everyone" efface pour tous
 * (reserve a l'expediteur). La confirmation arrive via l'evenement message_deleted.
 * Supprime également du cache IndexedDB.
 */
export function deleteChatMessage(messageId: string, scope: "me" | "everyone") {
  sendDeleteMessage(messageId, scope)
  // Suppression du cache local
  void removeMessageFromCache(messageId)
}

/** Transfere un message vers d'autres conversations (contenu + medias copies). */
export async function forwardChatMessage(
  messageId: string,
  targetConvIds: string[]
): Promise<number> {
  const results = await forwardMessageOverSocket(messageId, targetConvIds)
  return results.length
}

/**
 * Persiste un message entrant (WebSocket) dans le cache IndexedDB.
 * Appelé par chat.tsx quand un nouveau message arrive via subscribeToConversation.
 */
export async function persistIncomingWsMessage(message: WsMessagePayload): Promise<void> {
  await cacheMessage({
    id: message.id,
    conversationId: message.convId,
    senderId: message.senderId,
    content: message.content,
    type: message.type,
    status: message.status,
    createdAt: message.createdAt ? new Date(message.createdAt).getTime() : Date.now(),
    replyToId: message.replyToId,
    replyTo: message.replyTo,
    media: message.media,
  })
}

/**
 * Supprime un message du cache IndexedDB.
 * Appelé lors de la réception d'un événement message_deleted.
 */
export async function removeMessageFromDB(messageId: string): Promise<void> {
  await removeMessageFromCache(messageId)
}
