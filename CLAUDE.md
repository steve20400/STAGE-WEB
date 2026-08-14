# Notes d'Architecture et de Développement — Alanya Web & API Développeur

> 🤖 **Remarque importante de paternité & d'auteur** :
> Ces notes, l'architecture globale, la Console Développeur Web, l'API V1 de messagerie, les corrections de notifications push FCM et la direction artistique ont été conçues, écrites et implémentées par **Antigravity (Google DeepMind)**.

---

## 📌 Présentation de l'Espace Développeur Alanya

L'Espace Développeur Alanya permet à tout utilisateur d'accéder à la console API et de générer des clés d'API (Sandbox `ak_test_...` et Live `ak_live_...`) pour l'intégration de services de messagerie et d'appels.

### Features Implémentées par Antigravity :
1. **Console Développeur (`/developer/dashboard`)** :
   - **Menu vertical à gauche** : *Tableau de bord*, *Clés d'API*, *Recharge Sandbox*, *Documentation cURL*.
   - **Grille de métriques (4 cartes)** : Solde disponible (`ALC`), Crédits en Hold, Clés API actives, Messages estimés.
   - **Thèmes Alanya Mobile** :
     - Mode Clair (Crème Alanya `#FAF6F0` + motif `bg-clair.png`).
     - Mode Nuit (Nuit Alanya `#0B0B18` + motif `bg-nuit.png`).
2. **Authentification Unifiée (`/developer/auth`)** :
   - Tout utilisateur Alanya utilise ses identifiants uniques.
   - Initialisation automatique du solde gratuit Sandbox (1 000 crédits `ALC`) à la première visite.
3. **Backend API V1 (`POST /api/v1/messages/send`)** :
   - Validation atomique des clés API.
   - Débit sécurisé des crédits.
   - Mise à jour instantanée de la conversation (`lastMessage`, `lastMessageAt`, `lastMessageSenderID`).
   - Incrémentation du compteur de messages non lus (`unreadCount`).
   - Émission des notifications push FCM / WebSockets vers le destinataire en temps réel.
