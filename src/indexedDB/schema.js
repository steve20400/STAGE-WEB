import { openDB } from 'idb';

const DB_NAME = 'alanya_messaging_client_db';
const DB_VERSION = 3; // Incrémenté pour la migration avec Appareil + users

export const initIndexedDB = () => {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion, transaction) {

            // ═══════════════════════════════════════════════════
            // STORE : users (Profil utilisateur backend-alanya)
            // ═══════════════════════════════════════════════════
            if (!db.objectStoreNames.contains('users')) {
                const userStore = db.createObjectStore('users', {
                    keyPath: 'alanyaID',
                    autoIncrement: false,
                });
                userStore.createIndex('typeCompte', 'typeCompte');
            }

            // ═══════════════════════════════════════════════════
            // STORE : Appareil (Sessions / Devices)
            // ═══════════════════════════════════════════════════
            if (!db.objectStoreNames.contains('Appareil')) {
                const appareilStore = db.createObjectStore('Appareil', {
                    keyPath: 'appareilID',
                    autoIncrement: false,
                });
                appareilStore.createIndex('alanyaID', 'alanyaID');
                appareilStore.createIndex('is_online', 'is_online');
                appareilStore.createIndex('lastLogin', 'lastLogin');
                appareilStore.createIndex('typeDevice', 'typeDevice');
                appareilStore.createIndex('destroy', 'destroy');
                // Index composite : appareils en ligne d'un utilisateur
                appareilStore.createIndex('by_user_online', ['alanyaID', 'is_online']);
                // Index composite : appareils actifs (non détruits) d'un utilisateur
                appareilStore.createIndex('by_user_active', ['alanyaID', 'destroy']);
            }

            // ═══════════════════════════════════════════════════
            // STORE : conversations
            // ═══════════════════════════════════════════════════
            if (!db.objectStoreNames.contains('conversations')) {
                const convStore = db.createObjectStore('conversations', {
                    keyPath: 'id',
                });
                convStore.createIndex('updatedAt', 'updatedAt');
            }

            // ═══════════════════════════════════════════════════
            // STORE : messages
            // ═══════════════════════════════════════════════════
            if (!db.objectStoreNames.contains('messages')) {
                const msgStore = db.createObjectStore('messages', {
                    keyPath: 'id',
                });
                msgStore.createIndex('conversationId', 'conversationId');
                msgStore.createIndex('createdAt', 'createdAt');
                msgStore.createIndex('by_conversation_and_date', ['conversationId', 'createdAt']);
            }

            // ═══════════════════════════════════════════════════
            // STORE : outboxQueue (Messages en attente d'envoi)
            // ═══════════════════════════════════════════════════
            if (!db.objectStoreNames.contains('outboxQueue')) {
                const outboxStore = db.createObjectStore('outboxQueue', {
                    keyPath: 'tempId',
                });
                outboxStore.createIndex('conversationId', 'conversationId');
                outboxStore.createIndex('createdAt', 'createdAt');
            }

            // Fichiers nécessaires aux aperçus (texte/PDF) : conservés localement
            // pour éviter les rechargements à chaque ouverture de conversation.
            if (!db.objectStoreNames.contains('previewMedia')) {
                const previewStore = db.createObjectStore('previewMedia', { keyPath: 'key' });
                previewStore.createIndex('cachedAt', 'cachedAt');
            }

            // ═══════════════════════════════════════════════════
            // STORE : callLogs (Historique d'appels WebRTC)
            // ═══════════════════════════════════════════════════
            if (!db.objectStoreNames.contains('callLogs')) {
                const callStore = db.createObjectStore('callLogs', {
                    keyPath: 'id',
                });
                callStore.createIndex('conversationId', 'conversationId');
                callStore.createIndex('startedAt', 'startedAt');
                callStore.createIndex('alanyaID', 'alanyaID');
            }
        },
    });
};