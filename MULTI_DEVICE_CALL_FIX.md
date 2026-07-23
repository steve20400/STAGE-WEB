# Correctif immédiat — appels sur plusieurs appareils

## Incident

Quand le même compte recevait un appel sur plusieurs appareils, un appareil pouvait décrocher tandis qu'un autre laissait expirer son compteur de 30 secondes. L'expiration appelait alors `rejectIncomingCall()`, ce qui envoyait une requête de rejet au serveur et pouvait terminer l'appel déjà accepté par l'autre appareil.

## Correctif frontend

- Le compte à rebours de `IncomingCallOverlay` appelle maintenant `onTimeout`, distinct de `onDecline`.
- `onTimeout` appelle `dismissIncomingCallLocally()` : il ferme uniquement l'overlay et la sonnerie de cet appareil. Il n'appelle ni `reject`, ni `end` côté backend.
- Si un évènement `joined`/`accepted` est reçu pour le même utilisateur alors qu'un autre appareil a encore l'overlay, cet appareil ferme son overlay local sans terminer l'appel.

## Résultat

Un appareil peut décrocher ; les autres appareils du même compte cessent de sonner ou expirent localement, sans couper l'appel entre les deux personnes déjà en communication.

## Limite et prochaine étape

IndexedDB ne partage aucune information entre appareils. La gestion complète des sessions/appareils demandée (inventaire, révocation, FCM ciblé) nécessite le registre backend et le service de signalisation WebSocket. Elle doit être ajoutée côté serveur avec une migration Prisma et des endpoints sécurisés ; elle ne peut pas être garantie par une base IndexedDB locale seule.
