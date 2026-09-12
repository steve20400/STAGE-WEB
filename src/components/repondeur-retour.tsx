import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useCallState } from "../hooks/use-call"

/**
 * LE RETOUR A L'ECRAN D'APPEL, QUAND LE REPONDEUR PREND LA MAIN.
 *
 * 🔴 IL NE DESSINE RIEN. Le répondeur s'affiche DANS l'écran d'appel — c'est là
 * qu'il a sa place, et c'est ce qu'on attend en voyant une sonnerie expirer.
 * Mais on peut très bien être ailleurs à cet instant : la fenêtre se réduit en
 * vignette dès qu'on va écrire un message, et l'on se retrouve alors dans une
 * discussion, aux réglages, n'importe où.
 *
 * `displayMode: "full"` ne suffit pas à revenir : le mode dit COMMENT l'appel
 * s'affiche, pas OÙ l'on se trouve. Il fallait donc refaire la navigation, et
 * un service — `call-manager` n'est pas un composant — ne peut pas naviguer.
 *
 * ⚠️ UNE PREMIÈRE VERSION POSAIT LE PANNEAU PAR-DESSUS LA DISCUSSION, sans
 * revenir. C'était plus simple, et c'était moins bon : une carte flottante au
 * milieu d'une conversation ne dit pas qu'on vient d'appeler quelqu'un, et
 * l'écran d'appel — le nom, la photo, le contexte entier — disparaissait juste
 * au moment où il devenait utile.
 */
export function RepondeurRetour() {
  const call = useCallState()
  const navigate = useNavigate()
  const location = useLocation()
  const callId = call.repondeur?.callId ?? null

  useEffect(() => {
    if (!callId) return
    // Déjà sur le bon écran : il affiche le panneau lui-même, il n'y a rien à
    // faire. `endsWith` couvre le préfixe /webapp/ de la production.
    if (window.location.pathname.endsWith(`/calls/${callId}`)) return

    // On emporte l'endroit d'où l'on part, pour y être ramené à la fermeture
    // du répondeur — et non déposé sur la liste des appels.
    const depart = `${location.pathname}${location.search}`
    navigate(
      `/calls/${callId}?type=${call.callType}&returnTo=${encodeURIComponent(depart)}`,
      { replace: true },
    )
    // `location` volontairement absent : ce retour se déclenche à l'APPARITION
    // du répondeur, pas à chaque navigation qui suivrait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId])

  return null
}
