import { resolveMediaUrl } from "../services/media-service"

/**
 * Avatars : le backend stocke avatarUrl (max 2048 caracteres, format URL).
 * On encode donc la photo en miniature JPEG data-URL qui tient dans cette
 * limite : lisible par tous les clients (web et mobile) sans aucun probleme
 * de droits d'acces, et persistee en base -> survit aux reconnexions.
 */

const AVATAR_URL_MAX_CHARS = 2000 // marge sous la limite backend (2048)

/**
 * Reduit une image en miniature carree et la compresse jusqu'a tenir dans
 * la limite. Essaie plusieurs tailles/qualites decroissantes.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)

  const attempts: Array<{ size: number; quality: number }> = [
    { size: 96, quality: 0.7 },
    { size: 80, quality: 0.6 },
    { size: 64, quality: 0.55 },
    { size: 56, quality: 0.5 },
    { size: 48, quality: 0.45 },
    { size: 40, quality: 0.4 },
  ]

  for (const { size, quality } of attempts) {
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas indisponible dans ce navigateur.")

    // Recadrage carre centre (comme un avatar classique).
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)

    const dataUrl = canvas.toDataURL("image/jpeg", quality)
    if (dataUrl.length <= AVATAR_URL_MAX_CHARS) {
      bitmap.close()
      return dataUrl
    }
  }

  bitmap.close()
  throw new Error("Image trop complexe : choisissez une photo plus simple.")
}

/**
 * URL affichable pour un avatar quel que soit son format :
 * - data-URL (miniature) -> telle quelle ;
 * - URL absolue http(s) -> telle quelle ;
 * - URL relative backend (/api/media/...) -> completee avec le token.
 */
export function avatarDisplaySrc(avatar?: string | null): string | null {
  if (!avatar) return null
  if (avatar.startsWith("data:") || /^https?:\/\//.test(avatar)) return avatar
  return resolveMediaUrl(avatar)
}
