/**
 * indexeddb-cache.ts — Couche de cache TypeScript au-dessus des repositories
 * IndexedDB existants. Fournit des méthodes cache-first pour les conversations
 * et les messages, avec file d'attente offline (outbox).
 *
 * Cette couche est consommée par chats-service.ts et messages-service.ts.
 * Les repositories sous-jacents (messageRepository.js, userRepository.js)
 * ne sont pas modifiés.
 */

import {
  upsertConversation,
  saveBulkConversations,
  getAllConversations,
  getConversationById,
  upsertMessage,
  saveBulkMessages,
  getMessagesByConversation,
  deleteMessage,
  clearMessagesByConversation,
  enqueueOfflineMessage,
  getPendingQueue,
  getPendingByConversation,
  removeFromQueue,
  saveCallLog,
  getAllCallLogs,
  getCallLogsByConversation,
  getDBStats,
} from "../indexedDB/messageRepository"

/* ─────────────── Types internes ─────────────── */

/** Structure minimale d'une conversation telle que stockée en IndexedDB. */
interface CachedConversation {
  id: string
  updatedAt?: number | string
  [key: string]: unknown
}

/** Structure minimale d'un message tel que stocké en IndexedDB. */
interface CachedMessage {
  id: string
  conversationId: string
  createdAt?: number | string
  status?: string
  [key: string]: unknown
}

interface OutboxPayload {
  conversationId: string
  senderId?: string
  content?: string
  type?: string
  [key: string]: unknown
}

/* ═════════════════════════════════════════════════
   CONVERSATIONS
   ═════════════════════════════════════════════════ */

/** Sauvegarde une liste complète de conversations en IndexedDB. */
export async function cacheConversations(conversations: CachedConversation[]): Promise<void> {
  if (!conversations.length) return
  await saveBulkConversations(conversations)
}

/** Sauvegarde / met à jour une conversation unique. */
export async function cacheConversation(conversation: CachedConversation): Promise<void> {
  await upsertConversation(conversation)
}

/** Charge toutes les conversations depuis IndexedDB (triées par updatedAt desc). */
export async function loadCachedConversations(): Promise<CachedConversation[]> {
  return getAllConversations()
}

/** Charge une conversation par son id. */
export async function loadCachedConversation(id: string): Promise<CachedConversation | undefined> {
  return getConversationById(id)
}

/* ═════════════════════════════════════════════════
   MESSAGES
   ═════════════════════════════════════════════════ */

/** Sauvegarde une liste de messages pour une conversation. */
export async function cacheMessages(messages: CachedMessage[]): Promise<void> {
  if (!messages.length) return
  // Chaque message doit avoir un conversationId pour l'index
  await saveBulkMessages(messages)
}

/** Sauvegarde un message unique (ex : message WebSocket entrant). */
export async function cacheMessage(message: CachedMessage): Promise<void> {
  await upsertMessage(message)
}

/** Charge les messages d'une conversation depuis IndexedDB (les plus récents). */
export async function loadCachedMessages(
  conversationId: string,
  limit = 100
): Promise<CachedMessage[]> {
  return getMessagesByConversation(conversationId, limit)
}

/** Supprime un message du cache local. */
export async function removeMessageFromCache(messageId: string): Promise<void> {
  await deleteMessage(messageId)
}

/** Supprime tous les messages d'une conversation. */
export async function clearConversationMessages(conversationId: string): Promise<void> {
  await clearMessagesByConversation(conversationId)
}

/* ═════════════════════════════════════════════════
   OUTBOX (file d'attente offline)
   ═════════════════════════════════════════════════ */

/** Met un message en file d'attente pour envoi ultérieur (offline). */
export async function enqueueOffline(
  payload: OutboxPayload
): Promise<{ tempId: string; createdAt: number }> {
  return enqueueOfflineMessage(payload)
}

/** Retourne tous les messages en file d'attente. */
export async function getOfflineQueue(): Promise<OutboxPayload[]> {
  return getPendingQueue()
}

/** Retourne les messages en file d'attente pour une conversation. */
export async function getOfflineQueueForConversation(
  conversationId: string
): Promise<OutboxPayload[]> {
  return getPendingByConversation(conversationId)
}

/** Retire un message de la file d'attente après envoi réussi. */
export async function dequeueOffline(tempId: string): Promise<void> {
  await removeFromQueue(tempId)
}

/* ═════════════════════════════════════════════════
   CALL LOGS
   ═════════════════════════════════════════════════ */

export async function cacheCallLog(call: Record<string, unknown>): Promise<void> {
  await saveCallLog(call)
}

export async function loadCachedCallLogs(): Promise<Record<string, unknown>[]> {
  return getAllCallLogs()
}

export async function loadCachedCallLogsForConversation(
  conversationId: string
): Promise<Record<string, unknown>[]> {
  return getCallLogsByConversation(conversationId)
}

/* ═════════════════════════════════════════════════
   STATS / DEBUG
   ═════════════════════════════════════════════════ */

export async function getCacheStats(): Promise<Record<string, number>> {
  return getDBStats()
}
