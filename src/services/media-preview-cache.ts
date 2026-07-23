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

/** Route le fetch de preview par le proxy same-origin Vercel quand l'URL est un média backend. */
function previewRequestUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    const match = parsed.pathname.match(/\/api\/media\/([a-zA-Z0-9-]+)$/)
    return match ? `/api/media-proxy/${match[1]}` : url
  } catch {
    return url
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
  const response = await fetch(previewRequestUrl(url), {
    credentials: "same-origin",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
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
