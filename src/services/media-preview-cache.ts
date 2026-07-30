import { initIndexedDB } from "../indexedDB/schema"
import { loadSessionToken } from "../data/session-auth"

/** Taille maximale volontaire pour éviter de remplir le stockage du téléphone. */
const MAX_CACHED_PREVIEW_BYTES = 30 * 1024 * 1024

/**
 * Budget total du cache d'aperçus. Sans plafond global, une utilisation
 * intensive (messagerie d'entreprise, beaucoup de pièces jointes) remplit le
 * quota du navigateur : les écritures échouent alors en silence, et c'est tout
 * le stockage local de l'application qui devient fragile.
 */
const MAX_TOTAL_CACHE_BYTES = 150 * 1024 * 1024

/** Sweep d'éviction déclenché tous les 20 Mo écrits, pas à chaque aperçu. */
const EVICTION_CHECK_INTERVAL_BYTES = 20 * 1024 * 1024

/**
 * Tant que `api/media-proxy/<id>` n'était pas déployé, l'hébergement répondait
 * `200` + `index.html` au lieu de `404`. Cette page a donc été enregistrée en
 * cache à la place des PDF, CSV et fichiers texte. Le cache étant lu avant le
 * réseau, ces entrées empoisonnées survivraient au correctif : on vide
 * `previewMedia` une fois par navigateur. Changer la génération relance la purge.
 */
const PURGE_MARKER_KEY = "alanya_preview_cache_generation"
const PURGE_GENERATION = "2026-07-spa-fallback"

interface CachedPreview {
  key: string
  blob: Blob
  cachedAt: number
}

function cacheKey(url: string): string {
  if (url.startsWith("blob:") || url.startsWith("data:")) return url
  try {
    const parsed = new URL(url, window.location.origin)
    // Le token change après renouvellement : il ne doit pas invalider le cache local.
    parsed.searchParams.delete("token")
    parsed.searchParams.delete("download")
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Le proxy same-origin `api/media-proxy` est une fonction serverless du dépôt
 * front : elle n'existe que sur Vercel. En développement (`npm run dev`) ou sur
 * un autre hébergeur, elle répond 404 — on retombe alors sur l'URL backend
 * directe. Le résultat de la première tentative est mémorisé pour ne pas
 * multiplier les allers-retours inutiles.
 */
let mediaProxyAvailable: boolean | null = null

/**
 * URL du proxy pour un média backend, ou null si l'URL n'en est pas un.
 *
 * Le chemin est prefixe par BASE_URL : sous un deploiement en sous-repertoire
 * (`/webapp/`), un chemin absolu `/api/media-proxy/...` viserait la racine du
 * domaine, ou le proxy n'est pas monte.
 */
function mediaProxyUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin)
    const match = parsed.pathname.match(/\/api\/media\/([a-zA-Z0-9-]+)$/)
    if (!match) return null
    // BASE_URL se termine toujours par "/" (garanti par vite.config.ts).
    return `${import.meta.env.BASE_URL}api/media-proxy/${match[1]}`
  } catch {
    return null
  }
}

/**
 * Un hebergement statique (Nginx, `vercel.json`) reecrit les routes inconnues
 * vers `index.html`. Le proxy absent repond alors 200 avec du HTML au lieu de
 * 404 : sans ce controle, cette page serait mise en cache et lue comme un PDF
 * ou un CSV, transformant une erreur visible en corruption silencieuse.
 */
function isSpaFallback(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")
}

/** Une seule purge par session, même si dix aperçus se chargent en parallèle. */
let purgeOnce: Promise<void> | null = null

function purgePoisonedCache(): Promise<void> {
  if (!purgeOnce) {
    purgeOnce = (async () => {
      try {
        if (localStorage.getItem(PURGE_MARKER_KEY) === PURGE_GENERATION) return
        const db = await initIndexedDB()
        await db.clear("previewMedia")
        localStorage.setItem(PURGE_MARKER_KEY, PURGE_GENERATION)
      } catch {
        // Sans stockage, il n'y a rien de périmé à purger.
      }
    })()
  }
  return purgeOnce
}

/** Octets écrits depuis le dernier sweep : évite de recompter à chaque aperçu. */
let bytesSinceEviction = 0

/**
 * Retire les entrées les plus anciennes tant que le cache dépasse son budget.
 * L'ordre suit `cachedAt`, l'index déjà présent dans le schéma.
 */
async function evictOldestIfNeeded(): Promise<void> {
  if (bytesSinceEviction < EVICTION_CHECK_INTERVAL_BYTES) return
  bytesSinceEviction = 0
  try {
    const db = await initIndexedDB()
    const entries = (await db.getAllFromIndex("previewMedia", "cachedAt")) as CachedPreview[]
    let total = entries.reduce((sum, entry) => sum + (entry.blob?.size ?? 0), 0)
    for (const entry of entries) {
      if (total <= MAX_TOTAL_CACHE_BYTES) break
      await db.delete("previewMedia", entry.key)
      total -= entry.blob?.size ?? 0
    }
  } catch {
    // Le cache reste une optimisation : son entretien ne doit rien interrompre.
  }
}

/**
 * Lit d'abord IndexedDB, puis le réseau seulement une fois. Les blobs sont
 * utilisables hors connexion tant que l'utilisateur n'a pas vidé ses données.
 */
export async function loadPreviewBlob(url: string): Promise<Blob> {
  if (url.startsWith("blob:")) {
    const response = await fetch(url)
    if (!response.ok) throw new Error("Fichier local introuvable")
    return response.blob()
  }

  const key = cacheKey(url)
  await purgePoisonedCache()
  // IndexedDB peut être indisponible (navigation privée, quota, migration bloquée) :
  // le cache est une optimisation et ne doit jamais empêcher l'aperçu réseau.
  try {
    const db = await initIndexedDB()
    const cached = await db.get("previewMedia", key) as CachedPreview | undefined
    if (cached?.blob) return cached.blob
  } catch {
    // Continuer avec le téléchargement réseau.
  }

  // Le backend accepte le Bearer et aussi ?token=. Le header est indispensable
  // lorsqu'un navigateur/mobile retire ou ne transmet pas le paramètre après une redirection.
  const token = loadSessionToken()
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined

  let response: Response | null = null
  const proxied = mediaProxyAvailable === false ? null : mediaProxyUrl(url)
  if (proxied) {
    try {
      const proxyResponse = await fetch(proxied, { credentials: "same-origin", headers })
      if (proxyResponse.ok && isSpaFallback(proxyResponse)) {
        // 200 + text/html = reecriture SPA, pas le proxy. Aucun media n'est HTML.
        mediaProxyAvailable = false
      } else if (proxyResponse.ok) {
        mediaProxyAvailable = true
        response = proxyResponse
      } else if (proxyResponse.status === 404 || proxyResponse.status === 405) {
        // Pas de proxy sur cet hébergement : on n'y reviendra plus.
        mediaProxyAvailable = false
      } else {
        // 401/403/502… : erreur réelle, inutile de réessayer en direct.
        response = proxyResponse
      }
    } catch {
      mediaProxyAvailable = false
    }
  }

  if (!response) {
    try {
      response = await fetch(url, { credentials: "same-origin", headers })
    } catch {
      // Sans proxy same-origin, la redirection du backend vers Backblaze B2 est
      // cross-origin : le navigateur bloque la lecture si B2 n'envoie pas les
      // en-tetes CORS. C'est le cas typique quand `api/media-proxy` n'est pas
      // deploye sur l'hebergement (voir MEDIA_PREVIEW_PROXY.md).
      throw new Error("Aperçu indisponible : le fichier n'a pas pu être lu depuis le stockage.")
    }
  }
  if (!response.ok) throw new Error(`Chargement échoué (${response.status})`)
  // Pas de controle text/html ici : un .html envoye par un utilisateur est un
  // media legitime, lu comme source par le visionneur texte.
  const blob = await response.blob()
  if (blob.size <= MAX_CACHED_PREVIEW_BYTES) {
    try {
      const db = await initIndexedDB()
      await db.put("previewMedia", { key, blob, cachedAt: Date.now() } satisfies CachedPreview)
      bytesSinceEviction += blob.size
      await evictOldestIfNeeded()
    } catch {
      // Quota/IndexedDB indisponible : l'aperçu courant reste affichable.
    }
  }
  return blob
}
