# Proxy Vercel des aperçus média

## Problème résolu

Avant l'envoi, un fichier sélectionné est lu depuis une URL locale `blob:` : son aperçu fonctionne. Après confirmation du backend, l'URL devient `/api/media/<id>`. Le backend peut rediriger cette requête vers Backblaze B2. Un navigateur ne peut pas toujours lire le résultat redirigé avec `fetch`, car le CDN B2 peut ne pas fournir les en-têtes CORS nécessaires. Le symptôme est `Failed to fetch`, chez l'émetteur comme chez le destinataire.

## Solution frontend

La fonction Vercel `api/media-proxy/[id].js` est dans le dépôt frontend. Pour les aperçus texte, CSV et PDF :

1. le navigateur envoie le Bearer token au domaine Vercel de l'application ;
2. la fonction Vercel appelle le backend `/api/media/<id>` ;
3. elle suit la redirection B2 côté serveur ;
4. elle renvoie le binaire au navigateur depuis la même origine ;
5. le visionneur intégré le lit et IndexedDB le met en cache.

Le backend n'est pas modifié. Ses contrôles d'accès restent appliqués, car le token de l'utilisateur est transmis au backend. Cette fonction ne rend aucun média public.

## Déploiement sur alanyavox.com/webapp (Nginx)

`api/media-proxy/[id].js` est une fonction **serverless Vercel**. Sur un hébergement Nginx classique, elle n'existe pas. Vérification faite le 30/07/2026 :

```
GET https://alanyavox.com/webapp/api/media-proxy/testid
→ 200  text/html  586 octets      (c'est index.html, pas le proxy)
```

Nginx applique sa réécriture SPA et renvoie `200` + `index.html` au lieu de `404`. Le frontend détecte désormais ce cas (`isSpaFallback`, réponse `text/html`) et ne met plus cette page en cache à la place du document. Sans cette détection, `index.html` était enregistrée dans IndexedDB puis relue comme un PDF ou un CSV : l'aperçu restait cassé même après correction, tant que le cache n'était pas vidé.

Le backend étant sur la même origine que l'application, il suffit de faire porter le chemin par Nginx pour retrouver un vrai proxy same-origin :

```nginx
# Aperçus média : lecture same-origin, la redirection B2 est suivie côté serveur.
location /webapp/api/media-proxy/ {
    rewrite ^/webapp/api/media-proxy/(.*)$ /api/media/$1 break;
    proxy_pass              http://127.0.0.1:3000;
    proxy_set_header        Host $host;
    proxy_set_header        Authorization $http_authorization;
    proxy_intercept_errors  off;
    proxy_buffering         off;
}
```

Le backend reste l'unique autorité : l'en-tête `Authorization` est transmis tel quel, ses contrôles d'accès s'appliquent, et aucun média ne devient public.

## Repli sans proxy

Tant que ce `location` n'est pas en place, l'aperçu PDF passe au **lecteur PDF natif du navigateur** dans une `iframe` pointant directement sur `/api/media/<id>`. Une `iframe` suit la redirection vers B2 sans être soumise à CORS, contrairement à `fetch`. Le document reste consultable et défilable dans la discussion ; seules la mise en cache hors ligne et l'uniformité de rendu de PDF.js sont perdues.

Le visionneur texte/CSV n'a pas d'équivalent natif : il a besoin des octets. Il affiche donc son erreur, accompagnée d'un lien d'ouverture directe.

## Limite

Si B2 répond réellement `AccessDenied` ou que son quota est dépassé, le proxy reçoit lui aussi cette réponse. Il peut supprimer le problème CORS, pas contourner un refus de stockage.
