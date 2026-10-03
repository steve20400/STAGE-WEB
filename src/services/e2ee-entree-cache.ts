import type { DescripteurMedia } from "./e2ee-media"

/**
 * L'ENTRÉE DU CACHE LOCAL pour un message déchiffré — texte, ou média chiffré.
 *
 * 🔴 UNE SEULE FABRIQUE, POUR LES DEUX ENTRÉES. La relève (`e2ee-releve.ts`) et
 * la restauration depuis l'archive (`restauration.tsx`) écrivaient chacune
 * leur propre entrée, avec `type: "TEXT"` en dur. Le jour des médias, l'une
 * aurait appris à les ranger et pas l'autre : une photo relevée en direct se
 * serait affichée, la même restaurée sur un autre ordinateur non.
 *
 * Un média chiffré se range COMPLET : type du message déduit du vrai type du
 * fichier, et ligne de média reconstruite à partir du descripteur. Le fil peut
 * ainsi l'afficher hors ligne, avant même que le serveur ait rendu la sienne.
 */
export function entreeCacheDechiffree(m: {
  id: string
  convId: string
  expediteurId: string
  texte: string
  quand: number
  media?: DescripteurMedia
}) {
  return {
    id: m.id,
    conversationId: m.convId,
    senderId: m.expediteurId,
    content: m.texte,
    type: typeDuMessage(m.media),
    status: "SENT",
    createdAt: m.quand,
    ...(m.media
      ? {
          // Ce que le serveur rendrait pour ce média : un fichier neutre,
          // marqué chiffré. Le vrai nom et le vrai type sont dans `mediaChiffre`.
          media: [
            {
              id: m.media.id,
              url: `/api/media/${m.media.id}`,
              filename: "chiffre.bin",
              mimeType: "application/octet-stream",
              sizeBytes: 0,
              chiffre: true,
            },
          ],
          mediaChiffre: m.media,
        }
      : {}),
  }
}

/** Le type de message que le serveur connaît, déduit du vrai type du fichier. */
export function typeDuMessage(media?: DescripteurMedia): "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "FILE" {
  if (!media) return "TEXT"
  if (media.mime.startsWith("image/")) return "IMAGE"
  if (media.mime.startsWith("video/")) return "VIDEO"
  if (media.mime.startsWith("audio/")) return "AUDIO"
  return "FILE"
}
