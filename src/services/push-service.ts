import { initializeApp } from "firebase/app";
import { getMessaging, getToken, deleteToken, onMessage, type MessagePayload } from "firebase/messaging";
import { apiRequest } from "../lib/api-client";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let messaging: ReturnType<typeof getMessaging> | null = null;
let onMessageUnsubscribe: (() => void) | null = null;

function getFirebaseMessaging(): ReturnType<typeof getMessaging> | null {
  if (messaging) return messaging;

  const { apiKey, projectId, messagingSenderId } = firebaseConfig;
  if (!apiKey || !projectId || !messagingSenderId) {
    console.warn("[Push] Firebase config is incomplete. Web Push Notifications will be disabled.");
    return null;
  }

  try {
    const app = initializeApp(firebaseConfig);
    messaging = getMessaging(app);
    return messaging;
  } catch (error) {
    console.error("[Push] Error initializing Firebase:", error);
    return null;
  }
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Workers are not supported in this browser.");
  }

  const { apiKey, authDomain, projectId, messagingSenderId, appId } = firebaseConfig;
  const swUrl =
    `/firebase-messaging-sw.js` +
    `?apiKey=${encodeURIComponent(apiKey || "")}` +
    `&authDomain=${encodeURIComponent(authDomain || "")}` +
    `&projectId=${encodeURIComponent(projectId || "")}` +
    `&messagingSenderId=${encodeURIComponent(messagingSenderId || "")}` +
    `&appId=${encodeURIComponent(appId || "")}`;

  try {
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: "/",
    });
    console.log("[Push] Service Worker registered successfully:", registration);
    return registration;
  } catch (error) {
    console.error("[Push] Service Worker registration failed:", error);
    throw error;
  }
}

export async function initPushNotifications(): Promise<void> {
  if (typeof window === "undefined") return;

  const msging = getFirebaseMessaging();
  if (!msging) return;

  try {
    // 1. Demande de permission
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.log("[Push] Notification permission denied.");
        return;
      }
    } else if (Notification.permission === "denied") {
      console.warn("[Push] Notification permission is denied. Enable it in settings.");
      return;
    }

    // 2. Enregistrement du Service Worker
    const registration = await registerServiceWorker();

    // 3. Récupération du Token FCM
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.warn("[Push] VITE_FIREBASE_VAPID_KEY is missing. Cannot request FCM token.");
      return;
    }

    const token = await getToken(msging, {
      serviceWorkerRegistration: registration,
      vapidKey,
    });

    if (token) {
      console.log("[Push] FCM Token generated:", token);
      
      // 4. Envoi du token au backend
      await apiRequest("/api/push/register", {
        method: "POST",
        body: { token, platform: "web" },
      });
      console.log("[Push] Token registered successfully on backend.");
    } else {
      console.warn("[Push] No FCM token returned.");
    }

    // 5. Gestion des messages au premier plan (Foreground)
    if (onMessageUnsubscribe) {
      onMessageUnsubscribe();
    }

    onMessageUnsubscribe = onMessage(msging, (payload: MessagePayload) => {
      console.log("[Push] Foreground message received:", payload);
      
      const title = payload.notification?.title || payload.data?.title || "Nouveau message";
      const body = payload.notification?.body || payload.data?.body || "";
      
      const options: NotificationOptions = {
        body,
        icon: "/alanya-logo.jpeg",
        badge: "/alanya-logo.jpeg",
        data: payload.data,
      };

      const notification = new Notification(title, options);
      notification.onclick = (e) => {
        e.preventDefault();
        notification.close();
        
        const data = payload.data;
        if (!data) return;

        let targetUrl = "/chats";
        if (data.type === "message" && data.convId) {
          targetUrl = `/chats/${data.convId}`;
        } else if (data.type === "incoming_call" && data.callId) {
          targetUrl = `/calls/${data.callId}`;
        }

        window.location.href = targetUrl;
      };
    });

  } catch (error) {
    console.error("[Push] Failed to initialize push notifications:", error);
  }
}

export async function unregisterPush(): Promise<void> {
  if (typeof window === "undefined") return;

  const msging = getFirebaseMessaging();
  if (!msging) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return;

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    const token = await getToken(msging, {
      serviceWorkerRegistration: registration,
      vapidKey,
    });

    if (token) {
      // 1. Suppression côté backend
      await apiRequest(`/api/push/register?token=${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
      console.log("[Push] Token deleted from backend.");
    }

    // 2. Suppression côté Firebase client
    await deleteToken(msging);
    console.log("[Push] Token deleted from client.");

    if (onMessageUnsubscribe) {
      onMessageUnsubscribe();
      onMessageUnsubscribe = null;
    }
  } catch (error) {
    console.error("[Push] Failed to unregister push notifications:", error);
  }
}
