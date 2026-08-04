# Menu d'appel, invitation et transfert

Ce document décrit le menu « trois points » des fenêtres d'appel, ainsi que
l'invitation d'un tiers et le transfert d'appel — protocole compris.

## 1. Le menu « trois points »

### Placement

Le bouton `⋯` est **le dernier de la barre de commandes**, tout à droite. Toutes
les commandes d'appel — micro, caméra, retourner, haut-parleur, chat,
raccrocher — restent à sa gauche. Il n'est pas une commande d'appel : c'est la
porte vers les autres actions, il ne se mélange donc pas aux autres boutons.

Ce placement est identique dans les trois fenêtres.

### Contenu — le même partout

Un seul composant sert les trois fenêtres :
[`src/components/call-options-menu.tsx`](src/components/call-options-menu.tsx).

1. **Taille de la fenêtre ›** (sous-menu)
2. **Inviter une personne**
3. **Transférer l'appel**

### Seule différence : les tailles proposées

Une fenêtre ne se propose jamais elle-même. Le sous-menu n'affiche que les
**deux autres** tailles :

| Fenêtre courante | Propositions              |
| ---------------- | ------------------------- |
| Petite           | Écran moyen · Grand écran |
| Moyenne          | Petit écran · Grand écran |
| Grande           | Petit écran · Écran moyen |

Les tailles `small` et `medium` sont rendues par la fenêtre flottante
(`ActiveCallFloating`) ; `full` est la page d'appel entière. Passer du grand
écran à une taille réduite quitte donc la route de l'appel, sinon la vignette
resterait cachée derrière la page.

### Notes d'implémentation

- Les dialogues d'invitation et de transfert partent dans un **portail** sur
  `<body>` : la petite fenêtre les rognerait.
- La vignette ne clippe plus le menu : `overflow: hidden` est porté par
  `.active-call-content` et non par `.active-call-floating`.
- En appel vidéo, la barre de commandes ne s'efface plus automatiquement tant
  que le menu est ouvert.

## 2. Désigner quelqu'un : contacts ou clavier

Les deux dialogues offrent deux entrées, par onglet :

- **Contacts** — recherche par nom ou par numéro, puis choix dans la liste.
- **Composer un ID** — pavé numérique de téléphone (Alanya ID de 6 ou 8
  chiffres). Le clavier physique fonctionne aussi : chiffres, `Retour arrière`,
  `Entrée` pour valider, `Échap` pour fermer. Si le numéro composé correspond à
  un contact, son nom s'affiche sous le numéro.

Dans les deux cas, la personne est désignée par son **numéro public**. Jamais
par `contact.id`, qui identifie la fiche contact locale et non l'utilisateur
distant.

## 3. Invitation — protocole

L'invitation fait sonner un tiers et l'ajoute à l'appel **sans que l'on
quitte**. L'appel devient multi-partie ; le mesh WebRTC connecte l'invité à tous
les participants dès qu'il décroche.

Seul le serveur peut faire sonner quelqu'un. Le client envoie :

```json
{ "type": "call_invite", "callId": "<id>", "publicNumber": "<numéro Alanya>" }
```

C'est **exactement le message de l'application mobile** (`RealtimeClient.callInvite`).
Les deux clients doivent parler la même langue pour qu'une invitation lancée
depuis le web arrive sur un téléphone.

Le serveur répond ensuite par des `call_state` :

| `state`    | Signification                      | Effet côté client                      |
| ---------- | ---------------------------------- | -------------------------------------- |
| `inviting` | `userId` = identifiant de l'invité | Mémorise la cible (utile au transfert) |
| `joined`   | L'invité a décroché                | Connexion WebRTC au nouveau pair       |
| `declined` | L'invité a refusé                  | Annule un transfert en attente         |

## 4. Transfert — supervisé

Le transfert **réutilise `call_invite`**. Il n'y a pas de message dédié.

1. On invite la cible : `call_invite`.
2. Le serveur renvoie `inviting` → on retient l'`userId` de la cible. Le numéro
   composé ne suffit pas à la reconnaître parmi les arrivants.
3. Dès que ce même `userId` envoie `joined`, l'initiateur part :
   `POST /api/calls/:id/leave` puis `call_state` `left`.
4. L'appel continue entre le correspondant d'origine et la personne invitée.

On ne raccroche donc **pas** au moment du clic : partir avant que la cible ait
décroché couperait le correspondant, et un transfert refusé laisserait tout le
monde en plan. Si la cible refuse (`declined`), le transfert est annulé et l'on
reste dans l'appel.

Entre le clic et le départ, l'écran d'appel affiche « Transfert en cours — en
attente de la réponse du destinataire… » (`state.transferPending`). Sans ce
rappel, l'action paraîtrait sans effet.

## 5. Vérification

Les deux flux ont été validés de bout en bout contre un serveur WebSocket
rejouant la séquence du backend.

Invitation — trames émises :

```
{"type":"call_invite","callId":"appel-test-77","publicNumber":"12345678"}
```

L'appel n'est pas quitté, et le compteur passe à « 2 participants » après le
`joined`.

Transfert — trames émises :

```
{"type":"call_invite","callId":"appel-test-42","publicNumber":"12345678"}
{"type":"call_state","callId":"appel-test-42","state":"left","displayName":"Dev Local"}
```

La seconde trame ne part qu'après le `joined` de la cible, et le client revient
à la liste des appels.

## 6. Déploiement

Rien dans ce chantier ne touche au base path : pas de modification de
`vite.config.ts`, `vercel.json`, ni du `basename` du routeur, et aucun chemin
absolu ajouté. Build de production :

```bash
VITE_APP_BASE_PATH=/webapp/ npm run build
```

## Fichiers concernés

| Fichier                                   | Rôle                                                |
| ----------------------------------------- | --------------------------------------------------- |
| `src/components/call-options-menu.tsx`    | Menu commun, sous-menu des tailles, dialogues       |
| `src/components/call-options-menu.css`    | Styles du menu, du pavé et des dialogues            |
| `src/components/active-call-floating.tsx` | Fenêtres petite et moyenne                          |
| `app/(protected)/calls/[callId]/call.tsx` | Grand écran                                         |
| `src/services/call-manager.ts`            | `inviteToCall`, `transferCall`, transfert supervisé |
| `src/services/websocket-service.ts`       | `sendCallInvite`                                    |
