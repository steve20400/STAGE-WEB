import { useSyncExternalStore } from "react"
import {
  reglagesTelechargement,
  surChangementTelechargement,
  type ReglagesTelechargement,
} from "../services/telechargement-auto"

/**
 * Le réglage du téléchargement automatique, suivi en direct : le changer dans
 * les paramètres s'applique aux bulles déjà à l'écran, sans recharger.
 */
export function useTelechargementAuto(): ReglagesTelechargement {
  return useSyncExternalStore(surChangementTelechargement, reglagesTelechargement)
}
