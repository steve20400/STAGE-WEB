import {
    getMessagesByConversation,
    saveBulkMessages,
    upsertMessage,
    enqueueOfflineMessage,
    getPendingQueue,
    removeFromQueue,
    upsertConversation,
    saveBulkConversations,
    getAllConversations,
    upsertUser,
    saveBulkUsers,
    getUserById,
    getAllUsers,
    upsertAppareil,
    saveBulkAppareils,
    getAppareilsByUser,
    getCurrentAppareil,
    setAppareilOnline,
    setAppareilOffline,
    getPendingByConversation,
} from './messageRepository';

const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000/api';

const getAuthHeaders = () => {
    const token = localStorage.getItem('token') || '';
    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
};

// ═══════════════════════════════════════════════════════════
// MESSAGES — Stratégie Cache-First
// ═══════════════════════════════════════════════════════════

export const fetchChatMessages = async (conversationId, onLocalData, onFreshData) => {
    // ÉTAPE 1 : Lecture locale instantanée (~2ms)
    const localMessages = await getMessagesByConversation(conversationId);
    const pendingMessages = await getPendingByConversation(conversationId);
    const mergedLocal = [...localMessages, ...pendingMessages].sort(
        (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
    );

    if (onLocalData) onLocalData(mergedLocal);

    // ÉTAPE 2 : Synchronisation serveur si en ligne
    if (!navigator.onLine) return mergedLocal;

    try {
        const response = await fetch(`${API_URL}/messages/${conversationId}`, {
            headers: getAuthHeaders(),
        });

        if (response.ok) {
            const serverMessages = await response.json();
            await saveBulkMessages(serverMessages);

            const updatedLocal = await getMessagesByConversation(conversationId);
            const finalMerged = [...updatedLocal, ...pendingMessages].sort(
                (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
            );

            if (onFreshData) onFreshData(finalMerged);
            return finalMerged;
        }
    } catch (error) {
        console.warn('[SyncEngine] Erreur réseau messages:', error);
    }

    return mergedLocal;
};

// ═══════════════════════════════════════════════════════════
// ENVOI OPTIMISTE
// ═══════════════════════════════════════════════════════════

export const sendChatMessage = async (payload, onStatusChange) => {
    const tempId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const optimistic = {
        ...payload,
        id: tempId,
        createdAt: Date.now(),
        status: 'sending',
    };

    // Affichage immédiat
    await upsertMessage(optimistic);
    if (onStatusChange) onStatusChange(optimistic);

    // Hors-ligne → outbox
    if (!navigator.onLine) {
        const pending = await enqueueOfflineMessage(payload);
        const updated = { ...optimistic, status: 'pending', tempId: pending.tempId };
        await upsertMessage(updated);
        if (onStatusChange) onStatusChange(updated);
        return updated;
    }

    // Envoi serveur
    try {
        const res = await fetch(`${API_URL}/messages`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload),
        });

        if (res.ok) {
            const confirmed = await res.json();
            await upsertMessage({ ...confirmed, status: 'sent' });
            if (onStatusChange) onStatusChange({ ...confirmed, status: 'sent' });
            return confirmed;
        }
        throw new Error(`HTTP ${res.status}`);
    } catch (error) {
        console.warn('[SyncEngine] Échec envoi → outbox:', error);
        const pending = await enqueueOfflineMessage(payload);
        const fallback = { ...optimistic, status: 'pending', tempId: pending.tempId };
        await upsertMessage(fallback);
        if (onStatusChange) onStatusChange(fallback);
        return fallback;
    }
};

// ═══════════════════════════════════════════════════════════
// CONVERSATIONS — Cache-First
// ═══════════════════════════════════════════════════════════

export const fetchConversations = async (onLocalData, onFreshData) => {
    const local = await getAllConversations();
    if (onLocalData) onLocalData(local);

    if (!navigator.onLine) return local;

    try {
        const res = await fetch(`${API_URL}/conversations`, {
            headers: getAuthHeaders(),
        });
        if (res.ok) {
            const server = await res.json();
            await saveBulkConversations(server);
            const updated = await getAllConversations();
            if (onFreshData) onFreshData(updated);
            return updated;
        }
    } catch (error) {
        console.warn('[SyncEngine] Erreur réseau conversations:', error);
    }

    return local;
};

// ═══════════════════════════════════════════════════════════
// USERS — Cache-First
// ═══════════════════════════════════════════════════════════

export const fetchUserProfile = async (alanyaID, onLocalData, onFreshData) => {
    const local = await getUserById(alanyaID);
    if (local && onLocalData) onLocalData(local);

    if (!navigator.onLine) return local;

    try {
        const res = await fetch(`${API_URL}/users/${alanyaID}`, {
            headers: getAuthHeaders(),
        });
        if (res.ok) {
            const serverUser = await res.json();
            await upsertUser(serverUser);
            if (onFreshData) onFreshData(serverUser);
            return serverUser;
        }
    } catch (error) {
        console.warn('[SyncEngine] Erreur réseau user:', error);
    }

    return local;
};

export const fetchAllUsers = async (onLocalData, onFreshData) => {
    const local = await getAllUsers();
    if (local.length > 0 && onLocalData) onLocalData(local);

    if (!navigator.onLine) return local;

    try {
        const res = await fetch(`${API_URL}/users`, {
            headers: getAuthHeaders(),
        });
        if (res.ok) {
            const serverUsers = await res.json();
            await saveBulkUsers(serverUsers);
            if (onFreshData) onFreshData(serverUsers);
            return serverUsers;
        }
    } catch (error) {
        console.warn('[SyncEngine] Erreur réseau users:', error);
    }

    return local;
};

// ═══════════════════════════════════════════════════════════
// APPAREIL — Cache-First + Synchronisation
// ═══════════════════════════════════════════════════════════

export const fetchUserAppareils = async (alanyaID, onLocalData, onFreshData) => {
    const local = await getAppareilsByUser(alanyaID);
    if (local.length > 0 && onLocalData) onLocalData(local);

    if (!navigator.onLine) return local;

    try {
        const res = await fetch(`${API_URL}/appareils/user/${alanyaID}`, {
            headers: getAuthHeaders(),
        });
        if (res.ok) {
            const serverAppareils = await res.json();
            await saveBulkAppareils(serverAppareils);
            if (onFreshData) onFreshData(serverAppareils);
            return serverAppareils;
        }
    } catch (error) {
        console.warn('[SyncEngine] Erreur réseau appareils:', error);
    }

    return local;
};

/**
 * Synchronise l'appareil courant avec le backend
 * (appelé au login et au changement de statut en ligne/hors ligne)
 */
export const syncCurrentAppareil = async () => {
    const current = await getCurrentAppareil();
    if (!current) return null;

    if (!navigator.onLine) return current;

    try {
        const res = await fetch(`${API_URL}/appareils/${current.appareilID}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                ...current,
                is_online: navigator.onLine ? 1 : 0,
                lastLogin: new Date().toISOString(),
            }),
        });

        if (res.ok) {
            const updated = await res.json();
            await upsertAppareil(updated);
            return updated;
        }
    } catch (error) {
        console.warn('[SyncEngine] Erreur sync appareil:', error);
    }

    return current;
};

// ═══════════════════════════════════════════════════════════
// OUTBOX — Synchronisation des messages en attente
// ═══════════════════════════════════════════════════════════

export const syncOutboxQueue = async () => {
    if (!navigator.onLine) return { synced: 0, failed: 0, total: 0 };

    const queue = await getPendingQueue();
    if (!queue.length) return { synced: 0, failed: 0, total: 0 };

    let synced = 0;
    let failed = 0;

    for (const item of queue) {
        try {
            const res = await fetch(`${API_URL}/messages`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    conversationId: item.conversationId,
                    senderId: item.senderId,
                    content: item.content,
                    type: item.type || 'text',
                }),
            });

            if (res.ok) {
                const confirmed = await res.json();
                await upsertMessage({ ...confirmed, status: 'sent' });
                await removeFromQueue(item.tempId);
                synced++;
            } else {
                failed++;
            }
        } catch (error) {
            console.warn(`[SyncEngine] Échec sync outbox ${item.tempId}:`, error);
            failed++;
            break; // Stop si réseau instable
        }
    }

    return { synced, failed, total: queue.length };
};

// ═══════════════════════════════════════════════════════════
// INITIALISATION COMPLÈTE AU DÉMARRAGE
// ═══════════════════════════════════════════════════════════

/**
 * Appelé une seule fois au login de l'utilisateur.
 * Charge tout en cache local pour un démarrage instantané.
 */
export const initializeLocalCache = async (alanyaID) => {
    if (!navigator.onLine) {
        console.warn('[SyncEngine] Hors-ligne, utilisation du cache local uniquement');
        return;
    }

    try {
        // Lancer toutes les requêtes en parallèle pour maximiser la vitesse
        await Promise.allSettled([
            fetchUserProfile(alanyaID),
            fetchUserAppareils(alanyaID),
            fetchConversations(),
            fetchAllUsers(),
            syncOutboxQueue(),
            syncCurrentAppareil(),
        ]);

        console.log('[SyncEngine] Cache local initialisé avec succès');
    } catch (error) {
        console.error('[SyncEngine] Erreur lors de l\'initialisation:', error);
    }
};
