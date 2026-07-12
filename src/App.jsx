import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useWebSocket } from './hooks/useWebSocket';
import { useOfflineSync } from './hooks/useOfflineSync';
import { API_BASE_URL } from './config/config';

export default function App() {
    const location = useLocation();
    const navigate = useNavigate();
    const { token, deviceId, userId, accountStatus } = useAuth();
    const { status: wsStatus, send: sendWs, disconnect: disconnectWs } = useWebSocket(
        API_BASE_URL ? `ws://${API_BASE_URL.replace('http', '')}/ws/` : null
    );
    const { pendingCount, isSyncing, syncNow, refreshCount } = useOfflineSync();
    const isMounted = useRef(false);

    // WebSockets : connexion et écoute
    useEffect(() => {
        if (token && userId && deviceId) {
            // Construire le WS URL avec les infos de session
            const wsUrl = `${API_BASE_URL.replace('http', 'ws')}?token=${token}&device_id=${deviceId}`;
            disconnectWs(); // Déconnecter avant de reconnecter

            // On passe un callback pour gérer les messages
            const handleWsMessage = (data) => {
                // data est déjà traitée par useWebSocket + indexedDB, ici on peut juste
                // rafraîchir l'UI si nécessaire
                console.log('[App] WS message:', data);
            };

            const { status, send, connect, disconnect } = useWebSocket(wsUrl, {
                onMessage: handleWsMessage,
            });

            if (status === 'connected') {
                console.log('[App] WebSocket connecté');
            }

            // Expose pour le contexte global si besoin
            window._wsSend = send;

            return () => disconnect();
        }
    }, [token, userId, deviceId, disconnectWs]);

    // Sync : en ligne => sync, en ligne => refresh
    useEffect(() => {
        if (navigator.onLine) {
            syncNow();
            // Refresh count en ligne
            refreshCount();
        }
    }, [navigator.onLine, syncNow, refreshCount]);

    // Empêcher le refresh total de la page lors des changements d'URL
    useEffect(() => {
        if (isMounted.current) {
            // Empêcher le refresh total
            event.preventDefault();
        } else {
            isMounted.current = true;
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