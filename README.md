# Alanya — client web

Alanya est une messagerie (chat, appels, statuts) développée dans le cadre du projet
de Base de Données de l'ENSPY, promotion 2025/2026. Ce dépôt contient le **client web**.

L'application mobile (Flutter) et le backend vivent dans des dépôts séparés :

- Backend (Next.js) : https://github.com/Dominique-BRIA/backend-alanya
- Application mobile : https://github.com/Dominique-BRIA/alanya

Web et mobile partagent le même backend et le même serveur temps réel : un message
envoyé depuis le web arrive sur le mobile, et inversement.

## Ce que fait l'application

- Comptes et connexion réels (email ou numéro Alanya à 6 chiffres), avec session
  persistante — on ne redemande pas les identifiants à chaque ouverture.
- Discussions en direct : texte, images, documents, vocaux enregistrés dans le
  navigateur, et messages à trois états (envoyé, reçu, lu).
- Répondre en glissant un message, supprimer / transférer / copier, visionneuse
  d'image plein écran.
- Appels audio et vidéo en WebRTC, avec sonnerie de l'autre côté.
- Statuts éphémères (texte sur fond coloré, photo ou vidéo) visibles 24 h.
- Répertoire de contacts et assistant IA (Gemini) intégré.
- Interface deux colonnes façon WhatsApp Web, thème clair/sombre, palette
  reprise de l'application mobile.

## Démarrer en local

```bash
npm install
npm run dev
```

Vite affiche l'adresse dans le terminal (en général `http://localhost:5173`).

Par défaut, l'application pointe déjà vers le backend déployé — il n'y a donc rien
d'autre à configurer pour tester. Pour builder la version de production :

```bash
npm run build
```

## Configuration

Les variables se trouvent dans `.env.example`. En production, elles sont dans
`.env.production` (URLs publiques uniquement) ; en local, on peut les surcharger
dans un `.env.local`.

```env
# Backend Next.js (local : http://localhost:3000)
VITE_API_BASE_URL=https://backend-alanya.vercel.app
# Serveur WebSocket (local : ws://localhost:3001)
VITE_WS_URL=wss://alanya-ws.onrender.com
VITE_DATA_MODE=api
```

`VITE_DATA_MODE` accepte `api` (backend uniquement), `auto` (backend avec repli
local) ou `prototype` (données locales du navigateur, sans backend).

### Appels entre réseaux différents (TURN)

Deux navigateurs sur la même machine se voient sans rien configurer. Mais dès que
les deux personnes sont sur des réseaux différents (Wi-Fi, 4G), il faut un serveur
TURN pour relayer l'audio et la vidéo. La bonne façon de faire est de renseigner un
compte [Metered](https://www.metered.ca) **côté backend** (`METERED_API_KEY` et
`METERED_DOMAIN`) : le backend distribue alors le TURN au web **et** au mobile.

Le front peut aussi recevoir un TURN de dépannage via `VITE_TURN_URLS`,
`VITE_TURN_USERNAME` et `VITE_TURN_CREDENTIAL`, mais cela ne couvre pas les appels
mobile ↔ mobile — la configuration côté backend reste préférable.

## Déploiement

- Le client web et le backend sont déployés sur **Vercel**.
- Le serveur WebSocket temps réel tourne sur **Render**.
- `vercel.json` réécrit toutes les routes vers `index.html` (application monopage).

## Organisation du code

```text
app/             Pages et écrans (discussions, appels, statuts, IA, paramètres…)
src/components/  Composants partagés (thème, toasts, gardes de route…)
src/services/    Appels au backend et logique temps réel (WebSocket, WebRTC)
src/data/        Session utilisateur et données locales
src/styles/      Styles globaux et thème
public/          Logo et fond décoratif
```

## Stack

React + Vite + TypeScript pour le web, Next.js (App Router) et Prisma/PostgreSQL
pour le backend, un serveur WebSocket Node pour le temps réel, et WebRTC pour les
appels.
