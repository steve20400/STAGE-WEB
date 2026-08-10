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
 * Televerse une miniature d'avatar (data-URL produite ci-dessus) et renvoie
 * l'URL relative `/api/media/{id}` a enregistrer dans le profil.
 */
export async function uploadAvatarDataUrl(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob()
  const media = await uploadMedia(blob, "avatar.jpg")
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
