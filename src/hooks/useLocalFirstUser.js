import { useState, useEffect, useCallback } from 'react';
import {
    fetchUserProfile,
    fetchUserAppareils,
    syncCurrentAppareil,
} from '../indexedDB/syncEngine';
import {
    getUserById,
    getAppareilsByUser,
    getOnlineAppareilsByUser,
    getActiveAppareilsByUser,
} from '../indexedDB/messageRepository';

/**
 * Hook pour gérer le profil utilisateur + ses appareils en local-first
 */
export const useLocalFirstUser = (alanyaID) => {
    const [user, setUser] = useState(null);
    const [appareils, setAppareils] = useState([]);
    const [onlineAppareils, setOnlineAppareils] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadUser = useCallback(async () => {
        if (!alanyaID) return;

        // Lecture locale instantanée
        const localUser = await getUserById(alanyaID);
        const localAppareils = await getAppareilsByUser(alanyaID);
        const localOnline = await getOnlineAppareilsByUser(alanyaID);

        if (localUser) setUser(localUser);
        if (localAppareils.length > 0) setAppareils(localAppareils);
        if (localOnline.length > 0) setOnlineAppareils(localOnline);

        if (localUser && localAppareils.length > 0) {
            setLoading(false);
        }

        // Synchronisation serveur
        await fetchUserProfile(
            alanyaID,
            null,
            (freshUser) => setUser(freshUser)
        );

        await fetchUserAppareils(
            alanyaID,
            null,
            (freshAppareils) => {
                setAppareils(freshAppareils);
                setOnlineAppareils(freshAppareils.filter((a) => a.is_online === 1));
            }
        );

        setLoading(false);
    }, [alanyaID]);

    useEffect(() => {
        loadUser();
    }, [loadUser]);

    // Synchroniser l'appareil courant au montage
    useEffect(() => {
        syncCurrentAppareil();

        const handleOnline = () => syncCurrentAppareil();
        const handleOffline = () => syncCurrentAppareil();

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return {
        user,
        appareils,
        onlineAppareils,
        loading,
        refreshUser: loadUser,
    };
};