import { apiRequest } from "../lib/api-client"
import { loadSessionToken } from "../data/session-auth"

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "")

export interface UploadedMedia {
  id: string
  /** URL relative proxyfiee par le backend : /api/media/{id} */
  url: string
  mimeType: string
  sizeBytes: number
  durationMs: number | null
}

/**
 * POST /api/media — upload multipart (champ "file").
 * durationMs est fourni pour l'audio/video (affichage cote destinataire).
 */
export async function uploadMedia(
  file: File | Blob,
  filename: string,
  durationMs?: number
): Promise<UploadedMedia> {
  const form = new FormData()
  form.append("file", file, filename)
  if (durationMs && Number.isFinite(durationMs)) {
    form.append("durationMs", String(Math.round(durationMs)))
  }
  return apiRequest<UploadedMedia>("/api/media", { method: "POST", body: form })
}

/**
 * Transforme une URL relative backend (/api/media/{id}) en URL absolue utilisable
 * dans <img>/<audio>/<video>. Les balises ne peuvent pas envoyer d'en-tete
 * Authorization : le backend accepte ?token= pour ce cas (prevu pour le web).
 */
export function resolveMediaUrl(relativeUrl: string, options?: { download?: boolean }): string {
  if (!relativeUrl) return ""
  // Ignorer les URLs locales générées côté client (blob:, data:)
  if (/^(blob:|data:)/.test(relativeUrl)) return relativeUrl
  const token = loadSessionToken() ?? ""
  // En production Vercel, tous les binaires /api/media passent par notre proxy
  // same-origin. Cela couvre aussi <img>, avatars et Office Online, qui ne
  // peuvent pas envoyer eux-mêmes un header Authorization après une redirection B2.
  const mediaId = relativeUrl.match(/\/api\/media\/([a-zA-Z0-9-]+)/)?.[1]
  if (import.meta.env.PROD && mediaId) {
    const query = new URLSearchParams({ token })
    if (options?.download) query.set("download", "1")
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return `${origin}/api/media-proxy/${mediaId}?${query.toString()}`
  }
  const base = /^https?:\/\//.test(relativeUrl) ? relativeUrl : `${API_BASE_URL}${relativeUrl}`
  const sep = base.includes("?") ? "&" : "?"
  const download = options?.download ? "&download=1" : ""
  return `${base}${sep}token=${encodeURIComponent(token)}${download}`
}

/** Duree "mm:ss" a partir de millisecondes. */
export function formatAudioDuration(durationMs?: number): string {
  if (!durationMs || durationMs <= 0) return "--:--"
  const totalSec = Math.round(durationMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}
