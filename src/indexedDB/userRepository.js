import { initIndexedDB } from './schema';

// ═══════════════════════════════════════════════════════════
// USERS — CRUD complet
// ═══════════════════════════════════════════════════════════

/**
 * Sauvegarde ou met à jour un utilisateur
 * @param {Object} user - { alanyaID, typeCompte }
 */
export const upsertUser = async (user) => {
    const db = await initIndexedDB();
    await db.put('users', user);
};

/**
 * Sauvegarde en masse (ex: liste des contacts)
 */
export const saveBulkUsers = async (users = []) => {
    if (!users.length) return;
    const db = await initIndexedDB();
    const tx = db.transaction('users', 'readwrite');
    await Promise.all([
        ...users.map((u) => tx.store.put(u)),
        tx.done,
    ]);
};

/**
 * Récupère un utilisateur par son ID
 */
export const getUserById = async (alanyaID) => {
    const db = await initIndexedDB();
    return db.get('users', alanyaID);
};

/**
 * Récupère tous les utilisateurs
 */
export const getAllUsers = async () => {
    const db = await initIndexedDB();
    return db.getAll('users');
};

/**
 * Filtre les utilisateurs par type de compte
 * @param {number} typeCompte - 0 = user, 1 = admin, etc.
 */
export const getUsersByType = async (typeCompte) => {
    const db = await initIndexedDB();
    return db.getAllFromIndex('users', 'typeCompte', typeCompte);
};

/**
 * Supprime un utilisateur
 */
export const deleteUser = async (alanyaID) => {
    const db = await initIndexedDB();
    await db.delete('users', alanyaID);
};

// ═══════════════════════════════════════════════════════════
// APPAREIL — CRUD complet
// ═══════════════════════════════════════════════════════════

/**
 * Sauvegarde ou met à jour un appareil
 * @param {Object} appareil
 * {
 *   appareilID: number,
 *   cookies_WebID: string,
 *   libelle: string,
 *   is_online: 0 | 1,
 *   create_at: string (ISO datetime),
 *   typeDevice: number,
 *   lastLogin: string (ISO datetime),
 *   system: string,
 *   alanyaID: number (FK vers users),
 *   destroy: 0 | 1
 * }
 */
export const upsertAppareil = async (appareil) => {
    const db = await initIndexedDB();
    await db.put('Appareil', appareil);
};

/**
 * Sauvegarde en masse des appareils
 */
export const saveBulkAppareils = async (appareils = []) => {
    if (!appareils.length) return;
    const db = await initIndexedDB();
    const tx = db.transaction('Appareil', 'readwrite');
    await Promise.all([
        ...appareils.map((a) => tx.store.put(a)),
        tx.done,
    ]);
};

/**
 * Récupère un appareil par son ID
 */
export const getAppareilById = async (appareilID) => {
    const db = await initIndexedDB();
    return db.get('Appareil', appareilID);
};

/**
 * Récupère tous les appareils d'un utilisateur
 */
export const getAppareilsByUser = async (alanyaID) => {
    const db = await initIndexedDB();
    return db.getAllFromIndex('Appareil', 'alanyaID', alanyaID);
};

/**
 * Récupère les appareils EN LIGNE d'un utilisateur (index composite)
 */
export const getOnlineAppareilsByUser = async (alanyaID) => {
    const db = await initIndexedDB();
    const tx = db.transaction('Appareil', 'readonly');
    const index = tx.store.index('by_user_online');
    const range = IDBKeyRange.only([alanyaID, 1]);
    const result = await index.getAll(range);
    await tx.done;
    return result;
};

/**
 * Récupère les appareils ACTIFS (non détruits) d'un utilisateur
 */
export const getActiveAppareilsByUser = async (alanyaID) => {
    const db = await initIndexedDB();
    const tx = db.transaction('Appareil', 'readonly');
    const index = tx.store.index('by_user_active');
    const range = IDBKeyRange.only([alanyaID, 0]);
    const result = await index.getAll(range);
    await tx.done;
    return result;
};

/**
 * Récupère tous les appareils en ligne (tous utilisateurs)
 */
export const getAllOnlineAppareils = async () => {
    const db = await initIndexedDB();
    return db.getAllFromIndex('Appareil', 'is_online', 1);
};

/**
 * Marque un appareil comme hors ligne
 */
export const setAppareilOffline = async (appareilID) => {
    const db = await initIndexedDB();
    const appareil = await db.get('Appareil', appareilID);
    if (appareil) {
        appareil.is_online = 0;
        appareil.lastLogin = new Date().toISOString();
        await db.put('Appareil', appareil);
    }
};

/**
 * Marque un appareil comme en ligne
 */
export const setAppareilOnline = async (appareilID) => {
    const db = await initIndexedDB();
    const appareil = await db.get('Appareil', appareilID);
    if (appareil) {
        appareil.is_online = 1;
        appareil.lastLogin = new Date().toISOString();
        await db.put('Appareil', appareil);
    }
};

/**
 * Marque un appareil comme détruit (soft delete)
 */
export const destroyAppareil = async (appareilID) => {
    const db = await initIndexedDB();
    const appareil = await db.get('Appareil', appareilID);
    if (appareil) {
        appareil.destroy = 1;
        appareil.is_online = 0;
        await db.put('Appareil', appareil);
    }
};

/**
 * Supprime définitivement un appareil
 */
export const deleteAppareil = async (appareilID) => {
    const db = await initIndexedDB();
    await db.delete('Appareil', appareilID);
};

/**
 * Récupère l'appareil courant (celui du navigateur actuel)
 * via le cookies_WebID stocké en localStorage
 */
export const getCurrentAppareil = async () => {
    const cookiesWebID = localStorage.getItem('cookies_WebID');
    if (!cookiesWebID) return null;

    const db = await initIndexedDB();
    const all = await db.getAll('Appareil');
    return all.find((a) => a.cookies_WebID === cookiesWebID) || null;
};