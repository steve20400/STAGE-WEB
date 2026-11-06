import { useEffect, useState } from "react"
import { SORTIE_CHOISISSABLE } from "../services/audio-output"

export interface SortieAudio {
  deviceId: string
  label: string
}

/**
 * Les sorties audio de l'appareil — haut-parleurs, casque, Bluetooth — quand
 * le navigateur sait en choisir une (`setSinkId`, 06/11/2026). Ailleurs, une
 * liste vide : l'ecran garde sa bascule oreille / haut-parleur.
 *
 * Les noms ne sont donnes qu'une fois le micro autorise, ce qui est le cas
 * pendant un appel. La liste suit les branchements (`devicechange`).
 */
export function useSortiesAudio(actif: boolean): SortieAudio[] {
  const [sorties, setSorties] = useState<SortieAudio[]>([])

  useEffect(() => {
    if (!actif || !SORTIE_CHOISISSABLE || !navigator.mediaDevices?.enumerateDevices) return
    let vivant = true
    const lire = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((appareils) => {
          if (!vivant) return
          const vus = new Set<string>()
          setSorties(
            appareils
              .filter((a) => a.kind === "audiooutput" && a.label && !vus.has(a.deviceId))
              .map((a) => {
                vus.add(a.deviceId)
                return { deviceId: a.deviceId, label: a.label }
              })
          )
        })
        .catch(() => undefined)
    }
    lire()
    navigator.mediaDevices.addEventListener("devicechange", lire)
    return () => {
      vivant = false
      navigator.mediaDevices.removeEventListener("devicechange", lire)
    }
  }, [actif])

  return sorties
}
