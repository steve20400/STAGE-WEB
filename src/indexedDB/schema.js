import { openDB } from 'idb';

const DB_NAME = 'alanya_messaging_client_db';
const DB_VERSION = 4; // Incrémenté pour le magasin traductions

/**
 * Connexion unique, partagee par tout le client.
 *
 * `openDB` etait rappele a chaque acces — et le cache des traductions en fait
 * trois par message. Chaque appel ouvrait une connexion neuve : autant de
 * poignees sur la meme base, et surtout autant de demandes de mise a jour de
 * version en attente les unes derriere les autres. On memoise donc la promesse.
 */
let connexion = null;

export const initIndexedDB = () => {
    if (connexion) return connexion;
    connexion = openDB(DB_NAME, DB_VERSION, {
        /**
         * Un ONGLET RESTE OUVERT sur l'ancienne version : sans ce gestionnaire,
         * la mise a jour ne se fait jamais et l'ouverture reste en suspens
         * indefiniment — l'application demarre sur une base qui ne repond pas.
         * On previent plutot que d'attendre en silence.
         */
        blocked() {
            // eslint-disable-next-line no-console
            console.warn('[idb] mise a jour bloquee par un autre onglet ouvert sur l ancienne version');
        },
        /** Un autre onglet veut monter de version : on libere la place. */
        blocking(currentVersion, blockedVersion, event) {
            connexion = null;
            event.target?.close?.();
        },
        /** Connexion fermee par le navigateur : la prochaine demande en rouvrira une. */
        terminated() {
            connexion = null;
        },
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

            // Traductions de messages, classées par empreinte du CONTENU et non
            // par identifiant de message : `saveBulkMessages` et
            // `cacheBackendMessages` réécrivent l'objet message entier à chaque
            // ouverture de conversation, une colonne portée par `messages`
            // serait donc effacée en permanence. L'empreinte en tête de clé
            // permet en plus de supprimer toutes les cibles d'un même texte par
            // plage, et rend l'invalidation structurelle : un message édité
            // change d'empreinte, donc de clé.
            if (!db.objectStoreNames.contains('traductions')) {
                const tradStore = db.createObjectStore('traductions', { keyPath: 'cle' });
                // Éviction LRU, sur le modèle de l'index cachedAt de previewMedia.
                tradStore.createIndex('luLe', 'luLe');
                // Purge d'une langue cible entière quand l'utilisateur en accumule trop.
                tradStore.createIndex('cible', 'cible');
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
    // Une ouverture qui echoue ne doit pas rester en cache : sinon toute la
    // session retomberait sur la meme promesse rejetee.
    connexion.catch(() => {
        connexion = null;
    });
    return connexion;
};