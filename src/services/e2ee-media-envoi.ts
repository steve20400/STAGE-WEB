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
import { envoyerDansGroupe, estGroupe } from "./e2ee-groupe-fil"

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
  /*
   * 🔴 EN GROUPE (lot 4, chapitre 34) : le fichier est chiffré UNE fois avec
   * sa propre clé, comme à deux ; seul le descripteur (clé, empreinte, aperçu)
   * part dans le message de groupe, chiffré pour tous avec la clé du groupe.
   */
  const groupe = await estGroupe(convId)
  const destinataire = groupe ? null : await correspondant(convId)
  const appareils = destinataire ? await ouvrirSessions(destinataire) : []
  if (destinataire && appareils.length === 0) {
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

  const legende = o.legende ?? ""
  const moi = getMyUserId()

  // 4-5 (groupe). La ligne et son chiffré, en un seul envoi.
  if (groupe || !destinataire) {
    const cree = await envoyerDansGroupe(convId, legende, {
      media: descripteur,
      replyToId: o.replyToId,
      type: typeDuMessage(descripteur),
    })
    const entree = {
      id: cree.id,
      convId,
      expediteurId: moi ?? "",
      texte: legende,
      quand: new Date(cree.createdAt).getTime() || Date.now(),
      media: descripteur,
      ...(o.replyToId ? { reponseA: o.replyToId } : {}),
    }
    await cacheMessage(entreeCacheDechiffree(entree)).catch(() => undefined)
    await garderClair(descripteur.id, new Blob([clair as Uint8Array<ArrayBuffer>], { type: o.mime }))
    return { id: cree.id, createdAt: cree.createdAt, descripteur }
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
  const charge = ecrireCharge(message.id, legende, descripteur, { reponseA: o.replyToId })
  const enveloppes = await chiffrerPour(destinataire, appareils, charge)
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
  const entree = {
    id: message.id,
    convId,
    expediteurId: moi ?? "",
    texte: legende,
    quand,
    media: descripteur,
    ...(o.replyToId ? { reponseA: o.replyToId } : {}),
  }
  await cacheMessage(entreeCacheDechiffree(entree)).catch(() => undefined)
  await garderClair(descripteur.id, new Blob([clair as Uint8Array<ArrayBuffer>], { type: o.mime }))
  archiver(entree)

  return { id: message.id, createdAt: message.createdAt, descripteur }
}
