import { initIndexedDB } from './schema';

// ═══════════════════════════════════════════════════════════
// CONVERSATIONS
// ═══════════════════════════════════════════════════════════

export const upsertConversation = async (conversation) => {
    const db = await initIndexedDB();
    await db.put('conversations', conversation);
};

export const saveBulkConversations = async (conversations = []) => {
    if (!conversations.length) return;
    const db = await initIndexedDB();
    const tx = db.transaction('conversations', 'readwrite');
    await Promise.all([
        ...conversations.map((c) => tx.store.put(c)),
        tx.done,
    ]);
};

export const getAllConversations = async () => {
    const db = await initIndexedDB();
    const all = await db.getAll('conversations');
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};

export const getConversationById = async (id) => {
    const db = await initIndexedDB();
    return db.get('conversations', id);
};

export const deleteConversation = async (id) => {
    const db = await initIndexedDB();
    await db.delete('conversations', id);
};

// ═══════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════

export const upsertMessage = async (message) => {
    const db = await initIndexedDB();
    await db.put('messages', message);
};

export const saveBulkMessages = async (messages = []) => {
    if (!messages.length) return;
    const db = await initIndexedDB();
    const tx = db.transaction('messages', 'readwrite');
    await Promise.all([
        ...messages.map((m) => tx.store.put(m)),
        tx.done,
    ]);
};

export const getMessagesByConversation = async (conversationId, limit = 50) => {
    const db = await initIndexedDB();
    const tx = db.transaction('messages', 'readonly');
    const index = tx.store.index('by_conversation_and_date');
    const range = IDBKeyRange.bound(
        [conversationId, 0],
        [conversationId, Number.MAX_SAFE_INTEGER]
    );
    const allMessages = await index.getAll(range);
    await tx.done;
    return allMessages.slice(-limit);
};

export const deleteMessage = async (id) => {
    const db = await initIndexedDB();
    await db.delete('messages', id);
};

export const clearMessagesByConversation = async (conversationId) => {
    const db = await initIndexedDB();
    const tx = db.transaction('messages', 'readwrite');
    const index = tx.store.index('conversationId');
    const range = IDBKeyRange.only(conversationId);
    let cursor = await index.openCursor(range);
    while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
    }
    await tx.done;
};

// ═══════════════════════════════════════════════════════════
// OUTBOX QUEUE (Messages en attente d'envoi)
// ═══════════════════════════════════════════════════════════

export const enqueueOfflineMessage = async (payload) => {
    const db = await initIndexedDB();
    const pending = {
        ...payload,
        tempId: `outbox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        createdAt: Date.now(),
        status: 'pending',
    };
    await db.put('outboxQueue', pending);
    return pending;
};

export const getPendingQueue = async () => {
    const db = await initIndexedDB();
    return db.getAll('outboxQueue');
};

export const getPendingByConversation = async (conversationId) => {
    const db = await initIndexedDB();
    return db.getAllFromIndex('outboxQueue', 'conversationId', conversationId);
};

export const removeFromQueue = async (tempId) => {
    const db = await initIndexedDB();
    await db.delete('outboxQueue', tempId);
};

export const clearQueue = async () => {
    const db = await initIndexedDB();
    await db.clear('outboxQueue');
};

// ═══════════════════════════════════════════════════════════
// CALL LOGS (Historique d'appels)
// ═══════════════════════════════════════════════════════════

export const saveCallLog = async (call) => {
    const db = await initIndexedDB();
    await db.put('callLogs', call);
};

export const getAllCallLogs = async () => {
    const db = await initIndexedDB();
    const all = await db.getAll('callLogs');
    return all.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
};

export const getCallLogsByConversation = async (conversationId) => {
    const db = await initIndexedDB();
    return db.getAllFromIndex('callLogs', 'conversationId', conversationId);
};

export const getCallLogsByUser = async (alanyaID) => {
    const db = await initIndexedDB();
    return db.getAllFromIndex('callLogs', 'alanyaID', alanyaID);
};

// ═══════════════════════════════════════════════════════════
// UTILITAIRES GLOBAUX
// ═══════════════════════════════════════════════════════════

export const clearAllData = async () => {
    const db = await initIndexedDB();
    const stores = ['users', 'Appareil', 'conversations', 'messages', 'outboxQueue', 'callLogs'];
    const tx = db.transaction(stores, 'readwrite');
    await Promise.all([
        ...stores.map((s) => tx.objectStore(s).clear()),
        tx.done,
    ]);
};

export const getDBStats = async () => {
    const db = await initIndexedDB();
    const [users, appareils, conversations, messages, pending, calls] = await Promise.all([
        db.count('users'),
        db.count('Appareil'),
        db.count('conversations'),
        db.count('messages'),
        db.count('outboxQueue'),
        db.count('callLogs'),
    ]);
    return { users, appareils, conversations, messages, pending, calls };
};