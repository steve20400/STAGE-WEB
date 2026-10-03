import { apiRequest } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { correspondant } from "./e2ee-fil"
import { chiffrerPour, deposer, idAppareil, ouvrirSessions } from "./e2ee-service"
import { chiffrerFichier, ecrireCharge, type DescripteurMedia } from "./e2ee-media"
import { fabriquerApercu } from "./e2ee-apercus"
import { entreeCacheDechiffree, typeDuMessage } from "./e2ee-entree-cache"
import { cacheMessage } from "./indexeddb-cache"
import { archiver } from "./e2ee-sauvegarde"
import { garderClair } from "./e2ee-media-ouverture"

/**
 * ENVOYER UN MÉDIA CHIFFRÉ DE BOUT EN BOUT — cours, chapitre 24 (lot B).
 *
 * L'ordre, et pourquoi :
 *
 *   1. l'APERÇU, tant que le fichier est en clair (photo floutée, première
 *      image, première page) — après, il serait trop tard ;
 *   2. le CHIFFREMENT du fichier, avec une clé neuve ;
 *   3. le TÉLÉVERSEMENT du fichier chiffré, marqué `chiffre=1` : le serveur
 *      ne garde ni son nom ni son type ;
 *   4. la LIGNE DU MESSAGE, sans contenu — c'est elle qui donne l'identifiant
 *      que la charge v2 doit porter ;
 *   5. les ENVELOPPES, une par appareil du correspondant ET de mes autres
 *      appareils, portant la clé, l'empreinte, l'aperçu et la légende ;
 *   6. le RANGEMENT local et l'ARCHIVE : on ne s'envoie pas d'enveloppe à
 *      soi-même, ce cache et l'archive sont donc les seuls endroits où MA
 *      copie de la clé existe.
 *
 * ⚠️ UN MÉDIA PAR MESSAGE (décision du user, 03/10/2026) : la charge ne porte
 * qu'un descripteur, et dix aperçus ne tiendraient pas dans une enveloppe.
 */
export async function envoyerMediaChiffre(
  convId: string,
  fichier: Blob,
  o: { nom: string; mime: string; dureeMs?: number; legende?: string; replyToId?: string },
): Promise<{ id: string; createdAt: string; descripteur: DescripteurMedia }> {
  const destinataire = await correspondant(convId)
  const appareils = await ouvrirSessions(destinataire)
  if (appareils.length === 0) {
    throw new Error("Ce correspondant n'a aucun appareil capable de déchiffrer.")
  }

  // 1-2. Aperçu puis chiffrement.
  const clair = new Uint8Array(await fichier.arrayBuffer())
  const apercu = await fabriquerApercu(fichier, o.mime, o.dureeMs)
  const f = await chiffrerFichier(clair)

  // 3. Le fichier chiffré.
  const form = new FormData()
  form.append("file", new Blob([f.chiffre as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }), "chiffre.bin")
  form.append("chiffre", "1")
  const media = await apiRequest<{ id: string }>("/api/media", { method: "POST", body: form })

  const descripteur: DescripteurMedia = {
    id: media.id,
    cle: f.cle,
    empreinte: f.empreinte,
    taille: clair.length,
    mime: o.mime,
    nom: o.nom,
    ...apercu,
  }

  // 4. La ligne du message : aucun contenu, le type seulement.
  const message = await apiRequest<{ id: string; createdAt: string }>(
    `/api/conversations/${encodeURIComponent(convId)}/messages`,
    {
      method: "POST",
      body: {
        type: typeDuMessage(descripteur),
        chiffre: true,
        mediaIds: [media.id],
        ...(o.replyToId ? { replyToId: o.replyToId } : {}),
      },
    },
  )

  // 5. Les enveloppes.
  const legende = o.legende ?? ""
  const charge = ecrireCharge(message.id, legende, descripteur)
  const enveloppes = await chiffrerPour(destinataire, appareils, charge)
  const moi = getMyUserId()
  if (moi && moi !== destinataire) {
    try {
      const miens = await ouvrirSessions(moi, idAppareil())
      if (miens.length > 0) enveloppes.push(...(await chiffrerPour(moi, miens, charge)))
    } catch (err) {
      console.warn("[e2ee] copie du média vers mes autres appareils impossible :", err)
    }
  }
  await deposer(convId, enveloppes, message.id)

  // 6. Ma copie : cache local, clair du fichier, archive.
  const quand = new Date(message.createdAt).getTime() || Date.now()
  const entree = { id: message.id, convId, expediteurId: moi ?? "", texte: legende, quand, media: descripteur }
  await cacheMessage(entreeCacheDechiffree(entree)).catch(() => undefined)
  await garderClair(descripteur.id, new Blob([clair as Uint8Array<ArrayBuffer>], { type: o.mime }))
  archiver(entree)

  return { id: message.id, createdAt: message.createdAt, descripteur }
}
