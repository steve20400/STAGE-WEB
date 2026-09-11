import { apiRequest } from "../lib/api-client"
import { uploadMedia } from "./media-service"

/**
 * LE RÉPONDEUR — message d'accueil, et dépôt d'une messagerie vocale.
 *
 * 🔴 LE RÉPONDEUR EST JOUÉ PAR LE CLIENT DE L'APPELANT. Les appels sont en
 * pair-à-pair : quand personne ne décroche, il n'existe AUCUN pair pour jouer
 * l'accueil et enregistrer. À l'expiration de la sonnerie, c'est donc
 * l'application de l'appelant qui télécharge l'accueil du destinataire, le joue,
 * et propose d'enregistrer.
 *
 * L'alternative — un serveur média qui répondrait à la place du destinataire —
 * donnerait la même expérience pour le prix d'une infrastructure entière.
 *
 * ⚠️ LIMITE INHÉRENTE À CE CHOIX : si l'appelant ferme son onglet à l'instant où
 * la sonnerie expire, il n'y a pas de message. Rien ne peut l'éviter sans le
 * serveur média qu'on a justement écarté.
 */

/** Le média d'un message d'accueil, tel que le serveur le décrit. */
export interface AccueilRepondeur {
  id: string
  url: string
  mimeType: string
  durationMs: number | null
  filename: string
}

export interface EtatRepondeur {
  actif: boolean
  accueil: AccueilRepondeur | null
}

/** Mon répondeur : est-il actif, et quel accueil porte-t-il ? */
export async function lireMonRepondeur(): Promise<EtatRepondeur> {
  const reponse = await apiRequest<EtatRepondeur>("/api/repondeur")
  return { actif: reponse.actif === true, accueil: reponse.accueil ?? null }
}

/**
 * L'accueil de la personne qu'on vient d'appeler sans réponse.
 *
 * ⚠️ REND `null` PLUTÔT QUE DE LEVER quand il n'y en a pas — et c'est le cas le
 * plus fréquent, la plupart des comptes n'ayant pas de répondeur. Le serveur
 * répond alors 404, ce qui n'est pas une panne : c'est la réponse.
 */
export async function accueilDeLAppel(callId: string): Promise<AccueilRepondeur | null> {
  try {
    const reponse = await apiRequest<{ accueil?: AccueilRepondeur }>(
      `/api/repondeur?appel=${encodeURIComponent(callId)}`,
    )
    return reponse.accueil ?? null
  } catch {
    return null
  }
}

/**
 * Téléverse un fichier audio et le pose comme message d'accueil.
 *
 * ⚠️ POSER UN ACCUEIL L'ACTIVE, côté serveur, sauf refus explicite. Enregistrer
 * son message puis devoir chercher un interrupteur pour qu'il serve est
 * exactement le genre d'étape qu'on oublie — et le répondeur resterait muet sans
 * que rien ne dise pourquoi.
 */
export async function poserAccueil(
  fichier: File | Blob,
  nomFichier: string,
  dureeMs?: number,
): Promise<EtatRepondeur> {
  const media = await uploadMedia(fichier, nomFichier, dureeMs)
  return apiRequest<EtatRepondeur>("/api/repondeur", {
    method: "POST",
    body: { mediaId: media.id },
  })
}

/** Allume ou éteint le répondeur, sans toucher à l'accueil enregistré. */
export async function activerRepondeur(actif: boolean): Promise<EtatRepondeur> {
  return apiRequest<EtatRepondeur>("/api/repondeur", {
    method: "POST",
    body: { actif },
  })
}

/**
 * Retire l'accueil, et éteint le répondeur du même geste.
 *
 * ⚠️ LE FICHIER N'EST PAS SUPPRIMÉ : il appartient au compte et peut avoir été
 * partagé ailleurs. On détache seulement.
 */
export async function retirerAccueil(): Promise<void> {
  await apiRequest<void>("/api/repondeur", { method: "DELETE" })
}

/**
 * Dépose la messagerie vocale laissée après un appel sans réponse.
 *
 * ⚠️ LE SERVEUR VÉRIFIE TOUT : que l'appel existe, qu'on l'a initié, qu'il n'a
 * pas été décroché, qu'il est récent, qu'il n'a pas déjà sa messagerie, et que
 * le destinataire a bien un répondeur. Ces contrôles ne sont pas doublés ici —
 * les redoubler donnerait deux vérités, et celle du client ne protège personne.
 */
export async function deposerMessagerie(
  callId: string,
  audio: Blob,
  dureeMs: number,
): Promise<void> {
  const nom = `repondeur-${Date.now()}.webm`
  const media = await uploadMedia(audio, nom, dureeMs)
  await apiRequest(`/api/calls/${encodeURIComponent(callId)}/voicemail`, {
    method: "POST",
    body: { mediaId: media.id },
  })
}

/**
 * Taille maximale d'un message d'accueil importé.
 *
 * ⚠️ CONTRÔLÉE AVANT LE TÉLÉVERSEMENT, pas après : un fichier de cent mégaoctets
 * partirait sinon en entier pour se faire refuser à l'arrivée — la donnée est
 * payée, sur mobile comme ailleurs.
 */
export const ACCUEIL_MAX_OCTETS = 5 * 1024 * 1024

/**
 * Durée maximale d'un message d'accueil.
 *
 * Trente secondes : au-delà, l'appelant raccroche avant le bip. Ce n'est pas une
 * limite technique mais une limite d'usage, et c'est pour cela qu'elle est
 * généreuse plutôt que serrée.
 */
export const ACCUEIL_MAX_MS = 30_000

/** Le fichier peut-il servir d'accueil ? Rend la raison du refus, ou `null`. */
export function refusAccueil(fichier: File): "format" | "taille" | null {
  if (!fichier.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|aac|webm|opus)$/i.test(fichier.name)) {
    return "format"
  }
  if (fichier.size > ACCUEIL_MAX_OCTETS) return "taille"
  return null
}
