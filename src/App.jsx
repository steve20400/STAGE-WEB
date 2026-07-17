import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './components/auth-provider';
import { getOfflineQueue, dequeueOffline } from './services/indexeddb-cache';

/**
 * App.jsx — Contrôleur additionnel : protection de routes + drain de l'outbox
 * au retour en ligne.
 *
 * NOTE : Ce composant n'est PAS le point d'entrée du routage (c'est main.tsx).
 * Il sert de middleware global pour la navigation et la synchronisation offline.
 */
export default function App() {
    const location = useLocation();
    const navigate = useNavigate();
    const { token, accountStatus } = useAuth();
    const isMounted = useRef(false);

    // Drain de la file d'attente offline au retour en ligne
    useEffect(() => {
        const drainOfflineQueue = async () => {
            try {
                const pending = await getOfflineQueue();
                if (pending.length === 0) return;
                // eslint-disable-next-line no-console
                console.log(`[App] Draining ${pending.length} offline message(s)...`);
                for (const msg of pending) {
                    try {
                        // Tente d'envoyer via le service REST
                        const { apiRequest } = await import('./lib/api-client');
                        await apiRequest(`/api/conversations/${msg.conversationId}/messages`, {
                            method: 'POST',
                            body: {
                                content: msg.content || undefined,
                                type: msg.type || 'TEXT',
                                mediaId: msg.mediaId,
                                replyToId: msg.replyToId,
                            },
                        });
                        // Supprime de l'outbox après envoi réussi
                        if (msg.tempId) {
                            await dequeueOffline(msg.tempId);
                        }
                    } catch (err) {
                        // eslint-disable-next-line no-console
                        console.warn('[App] Failed to drain message:', err);
                        // On arrête au premier échec (le réseau est probablement instable)
                        break;
                    }
                }
            } catch {
                // IndexedDB indisponible
            }
        };

        const handleOnline = () => {
            void drainOfflineQueue();
        };

        // Drain immédiat si déjà en ligne au montage
        if (navigator.onLine) {
            void drainOfflineQueue();
        }

        window.addEventListener('online', handleOnline);
        return () => window.removeEventListener('online', handleOnline);
    }, []);

    // Initialisation des notifications push FCM quand le token d'authentification change
    const pushInitialized = useRef(false);
    useEffect(() => {
        if (token && !pushInitialized.current) {
            pushInitialized.current = true;
            import('./services/push-service')
                .then(({ initPushNotifications }) => {
                    void initPushNotifications();
                })
                .catch((err) => {
                    // eslint-disable-next-line no-console
                    console.error('[App] Failed to load push service:', err);
                });
        } else if (!token) {
            pushInitialized.current = false;
        }
    }, [token]);

    // Protection des routes (inchangée)
    useEffect(() => {
        if (!isMounted.current) {
            isMounted.current = true;
            return;
        }
    }, [location]);

    // Middleware de protection des routes et gestion de l'état
    useEffect(() => {
        const protectedRoutes = ['/chats', '/ai', '/settings', '/contacts', '/status', '/calls'];
        const publicRoutes = ['/welcome', '/login', '/signup', '/forgot-password'];

        const isProtected = protectedRoutes.some((route) => location.pathname.startsWith(route));
        const isPublic = publicRoutes.some((route) => location.pathname.startsWith(route));

        if (isProtected) {
            // Si route protégée, il faut un token valide
            if (!token) {
                // Pas de token => aller vers login
                navigate('/login');
            } else {
                // Token présent, on vérifie l'état du compte
                if (accountStatus === 'unregistered') {
                    // Si non enregistré, rediriger vers l'enregistrement ou l'accueil
                    navigate('/welcome');
                } else if (accountStatus === 'pending') {
                    // Si en attente, rediriger vers la page d'attente ou l'accueil
                    // On garde quand même accès aux autres routes publiques/protégées
                }
            }
        } else if (isPublic && token) {
            // Si route publique et token présent, aller vers le dashboard
            navigate('/chats');
        }
    }, [location.pathname, token, accountStatus, navigate]);

    return null;
}