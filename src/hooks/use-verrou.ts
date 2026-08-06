import { useCallback, useEffect, useState } from "react"
import { appareilCourantId } from "../services/appareils-service"
import {
  envoyerVerrou,
  subscribeToConversationLocks,
  type EtatVerrou,
} from "../services/websocket-service"
import { loadSessionUser } from "../data/session-user"
import { pseudoEnCache } from "../services/pseudo-appareil-service"

/**
 * Verrou d'une conversation, du point de vue de CET appareil.
 *
 * Le verrou se joue entre appareils d'un meme compte : un numero professionnel
 * partage entre plusieurs agents, dont un prend la main sur une conversation
 * pour que les autres n'ecrivent pas par-dessus lui.
 *
 * Il ne coupe que l'ecriture. Les autres appareils continuent de tout recevoir
 * et de tout lire — c'est meme l'interet : suivre l'echange sans le perturber.
 */
export interface VerrouConversation {
  /** Un appareil du compte detient la conversation. */
  verrouille: boolean
  /** C'est CET appareil qui la detient. */
  parMoi: boolean
  /**
   * Un AUTRE appareil du compte la detient : ici on n'ecrit pas, et le bouton
   * de verrouillage disparait — il n'y a rien a reprendre, la main appartient
   * a celui qui l'a prise.
   */
  parUnAutre: boolean
  /** Nom de l'appareil qui detient la main, quand le serveur le connait. */
  detenteur: string | null
}

const AUCUN: VerrouConversation = {
  verrouille: false,
  parMoi: false,
  parUnAutre: false,
  detenteur: null,
}

/** Traduit l'etat brut du serveur du point de vue de cet appareil. */
export function lireVerrou(
  etat: { appareilId?: number | null; detenteur?: string | null } | null | undefined
): VerrouConversation {
  if (!etat || etat.appareilId == null) return AUCUN
  const moi = appareilCourantId()
  const parMoi = moi !== null && etat.appareilId === moi
  return {
    verrouille: true,
    parMoi,
    parUnAutre: !parMoi,
    detenteur: etat.detenteur ?? null,
  }
}

/**
 * Suit le verrou d'une conversation et permet de le poser ou de le rendre.
 *
 * `initial` vient de la liste des conversations : sans lui, l'ecran s'ouvrirait
 * deverrouille jusqu'au premier evenement temps reel, et laisserait croire une
 * seconde qu'on peut ecrire.
 */
export function useVerrou(convId: string | undefined, initial?: VerrouConversation) {
  const [verrou, setVerrou] = useState<VerrouConversation>(initial ?? AUCUN)

  useEffect(() => {
    if (initial) setVerrou(initial)
  }, [initial])

  useEffect(() => {
    if (!convId) return
    return subscribeToConversationLocks((etat: EtatVerrou) => {
      if (etat.convId !== convId) return
      setVerrou(etat.locked ? lireVerrou(etat) : AUCUN)
    })
  }, [convId])

  const basculer = useCallback(() => {
    if (!convId) return
    // On ne reprend jamais la main a un autre appareil : le bouton n'existe
    // meme pas chez lui, et le serveur refuserait de toute facon.
    if (verrou.parUnAutre) return
    envoyerVerrou(convId, !verrou.parMoi, appareilCourantId(), pseudoEnCache() ?? loadSessionUser()?.name ?? null)
  }, [convId, verrou.parMoi, verrou.parUnAutre])

  return { verrou, basculer }
}
