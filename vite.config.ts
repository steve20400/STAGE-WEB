import { defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"

/**
 * LA POLITIQUE DE SÉCURITÉ DU CONTENU (CSP) — ticket 5.2 du plan E2EE.
 *
 * 🔴 CE QU'ELLE PROTÈGE, ET QUE RIEN D'AUTRE NE PROTÈGE. Le coffre chiffré
 * empêche d'EMPORTER les clés privées : elles sont scellées par une clé non
 * extractible, et le navigateur refuse de les exporter. Il n'empêche PAS un
 * script hostile de s'en SERVIR SUR PLACE — de déchiffrer les messages dans
 * l'onglet et de les envoyer ailleurs.
 *
 * La CSP est la seule défense contre cela : elle dit d'où le code peut venir,
 * et où les données peuvent aller.
 *
 * ⚠️ `script-src` N'A PAS `'unsafe-inline'`, ET C'EST TOUT L'INTÉRÊT. Le reste
 * de la politique peut être discuté ; cette ligne-là est la fonctionnalité. La
 * construction de production ne produit AUCUN script en ligne — vérifié dans
 * `dist/index.html` — donc rien ne pousse à l'assouplir.
 *
 * ⚠️ `style-src` GARDE `'unsafe-inline'`, et ce n'est pas un oubli. L'application
 * pose 38 balises `<style>` et 209 attributs `style` — mesurés, pas supposés.
 * Les remplacer par des empreintes ou des nonces demanderait de réécrire toute
 * la mise en forme. Le risque résiduel est l'exfiltration par sélecteur CSS,
 * très inférieur à l'exécution de code.
 *
 * ⚠️ CE QU'UNE BALISE `<meta>` NE SAIT PAS FAIRE : `frame-ancestors`,
 * `report-uri` et `sandbox` sont ignorés là. Ils doivent être posés en EN-TÊTE
 * HTTP par le serveur. Le nécessaire est écrit dans `docs/CSP-DEPLOIEMENT.md` —
 * sans lui, la protection contre le détournement de clic reste absente.
 */
function politiqueSecurite(apiBaseUrl: string, wsUrl: string): string {
  const api = apiBaseUrl.replace(/\/$/, "")

  /*
   * 🐛 L'ADRESSE WEBSOCKET NE SE DÉDUIT PAS DE CELLE DE L'API, et le banc l'a
   * prouvé. `VITE_WS_URL` existe et vaut `wss://alanyavox.com/ws` en
   * production, indépendamment de `VITE_API_BASE_URL`. La politique déduisait
   * `ws://…` de l'API et bloquait donc la VRAIE connexion.
   *
   * ⚠️ CE DÉFAUT AURAIT ÉTÉ SILENCIEUX ET GRAVE : l'application se charge, on
   * se connecte, on lit ses messages — et plus rien n'arrive en temps réel. On
   * aurait cherché du côté du serveur pendant des heures.
   *
   * On lit donc la variable quand elle existe, et on ne déduit qu'à défaut.
   */
  const ws = (wsUrl || api).replace(/^http/, "ws")

  /*
   * ⚠️ LES ORIGINES DE L'API SONT TOUJOURS NOMMÉES, même en production où elles
   * coïncident avec `'self'` (alanyavox.com sert le site ET l'API). La
   * répétition ne coûte rien, et elle garde la politique juste le jour où les
   * deux seront séparés — ce qui arrivera sans qu'on pense à revenir ici.
   */
  /*
   * ⚠️ UNE DIRECTIVE CSP PORTE SUR L'ORIGINE, pas sur le chemin :
   * `wss://alanyavox.com/ws` doit s'écrire `wss://alanyavox.com`. Laisser le
   * chemin restreint la correspondance et bloque tout ce qui n'y ressemble pas
   * exactement.
   */
  const origine = (u: string) => {
    try {
      return new URL(u).origin
    } catch {
      return u
    }
  }
  const origines = [origine(api), origine(ws)]

  const regles: Record<string, string[]> = {
    "default-src": ["'self'"],
    /* Rien ne doit pouvoir réécrire l'URL de base des ressources relatives. */
    "base-uri": ["'self'"],
    /* Plus aucun usage légitime des greffons. */
    "object-src": ["'none'"],
    /*
     * `www.gstatic.com` : le service worker de Firebase y charge le SDK par
     * `importScripts`. Sans lui, les notifications push cessent de fonctionner.
     *
     * 🐛 `'wasm-unsafe-eval'` A ÉTÉ AJOUTÉ APRÈS COUP, ET SON ABSENCE CASSAIT LE
     * CHIFFREMENT LUI-MÊME. Le banc a signalé `script-src → wasm-eval` : sans
     * cette autorisation, le navigateur refuse d'instancier le moindre module
     * WebAssembly. Or DEUX pièces essentielles en sont faites — Argon2id
     * (`hash-wasm`, la serrure « mot de passe ») et Curve25519
     * (`@privacyresearch/curve25519-typescript`, tout le protocole Signal).
     *
     * ⚠️ UNE CSP QUI CASSE LE CHIFFREMENT QU'ELLE PROTÈGE est le pire des deux
     * mondes : on croit avoir durci, et on a désactivé.
     *
     * ⚠️ CE N'EST PAS `'unsafe-eval'`. La directive large autoriserait
     * `eval()` sur du JavaScript, donc l'exécution de code arbitraire — soit
     * exactement ce que cette politique existe pour empêcher.
     * `'wasm-unsafe-eval'` n'ouvre QUE WebAssembly, dont les modules sont
     * livrés avec l'application et ne se fabriquent pas à la volée depuis une
     * chaîne de caractères.
     */
    "script-src": ["'self'", "'wasm-unsafe-eval'", "https://www.gstatic.com"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    /*
     * `blob:` sert aux aperçus de fichiers ; `data:` aux avatars encodés. Les
     * images ne s'exécutent pas — le risque est l'exfiltration par URL, et il
     * est borné à notre propre origine.
     */
    "img-src": ["'self'", "data:", "blob:"],
    "media-src": ["'self'", "blob:", "data:"],
    /*
     * 🔴 LA LIGNE QUI DÉCIDE OÙ LES MESSAGES DÉCHIFFRÉS PEUVENT ALLER. Un script
     * hostile qui lirait le coffre ne pourrait rien en faire sortir ailleurs
     * que vers nos propres serveurs.
     *
     * `*.googleapis.com` est nécessaire à l'enregistrement FCM
     * (`fcmregistrations`, `firebaseinstallations`).
     */
    "connect-src": ["'self'", ...origines, "https://*.googleapis.com"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "form-action": ["'self'"],
    "frame-src": ["'none'"],
  }

  return Object.entries(regles)
    .map(([nom, valeurs]) => `${nom} ${valeurs.join(" ")}`)
    .join("; ")
}

/**
 * Pose la politique dans `index.html` — À LA CONSTRUCTION SEULEMENT.
 *
 * 🐛 ELLE A D'ABORD ÉTÉ POSÉE AUSSI EN DÉVELOPPEMENT, et l'application ne
 * s'affichait plus : le serveur de Vite injecte ses propres scripts EN LIGNE
 * pour le rechargement à chaud, et `script-src 'self'` les refuse — à juste
 * titre.
 *
 * ⚠️ ASSOUPLIR LA POLITIQUE POUR LE DÉVELOPPEMENT AURAIT ÉTÉ LE PIRE CHOIX :
 * on aurait éprouvé une politique qui n'est pas celle qui part en production.
 * On la pose donc sur l'ARTEFACT LIVRÉ, et le banc `e2ee-csp.mjs` construit
 * puis sert cet artefact pour l'éprouver — c'est le seul qui compte.
 */
function greffonCsp(apiBaseUrl: string, wsUrl: string): Plugin {
  return {
    name: "alanya-csp",
    apply: "build",
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content: politiqueSecurite(apiBaseUrl, wsUrl),
            },
            injectTo: "head-prepend",
          },
        ],
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const base = env.VITE_APP_BASE_PATH || "/"
  const api = env.VITE_API_BASE_URL || "https://alanyavox.com"
  const ws = env.VITE_WS_URL || ""

  return {
    plugins: [react(), greffonCsp(api, ws)],
    base: base.endsWith("/") ? base : `${base}/`,
  }
})
