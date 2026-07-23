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

## Limite

Si B2 répond réellement `AccessDenied` ou que son quota est dépassé, le proxy reçoit lui aussi cette réponse. Il peut supprimer le problème CORS, pas contourner un refus de stockage.
