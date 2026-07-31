# À ajouter au backend

Ce fichier recense ce que le **client web** ne peut pas faire faute d'un champ ou
d'un endpoint côté serveur. Le backend vit dans un dépôt séparé : rien n'y est
modifié sans validation. Chaque entrée décrit le besoin, pourquoi il ne peut pas
être résolu côté client, un contrat proposé, et ce que le web fera dès qu'il
existera.

L'application web est déployée sur `https://alanyavox.com/webapp/` et partage ce
backend avec l'application mobile : tout ajout profite aux deux.

---

## 1. Sonnerie personnalisée transférable d'un appareil à l'autre

**État actuel.** L'import d'une sonnerie fonctionne : le fichier est téléversé par
`POST /api/media`, déjà utilisé pour les messages vocaux, et il vit donc bien côté
serveur. En revanche, **le choix de l'utilisateur reste local au navigateur**,
dans `localStorage` :

| Clé locale                   | Contenu                                               |
| ---------------------------- | ----------------------------------------------------- |
| `alanya-ringtones-custom-v1` | la liste des sonneries importées : `[{ url, label }]` |
| `alanya-ringtone-incoming`   | son choisi pour l'appel entrant                       |
| `alanya-ringtone-outgoing`   | son choisi pour l'appel sortant                       |
| `alanya-ringtone-message`    | son choisi pour l'arrivée d'un message                |

**Pourquoi ça ne peut pas se régler côté client.** Rien ne rattache ces
préférences au compte. `PATCH /api/account/profile` n'accepte que `pseudo`,
`statusMsg` et `avatarUrl`. Conséquence : un utilisateur qui importe sa sonnerie
sur son ordinateur ne la retrouve pas sur son téléphone, ni même dans un autre
navigateur du même ordinateur, alors que **le fichier est déjà sur le serveur** —
seule l'information « c'est celle-là que je veux » manque.

**Contrat proposé.** Le même style que `/api/account/privacy`, qui existe déjà et
que les deux clients utilisent :

```
GET /api/account/ringtones
→ 200 { "incoming": "...", "outgoing": "...", "message": "...", "library": [ { "url": "...", "label": "..." } ] }

POST /api/account/ringtones
  body : n'importe quel sous-ensemble des mêmes champs
→ 200
```

Chaque valeur de `incoming` / `outgoing` / `message` est soit un nom de fichier
fourni par l'application (`incoming_ring.mp3`, `outgoing_ring.mp3`,
`notification.mp3`, `ringtone.mp3`, `message.mp3`), soit une URL relative de média
(`/api/media/{id}`). Le client distingue déjà les deux : une URL commence par une
barre oblique, un nom de fichier jamais. Aucun champ « type » n'est nécessaire.

`library` recense les sonneries importées du compte, pour qu'un nouvel appareil
retrouve la liste et puisse en choisir une autre que celle en cours.

**Longueurs à prévoir** : `label` jusqu'à 80 caractères, valeurs jusqu'à 200.
`library` peut être bornée côté serveur — cinq entrées suffisent largement.

**Ce que le web fera dès que ça existe.** `src/services/ringtones.ts` est déjà
structuré pour : `customRingtones()`, `ringtoneFile()` et `setRingtone()` liront et
écriront le serveur, avec le stockage local en cache de premier affichage et en
repli hors connexion — exactement le schéma déjà en place pour la confidentialité
dans `src/services/privacy-service.ts`. Le plafond de 5 Mo par fichier et le refus
des types non audio restent côté client.

**Sans cet ajout**, la sonnerie importée continue de fonctionner, mais reste
attachée au navigateur où elle a été choisie. Ce n'est pas bloquant, c'est une
limite à assumer et à documenter auprès des utilisateurs.

---

## Modèle pour les entrées suivantes

Pour chaque nouveau besoin : l'état actuel et ce qui coince, pourquoi le client ne
peut pas s'en sortir seul, un contrat proposé aligné sur les conventions
existantes du backend, les limites de taille, ce que le web fera ensuite, et ce
qu'on perd si l'ajout n'est pas fait.
