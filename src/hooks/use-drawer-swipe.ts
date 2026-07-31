import { useEffect } from "react"

/**
 * Largeur d'ecran en dessous de laquelle le tiroir de navigation existe.
 * Miroir exact de `app/(protected)/layout.css` : au-dela, `.sidebar-mobile-wrap`
 * est en `display: none` et un glissement ouvrirait un panneau invisible.
 */
const DRAWER_MEDIA_QUERY = "(max-width: 860px)"

/** Deplacement horizontal a partir duquel le geste est reconnu. */
const SWIPE_DISTANCE = 60

/**
 * Derive verticale au-dela de laquelle on considere que l'utilisateur defile la
 * page et non qu'il ouvre le tiroir. Meme valeur que l'abandon du
 * glisser-pour-repondre dans le fil, pour que les deux gestes se comportent
 * pareil sous le doigt.
 */
const SWIPE_VERTICAL_TOLERANCE = 40

/**
 * Le mouvement doit etre franchement horizontal. La seule tolerance verticale ne
 * suffit pas : un geste en diagonale peut franchir le seuil horizontal alors que
 * la derive verticale est encore sous la tolerance, et ouvrir le tiroir sans que
 * l'utilisateur l'ait voulu. On exige donc le double.
 */
const SWIPE_HORIZONTAL_DOMINANCE = 2

interface DrawerSwipeOptions {
  /** Etat courant du tiroir. */
  open: boolean
  /**
   * Faux quand un autre geste horizontal a la priorite sur cet ecran. La
   * fermeture, elle, reste toujours possible : tiroir ouvert, il recouvre le
   * contenu, donc plus personne ne se dispute le mouvement.
   */
  canOpen: boolean
  onOpen: () => void
  onClose: () => void
}

/**
 * Le geste ne doit pas voler le defilement horizontal d'un carrousel (bande de
 * pieces jointes, onglets des reglages, galerie de medias) ni le deplacement de
 * la fenetre d'appel reduite. On remonte les ancetres du point de depart : si
 * l'un d'eux peut reellement defiler horizontalement, on laisse la main.
 */
function claimsHorizontalGesture(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null
  while (node) {
    if (node.classList.contains("active-call-floating")) return true
    const overflowX = getComputedStyle(node).overflowX
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      node.scrollWidth > node.clientWidth + 1
    ) {
      return true
    }
    node = node.parentElement
  }
  return false
}

/**
 * Ouverture et fermeture du tiroir de navigation au glissement du doigt.
 *
 * Le geste est seulement *reconnu*, jamais capture : on n'appelle pas
 * `preventDefault`, donc le defilement vertical de la page reste natif. Le
 * tiroir s'ouvre d'un coup au franchissement du seuil, il ne suit pas le doigt —
 * une animation de suivi demanderait de reecrire le voile, qui bascule
 * aujourd'hui en `display` et non en opacite.
 */
export function useDrawerSwipe({ open, canOpen, onOpen, onClose }: DrawerSwipeOptions) {
  useEffect(() => {
    let startX = 0
    let startY = 0
    let tracking = false

    const onPointerDown = (event: PointerEvent) => {
      // Evalue a chaque geste, et non une fois pour toutes : la largeur change
      // quand on tourne le telephone.
      if (!window.matchMedia(DRAWER_MEDIA_QUERY).matches) return
      if (claimsHorizontalGesture(event.target)) return
      startX = event.clientX
      startY = event.clientY
      tracking = true
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!tracking) return
      const dx = event.clientX - startX
      const dy = event.clientY - startY

      if (Math.abs(dy) > SWIPE_VERTICAL_TOLERANCE) {
        tracking = false
        return
      }
      if (Math.abs(dx) < SWIPE_DISTANCE) return
      if (Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_DOMINANCE) {
        tracking = false
        return
      }

      // Un seul verdict par geste.
      tracking = false
      if (dx > 0) {
        if (!open && canOpen) onOpen()
      } else if (open) {
        onClose()
      }
    }

    const stopTracking = () => {
      tracking = false
    }

    window.addEventListener("pointerdown", onPointerDown, { passive: true })
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    window.addEventListener("pointerup", stopTracking, { passive: true })
    window.addEventListener("pointercancel", stopTracking, { passive: true })
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", stopTracking)
      window.removeEventListener("pointercancel", stopTracking)
    }
  }, [open, canOpen, onOpen, onClose])
}
