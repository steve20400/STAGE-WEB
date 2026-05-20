# Checklist Integration Backend

Objectif : permettre a l'equipe backend de brancher l'API sans casser le front.

## Demarrage

1. Lancer le backend.
2. Creer ou mettre a jour `.env.local` cote front :

```env
VITE_API_BASE_URL=http://localhost:8080
VITE_DATA_MODE=auto
```

3. Lancer le front :

```bash
npm run dev
```

## Parcours A Tester

### Auth

- Aller sur `/login`
- Se connecter avec numero + mot de passe
- Verifier que le front va vers `/dashboard`
- Rafraichir la page
- Verifier que la session reste active via `GET /api/users/me`
- Se deconnecter depuis l'app

### Inscription

- Aller sur `/signup`
- Saisir nom, telephone, email
- Saisir un mot de passe valide
- Demander un OTP
- Verifier le code
- Verifier que le compte est cree et que la session est active

### Dashboard

- Aller sur `/dashboard`
- Verifier que le profil affiche le bon utilisateur
- Verifier que les conversations recentes, appels et contacts restent coherents

### Chats

- Aller sur `/chats`
- Verifier la liste des conversations
- Ouvrir une conversation
- Charger les messages
- Envoyer un message
- Verifier que le dernier message remonte dans la liste

### Contacts

- Verifier que les contacts retournes par le backend peuvent alimenter :
  - creation de chat
  - dashboard
  - appels

### Calls

- Aller sur `/calls`
- Verifier l'historique
- Filtrer audio/video/manques
- Creer un appel depuis un contact

## Points D'Attention

- Ne pas changer les noms de champs sans prevenir le front.
- Toujours retourner une erreur JSON `{ "message": "..." }`.
- Toujours retourner les dates en ISO string.
- Garder le telephone dans un format stable, idealement `+237...`.
- En mode prototype, certains ecrans peuvent encore afficher des donnees locales. Pour valider le backend, il faudra progressivement rendre `VITE_DATA_MODE=api` strict dans les services.

## Fichiers Front A Connaitre

- `src/lib/api-client.ts` : client HTTP commun.
- `src/services/auth-api.ts` : endpoints auth deja prepares.
- `src/services/chats-service.ts` : future entree pour conversations/messages.
- `src/services/calls-service.ts` : future entree pour appels.
- `src/services/dashboard-service.ts` : aggregation pour dashboard.
- `docs/api-contract.md` : contrat JSON attendu.

## Priorite Backend

1. `POST /api/auth/login`
2. `POST /api/auth/register-otp`
3. `POST /api/auth/register`
4. `GET /api/users/me`
5. `GET /api/contacts`
6. `GET /api/chats`
7. `GET /api/chats/:chatId/messages`
8. `POST /api/chats/:chatId/messages`
9. `GET /api/calls`
10. `POST /api/calls`

## Structure Backend Cible

Le backend reste dans un dossier/repo separe pour le moment. La structure cible a
conserver pour la suite :

- `config/` : `SecurityConfig`, `CorsConfig`, `WebSocketConfig`
- `security/` : `JwtUtil`, `JwtFilter`, `UserDetailsServiceImpl`
- `model/` : `User`, `Contact`, `Conversation`, `Message`, `CallHistory`
- `repository/` : repositories JPA correspondants
- `service/` : `AuthService`, `UserService`, puis `ContactService`, `ConversationService`, `MessageService`, `CallService`
- `controller/` : `AuthController`, `UserController`, `ContactController`, `ChatController`, `CallController`
- `dto/request/` : login/register plus `VerifyOtpRequest`, `UpdateUserRequest`, `CreateChatRequest`, `SendMessageRequest`, `CreateCallRequest`
- `dto/response/` : `AuthResponse`, `UserResponse`, puis responses contacts, conversations, messages et appels
- `exception/` : `GlobalExceptionHandler` et exceptions metier

Pour le commit front actuel, seules les routes auth deja disponibles sont branchees.
Les routes utilisateur, contacts, chats, messages et appels restent a implementer cote backend.
