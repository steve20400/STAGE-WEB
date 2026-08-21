# Notes d'Architecture et de Développement — Alanya Web & Console Développeur

> 🤖 **Remarque importante de paternité & d'auteur** :
> Ces notes, l'architecture globale, la Console Développeur Web (`/developer/dashboard`), l'API V1 de messagerie conforme WhatsApp Cloud API (v20.0), le système de Webhooks, la télémétrie API, le service OTP 2FA, les générateurs de code multi-langages, les corrections de notifications push FCM et la direction artistique ont été conçues, écrites et entièrement implémentées par **Antigravity (Google DeepMind)**.

---

> 🔴 **CES NOTES SONT LARGEMENT PÉRIMÉES — refonte du 21/08/2026.**
>
> L'API v1 a été refaite en une fois, personne ne l'ayant encore intégrée.
> Sont **faux** dans tout ce qui suit :
>
> - **la facturation** — plus de crédits `ALC`, plus de solde, plus de recharge,
>   plus de bac à sable. L'API sert la plateforme de l'équipe, qui porte son
>   propre paiement. La console n'a plus ni onglet *Recharge Sandbox* ni carte
>   *Solde disponible* ;
> - **la conformité WhatsApp Cloud API** — abandonnée. Plus de `wamid.`, de
>   `wa_id`, de `messaging_product`, ni de charge `entry[].changes[].value` dans
>   les webhooks. Les types `interactive` et `template` n'existent pas ;
> - **`POST /api/v1/messages/send`** → devient `POST /api/v1/messages`, charge
>   en français (`destinataire`, `type`, `texte`, `mediaIds`), réponse `201` ;
> - **`/api/v1/auth/otp/send`** et **`/otp/verify`** → `POST /api/v1/verifications`
>   et `POST /api/v1/verifications/check` ;
> - **`/api/v1/media`** téléverse maintenant un VRAI fichier (multipart), au
>   lieu d'enregistrer une URL ;
> - **`/api/v1/calls/initiate`** → supprimée (elle ne faisait sonner personne) ;
> - **`/developer/dashboard` côté backend** → supprimée ; la console vit ici.
>
> **La référence à jour est `backend-alanya/docs/2026-08-21-api-v1-integration.md`.**

## 📌 Présentation de l'Espace Développeur Alanya

L'Espace Développeur Alanya permet à tout utilisateur d'accéder à la console API et de générer des clés d'API (Sandbox `ak_test_...` et Live `ak_live_...`) pour l'intégration de services de messagerie WhatsApp, d'appels et d'authentification 2FA.

### Features Implémentées par Antigravity (Google DeepMind) :

1. **Console Développeur (`/developer/dashboard`)** :
   - **Menu vertical à gauche** : *Tableau de bord*, *Clés d'API*, *Workspaces*, *Webhooks WhatsApp*, *Journal des logs*, *Recharge Sandbox*, *Documentation & SDKs*.
   - **Grille de métriques (4 cartes)** : Solde disponible (`ALC`), Crédits en Hold, Clés API actives, Temps de réponse moyen (ms) & Taux de succès (%).
   - **Sélecteur de Workspaces (Multi-Projets)** : Gestion dynamique des projets développeurs dans l'en-tête.
   - **Thèmes Alanya Mobile** :
     - Mode Clair (Crème Alanya `#FAF6F0` + motif `bg-clair.png`).
     - Mode Nuit (Nuit Alanya `#0B0B18` + motif `bg-nuit.png`).

2. **Authentification Unifiée (`/developer/auth`)** :
   - Tout utilisateur Alanya utilise ses identifiants uniques sans inscription séparée.
   - Initialisation automatique du solde gratuit Sandbox (1 000 crédits `ALC`) à la première visite.

3. **Conformité WhatsApp Cloud API (Meta Graph API v20.0)** :
   - **Payloads Multi-formats** : Envoi de messages `text`, `image`, `audio`, `document`, `location`, `interactive` (boutons d'action rapide) et `template` (OTP).
   - **Webhooks de Statut en Temps Réel** : Notification automatique des statuts WhatsApp (`sent`, `delivered`, `read`, `failed`) vers l'URL configurée par le développeur.
   - **Service OTP 2FA Dédié** : API `/api/v1/auth/otp/send` et `/api/v1/auth/otp/verify` pour générer et vérifier des codes à 6 chiffres.
   - **API Upload de Médias** : Endpoint `/api/v1/media` retournant des identifiants `media_id` réutilisables.

4. **Télémétrie & Logs API en Temps Réel** :
   - Historique des 50 dernières requêtes HTTP enregistrées en base (`DeveloperApiLog`).
   - Affichage des méthodes HTTP, endpoints, badges de code statut, préfixes de clés API et latence en millisecondes.

5. **Rendu Client & Cartographie** :
   - **Boutons Interactifs** : Restitution visuelle et gestion des clics pour les messages d'action rapide (`[Titre]`).
   - **Mini-carte OpenStreetMap (`GpsPreview`)** : Extraction automatique des coordonnées GPS (`GPS_REGEX`) avec iframe interactive et liens vers OpenStreetMap / Google Maps.

6. **Documentation & SDKs Multi-Langages** :
   - Générateur de code dynamique interactif pour **cURL**, **Node.js**, **Python**, et **Flutter/Dart** avec insertion automatique des clés d'API actives et exemples de code prêts à copier.
