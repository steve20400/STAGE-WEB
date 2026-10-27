import { resolveMediaUrl, uploadMedia } from "../services/media-service"
import { langueInitiale, traduire } from "../i18n"

/**
 * Avatars : le backend stocke avatarUrl et n'accepte que deux formes
 * (updateProfileSchema) — une URL absolue http(s) ou une URL de media
 * `/api/media/{id}`. Une data-URL est donc REFUSEE (422). On genere une
 * miniature carree, on la televerse via POST /api/media, puis on enregistre
 * son URL relative : le backend autorise explicitement la lecture d'un media
 * utilise comme avatar par n'importe quel utilisateur authentifie, donc la
 * photo est bien visible par les contacts (web et mobile).
 */

/** Cote de la miniature carree enregistree comme avatar. */
const AVATAR_SIZE = 256
const AVATAR_QUALITY = 0.82

/** Miniature data-URL, utilisee pour l'apercu immediat avant enregistrement. */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)

  try {
    const canvas = document.createElement("canvas")
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error(traduire(langueInitiale(), "core_canvas_unavailable"))

    // Recadrage carre centre (comme un avatar classique).
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)

    return canvas.toDataURL("image/jpeg", AVATAR_QUALITY)
  } finally {
    bitmap.close()
  }
}

/**
 * Les octets d'une data-URL, SANS passer par `fetch`.
 *
 * 🐛 « ON N'ARRIVE PAS À CHANGER DE PHOTO DE PROFIL, ÇA DIT QU'ON N'ARRIVE PAS
 * À JOINDRE LE SERVEUR » (user, 27/10/2026). Le serveur n'avait jamais été
 * appelé : c'est `fetch(dataUrl)` qui échouait, refusé par NOTRE PROPRE
 * politique de sécurité. `connect-src` gouverne tous les `fetch`, y compris
 * ceux d'une adresse `data:`, et `data:` n'y figure pas — le navigateur rendait
 * donc une panne réseau, que l'application a traduite par le seul message
 * qu'elle connaît pour ça : « impossible de joindre le serveur ».
 *
 * 🔴 ON DÉCODE AU LIEU D'ÉLARGIR LA CSP. Ajouter `data:` à `connect-src`
 * aurait marché, mais une data-URL ne désigne que des octets que la page tient
 * déjà : la demander au navigateur par une requête réseau était un détour, pas
 * un besoin. Le décodage local marche sous n'importe quelle politique.
 *
 * ⚠️ C'EST LE TROISIÈME DÉFAUT DE CETTE FAMILLE : `blob:` manquait pour
 * l'aperçu des PDF (06/10), un hôte d'images manquait pour les avatars de
 * l'équipe (02/10). Une ressource lue par `fetch` doit être déclarée dans
 * `connect-src`, ou ne pas passer par `fetch`.
 */
function octetsDepuisDataUrl(dataUrl: string): Blob {
  const virgule = dataUrl.indexOf(",")
  if (virgule < 0) throw new Error(traduire(langueInitiale(), "core_canvas_unavailable"))
  const entete = dataUrl.slice(0, virgule)
  const charge = dataUrl.slice(virgule + 1)
  const mime = /^data:([^;,]+)/.exec(entete)?.[1] ?? "application/octet-stream"

  // Nos miniatures sortent de `toDataURL`, donc toujours en base64 ; l'autre
  // forme est gérée pour que la fonction ne mente pas sur ce qu'elle accepte.
  if (!/;base64/i.test(entete)) {
    return new Blob([decodeURIComponent(charge)], { type: mime })
  }
  const brut = atob(charge)
  const octets = new Uint8Array(brut.length)
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i)
  return new Blob([octets], { type: mime })
}

/**
 * Televerse une miniature d'avatar (data-URL produite ci-dessus) et renvoie
 * l'URL relative `/api/media/{id}` a enregistrer dans le profil.
 */
export async function uploadAvatarDataUrl(dataUrl: string): Promise<string> {
  const media = await uploadMedia(octetsDepuisDataUrl(dataUrl), "avatar.jpg")
  return media.url
}

/**
 * URL affichable pour un avatar quel que soit son format :
 * - data-URL (apercu local avant enregistrement) -> telle quelle ;
 * - URL absolue http(s) -> telle quelle ;
 * - URL relative backend (/api/media/...) -> completee avec le token.
 */
export function avatarDisplaySrc(avatar?: string | null): string | null {
  if (!avatar) return null
  if (avatar.startsWith("data:") || /^https?:\/\//.test(avatar)) return avatar
  return resolveMediaUrl(avatar)
}
