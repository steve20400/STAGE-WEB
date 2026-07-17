// Service Worker dédié à Firebase Cloud Messaging (FCM).
// Importe les scripts Firebase de compatibilité (compat) depuis le CDN.
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Récupère la configuration Firebase depuis les paramètres d'URL (injectés lors de l'enregistrement)
const urlParams = new URLSearchParams(location.search);
const apiKey = urlParams.get('apiKey');
const authDomain = urlParams.get('authDomain');
const projectId = urlParams.get('projectId');
const messagingSenderId = urlParams.get('messagingSenderId');
const appId = urlParams.get('appId');

if (apiKey && projectId && messagingSenderId) {
  firebase.initializeApp({
    apiKey,
    authDomain,
    projectId,
    messagingSenderId,
    appId
  });

  const messaging = firebase.messaging();

  // Handler d'arrière-plan pour les messages FCM
  messaging.onBackgroundMessage((payload) => {
    console.log('[sw] Message push reçu en arrière-plan:', payload);

    // Si le payload contient déjà une notification formatée par FCM, le navigateur l'affiche automatiquement.
    // Sinon (ou en cas de payload de données pures "data"), on la construit manuellement :
    if (payload.data && !payload.notification) {
      const title = payload.data.title || 'Nouveau message';
      const options = {
        body: payload.data.body || 'Vous avez reçu une notification',
        icon: '/alanya-logo.jpeg',
        badge: '/alanya-logo.jpeg',
        data: payload.data // On passe tout le payload pour le clic handler
      };

      self.registration.showNotification(title, options);
    }
  });
} else {
  console.warn('[sw] Configuration Firebase manquante dans les paramètres d\'URL du Service Worker.');
}

// Handler de clic sur la notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data;
  if (!data) return;

  let targetUrl = '/chats';
  if (data.type === 'message' && data.convId) {
    targetUrl = `/chats/${data.convId}`;
  } else if (data.type === 'incoming_call' && data.callId) {
    targetUrl = `/calls/${data.callId}`;
  }

  // Cherche si un onglet de l'app est déjà ouvert pour le focus, sinon ouvre une nouvelle fenêtre
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        // Si l'onglet est déjà sur notre domaine
        if (client.url.includes(location.origin)) {
          return client.navigate(targetUrl).then((c) => c.focus());
        }
      }
      // Sinon on ouvre un nouvel onglet
      return clients.openWindow(targetUrl);
    })
  );
});
