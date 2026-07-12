import { useState, useEffect, useCallback } from 'react';
import { getPendingQueue } from '../indexedDB/messageRepository';
import { syncOutboxQueue } from '../indexedDB/syncEngine';

export const useOfflineSync = () => {
    const [pendingCount, setPendingCount] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);

    const refreshCount = useCallback(async () => {
        const pending = await getPendingQueue();
        setPendingCount(pending.length);
    }, []);

    const syncNow = useCallback(async () => {
        if (!navigator.onLine || isSyncing) return;
        setIsSyncing(true);
        try {
            const result = await syncOutboxQueue();
            await refreshCount();
            return result;
        } catch (err) {
            console.error('[OfflineSync] Erreur:', err);
        } finally {
            setIsSyncing(false);
        }
    }, [isSyncing, refreshCount]);

    useEffect(() => {
        refreshCount();

        const handleOnline = () => syncNow();
        window.addEventListener('online', handleOnline);

        if (navigator.onLine) syncNow();

        return () => window.removeEventListener('online', handleOnline);
    }, [refreshCount, syncNow]);

    return { pendingCount, isSyncing, syncNow, refreshCount };
};