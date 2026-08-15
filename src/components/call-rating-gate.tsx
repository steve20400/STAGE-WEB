import { useEffect, useState } from "react"
import { useCallState } from "../hooks/use-call"
import { consumePendingRating } from "../services/call-manager"
import { CallRatingModal } from "./call-rating-modal"

/**
 * Monte le modal de notation post-appel au niveau racine de l'application,
 * independamment de la page active.
 *
 * ⚠️ Ne PAS le poser dans l'ecran d'appel (`call.tsx`) : `queue_rating_available`
 * arrive quasi toujours APRES que le raccrochage a deja navigue ailleurs (voir
 * la doc de `pendingRatingIdHist` dans call-manager.ts). Un modal attache a
 * l'ecran d'appel se serait demonte avant l'arrivee du message, exactement
 * comme `ivr-panel.tsx` etait reste sans le moindre appelant avant d'etre
 * cable dans `call.tsx`.
 */
export function CallRatingGate() {
  const call = useCallState()
  const [idHist, setIdHist] = useState<string | null>(null)

  useEffect(() => {
    if (call.pendingRatingIdHist && !idHist) {
      setIdHist(consumePendingRating())
    }
  }, [call.pendingRatingIdHist, idHist])

  if (!idHist) return null
  return <CallRatingModal idHist={idHist} onClose={() => setIdHist(null)} />
}
