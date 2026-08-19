import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "../i18n"
import "./fenetre-reduite.css"

/**
 * LA FENETRE REDUITE DE LA REUNION.
 *
 * On y replie toute la salle : le rendu video en plus petit, avec defilement, et
 * les commandes que la salle y depose. La demande allait plus loin qu'un simple
 * panneau flottant — « meme si on appuie sur le bouton moins du navigateur, la
 * fenetre reste visible, et on doit pouvoir la deplacer sur l'ecran ». Aucun
 * element HTML ne sait faire cela : un panneau, si haut soit-il dans la page,
 * disparait avec la page qui le porte.
 *
 * D'ou l'API Document Picture-in-Picture. `requestWindow` ouvre une VRAIE
 * fenetre du systeme, toujours au-dessus des autres : elle se deplace a la
 * souris comme n'importe quelle fenetre, et elle survit a la reduction du
 * navigateur. C'est la seule voie pour la derniere phrase de la demande.
 *
 * ELLE N'EXISTE QUE SUR CHROME ET EDGE. Firefox et Safari ne la connaissent pas.
 * D'ou le repli : une carte flottante DANS la page, deplacable a la souris et au
 * clavier — mais qui, elle, disparait avec la fenetre du navigateur. Le repli
 * n'est pas un equivalent, c'est un moindre mal, et `fenetreReduiteSupportee()`
 * permet a l'appelant de le dire honnetement avant le clic.
 *
 * CE QUI TRAVERSE, ET CE QUI NE TRAVERSE PAS. Le contenu est rendu par un
 * portail React dans l'autre document : les evenements continuent d'arriver
 * (React branche ses ecouteurs sur le conteneur du portail, ou qu'il vive), le
 * contexte de langue et de theme reste celui de l'application. En revanche
 * AUCUNE FEUILLE DE STYLE ne suit — voir `recopierLesFeuilles`. Et les noeuds du
 * DOM sont recrees a l'ouverture comme a la fermeture : un `<video>` doit donc
 * rebrancher son `srcObject` a son montage, ce que fait deja la grille des
 * participants. La contrepartie est qu'a la fermeture, PAR QUELQUE CHEMIN QUE
 * CE SOIT, la salle doit retrouver son contenu : d'ou l'appel a `onFermer`
 * lorsque la fenetre du systeme se ferme sans nous.
 */

/** Options de `requestWindow`, absentes de la definition standard du DOM. */
interface OptionsFenetreSysteme {
  width?: number
  height?: number
  disallowReturnToOpener?: boolean
  preferInitialWindowPlacement?: boolean
}

/** L'API Document Picture-in-Picture, que TypeScript ne declare pas encore. */
interface ApiFenetreSysteme {
  requestWindow(options?: OptionsFenetreSysteme): Promise<Window>
  readonly window: Window | null
}

/**
 * L'API si le navigateur la porte, `null` sinon.
 *
 * On verifie la METHODE et pas seulement la propriete : c'est ce qui distingue
 * une implementation d'un objet vide pose par une extension.
 */
function apiFenetreSysteme(): ApiFenetreSysteme | null {
  if (typeof window === "undefined") return null
  const porteur = window as unknown as { documentPictureInPicture?: ApiFenetreSysteme }
  const api = porteur.documentPictureInPicture
  return api && typeof api.requestWindow === "function" ? api : null
}

/**
 * Vrai la ou la VRAIE fenetre du systeme est disponible — celle qui survit a la
 * reduction du navigateur. Faux ailleurs, sans jamais jeter : le composant
 * fonctionne quand meme, avec son repli dans la page.
 */
export function fenetreReduiteSupportee(): boolean {
  try {
    return apiFenetreSysteme() !== null
  } catch {
    return false
  }
}

/**
 * Recopie les feuilles de style de la page dans le document de la fenetre.
 *
 * PIEGE MAJEUR DE CETTE API, et la raison d'etre de cette fonction : la fenetre
 * est un AUTRE document. Il nait avec un `<head>` vide. Rien de ce que la page
 * charge ne s'y applique — ni la mise en page, ni la police, ni surtout les
 * variables de theme, qui sont posees sur `:root` par `globals.css`. Sans cette
 * copie, la fenetre s'ouvre en Times New Roman sur fond blanc, toutes les
 * couleurs `var(--...)` tombent a leur valeur vide, et le resultat est
 * inutilisable.
 *
 * Deux chemins, parce que les feuilles ne se lisent pas toutes : `cssRules` leve
 * une `SecurityError` des que la feuille vient d'une autre origine. On recopie
 * donc le texte quand on peut, et on refait pointer un `<link>` vers la meme
 * adresse quand on ne peut pas.
 */
function recopierLesFeuilles(cible: Document): void {
  try {
    // Feuilles construites en memoire : partageables telles quelles, sans copie.
    cible.adoptedStyleSheets = [...document.adoptedStyleSheets]
  } catch {
    // Certains navigateurs refusent d'adopter une feuille nee dans un autre
    // document. Les balises ci-dessous suffisent alors.
  }

  for (const feuille of Array.from(document.styleSheets)) {
    try {
      const regles = Array.from(feuille.cssRules)
        .map((regle) => regle.cssText)
        .join("\n")
      const balise = cible.createElement("style")
      balise.textContent = regles
      if (feuille.media.mediaText) balise.media = feuille.media.mediaText
      cible.head.appendChild(balise)
    } catch {
      // Feuille illisible (autre origine). Son adresse, elle, reste connue : le
      // navigateur la rechargera pour cette fenetre, depuis son cache.
      if (!feuille.href) continue
      const lien = cible.createElement("link")
      lien.rel = "stylesheet"
      lien.href = feuille.href
      if (feuille.media.mediaText) lien.media = feuille.media.mediaText
      cible.head.appendChild(lien)
    }
  }
}

/**
 * Attributs de la racine du document qui portent l'apparence.
 *
 * `data-theme` et `data-palette` choisissent le jeu de variables — les quatre
 * themes de l'application en dependent entierement. `class` porte le marqueur
 * `dark`. `lang` et `dir` servent au navigateur : cesure, correction
 * orthographique, sens de lecture.
 */
const ATTRIBUTS_D_APPARENCE = ["data-theme", "data-palette", "class", "lang", "dir"]

/**
 * Aligne la racine de la fenetre sur celle de la page, et l'y maintient.
 *
 * L'observateur n'est pas un luxe : le bouton de theme est a portee de clic
 * pendant que la fenetre est ouverte. Sans lui, la page passerait en nuit et la
 * fenetre resterait en clair — deux apparences pour une seule application.
 */
function suivreLApparence(cible: Document): () => void {
  const source = document.documentElement
  const copie = cible.documentElement

  const recopier = () => {
    for (const nom of ATTRIBUTS_D_APPARENCE) {
      const valeur = source.getAttribute(nom)
      if (valeur === null) copie.removeAttribute(nom)
      else copie.setAttribute(nom, valeur)
    }
  }

  recopier()
  const observateur = new MutationObserver(recopier)
  observateur.observe(source, { attributes: true, attributeFilter: ATTRIBUTS_D_APPARENCE })
  return () => observateur.disconnect()
}

/** Prepare le document de la fenetre : base, styles, apparence, corps. */
function habillerLaFenetre(cible: Document, titre: string): () => void {
  /*
   * EN PREMIER, la base. L'adresse de ce document est « about:blank » : les
   * `url()` des feuilles recopiees et tout chemin relatif s'y resoudraient dans
   * le vide. Le motif de fond et les polices locales disparaitraient sans un
   * mot d'erreur. On lui donne donc l'adresse de la page — la meme, y compris
   * sous le prefixe /webapp/.
   */
  const base = cible.createElement("base")
  base.href = document.baseURI
  cible.head.appendChild(base)

  recopierLesFeuilles(cible)
  const cesserDeSuivre = suivreLApparence(cible)
  // La classe donne au corps son fond et sa hauteur : la fenetre n'a pas de
  // mise en page a elle, elle emprunte celle de l'application.
  cible.body.className = "fr-corps-pip"
  cible.title = titre
  return cesserDeSuivre
}

/** Position de la carte flottante, en pixels depuis le coin haut gauche. */
interface Position {
  x: number
  y: number
}

/** Ecart conserve entre la carte et le bord de l'ecran a son apparition. */
const MARGE_ECRAN = 16
/** Pas d'un deplacement au clavier, et sa version rapide avec Majuscule. */
const PAS_CLAVIER = 20
const PAS_CLAVIER_RAPIDE = 60
/** Bornes de ce qu'on ose demander au systeme comme taille de fenetre. */
const LARGEUR_MINIMALE = 240
const HAUTEUR_MINIMALE = 200

/** Ramene une valeur entre deux bornes. */
function borner(valeur: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(valeur, minimum), maximum)
}

/**
 * Taille demandee au systeme. Une valeur absurde — zero, `NaN`, un panneau plus
 * grand que l'ecran — ferait echouer la demande, et donc basculer sur le repli
 * alors que la fenetre etait disponible.
 */
function tailleDemandee(valeur: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(valeur) || valeur <= 0) return Math.round(maximum / 3)
  return Math.round(borner(valeur, minimum, maximum))
}

/** Coin bas droit : la ou une fenetre secondaire derange le moins. */
function positionDeDepart(largeur: number, hauteur: number): Position {
  return {
    x: Math.max(MARGE_ECRAN, window.innerWidth - largeur - MARGE_ECRAN),
    y: Math.max(MARGE_ECRAN, window.innerHeight - hauteur - MARGE_ECRAN),
  }
}

/** La carte ne sort jamais de l'ecran : sinon on ne peut plus la ramener. */
function dansLEcran(position: Position, largeur: number, hauteur: number): Position {
  return {
    x: borner(position.x, 0, Math.max(0, window.innerWidth - largeur)),
    y: borner(position.y, 0, Math.max(0, window.innerHeight - hauteur)),
  }
}

export function FenetreReduite({
  ouverte,
  onFermer,
  largeur,
  hauteur,
  children,
}: {
  ouverte: boolean
  /** Appele par la croix ET par la fermeture de la fenetre du systeme. */
  onFermer: () => void
  /** Largeur voulue, en pixels : celle du panneau de chat de la reunion. */
  largeur: number
  /** Hauteur voulue, en pixels : les trois quarts de celle du panneau. */
  hauteur: number
  children: ReactNode
}) {
  const { t } = useTranslation()

  /** La fenetre du systeme, quand elle a pu s'ouvrir. */
  const [fenetreSysteme, setFenetreSysteme] = useState<Window | null>(null)
  /** Le repli : la carte flottante, dans la page. */
  const [repliDansLaPage, setRepliDansLaPage] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)

  const carteRef = useRef<HTMLDivElement | null>(null)
  const glisse = useRef({ actif: false, departX: 0, departY: 0, origineX: 0, origineY: 0 })

  /**
   * Le rappel de fermeture, lisible depuis un ecouteur pose une fois pour
   * toutes. Sans cette reference, l'ecouteur garderait le rappel du premier
   * rendu — et refermer la fenetre appellerait une fonction perimee.
   */
  const fermerRef = useRef(onFermer)
  fermerRef.current = onFermer

  /** Meme raison : la demande d'ouverture est differee d'une tache. */
  const tailleRef = useRef({ largeur, hauteur })
  tailleRef.current = { largeur, hauteur }

  const titre = t("size_small_screen")
  const titreRef = useRef(titre)
  titreRef.current = titre

  useEffect(() => {
    if (!ouverte) return

    const api = apiFenetreSysteme()
    if (!api) {
      // Firefox, Safari : pas de fenetre du systeme. On ne renonce pas pour
      // autant, la carte flottante rend le reste du service.
      setRepliDansLaPage(true)
      return () => setRepliDansLaPage(false)
    }

    let annule = false
    let systeme: Window | null = null
    let deshabiller: (() => void) | null = null

    /*
     * La fenetre a ete fermee SANS nous : la croix du systeme, un raccourci, ou
     * une autre fenetre reduite qui prend sa place — le navigateur n'en tient
     * qu'une. Il faut le remonter, sinon la salle continue de croire que son
     * contenu est ailleurs et reste vide pour toujours.
     */
    const surDisparition = () => {
      if (!annule) fermerRef.current()
    }

    /*
     * POURQUOI UN MINUTEUR A ZERO. React 18 en mode strict monte, demonte et
     * remonte chaque composant dans la MEME tache. Demander la fenetre des le
     * premier montage en ouvrirait deux, ou ferait echouer la seconde demande —
     * le navigateur n'autorise qu'une fenetre reduite par document. Differee
     * d'une tache, la demande du faux montage est annulee avant d'avoir eu lieu,
     * et seul le vrai montage ouvre. Le geste de l'utilisateur reste valide :
     * son effet dure plusieurs secondes, un tour de boucle ne l'epuise pas.
     */
    const minuteur = window.setTimeout(() => {
      api
        .requestWindow({
          width: tailleDemandee(
            tailleRef.current.largeur,
            LARGEUR_MINIMALE,
            window.screen.availWidth
          ),
          height: tailleDemandee(
            tailleRef.current.hauteur,
            HAUTEUR_MINIMALE,
            window.screen.availHeight
          ),
        })
        .then((fenetre) => {
          if (annule) {
            // Le composant est parti pendant l'ouverture : on ne laisse pas
            // une fenetre orpheline sur le bureau.
            fenetre.close()
            return
          }
          systeme = fenetre
          deshabiller = habillerLaFenetre(fenetre.document, titreRef.current)
          fenetre.addEventListener("pagehide", surDisparition)
          setFenetreSysteme(fenetre)
        })
        .catch(() => {
          // Refus de l'utilisateur, demande sans geste declencheur, fenetre deja
          // ouverte ailleurs : on ne laisse pas la commande sans effet, on
          // retombe sur la carte flottante.
          if (!annule) setRepliDansLaPage(true)
        })
    }, 0)

    return () => {
      annule = true
      window.clearTimeout(minuteur)
      deshabiller?.()
      if (systeme) {
        // L'ecouteur d'abord : le fermer nous-memes n'est pas une disparition
        // subie, et rappeler `onFermer` ici bouclerait avec l'appelant.
        systeme.removeEventListener("pagehide", surDisparition)
        systeme.close()
      }
      setFenetreSysteme(null)
      setRepliDansLaPage(false)
    }
  }, [ouverte])

  /** La carte revient dans l'ecran quand la fenetre du navigateur retrecit. */
  useEffect(() => {
    if (!repliDansLaPage) return
    const surRedimension = () => {
      const boite = carteRef.current?.getBoundingClientRect()
      if (!boite) return
      setPosition((precedente) =>
        precedente ? dansLEcran(precedente, boite.width, boite.height) : precedente
      )
    }
    window.addEventListener("resize", surRedimension)
    return () => window.removeEventListener("resize", surRedimension)
  }, [repliDansLaPage])

  /**
   * Deplacement au clavier : la carte doit etre atteignable sans souris. Les
   * fleches la poussent d'un pas, Majuscule enfoncee d'un pas long.
   */
  const deplacer = useCallback((dx: number, dy: number) => {
    setPosition((precedente) => {
      const boite = carteRef.current?.getBoundingClientRect()
      const depart = precedente ?? { x: boite?.left ?? 0, y: boite?.top ?? 0 }
      const suivante = { x: depart.x + dx, y: depart.y + dy }
      return boite ? dansLEcran(suivante, boite.width, boite.height) : suivante
    })
  }, [])

  const surTouche = useCallback(
    (evenement: KeyboardEvent<HTMLButtonElement>) => {
      const pas = evenement.shiftKey ? PAS_CLAVIER_RAPIDE : PAS_CLAVIER
      let dx = 0
      let dy = 0
      if (evenement.key === "ArrowLeft") dx = -pas
      else if (evenement.key === "ArrowRight") dx = pas
      else if (evenement.key === "ArrowUp") dy = -pas
      else if (evenement.key === "ArrowDown") dy = pas
      else return
      // Sans cela, les fleches feraient defiler la page derriere la carte.
      evenement.preventDefault()
      deplacer(dx, dy)
    },
    [deplacer]
  )

  const surPointeurBas = (evenement: PointerEvent<HTMLDivElement>) => {
    // Dans la fenetre du systeme, c'est le systeme qui deplace : la barre de
    // titre n'est pas une poignee, et la capture du pointeur ne ferait
    // qu'empecher les clics sur ce qu'elle contient.
    if (fenetreSysteme) return
    const cible = evenement.target as Element | null
    if (cible?.closest(".fr-fermer")) return
    const boite = carteRef.current?.getBoundingClientRect()
    glisse.current = {
      actif: true,
      departX: evenement.clientX,
      departY: evenement.clientY,
      origineX: position?.x ?? boite?.left ?? 0,
      origineY: position?.y ?? boite?.top ?? 0,
    }
    evenement.currentTarget.setPointerCapture(evenement.pointerId)
  }

  const surPointeurBouge = (evenement: PointerEvent<HTMLDivElement>) => {
    const etat = glisse.current
    if (!etat.actif) return
    const boite = carteRef.current?.getBoundingClientRect()
    const suivante = {
      x: etat.origineX + evenement.clientX - etat.departX,
      y: etat.origineY + evenement.clientY - etat.departY,
    }
    setPosition(boite ? dansLEcran(suivante, boite.width, boite.height) : suivante)
  }

  const surPointeurHaut = (evenement: PointerEvent<HTMLDivElement>) => {
    glisse.current.actif = false
    if (evenement.currentTarget.hasPointerCapture(evenement.pointerId)) {
      evenement.currentTarget.releasePointerCapture(evenement.pointerId)
    }
  }

  if (!ouverte) return null

  const dansPip = fenetreSysteme !== null
  // Ni fenetre ni repli : la demande est encore en vol. On ne rend rien plutot
  // que de faire clignoter une carte que la fenetre du systeme remplacera.
  if (!dansPip && !repliDansLaPage) return null

  const placement = position ?? positionDeDepart(largeur, hauteur)

  const carte = (
    <div
      ref={carteRef}
      className={`fr-fenetre ${dansPip ? "dans-pip" : "dans-page"}`}
      role="dialog"
      aria-label={titre}
      style={
        dansPip
          ? undefined
          : { left: placement.x, top: placement.y, width: largeur, height: hauteur }
      }
    >
      <div
        className="fr-tete"
        onPointerDown={surPointeurBas}
        onPointerMove={surPointeurBouge}
        onPointerUp={surPointeurHaut}
        onPointerCancel={surPointeurHaut}
      >
        {dansPip ? (
          <span className="fr-titre">{titre}</span>
        ) : (
          /* La poignee est un bouton pour etre atteignable au clavier : une fois
             le focus dessus, les fleches deplacent la carte. */
          <button type="button" className="fr-poignee" onKeyDown={surTouche} title={titre}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="9" cy="6" r="1.6" />
              <circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" />
              <circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" />
              <circle cx="15" cy="18" r="1.6" />
            </svg>
            <span className="fr-titre">{titre}</span>
          </button>
        )}

        {/* « Grand ecran » et non « Fermer » : ce bouton ne quitte pas la
            reunion, il la ramene a sa taille. « Fermer », sur une salle en
            cours, laisserait croire qu'on raccroche. */}
        <button
          type="button"
          className="fr-fermer"
          onClick={onFermer}
          title={t("size_large_screen")}
          aria-label={t("size_large_screen")}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 14h6v6M20 10h-6V4" />
            <path d="M14 10 21 3M10 14l-7 7" />
          </svg>
        </button>
      </div>

      {/* Le defilement demande : le rendu video garde une taille lisible, et
          c'est le corps qui defile quand tout ne tient pas. */}
      <div className="fr-corps">{children}</div>
    </div>
  )

  /*
   * Un portail, dans les deux cas. Vers le corps de la fenetre du systeme quand
   * elle existe ; vers celui de la page sinon — et pas la ou la salle a place le
   * composant, car un ancetre en `transform` ou en `overflow: hidden` y
   * emprisonnerait une carte pourtant `fixed`.
   */
  return createPortal(carte, dansPip ? fenetreSysteme.document.body : document.body)
}
