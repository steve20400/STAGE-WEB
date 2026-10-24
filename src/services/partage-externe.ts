/**
 * PARTAGER UN MESSAGE VERS UNE AUTRE APPLICATION — demande du user, 07/10/2026.
 *
 * « Dans le partage, les applications du téléphone doivent apparaître —
 * WhatsApp, Telegram, Google… » C'est la feuille de partage du SYSTÈME, que
 * le navigateur ouvre par `navigator.share`. Le pendant du mobile
 * (`share_plus`, commit `c70dbb3`).
 *
 * Ce qui part :
 *   - un texte, tel quel ;
 *   - un contact, en nom et numéros ; une position, en lien de carte ;
 *   - un média, en FICHIER CLAIR — déchiffré dans ce navigateur s'il est
 *     chiffré —, avec sa légende.
 *
 * ⚠️ LE TRANSFERT, LUI, RESTE DANS L'APPLICATION. Partager fait sortir le
 * contenu d'Alanya : un fichier chiffré de bout en bout part déchiffré vers
 * l'application choisie. C'est voulu — c'est ce que demande celui qui partage
 * —, mais c'est la raison pour laquelle l'écran propose d'abord « Dans Alanya
 * Work ».
 */
import { resolveMediaUrl } from "./media-service"
import { ouvrirMediaChiffre } from "./e2ee-media-ouverture"
import { contactsDepuisContenu, positionDepuisContenu } from "./message-payload"
import type { DescripteurMedia } from "./e2ee-media"

/** Ce que le partage a besoin de savoir d'un message. */
export interface MessageAPartager {
  type: string
  content?: string | null
  mediaUrl?: string
  mediaMime?: string
  fileName?: string
  mediaChiffre?: DescripteurMedia
}

/** Le navigateur sait-il ouvrir la feuille de partage du système ? */
export function partageSystemeDisponible(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function"
}

/** Le texte lisible d'un message — un contact ou une position ne sont pas du JSON. */
export function texteAPartager(m: MessageAPartager): string {
  if (m.type === "contact") {
    const fiches = contactsDepuisContenu(m.content)
    if (fiches) {
      return fiches
        .map((c) => [c.name, ...c.phones].filter(Boolean).join("\n"))
        .join("\n\n")
    }
  }
  if (m.type === "location") {
    const p = positionDepuisContenu(m.content)
    if (p) {
      const lien = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
      return p.label ? `${p.label}\n${lien}` : lien
    }
  }
  return (m.content ?? "").trim()
}

export function aUnFichier(m: MessageAPartager): boolean {
  return Boolean(m.mediaChiffre) || Boolean(m.mediaUrl)
}

/**
 * Le fichier EN CLAIR du message : déchiffré ici, ou téléchargé.
 * Lève en cas d'échec.
 */
export async function fichierAPartager(m: MessageAPartager): Promise<File> {
  const d = m.mediaChiffre
  const blob = d
    ? await ouvrirMediaChiffre(d)
    : await fetch(resolveMediaUrl(m.mediaUrl ?? "")).then((r) => {
        if (!r.ok) throw new Error(`Téléchargement impossible (${r.status})`)
        return r.blob()
      })
  const nom = d?.nom ?? m.fileName ?? "fichier"
  const type = d?.mime ?? m.mediaMime ?? (blob.type || "application/octet-stream")
  return new File([blob], nom, { type })
}

/** Ce qu'on donne à `navigator.share`. */
export async function donneesAPartager(m: MessageAPartager): Promise<ShareData> {
  const texte = texteAPartager(m)
  if (!aUnFichier(m)) return { text: texte }
  const fichier = await fichierAPartager(m)
  return { files: [fichier], ...(texte ? { text: texte } : {}) }
}

/**
 * Peut-on partager CES données ? Un navigateur qui sait partager du texte ne
 * sait pas toujours partager un fichier — ni tous les types de fichiers.
 */
export function partageable(donnees: ShareData): boolean {
  if (!partageSystemeDisponible()) return false
  if (typeof navigator.canShare !== "function") return !donnees.files
  try {
    return navigator.canShare(donnees)
  } catch {
    return false
  }
}
