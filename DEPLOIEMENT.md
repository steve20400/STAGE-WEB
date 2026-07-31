# Déploiement sur alanyavox.com/webapp/

Le client web est servi par Nginx depuis un sous-répertoire, `/webapp/`. La racine
du domaine, elle, sert le backend Next.js — les deux cohabitent sur le même VPS.

## Procédure

Sur le serveur, dans le dossier du dépôt :

```bash
git pull origin main
npm ci
npm run build
```

`npm run build` suffit : le mode production charge `.env.production`, qui porte
`VITE_APP_BASE_PATH=/webapp/`. Les actifs sont donc écrits en `/webapp/assets/…`,
ce que Nginx sert correctement.

Puis publier le contenu de `dist/` à l'emplacement servi par Nginx pour
`/webapp/` (le dossier exact dépend de la configuration du serveur ; c'est le même
que celui utilisé jusqu'ici).

## Vérification en trois commandes

Après publication, depuis n'importe quelle machine :

```bash
curl -s https://alanyavox.com/webapp/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

Comparer l'empreinte obtenue avec celle du build local (`ls dist/assets/index-*.js`).
Si elles diffèrent, la publication n'a pas pris.

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://alanyavox.com/webapp/manifest.json
```

Doit répondre `200 application/json`. Un `404` signifie que `dist/` n'a pas été
copié entièrement.

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://alanyavox.com/webapp/sounds/incoming_ring.mp3
```

Doit répondre `200 audio/mpeg`. Les sons, le manifeste et les icônes viennent de
`public/` : ils doivent être publiés avec le reste, pas seulement `assets/`.

## Le piège à connaître

Un `npm run build` lancé **sans** `.env.production` — ou avec une variable
`VITE_APP_BASE_PATH` vide — produit des chemins en `/assets/…`. L'application
paraît alors totalement cassée en production : page blanche, tous les actifs en 404. C'est arrivé, et c'est la raison pour laquelle cette variable est désormais
inscrite dans le dépôt plutôt que passée à la main.

Le CI vérifie ce point à chaque push : il échoue si `dist/index.html` ne référence
pas `/webapp/assets/`.

## Ce que le CI ne fait pas

Il ne déploie rien. Il compile et contrôle, c'est tout. La mise en ligne reste un
`git pull` puis un build sur le serveur.
