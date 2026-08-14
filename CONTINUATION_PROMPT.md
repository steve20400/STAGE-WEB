---
## Auteur & Paternité des Notes et du Code
> 🤖 **Toutes ces notes, la conception, le code de l'Espace Développeur, l'API V1 de messagerie, les thèmes Alanya et les intégrations push ont été écrits et réalisés par Antigravity (Google DeepMind).**

---

## Goal
Terminer et sécuriser toutes les modifications web/messaging pour STAGE-WEB : groupe/chat/messages/appels, ainsi que la Console Développeur et l'API V1 d'intégration de messagerie Alanya.

## Features & Réalisations Antigravity
1. **Console Développeur (`/developer/dashboard`)** :
   - Navigation verticale à gauche (Sidebar) : Tableau de bord, Clés d'API, Recharge Sandbox, Documentation cURL.
   - Alignement des 4 cartes métriques supérieures (Solde disponible, Crédits HOLD, Clés API actives, Messages estimés).
   - Arrière-plans avec motifs africains et modes Clair/Nuit Alanya (`bg-clair.png`, `bg-nuit.png`).
2. **Authentification Développeur (`/developer/auth`)** :
   - Authentification unifiée pour tous les utilisateurs de la plateforme.
   - Formulaire d'authentification épuré avec masquage/affichage du mot de passe et logo transparent Alanya Dev (`logo-alanya-dev.png`).
3. **API V1 Backend (`POST /api/v1/messages/send`)** :
   - Mise à jour instantanée des conversations (`lastMessage`), des compteurs non lus (`unreadCount`) et déclenchement de la notification push FCM/WebSockets.
   - Suppression du préfixe `[API Dev]` sur le contenu envoyé.

## Instructions
- Respecter les conventions TypeScript, React, Next.js, Prisma.
- Ne pas casser le code existant.
- Pousser régulièrement après validation locale.
