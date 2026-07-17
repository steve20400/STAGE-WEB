# Comment fonctionne l'installation de l'application Alanya (PWA) ?

Lorsque vous ouvrez l'application Alanya sur un smartphone Android ou iOS, le navigateur vous propose désormais d'**Installer** l'application plutôt que de simplement "Ajouter un raccourci".

Ce comportement est dû à sa transformation en **PWA (Progressive Web App)**. Voici l'explication simple et technique de ce mécanisme.

---

## 1. Les 3 critères de l'installabilité PWA

Pour qu'un navigateur mobile (comme Chrome ou Safari) propose l'installation native d'un site web sous forme d'application, il exige 3 critères stricts. Nous les avons tous remplis lors de l'intégration des notifications :

### 📱 A. Le Manifeste Web (`manifest.json`)
C'est la carte d'identité de l'application. Sans elle, le navigateur ne sait pas comment afficher l'application sur le téléphone.
Nous l'avons déclaré dans la page principale `index.html` :
```html
<link rel="manifest" href="/manifest.json" />
```
Le fichier [manifest.json](file:///home/steve/Documents/stage%20web/projet-alanya/public/manifest.json) contient :
* **`name` & `short_name`** : Le nom complet de l'application qui apparaîtra sous l'icône sur l'écran d'accueil.
* **`icons`** : Les images (logos) qui seront utilisées pour l'icône de l'application et l'écran de chargement.
* **`display: "standalone"`** : Indique au téléphone d'ouvrir l'application dans sa propre fenêtre, **sans la barre d'adresse du navigateur**, ce qui donne l'illusion d'une application native téléchargée sur le Play Store.
* **`start_url`** : La page par laquelle l'application doit démarrer à l'ouverture (la racine `/`).

### ⚙️ B. Le Service Worker (`firebase-messaging-sw.js`)
Un Service Worker est un script Javascript qui s'exécute en tâche de fond dans le navigateur, indépendamment de l'application ouverte.
* Il est obligatoire pour justifier le statut de PWA (car il permet théoriquement le fonctionnement hors-ligne ou le cache).
* Dans notre cas, il sert à **écouter et recevoir les notifications push FCM** même quand le navigateur est fermé.

### 🔒 C. Une connexion sécurisée (HTTPS ou Localhost)
Les navigateurs bloquent l'installation PWA si le site est servi en HTTP simple pour des raisons de sécurité.
* En développement local, **localhost** est autorisé.
* En production, le déploiement sur **Vercel** fournit automatiquement un certificat SSL (HTTPS), ce qui active immédiatement la détection PWA.

---

## 2. Que se passe-t-il lorsque l'utilisateur installe l'application ?

| Étape | Comportement sur le téléphone |
| :--- | :--- |
| **1. Détection** | Le navigateur détecte le couple `manifest.json` + `Service Worker` actif. |
| **2. Invitation** | Une bannière ou un bouton "Installer l'application" apparaît (ex: dans la barre de recherche Chrome). |
| **3. Installation** | Le système télécharge l'icône et crée un conteneur d'application. *Cela prend 2 secondes et ne consomme pas d'espace de stockage (contrairement à un fichier APK/IPA de 50 Mo)*. |
| **4. Intégration** | L'application est ajoutée dans le **tiroir d'applications** d'Android/iOS au même titre que WhatsApp, Instagram ou vos jeux. |
| **5. Lancement** | L'application se lance avec un **Splash Screen (écran de démarrage)** à l'effigie d'Alanya et s'exécute dans une fenêtre immersive sans aucune interface de navigateur. |

---

## 3. Synthèse des Avantages PWA pour Alanya

1. **Légèreté absolue** : L'application installée pèse moins de 1 Mo sur le téléphone de l'utilisateur.
2. **Mises à jour transparentes** : Dès que vous poussez du code sur GitHub et que Vercel se met à jour, l'application installée sur les téléphones des utilisateurs se met à jour automatiquement au prochain démarrage. Aucun besoin de publier sur le Google Play Store ou l'App Store.
3. **Notifications Push** : Grâce au Service Worker installé, le téléphone réveille l'application dès qu'un message ou un appel arrive pour afficher la notification système.
