/**
 * Type declarations for the IndexedDB messageRepository module.
 * Auto-generated to satisfy TypeScript strict module resolution.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Conversations ───
export function upsertConversation(conversation: any): Promise<void>
export function saveBulkConversations(conversations: any[]): Promise<void>
export function getAllConversations(): Promise<any[]>
export function getConversationById(id: string): Promise<any | undefined>
export function deleteConversation(id: string): Promise<void>

// ─── Messages ───
export function upsertMessage(message: any): Promise<void>
export function saveBulkMessages(messages: any[]): Promise<void>
export function getMessagesByConversation(conversationId: string, limit?: number): Promise<any[]>
export function deleteMessage(id: string): Promise<void>
export function clearMessagesByConversation(conversationId: string): Promise<void>

// ─── Outbox Queue ───
export function enqueueOfflineMessage(payload: any): Promise<{ tempId: string; createdAt: number }>
export function getPendingQueue(): Promise<any[]>
export function getPendingByConversation(conversationId: string): Promise<any[]>
export function removeFromQueue(tempId: string): Promise<void>
export function clearQueue(): Promise<void>

// ─── Call Logs ───
export function saveCallLog(call: any): Promise<void>
export function getAllCallLogs(): Promise<any[]>
export function getCallLogsByConversation(conversationId: string): Promise<any[]>
export function getCallLogsByUser(alanyaID: string): Promise<any[]>

// ─── Utilities ───
export function clearAllData(): Promise<void>
export function getDBStats(): Promise<Record<string, number>>
