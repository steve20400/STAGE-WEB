/**
 * URL d'un fichier de `public/`, prefixee par le chemin de base du deploiement.
 *
 * En production l'application est servie depuis `/webapp/`. Un chemin ecrit en
 * dur comme `/sounds/incoming_ring.mp3` pointe alors sur la racine du domaine,
 * ou ce fichier n'existe pas : sonde du 31/07/2026 sur alanyavox.com —
 * `/sounds/incoming_ring.mp3` repond 404 en text/html, `/webapp/sounds/...`
 * repond 200 en audio/mpeg. Les sons ne jouaient donc jamais en production,
 * alors qu'ils fonctionnent en developpement, ou la base est `/`.
 *
 * `import.meta.env.BASE_URL` porte exactement ce prefixe, avec sa barre finale,
 * et vaut `/` en developpement : le meme code marche des deux cotes.
 */
export function publicAsset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`
}
