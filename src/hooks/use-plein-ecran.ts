import { useCallback, useEffect, useMemo, useState } from "react"

/**
 * Plein ecran d'un element — le gros rendu video de la salle, en pratique.
 *
 * POURQUOI UN HOOK PLUTOT QUE TROIS LIGNES DANS LA SALLE : l'etat « on est en
 * plein ecran » ne se tient pas a la main. On en sort par la touche Echap, par
 * le bouton du systeme, par un raccourci du navigateur, par un changement
 * d'onglet — autant de sorties que l'application ne declenche pas et qu'un
 * booleen local raterait. Il resterait alors un bouton « quitter le plein
 * ecran » sur un ecran qui n'y est plus, et le clic suivant ferait l'inverse de
 * ce qu'il annonce. On ecoute donc l'evenement de changement : c'est la seule
 * source de verite, et elle vaut pour toutes les sorties.
 *
 * TROIS APIS, PAS UNE :
 *  - la standard, `Element.requestFullscreen` ;
 *  - la vieille orthographe `webkit`, encore la seule de Safari de bureau ;
 *  - celle de l'iPhone, ou RIEN ne s'agrandit sauf un `<video>`, et par une
 *    methode a lui, `webkitEnterFullscreen`, qui n'a pas d'equivalent standard.
 * Les trois sont prises en charge ici pour que la salle n'ait pas a les
 * connaitre : elle pose `cible` sur l'element et lit `supporte`.
 */

/** Document + les orthographes WebKit, absentes de la definition standard. */
interface DocumentAgrandissable extends Document {
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
  webkitExitFullscreen?: () => Promise<void> | void
}

/** Element + la vieille demande d'agrandissement de Safari. */
interface ElementAgrandissable extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void
}

/**
 * Le lecteur video de l'iPhone. Il s'agrandit seul, se surveille seul
 * (`webkitDisplayingFullscreen`) et previent par ses propres evenements
 * (`webkitbeginfullscreen` / `webkitendfullscreen`) : le document, lui, ne sait
 * rien de ce plein ecran-la.
 */
interface VideoAgrandissable extends HTMLVideoElement {
  webkitSupportsFullscreen?: boolean
  webkitDisplayingFullscreen?: boolean
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
}

/** L'element qui occupe l'ecran dans ce document, quelle que soit l'orthographe. */
function elementAgrandi(doc: DocumentAgrandissable): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null
}

/**
 * Cet element precis occupe-t-il l'ecran ?
 *
 * L'egalite est stricte a dessein : si c'est un AUTRE element qui est agrandi —
 * une image ouverte par ailleurs, une video d'un autre composant —, ce n'est pas
 * a nous d'en sortir, et le bouton doit continuer de proposer d'entrer.
 */
function estAgrandi(element: HTMLElement | null): boolean {
  if (!element) return false
  const doc = element.ownerDocument as DocumentAgrandissable
  if (elementAgrandi(doc) === element) return true
  // Chemin iPhone : le document ignore ce plein ecran, le lecteur seul le sait.
  return (element as VideoAgrandissable).webkitDisplayingFullscreen === true
}

/**
 * Une demande d'agrandissement peut etre refusee — geste utilisateur trop
 * ancien, page dans un cadre sans permission. Le refus n'a aucune consequence a
 * traiter : l'evenement de changement dira de toute facon l'etat reel.
 */
function sansEchec(resultat: Promise<void> | void): void {
  if (resultat instanceof Promise) resultat.catch(() => undefined)
}

export function usePleinEcran(): {
  /** Reference a poser sur l'element a agrandir : `<div ref={cible}>`. */
  cible: (element: HTMLElement | null) => void
  actif: boolean
  basculer: () => void
  supporte: boolean
} {
  /**
   * L'element est un ETAT et non une `useRef` : c'est son arrivee qui doit
   * rebrancher les ecouteurs et recalculer `supporte`. Une reference ne
   * provoque aucun rendu — le bouton resterait eteint jusqu'a ce qu'autre chose
   * fasse rendre la salle.
   */
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [actif, setActif] = useState(false)

  /**
   * Stable d'un rendu a l'autre : une fonction recreee a chaque rendu serait
   * appelee par React avec `null` puis avec le noeud, a CHAQUE rendu de la
   * salle — soit un detachement et un rebranchement des ecouteurs pour rien.
   */
  const cible = useCallback((noeud: HTMLElement | null) => {
    setElement((precedent) => (precedent === noeud ? precedent : noeud))
  }, [])

  useEffect(() => {
    if (!element) {
      setActif(false)
      return
    }

    /*
     * Le document DE L'ELEMENT, et non celui de la page : le rendu peut avoir
     * ete deporte dans la fenetre reduite, qui est un autre document. Ecouter
     * `document` laisserait alors le bouton muet.
     */
    const doc = element.ownerDocument as DocumentAgrandissable
    const relire = () => setActif(estAgrandi(element))
    relire()

    doc.addEventListener("fullscreenchange", relire)
    doc.addEventListener("webkitfullscreenchange", relire)
    element.addEventListener("webkitbeginfullscreen", relire)
    element.addEventListener("webkitendfullscreen", relire)
    return () => {
      doc.removeEventListener("fullscreenchange", relire)
      doc.removeEventListener("webkitfullscreenchange", relire)
      element.removeEventListener("webkitbeginfullscreen", relire)
      element.removeEventListener("webkitendfullscreen", relire)
    }
  }, [element])

  /**
   * `fullscreenEnabled` ne dit pas seulement que l'API existe : il dit qu'elle
   * est PERMISE ici. Dans un cadre sans `allow="fullscreen"`, et dans la fenetre
   * reduite du systeme, il vaut faux — et le bouton doit alors disparaitre
   * plutot que promettre un agrandissement qui sera refuse.
   */
  const supporte = useMemo(() => {
    try {
      const doc = (element?.ownerDocument ?? document) as DocumentAgrandissable
      if (doc.fullscreenEnabled === true) return true
      if (doc.webkitFullscreenEnabled === true) return true
      return (element as VideoAgrandissable | null)?.webkitSupportsFullscreen === true
    } catch {
      // Aucune de ces lectures ne doit jeter : on repond « non supporte ».
      return false
    }
  }, [element])

  const basculer = useCallback(() => {
    if (!element) return
    const doc = element.ownerDocument as DocumentAgrandissable
    const video = element as VideoAgrandissable

    // On redemande l'etat a l'API plutot que de lire `actif` : entre le dernier
    // rendu et ce clic, une touche Echap a pu tout changer.
    if (estAgrandi(element)) {
      const sortir: (() => Promise<void> | void) | undefined =
        doc.exitFullscreen?.bind(doc) ??
        doc.webkitExitFullscreen?.bind(doc) ??
        video.webkitExitFullscreen?.bind(video)
      if (sortir) sansEchec(sortir())
      return
    }

    const entrer: (() => Promise<void> | void) | undefined =
      element.requestFullscreen?.bind(element) ??
      (element as ElementAgrandissable).webkitRequestFullscreen?.bind(element) ??
      (video.webkitSupportsFullscreen === true
        ? video.webkitEnterFullscreen?.bind(video)
        : undefined)
    if (entrer) sansEchec(entrer())
  }, [element])

  return { cible, actif, basculer, supporte }
}
