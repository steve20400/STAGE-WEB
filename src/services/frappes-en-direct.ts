import { useSyncExternalStore } from "react"
import { getMyUserId } from "../data/session-user"
import { subscribeToToutesFrappes } from "./websocket-service"

/**
 * QUI ECRIT, PAR CONVERSATION — pour la liste des discussions (14/11/2026,
 * jumeau de `home_screen.dart` sur le mobile, comme l'application de
 * reference).
 *
 * Un seul abonnement pour toute la liste, et non un par ligne : chaque ligne
 * lit seulement SA conversation (`useQuiEcrit`), et ne se redessine que
 * quand celle-ci change.
 *
 * On retient le dernier a s'etre mis a ecrire, avec son filet : efface si
 * aucun « stop » n'arrive dans les 6 secondes. Seul celui qu'on affiche
 * efface l'indicateur.
 */

const FILET_MS = 6000
const etat = new Map<string, { uid: string; filet: ReturnType<typeof setTimeout> }>()
const abonnes = new Set<() => void>()
let arret: (() => void) | null = null

function prevenir() {
  for (const a of abonnes) a()
}

function demarrer() {
  if (arret) return
  arret = subscribeToToutesFrappes((convId, event) => {
    if (!event.userId || event.userId === getMyUserId()) return
    const avant = etat.get(convId)
    if (event.isTyping) {
      if (avant) clearTimeout(avant.filet)
      etat.set(convId, {
        uid: event.userId,
        filet: setTimeout(() => {
          etat.delete(convId)
          prevenir()
        }, FILET_MS),
      })
      prevenir()
    } else if (avant && avant.uid === event.userId) {
      clearTimeout(avant.filet)
      etat.delete(convId)
      prevenir()
    }
  })
}

function sAbonner(rappel: () => void): () => void {
  demarrer()
  abonnes.add(rappel)
  return () => {
    abonnes.delete(rappel)
  }
}

/** L'identifiant de qui ecrit dans [convId], ou `undefined`. */
export function useQuiEcrit(convId: string): string | undefined {
  return useSyncExternalStore(sAbonner, () => etat.get(convId)?.uid)
}
