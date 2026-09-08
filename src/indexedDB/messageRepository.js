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
        // ⚠️ UN tempId FOURNI L'EMPORTE, et ce n'est pas un detail : la bulle
        // affichee a l'ecran porte deja un identifiant, et c'est LUI que le
        // serveur renverra dans son echo. En regenerer un ici ferait que la
        // reponse ne correspondrait a aucune bulle : le media resterait
        // eternellement « en cours d'envoi » a cote de sa copie confirmee.
        tempId:
            payload?.tempId ||
            `outbox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        createdAt: Date.now(),
        status: 'pending',
    };
    await db.put('outboxQueue', pending);
    return pending;
};

/**
 * Modifie une entree de la file sans la retirer.
 *
 * 🔴 SERT A NE PAS TELEVERSER DEUX FOIS LE MEME FICHIER. Un envoi de media se
 * fait en deux temps — televerser les octets, puis envoyer le message qui les
 * cite. Si le second echoue, reprendre depuis le debut renverrait les octets
 * une seconde fois : deux medias en base, deux fois la donnee payee. On range
 * donc l'identifiant obtenu des qu'on l'a, et on jette les octets.
 */
export const updateQueueItem = async (tempId, patch) => {
    const db = await initIndexedDB();
    const item = await db.get('outboxQueue', tempId);
    if (!item) return;
    await db.put('outboxQueue', { ...item, ...patch });
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
    // Liste lue dans la base, jamais écrite à la main : un magasin ajouté au
    // schéma et oublié ici survivrait à la déconnexion, et le compte suivant
    // lirait les données du précédent par le chemin cache-first. C'est la fuite
    // inter-comptes déjà corrigée une fois sur ce projet ; l'énumération la rend
    // impossible à réintroduire.
    const stores = Array.from(db.objectStoreNames);
    if (!stores.length) return;
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