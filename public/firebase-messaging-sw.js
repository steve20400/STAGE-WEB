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
        body: sansMarqueurs(payload.data.body || 'Vous avez reçu une notification'),
        // Relatif au service, donc sous /webapp/ : '/alanya-logo.jpeg' visait la
        // racine du domaine, ou l'image n'existe pas.
        icon: 'icone-192.png',
        badge: 'icone-192.png',
        data: payload.data // On passe tout le payload pour le clic handler
      };

      self.registration.showNotification(title, options);
    }
  });
} else {
  console.warn('[sw] Configuration Firebase manquante dans les paramètres d\'URL du Service Worker.');
}

/*
 * Retire les marqueurs de mise en forme (*gras*, _italique_, ~barre~,
 * __souligne__, `manuscrit`) : une notification n'affiche pas de style.
 *
 * ⚠️ COPIE de `src/lib/mise-en-forme.ts` (même algorithme, même ordre de
 * priorité) : un service worker ne peut pas importer les modules de l'appli.
 * Toute évolution des marqueurs doit être reportée ici.
 */
function sansMarqueurs(source) {
  const codes = ['__', '*', '_', '~', '`'];
  const analyse = (s, debut, fin) => {
    let sortie = '';
    let i = debut;
    while (i < fin) {
      let trouve = false;
      for (const code of codes) {
        const n = code.length;
        if (i + n <= fin && s.startsWith(code, i) && i + n + 1 <= fin - n) {
          let fermeture = -1;
          for (let j = i + n + 1; j <= fin - n; j++) {
            if (s.startsWith(code, j)) { fermeture = j; break; }
          }
          if (fermeture !== -1) {
            sortie += analyse(s, i + n, fermeture);
            i = fermeture + n;
            trouve = true;
            break;
          }
        }
      }
      if (!trouve) { sortie += s[i]; i++; }
    }
    return sortie;
  };
  return analyse(source, 0, source.length);
}

// Handler de clic sur la notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data;
  if (!data) return;

  // ⚠️ Relatif à la PORTÉE du service worker : sous /webapp/, une adresse
  // absolue « /chats » menait à la racine du domaine, hors de l'application.
  let targetUrl = new URL('chats', self.registration.scope).href;
  if (data.type === 'message' && data.convId) {
    targetUrl = new URL(`chats/${data.convId}`, self.registration.scope).href;
  } else if (data.type === 'incoming_call' && data.callId) {
    targetUrl = new URL(`calls/${data.callId}`, self.registration.scope).href;
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

/*
 * ══════════════ RECEVOIR UN PARTAGE (07/10/2026) ══════════════
 *
 * Demande du user : « quand on est dans WhatsApp et qu'on veut partager un
 * document, Alanya n'apparaît pas dans la liste des applications ». Le
 * manifeste déclare désormais la web-app comme CIBLE DE PARTAGE
 * (`share_target`) : une fois installée sur le téléphone, elle figure dans la
 * feuille de partage du système, à côté de WhatsApp et de Telegram.
 *
 * Le système nous ENVOIE alors le partage : un POST multipart vers
 * `partage-recu`, avec le texte et les fichiers. Aucun serveur ne doit le
 * recevoir — les fichiers restent sur le téléphone tant que l'utilisateur n'a
 * pas choisi une discussion. Ce service worker les range dans le cache du
 * navigateur, puis renvoie vers la page qui demande « dans quelle discussion ? ».
 *
 * ⚠️ RIEN D'AUTRE N'EST INTERCEPTÉ. Toute autre requête passe sans
 * `respondWith`, donc exactement comme sans service worker : ce fichier sert
 * d'abord aux notifications, et une erreur ici ne doit rien casser d'autre.
 */
const CACHE_PARTAGE = 'alanya-partage-recu';

self.addEventListener('fetch', (event) => {
  const requete = event.request;
  if (requete.method !== 'POST') return;
  const adresse = new URL(requete.url);
  const cible = new URL('partage-recu', self.registration.scope);
  if (adresse.origin !== cible.origin || adresse.pathname !== cible.pathname) return;

  event.respondWith((async () => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try {
      const formulaire = await requete.formData();
      const texte = ['title', 'text', 'url']
        .map((champ) => formulaire.get(champ))
        .filter((v) => typeof v === 'string' && v.trim() !== '')
        .join('\n');
      const fichiers = formulaire.getAll('fichiers').filter((f) => f instanceof File);
      const cache = await caches.open(CACHE_PARTAGE);
      const meta = { id, texte, fichiers: [] };
      for (let i = 0; i < fichiers.length; i += 1) {
        const f = fichiers[i];
        const cle = new URL(`partage-recu/${id}/${i}`, self.registration.scope).href;
        await cache.put(cle, new Response(f, {
          headers: { 'Content-Type': f.type || 'application/octet-stream' },
        }));
        meta.fichiers.push({ cle, nom: f.name, type: f.type || 'application/octet-stream' });
      }
      await cache.put(
        new URL(`partage-recu/${id}/meta`, self.registration.scope).href,
        new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } })
      );
    } catch (erreur) {
      console.warn('[sw] partage reçu illisible :', erreur);
    }
    // 303 : le navigateur suit en GET, la page lit le cache.
    return Response.redirect(new URL(`partage-recu?id=${id}`, self.registration.scope).href, 303);
  })());
});
