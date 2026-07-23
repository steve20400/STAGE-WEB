# Statuts d'appel — Frontend

Cette modification ne change ni la disposition, ni les boutons, ni le design de l'écran d'appel. Elle améliore uniquement les messages et le libellé des événements d'appel.

## États affichés durant un appel

| Libellé | Moment d'affichage |
|---|---|
| **Sonnerie** | L'appel est créé et le correspondant n'a pas encore signalé que son application a reçu l'écran entrant. Il peut être hors ligne ou ne pas avoir ouvert l'application. |
| **En train de sonner** | Le correspondant a reçu l'événement entrant dans son application ouverte. |
| **Appel en cours** | Le correspondant a accepté l'appel ; l'événement `joined`/`accepted` est reçu et la connexion WebRTC démarre. |

Le destinataire envoie l'état WebSocket `ringing` dès qu'il reçoit l'appel entrant. L'appelant passe alors de **Sonnerie** à **En train de sonner**. Les états `joined` ou `accepted` font passer les deux côtés à **Appel en cours**.

## Historique

- **Appel manqué** : appel entrant terminé sans réponse (`MISSED`).
- **Sans réponse** : même état backend `MISSED`, vu par l'appelant sortant.
- **Appel rejeté** : destinataire ayant refusé volontairement (`REJECTED`).
- **Occupé** : erreur de conflit `409` persistante lors de la création d'un appel ; l'interface affiche un message explicite.
- **Appel terminé** : appel normalement décroché puis clos (`ENDED`).

Le backend actuel ne persiste pas `BUSY` comme statut d'historique distinct. Le frontend peut donc l'indiquer au moment de l'échec, mais ne peut pas l'ajouter durablement à l'historique sans une évolution backend, qui n'a pas été faite.

## Règle de fin confirmée

- Un appel clos sans `answeredAt` est affiché en rouge comme **Appel manqué** dans le fil de discussion.
- Un appel `REJECTED` est affiché en rouge comme **Appel rejeté**.
- Un appel avec `answeredAt` est conservé comme événement normal : **Appel vocal** ou **Appel vidéo**, durée incluse, vert chez l'appelant et bleu chez le destinataire.

## Repli média

Les requêtes de preview utilisent le jeton de session dans l'en-tête `Authorization: Bearer`. Si un lecteur vidéo ne peut pas décoder ou charger un média, la carte affiche le nom, la taille et la durée du fichier, sans masquer le message ni forcer un téléchargement.
