# Architecture des aperçus de fichiers — Alanya Web

## Objectif

Les fichiers envoyés dans les discussions sont visualisés directement dans Alanya autant que le format et le navigateur le permettent. Aucun fichier texte ou code n'est exécuté : un `.html` est lu comme du texte source, ce qui évite qu'un script attaché puisse s'exécuter dans l'application.

## Chaîne d'accès sécurisée

1. Après l'envoi, le backend conserve un média et retourne `/api/media/<id>`.
2. Le frontend résout cette URL avec la session Alanya.
3. Les prévisualisations qui doivent lire le contenu (`fetch`) passent par `/api/media-proxy/<id>`, une fonction Vercel incluse dans **ce dépôt frontend**.
4. Le navigateur donne le header `Authorization: Bearer <jeton Alanya>` au proxy same-origin.
5. Le proxy transmet ce header au backend. Le backend vérifie que l'utilisateur est propriétaire du média ou participant de la conversation.
6. Si le backend redirige vers Backblaze B2, la fonction Vercel suit la redirection côté serveur puis renvoie le binaire au navigateur depuis le domaine de l'application.
7. Le navigateur n'a donc plus à effectuer un `fetch` cross-origin vers B2 : cela élimine le cas `Failed to fetch` dû aux en-têtes CORS de redirection.

Le proxy ne rend pas les médias publics : sans token Alanya valide, le backend renvoie `401` ou `403`.

## Cache local

Après une première lecture réussie, les blobs de preview sont enregistrés dans IndexedDB (`previewMedia`, version 3 de la base) avec une limite de 30 Mo par fichier. Le cache est une optimisation : son indisponibilité (quota du navigateur, navigation privée, migration) ne bloque jamais le téléchargement réseau. Il est nettoyé avec les données locales de l'application.

## Visionneur texte/code interne

Le visionneur est rendu directement en React. Il est utilisé automatiquement pour :

- texte : `.txt`, `.env`, `.properties`, `.md`, `.log` ;
- web/code : `.html`, `.htm`, `.tsx`, `.ts`, `.js`, `.jsx`, `.css`, `.scss`, `.py`, `.java`, `.cpp`, `.c`, `.h`, `.hpp`, `.php` ;
- données/configuration : `.json`, `.xml`, `.yaml`, `.yml`, `.ini`, `.cfg` ;
- autres formats texte déjà reconnus par la discussion.

Fonctions : numéros de lignes, recherche locale, copie du contenu, police monospace, coloration légère de commentaires et lignes clé/valeur. Les 50 000 premiers caractères sont lus afin de protéger les téléphones contre des documents texte extrêmement lourds.

## CSV

Les `.csv` sont parsés côté navigateur et visualisés comme tableau intégré. Les 30 premières lignes sont rendues dans la carte compacte, ce qui préserve la fluidité d'une discussion.

## PDF

Les PDF sont téléchargés via le même proxy puis rendus avec PDF.js (`pdfjs-dist`) directement dans l'application. PDF.js dessine les pages sur canvas : aucun lecteur PDF externe n'est requis. Les pages sont rendues à une échelle adaptée aux mobiles.

## Documents Office

Les `.doc` et `.docx` utilisent Microsoft Office Online Viewer dans une iframe intégrée. C'est nécessaire car Word est un format binaire complexe. Les fichiers Office restent affichés dans l'interface Alanya.

## Images, audio et vidéo

- Images : balise `<img>` et visionneuse image ;
- Audio : lecteur HTML5 intégré, avec nom, taille et durée ;
- Vidéo : lecteur HTML5 intégré. En cas d'échec de codec/chargement, la carte conserve nom, taille et durée au lieu de disparaître.

## Cas B2 réellement indisponible

Le proxy peut résoudre CORS, mais ne peut pas contourner une réponse B2 réelle telle que `AccessDenied`, `cap exceeded`, fichier supprimé ou quota atteint. Dans ce cas le frontend affiche une erreur lisible et conserve les métadonnées disponibles du fichier.

## Stabilité de l'interface

- Le fil ne scroll plus automatiquement lors du chargement des previews ni lors des synchronisations périodiques ; il ne descend que pour le chargement initial ou pour un nouveau message lorsque l'utilisateur est déjà près du bas.
- `AppErrorBoundary` entoure l'application. Une exception imprévue dans un preview, WebRTC ou un composant ne peut plus laisser un écran entièrement blanc : une page de récupération avec bouton de rechargement est affichée. Les messages restent stockés côté serveur/cache local.

## Isolation des erreurs de preview

Chaque `MessageBubble` est maintenant entouré par `MessageErrorBoundary`. Si un navigateur particulier, un fichier corrompu ou une donnée historique imprévue provoque une exception dans un preview, seule cette carte est remplacée par un repli indiquant nom et taille. La discussion, les autres fichiers et toute l'application restent utilisables. Le dernier diagnostic technique est enregistré localement sous `alanya_last_preview_error` pour faciliter le débogage, sans l'envoyer à un tiers.

## Performance PDF et fluidité du fil

Un aperçu PDF dans le fil ne rend désormais que la première page. C'est l'aperçu utile sans créer des dizaines de canvas pour plusieurs PDF ouverts en même temps. La visionneuse PDF ouverte rend jusqu'à 30 pages, dans son panneau dédié. Le visionneur texte compact limite aussi son affichage à 80 lignes. Ces limites évitent les ralentissements de scroll et les erreurs de mémoire sur mobile/PC tout en conservant le contenu complet dans la visionneuse dédiée.

## Correction PDF : isolation DOM React / PDF.js

PDF.js ajoute des canvas impérativement via le DOM. Le texte React « Chargement du PDF » était auparavant dans le même conteneur que ces canvas. `replaceChildren()` supprimait donc un nœud appartenant à React ; lors du rendu suivant, React tentait de le supprimer une seconde fois et levait une erreur DOM. Le conteneur canvas PDF.js est maintenant un enfant dédié et vide côté React. Les messages d'état React sont dans un autre enfant. Cela élimine l'erreur qui remplaçait un PDF correctement rendu par « Aperçu indisponible » quelques instants plus tard.

## Agrandissement des aperçus et positions GPS

Chaque aperçu de document reconnu dans le fil (PDF, texte/code, CSV, Word, Excel, PowerPoint) comporte maintenant le bouton **⛶ Agrandir**. Il ouvre `DocumentViewer`, le panneau plein écran intégré d'Alanya, sans téléchargement externe imposé. Les PDF utilisent PDF.js dans ce panneau ; les textes sont lus dans un lecteur monospace ; les formats Office restent affichés par Office Online dans le panneau.

Les coordonnées GPS sont maintenant affichées une seule fois, sous la mini-carte OpenStreetMap. Elles sont arrondies à **six chiffres après la virgule** (`lat.toFixed(6)`, `lng.toFixed(6)`). Le texte du message est nettoyé de la paire latitude/longitude déjà représentée par la carte, afin d'éviter le doublon placé au-dessus.

## Technologies utilisées par format

- **React 18 + TypeScript** : composants, état et isolation d'erreur par message ;
- **Vite** : construction du frontend ;
- **Vercel Serverless Function** : `api/media-proxy/[id].js`, proxy same-origin ;
- **Fetch + Bearer JWT Alanya** : autorisation des lectures de médias ;
- **Backblaze B2** : stockage effectif, atteint indirectement par le backend puis le proxy ;
- **IndexedDB + idb** : cache local des blobs validés (`previewMedia`) ;
- **PDF.js (`pdfjs-dist`)** : rendu canvas des PDF ;
- **Office Online Viewer** : rendu `.doc/.docx`, `.xls/.xlsx`, `.ppt/.pptx` ;
- **HTML5 `<img>`, `<audio>`, `<video>`** : médias visuels et sonores ;
- **OpenStreetMap embed** : mini-carte des positions partagées.

Le proxy B2 est le correctif essentiel au problème `Failed to fetch` : les redirections B2 sont suivies côté serveur Vercel, où CORS ne bloque pas, puis le navigateur reçoit le contenu depuis le domaine Alanya/Vercel. Une réponse B2 réelle de quota ou `AccessDenied` reste volontairement visible comme erreur, car le proxy ne contourne jamais les droits ni le quota du stockage.

### Accès unique à la visionneuse agrandie

Les icônes superposées directement sur les previews ont été retirées afin de préserver la lisibilité et le design des cartes médias. L'unique action d'agrandissement est désormais **Agrandir**, présente dans le menu contextuel `⋮` du message, avec Répondre, Copier et Transférer. Cette action ouvre `DocumentViewer` avec l'URL, le nom et le type MIME du média. Elle est proposée uniquement lorsqu'un média est attaché au message.

### Ouverture rapide par double interaction

Sur un aperçu documentaire, un **double-clic** PC ou un **double-tap** tactile (deux taps en moins de 320 ms) ouvre également `DocumentViewer`. Le geste est limité aux previews qui possèdent un média ; il ne remplace pas le menu `⋮ → Agrandir`, qui reste l'action explicite accessible.

### Menus contextuels et pièce jointe

Le menu d'actions `⋮` d'un message utilise un écouteur `pointerdown` : dès qu'un clic ou un tap survient hors de sa fenêtre, il se ferme. Le sélecteur de pièce jointe applique le même comportement, tout en s'ouvrant explicitement par clic/tap sur le trombone (et par survol sur ordinateur, conformément au comportement demandé précédemment).

### Audio et composeur

Le menu `⋮` d'un message audio contient l'action **Télécharger l’audio**. Elle crée un lien temporaire vers l'URL média avec `download=1`, pour demander au backend un téléchargement forcé tout en gardant les contrôles d'accès. Le texte d'aide sous le composeur a été retiré et la zone de saisie garde son ancrage au bas (`bottom`) du panneau de conversation, sans espace d'information supplémentaire.
