import { useEffect, useRef, useCallback, useState } from 'react';
import { upsertMessage, upsertAppareil } from '../indexedDB/messageRepository';

export const useWebSocket = (url, { onMessage, autoReconnect = true } = {}) => {
    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const reconnectAttemptsRef = useRef(0);
    const [status, setStatus] = useState('disconnected');
    const maxAttempts = 10;

    const connect = useCallback(() => {
        if (!url) return;
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        try {
            setStatus('connecting');
            const socket = new WebSocket(url);
            wsRef.current = socket;

            socket.onopen = () => {
                setStatus('connected');
                reconnectAttemptsRef.current = 0;
            };

            socket.onmessage = async (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // Sauvegarde automatique en IndexedDB selon le type d'événement
                    if (data?.type === 'new_message' && data.payload) {
                        await upsertMessage({ ...data.payload, status: 'sent' });
                    }

                    if (data?.type === 'appareil_status' && data.payload) {
                        await upsertAppareil(data.payload);
                    }

                    if (onMessage) onMessage(data);
                } catch (err) {
                    console.error('[WebSocket] Erreur parsing:', err);
                }
            };

            socket.onclose = () => {
                setStatus('disconnected');
                if (autoReconnect && reconnectAttemptsRef.current < maxAttempts) {
                    const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);
                    reconnectAttemptsRef.current++;
                    reconnectTimeoutRef.current = setTimeout(connect, delay);
                }
            };

            socket.onerror = (err) => {
                console.error('[WebSocket] Erreur:', err);
                socket.close();
            };
        } catch (err) {
            console.error('[WebSocket] Impossible de connecter:', err);
            setStatus('disconnected');
        }
    }, [url, onMessage, autoReconnect]);

    const send = useCallback((payload) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(payload));
            return true;
        }
        return false;
    }, []);

    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        if (wsRef.current) wsRef.current.close();
        setStatus('disconnected');
    }, []);

    useEffect(() => {
        connect();
        return () => disconnect();
    }, [connect, disconnect]);

    return { status, send, connect, disconnect };
};