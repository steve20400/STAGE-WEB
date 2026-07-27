import { initIndexedDB } from "../indexedDB/schema"
import { loadSessionToken } from "../data/session-auth"

/** Taille maximale volontaire pour éviter de remplir le stockage du téléphone. */
const MAX_CACHED_PREVIEW_BYTES = 30 * 1024 * 1024

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

/** URL du proxy pour un média backend, ou null si l'URL n'en est pas un. */
function mediaProxyUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin)
    const match = parsed.pathname.match(/\/api\/media\/([a-zA-Z0-9-]+)$/)
    return match ? `/api/media-proxy/${match[1]}` : null
  } catch {
    return null
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
      if (proxyResponse.ok) {
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
    response = await fetch(url, { credentials: "same-origin", headers })
  }
  if (!response.ok) throw new Error(`Chargement échoué (${response.status})`)
  const blob = await response.blob()
  if (blob.size <= MAX_CACHED_PREVIEW_BYTES) {
    try {
      const db = await initIndexedDB()
      await db.put("previewMedia", { key, blob, cachedAt: Date.now() } satisfies CachedPreview)
    } catch {
      // Quota/IndexedDB indisponible : l'aperçu courant reste affichable.
    }
  }
  return blob
}
