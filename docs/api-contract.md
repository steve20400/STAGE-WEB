# Contrat API Alanya

Ce document donne a l'equipe backend la cible attendue par le front.
Le front fonctionne encore en mode prototype, mais ces endpoints permettent de
brancher le backend progressivement sans modifier toutes les pages React.

## Configuration Front

Dans `.env.local` :

```env
VITE_API_BASE_URL=http://localhost:8080
VITE_DATA_MODE=prototype
```

Modes prevus :

- `prototype` : le front utilise les donnees locales et les mocks.
- `auto` : le front tente l'API quand elle existe, puis garde un fallback prototype sur certains modules.
- `api` : mode cible pour tester le backend sans masquer les erreurs. A finaliser dans les services avant validation backend stricte.

Important : aujourd'hui, l'authentification appelle deja certains endpoints API avec fallback prototype. Les services `chats`, `calls` et `dashboard` centralisent les donnees, mais ne font pas encore de vrais appels backend.

## Regles Generales

- Base URL : `VITE_API_BASE_URL`
- Format : JSON
- Auth : `Authorization: Bearer <token>` apres connexion
- Erreurs : retourner un JSON avec au minimum `message`

Exemple d'erreur :

```json
{
  "message": "Identifiants invalides."
}
```

## Types Communs

### User

```json
{
  "name": "Kevin Manga",
  "phone": "+237690000001",
  "email": "k.manga@enspy.cm",
  "statusMsg": "Disponible",
  "avatar": null
}
```

Champs attendus :

- `name` : string requis
- `phone` : string requis, format normalise cote backend si possible
- `email` : string optionnel mais recommande
- `statusMsg` : string optionnel
- `avatar` : string URL ou null

### Contact

```json
{
  "id": "1",
  "name": "Laure Ateba",
  "initials": "LA",
  "email": "l.ateba@enspy.cm",
  "phone": "+237690000004",
  "online": true
}
```

### Conversation

```json
{
  "id": "chat-1",
  "name": "Kevin Manga",
  "initials": "KM",
  "isGroup": false,
  "members": [],
  "lastMessage": "On se retrouve apres le cours.",
  "lastMessageType": "text",
  "time": "10:43",
  "unread": 2,
  "online": true,
  "isPinned": false,
  "colorIdx": 0
}
```

`lastMessageType` accepte :

- `text`
- `file`
- `audio`
- `image`

### Message

```json
{
  "id": "msg-1",
  "conversationId": "chat-1",
  "senderId": "+237690000001",
  "content": "Bonjour.",
  "type": "text",
  "status": "sent",
  "createdAt": "2026-04-21T10:30:00.000Z"
}
```

`status` accepte :

- `sending`
- `sent`
- `delivered`
- `read`
- `failed`

### Call

```json
{
  "id": "call-1",
  "contactId": "1",
  "contactName": "Kevin Manga",
  "contactInitials": "KM",
  "direction": "out",
  "type": "video",
  "status": "ended",
  "duration": "14:23",
  "createdAt": "2026-04-21T10:30:00.000Z",
  "isGroup": false
}
```

`direction` accepte :

- `in`
- `out`
- `missed`

`type` accepte :

- `audio`
- `video`

`status` accepte :

- `ended`
- `declined`
- `no_answer`

## Endpoints Auth

### POST `/api/auth/login`

Request :

```json
{
  "identifier": "+237690000001",
  "password": "password123"
}
```

Response `200` :

```json
{
  "accessToken": "jwt_or_session_token",
  "refreshToken": "refresh_token",
  "tokenType": "Bearer",
  "user": {
    "name": "Kevin Manga",
    "phone": "+237690000001",
    "email": "k.manga@enspy.cm",
    "statusMsg": "Disponible",
    "avatar": null
  }
}
```

### POST `/api/auth/register-otp`

Request :

```json
{
  "name": "Kevin Manga",
  "phone": "+237690000001",
  "email": "k.manga@enspy.cm",
  "password": "password123"
}
```

Response `200` :

```json
{
  "delivery": "email"
}
```

En developpement, le backend peut retourner :

```json
{
  "delivery": "debug",
  "debugOtp": "123456"
}
```

### POST `/api/auth/register`

Request :

```json
{
  "name": "Kevin Manga",
  "phone": "+237690000001",
  "email": "k.manga@enspy.cm",
  "password": "password123"
}
```

Response `200` :

```json
{
  "accessToken": "jwt_or_session_token",
  "refreshToken": "refresh_token",
  "tokenType": "Bearer",
  "user": {
    "name": "Kevin Manga",
    "phone": "+237690000001",
    "email": "k.manga@enspy.cm",
    "statusMsg": "Disponible",
    "avatar": null
  }
}
```

### POST `/api/auth/logout`

Response `204` ou `200`.

### POST `/api/auth/logout-all`

Response `204` ou `200`.

## Endpoints User

### GET `/api/users/me`

Response `200` :

```json
{
  "user": {
    "name": "Kevin Manga",
    "phone": "+237690000001",
    "email": "k.manga@enspy.cm",
    "statusMsg": "Disponible",
    "avatar": null
  }
}
```

### PATCH `/api/users/me`

Request :

```json
{
  "name": "Kevin Manga",
  "email": "k.manga@enspy.cm",
  "statusMsg": "En ligne"
}
```

Response `200` :

```json
{
  "user": {
    "name": "Kevin Manga",
    "phone": "+237690000001",
    "email": "k.manga@enspy.cm",
    "statusMsg": "En ligne",
    "avatar": null
  }
}
```

### DELETE `/api/users/me`

Response `204` ou `200`.

## Endpoints Contacts

### GET `/api/contacts`

Response `200` :

```json
{
  "contacts": [
    {
      "id": "1",
      "name": "Kevin Manga",
      "initials": "KM",
      "email": "k.manga@enspy.cm",
      "phone": "+237690000001",
      "online": true
    }
  ]
}
```

## Endpoints Chats

### GET `/api/chats`

Response `200` :

```json
{
  "conversations": [
    {
      "id": "chat-1",
      "name": "Kevin Manga",
      "initials": "KM",
      "isGroup": false,
      "members": [],
      "lastMessage": "Bonjour.",
      "lastMessageType": "text",
      "time": "10:43",
      "unread": 1,
      "online": true,
      "isPinned": false,
      "colorIdx": 0
    }
  ]
}
```

### POST `/api/chats`

Request conversation privee :

```json
{
  "contactId": "1"
}
```

Request groupe :

```json
{
  "name": "Groupe Projet",
  "memberIds": ["1", "4", "5"]
}
```

Response `201` :

```json
{
  "conversation": {
    "id": "chat-1",
    "name": "Groupe Projet",
    "initials": "GP",
    "isGroup": true,
    "members": ["1", "4", "5"],
    "lastMessage": "",
    "lastMessageType": "text",
    "time": "",
    "unread": 0,
    "online": false,
    "isPinned": false,
    "colorIdx": 1
  }
}
```

### GET `/api/chats/:chatId/messages`

Response `200` :

```json
{
  "messages": [
    {
      "id": "msg-1",
      "conversationId": "chat-1",
      "senderId": "+237690000001",
      "content": "Bonjour.",
      "type": "text",
      "status": "read",
      "createdAt": "2026-04-21T10:30:00.000Z"
    }
  ]
}
```

### POST `/api/chats/:chatId/messages`

Request :

```json
{
  "content": "Bonjour.",
  "type": "text"
}
```

Response `201` :

```json
{
  "message": {
    "id": "msg-2",
    "conversationId": "chat-1",
    "senderId": "+237690000001",
    "content": "Bonjour.",
    "type": "text",
    "status": "sent",
    "createdAt": "2026-04-21T10:31:00.000Z"
  }
}
```

## Endpoints Calls

### GET `/api/calls`

Response `200` :

```json
{
  "calls": [
    {
      "id": "call-1",
      "contactId": "1",
      "contactName": "Kevin Manga",
      "contactInitials": "KM",
      "direction": "out",
      "type": "video",
      "status": "ended",
      "duration": "14:23",
      "createdAt": "2026-04-21T10:30:00.000Z",
      "isGroup": false
    }
  ]
}
```

### POST `/api/calls`

Request :

```json
{
  "contactId": "1",
  "type": "video"
}
```

Response `201` :

```json
{
  "call": {
    "id": "call-1",
    "contactId": "1",
    "contactName": "Kevin Manga",
    "contactInitials": "KM",
    "direction": "out",
    "type": "video",
    "status": "ended",
    "duration": "00:00",
    "createdAt": "2026-04-21T10:30:00.000Z",
    "isGroup": false
  }
}
```

## Ordre D'Integration Recommande

1. Auth : login, register OTP, verify, me.
2. Contacts : liste des contacts.
3. Chats : liste des conversations.
4. Messages : lecture puis envoi.
5. Dashboard : reutiliser les donnees user/chats/contacts/calls.
6. Calls : historique puis creation d'appel.

## Definition De Pret

Un endpoint est considere pret quand :

- le format JSON respecte ce document ;
- les erreurs retournent `{ "message": "..." }` ;
- le token est accepte via `Authorization: Bearer <token>` ;
- les dates sont en ISO string ;
- le front peut fonctionner avec `VITE_API_BASE_URL` pointe vers le backend.
