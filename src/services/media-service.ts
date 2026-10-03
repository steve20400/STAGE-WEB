import { apiRequest } from "../lib/api-client"
import { API_BASE_URL } from "../config/runtime"
import { loadSessionToken } from "../data/session-auth"

export interface UploadedMedia {
  id: string
  /** URL relative proxyfiee par le backend : /api/media/{id} */
  url: string
  /**
   * L'adresse FIXE du fichier, quand il est parti dans le bucket ouvert.
   *
   * `null` dans tous les autres cas — et c'est le cas normal : la quasi-totalite
   * des medias reste privee. Ne jamais la lire sans repli sur `url`.
   */
  urlPublique?: string | null
  mimeType: string
  sizeBytes: number
  durationMs: number | null
}

/**
 * CE QUE CE FICHIER VA SERVIR — ET DONC OU LE SERVEUR VA LE RANGER.
 *
 * 🔴 DEUX USAGES SEULEMENT, ET LA LISTE EST CLOSE. Un accueil de repondeur et
 * une sonnerie sont entendus par TOUS ceux qui appellent : les publier ne
 * devoile rien qui ne soit deja devoile, et leur adresse devient fixe, donc
 * mise en cache par le navigateur pendant un an. C'est ce qui permet a l'accueil
 * de partir a l'instant ou la sonnerie s'arrete.
 *
 * ⚠️ RIEN D'AUTRE NE DOIT PORTER D'USAGE. Un message laisse PAR quelqu'un sur
 * un repondeur est un enregistrement prive ; une photo de discussion aussi. Le
 * serveur refuse d'ailleurs tout usage qu'il ne connait pas et range en prive —
 * mais la premiere protection, c'est de ne pas l'ecrire ici.
 */
export type UsageMedia = "accueil" | "sonnerie"

/**
 * POST /api/media — upload multipart (champ "file").
 * durationMs est fourni pour l'audio/video (affichage cote destinataire).
 *
 * `usage` est OPTIONNEL et le reste : sans lui, le fichier va dans le stockage
 * prive, ce qui est le bon defaut. Le nommer est un choix, jamais un oubli.
 */
export async function uploadMedia(
  file: File | Blob,
  filename: string,
  durationMs?: number,
  usage?: UsageMedia
): Promise<UploadedMedia> {
  const form = new FormData()
  form.append("file", file, filename)
  if (durationMs && Number.isFinite(durationMs)) {
    form.append("durationMs", String(Math.round(durationMs)))
  }
  if (usage) form.append("usage", usage)
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

/**
 * L'adresse JOUABLE d'un son du standard (invite, musique d'attente, son de
 * touche, bip de plainte).
 *
 * 🐛 « LE WEB NE SUIT AUCUN AUDIO QUAND ON APPELLE UN CENTRE D'APPELS OU UN
 * CENTRE VOCAL » (user, 03/10/2026). Ces sons vivent sur le serveur de la
 * plateforme de l'equipe — `https://open.alanya.cloud`, et parfois une
 * adresse en HTTP clair. La CSP du web (`media-src`) refuse le premier, la
 * regle du contenu mixte interdit le second a une page HTTPS : le navigateur
 * se taisait. Le telephone, sans CSP ni contenu mixte, entendait tout.
 *
 * ⚠️ UN SON D'UNE AUTRE ORIGINE PASSE PAR LE RELAIS DU SERVEUR
 * (`/api/ivr/son`), qui ne relaie que les hotes que la plateforme reference
 * elle-meme. Un son de notre origine, `blob:` ou `data:` reste tel quel.
 */
export function urlSonStandard(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^(blob:|data:)/.test(url) || url.startsWith("/")) return url
  let origineSon: string
  try {
    origineSon = new URL(url).origin
  } catch {
    return url
  }
  const nous = new URL(API_BASE_URL || window.location.origin, window.location.origin).origin
  if (origineSon === nous || origineSon === window.location.origin) return url
  const token = loadSessionToken() ?? ""
  return `${API_BASE_URL}/api/ivr/son?u=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`
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
