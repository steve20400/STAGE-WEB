import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    fetchChatMessages,
    sendChatMessage,
    syncOutboxQueue,
} from '../indexedDB/syncEngine';
import { upsertMessage } from '../indexedDB/messageRepository';

export const useLocalFirstChat = (conversationId) => {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadMessages = useCallback(async () => {
        if (!conversationId) {
            setMessages([]);
            setLoading(false);
            return;
        }

        await fetchChatMessages(
            conversationId,
            (localData) => {
                setMessages(localData);
                if (localData.length > 0) setLoading(false);
            },
            (freshData) => {
                setMessages(freshData);
                setLoading(false);
            }
        );
    }, [conversationId]);

    useEffect(() => {
        loadMessages();
    }, [loadMessages]);

    const handleSendMessage = useCallback(
        async (payload) => {
            const tempMsg = {
                ...payload,
                id: `tmp_${Date.now()}`,
                createdAt: Date.now(),
                status: 'sending',
            };

            setMessages((prev) => [...prev, tempMsg]);

            await sendChatMessage(payload, (updated) => {
                setMessages((prev) =>
                    prev.map((m) =>
                        m.id === tempMsg.id || m.tempId === updated.tempId ? updated : m
                    )
                );
            });
        },
        []
    );

    const handleIncomingSocketMessage = useCallback(
        async (socketMessage) => {
            await upsertMessage(socketMessage);
            if (socketMessage.conversationId === conversationId) {
                setMessages((prev) => {
                    if (prev.some((m) => m.id === socketMessage.id)) return prev;
                    return [...prev, socketMessage].sort(
                        (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
                    );
                });
            }
        },
        [conversationId]
    );

    useEffect(() => {
        const handleOnline = () => {
            syncOutboxQueue().then(() => loadMessages());
        };
        window.addEventListener('online', handleOnline);
        return () => window.removeEventListener('online', handleOnline);
    }, [loadMessages]);

    const sortedMessages = useMemo(
        () => [...messages].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
        [messages]
    );

    return {
        messages: sortedMessages,
        loading,
        handleSendMessage,
        handleIncomingSocketMessage,
        refreshChat: loadMessages,
    };
};