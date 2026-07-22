import { initIndexedDB } from "../indexedDB/schema"

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
  const db = await initIndexedDB()
  const cached = await db.get("previewMedia", key) as CachedPreview | undefined
  if (cached?.blob) return cached.blob

  const response = await fetch(url, { credentials: "same-origin" })
  if (!response.ok) throw new Error(`Chargement échoué (${response.status})`)
  const blob = await response.blob()
  if (blob.size <= MAX_CACHED_PREVIEW_BYTES) {
    await db.put("previewMedia", { key, blob, cachedAt: Date.now() } satisfies CachedPreview)
  }
  return blob
}
