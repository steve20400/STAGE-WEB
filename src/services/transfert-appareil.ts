/**
 * TRANSFÉRER UN MESSAGE DEPUIS L'APPAREIL — cours, chapitre 29.
 *
 * Jumeau de `alanya/lib/features/chat/transfert_appareil.dart`.
 *
 * 🐛 « TRANSFÉRER UN MESSAGE DE TOUT TYPE NE DONNE PLUS » (user, 07/10/2026).
 * Le transfert passait par le serveur, qui RECOPIE la ligne du message. Il ne
 * le peut pas dès qu'un fil chiffré est en jeu : depuis un fil chiffré il n'a
 * ni le texte ni la clé du média ; vers un fil chiffré il y écrirait du clair.
 * L'écran masquait donc « Transférer » sur un message chiffré.
 *
 * Ce navigateur, lui, a le contenu EN CLAIR : il le renvoie comme un message
 * neuf. `sendChatMessage` chiffre déjà tout seul quand la cible l'est.
 *
 * ⚠️ UN MÉDIA CHIFFRÉ CHANGE DE CLÉ en passant d'un fil à l'autre : il est
 * rechiffré. Réutiliser la clé d'origine permettrait à quiconque reçoit la
 * copie d'ouvrir l'original.
 */
import type { ChatMessageMock } from "../mocks/chat-data"
import { envoyerMediaChiffre } from "./e2ee-media-envoi"
import { ouvrirMediaChiffre } from "./e2ee-media-ouverture"
import { estChiffree, etatConnu, lireEtatE2ee } from "./e2ee-fil"
import { resolveMediaUrl, uploadMedia } from "./media-service"
import { sendChatMessage } from "./messages-service"

/** Le transfert de ce message vers ce fil doit-il passer par l'appareil ? */
export function transfertParLAppareil(
  m: Pick<ChatMessageMock, "chiffre" | "mediaChiffre">,
  sourceChiffree: boolean,
  cibleChiffree: boolean,
): boolean {
  return sourceChiffree || cibleChiffree || Boolean(m.chiffre) || Boolean(m.mediaChiffre)
}

/** L'état chiffré d'un fil, lu au serveur s'il n'est pas encore connu. */
export async function filChiffre(convId: string): Promise<boolean> {
  if (!etatConnu(convId)) await lireEtatE2ee(convId).catch(() => undefined)
  return estChiffree(convId)
}

/** Ce message porte-t-il un fichier ? */
function aUnMedia(m: ChatMessageMock): boolean {
  return Boolean(m.mediaChiffre) || Boolean(m.mediaUrl)
}

/**
 * Renvoie `m` dans `cible`, depuis le contenu en clair de ce navigateur.
 * Lève en cas d'échec : l'appelant le dit.
 */
export async function transfererDepuisLAppareil(m: ChatMessageMock, cible: string): Promise<void> {
  const texte = m.content ?? ""

  if (!aUnMedia(m)) {
    if (texte.trim() === "") throw new Error("Rien à transférer")
    await sendChatMessage(cible, texte, m.type)
    return
  }

  // Le fichier en clair : déchiffré ici, ou téléchargé.
  const d = m.mediaChiffre
  const fichier = d
    ? await ouvrirMediaChiffre(d)
    : await fetch(resolveMediaUrl(m.mediaUrl ?? "")).then((r) => {
        if (!r.ok) throw new Error(`Téléchargement impossible (${r.status})`)
        return r.blob()
      })
  const nom = d?.nom ?? m.fileName ?? "fichier"
  const mime = d?.mime ?? m.mediaMime ?? fichier.type ?? "application/octet-stream"
  const dureeMs = d?.dureeMs ?? m.durationMs ?? undefined

  if (await filChiffre(cible)) {
    await envoyerMediaChiffre(cible, fichier, { nom, mime, dureeMs, legende: texte })
    return
  }
  const envoye = await uploadMedia(new File([fichier], nom, { type: mime }), nom, dureeMs)
  await sendChatMessage(cible, texte, m.type, { mediaId: envoye.id })
}
