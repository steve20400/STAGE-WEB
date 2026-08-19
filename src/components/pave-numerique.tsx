import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react"
import {
  ALANYA_NUMBER_MAX_LENGTH,
  formatAlanyaNumber,
  normalizeAlanyaNumber,
} from "../lib/alanya-number"
import { useTranslation } from "../i18n"
import "./pave-numerique.css"

/** Disposition d'un clavier de telephone, celle du composeur d'appel. */
const TOUCHES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""] as const

/**
 * Pave numerique reutilisable : un numero Alanya en cours de composition, les
 * dix chiffres, un effacement d'un chiffre et un effacement total. Rien d'autre.
 *
 * POURQUOI CE COMPOSANT alors que `app/(protected)/calls/dialer.tsx` fait deja
 * ce clavier. Le composeur d'appel est un ECRAN : il occupe la fenetre, il
 * porte ses boutons d'appel et sa fermeture, et il decide lui-meme de ce qu'on
 * fait du numero. On a maintenant besoin du meme clavier POSE DANS une autre
 * interface — la fenetre des listes de contacts, ou l'on ajoute un membre par
 * son numero. D'ou un composant qui ne sait que composer : le numero est tenu
 * par le parent (`valeur` / `onChange`), et ce qu'on en fait lui appartient.
 * Pas de bouton d'appel ici, pas de bouton de fermeture.
 *
 * POURQUOI LE CLAVIER PHYSIQUE EST ECOUTE SUR LA RACINE ET NON SUR `document`.
 * C'est le seul vrai piege du composant. Le composeur plein ecran, lui, ecoute
 * `document` : il est seul a l'ecran, aucune autre saisie ne peut lui disputer
 * une frappe. Ce pave-ci vit dans une fenetre qui contient AUSSI des champs
 * texte — le nom de la liste, la recherche de contacts. Un ecouteur global y
 * volerait les chiffres tapes dans ces champs : « Astreinte 2 » deviendrait
 * « Astreinte » dans le champ et « 2 » dans le pave, sans que rien ne
 * l'explique. L'ecoute est donc attachee a la racine du composant, qui prend
 * le focus (`tabIndex`), et ne recoit que ce qui est frappe pendant qu'elle,
 * ou l'une de ses touches, a le focus.
 */
export function PaveNumerique({
  valeur,
  onChange,
  onValider,
  autoFocus,
  sousLeNumero,
}: {
  /** Chiffres seuls, sans les espaces d'affichage. Le parent tient l'etat. */
  valeur: string
  onChange: (chiffres: string) => void
  /** Appele sur Entree, quand la racine a le focus. Facultatif. */
  onValider?: () => void
  autoFocus?: boolean
  /**
   * Contenu place DIRECTEMENT sous les chiffres, a l'interieur de l'ecran du
   * pave — le nom du titulaire du numero, en pratique.
   *
   * Ce prop existe parce que le poser a cote du pave ne marche pas : les
   * chiffres sont dessines DANS le composant, en tete de sa grille, et un frere
   * suivant se retrouve donc apres les douze touches et la rangee d'effacement,
   * soit plus de quatre cents pixels plus bas. Sur telephone il fallait faire
   * defiler par-dessus tout le clavier pour lire le nom du numero qu'on venait
   * de composer, et les deux n'etaient jamais visibles ensemble.
   */
  sousLeNumero?: ReactNode
}) {
  const { t } = useTranslation()
  const racine = useRef<HTMLDivElement>(null)

  // Le parent peut poser n'importe quoi dans `valeur` (un collage, un numero
  // deja formate) : on ne fait confiance qu'a la version normalisee et bornee.
  const chiffres = useMemo(
    () => normalizeAlanyaNumber(valeur).slice(0, ALANYA_NUMBER_MAX_LENGTH),
    [valeur]
  )

  const taper = useCallback(
    (touche: string) => {
      const suivant = normalizeAlanyaNumber(chiffres + touche).slice(0, ALANYA_NUMBER_MAX_LENGTH)
      // Au plafond, la frappe ne change rien : ne pas prevenir le parent lui
      // evite un rendu pour rien a chaque touche pressee dans le vide.
      if (suivant !== chiffres) onChange(suivant)
    },
    [chiffres, onChange]
  )

  const effacer = useCallback(() => {
    if (chiffres) onChange(chiffres.slice(0, -1))
  }, [chiffres, onChange])

  const vider = useCallback(() => {
    if (chiffres) onChange("")
  }, [chiffres, onChange])

  const surFrappe = useCallback(
    (evenement: React.KeyboardEvent<HTMLDivElement>) => {
      if (/^[0-9]$/.test(evenement.key)) {
        evenement.preventDefault()
        return taper(evenement.key)
      }
      if (evenement.key === "Backspace" || evenement.key === "Delete") {
        // Sans cela, certains navigateurs remontent d'une page a la frappe
        // d'un retour arriere hors champ de saisie.
        evenement.preventDefault()
        return effacer()
      }
      if (evenement.key === "Enter") {
        // Entree sur une touche du pave, c'est presser CETTE touche : le
        // navigateur en fait deja un clic, on ne le double pas d'une
        // validation qui fermerait la fenetre au premier chiffre.
        const cible = evenement.target as HTMLElement
        if (cible !== evenement.currentTarget && cible.closest("button")) return
        onValider?.()
      }
      // Tout le reste (Echap en particulier) poursuit sa route : c'est la
      // fenetre qui porte le pave qui decide de s'en servir.
    },
    [effacer, onValider, taper]
  )

  // Le clic sur une touche ne doit pas laisser le focus la ou il etait — dans
  // le champ du nom, par exemple : la frappe suivante y partirait au lieu
  // d'arriver ici. On empeche donc le deplacement de focus par la souris et on
  // le ramene a la racine, seule porteuse de l'ecoute clavier.
  const surSouris = useCallback((evenement: React.MouseEvent<HTMLDivElement>) => {
    evenement.preventDefault()
    racine.current?.focus()
  }, [])

  useEffect(() => {
    if (autoFocus) racine.current?.focus()
  }, [autoFocus])

  return (
    <div
      ref={racine}
      className="pave-root"
      role="group"
      aria-label={t("dial_an_id")}
      tabIndex={0}
      onKeyDown={surFrappe}
      onMouseDown={surSouris}
    >
      {/* Le numero s'annonce a chaque chiffre : sans lecture a voix haute, un
          pave tactile ne dit pas ce qu'il a compris. */}
      <div className="pave-ecran">
        <div className="pave-numero" aria-live="polite">
          {chiffres ? formatAlanyaNumber(chiffres) : <span className="pave-vide">Alanya ID</span>}
        </div>
        {sousLeNumero ? <div className="pave-sous-numero">{sousLeNumero}</div> : null}
      </div>

      <div className="pave-touches">
        {TOUCHES.map((touche, index) =>
          touche === "" ? (
            // Les deux cases vides de la derniere rangee tiennent la grille en
            // place : le 0 reste centre sous le 8, comme sur un telephone.
            <span key={`vide-${index}`} aria-hidden />
          ) : (
            <button
              key={touche}
              type="button"
              className="pave-touche"
              onClick={() => taper(touche)}
              aria-label={touche}
            >
              {touche}
            </button>
          )
        )}
      </div>

      <div className="pave-actions">
        <span aria-hidden />

        <button
          type="button"
          className="pave-vider"
          onClick={vider}
          disabled={chiffres.length === 0}
        >
          {t("erase")}
        </button>

        <button
          type="button"
          className="pave-effacer"
          onClick={effacer}
          disabled={chiffres.length === 0}
          aria-label={t("erase_last_digit")}
          title={t("erase_last_digit")}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M21 5H9L3 12l6 7h12a1 1 0 001-1V6a1 1 0 00-1-1z" />
            <line x1="18" y1="9" x2="12" y2="15" />
            <line x1="12" y1="9" x2="18" y2="15" />
          </svg>
        </button>
      </div>
    </div>
  )
}
