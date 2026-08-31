import { apiRequest } from "../lib/api-client"
import { API_BASE_URL } from "../config/runtime"
import { loadSessionToken } from "../data/session-auth"

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
  // Si c'est déjà une URL HTTP/HTTPS externe complète, la retourner directement
  if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl
  const base = `${API_BASE_URL}${relativeUrl}`
  const token = loadSessionToken() ?? ""
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

/**
 * TAILLE MAXIMALE D'UN MEDIA, EN OCTETS — la meme que celle du serveur.
 *
 * ⚠️ L'ECRAN ACCEPTAIT 2 Go LA OU LE SERVEUR EN REFUSE 50 Mo. Un fichier de
 * 300 Mo passait donc le controle local, se televersait EN ENTIER — plusieurs
 * minutes sur un reseau mobile, et autant de donnees payees — puis revenait en
 * 413. L'utilisateur payait le transfert d'un fichier qui n'avait aucune chance
 * d'etre accepte, et rien ne le lui disait avant la fin.
 *
 * `MEDIA_MAX_SIZE_MB` cote serveur vaut 50 par defaut (`src/lib/env.ts`). Si tu
 * la changes la-bas, change-la ICI : les deux bornes doivent rester egales,
 * sinon l'une des deux ment. Refuser un peu tot vaut mieux que refuser trop
 * tard — un fichier refuse a l'ecran ne coute rien.
 */
export const TAILLE_MEDIA_MAX_MO = 50
export const TAILLE_MEDIA_MAX_OCTETS = TAILLE_MEDIA_MAX_MO * 1024 * 1024
