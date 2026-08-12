import { useCallback, useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation, type Cle } from "../i18n"
import {
  SECTIONS_FICHE,
  ficheMoteur,
  type SectionFiche,
  type TonReponse,
} from "../i18n/docs-traduction"
import { nomMoteur, type CodeMoteur } from "../services/traduction-fournisseurs"
import "./fiche-confidentialite.css"

/**
 * La fiche « ce que ce moteur fait de vos donnees », et le bouton qui l'ouvre.
 *
 * POURQUOI CE COMPOSANT. Les Parametres proposent cinq moteurs de traduction
 * avec leur prix. Le prix se compare d'un coup d'oeil ; le trajet du texte,
 * non. Or c'est lui qui devrait decider : un message confie a un fournisseur
 * distant a quitte l'appareil, et aucune note de deux lignes sous le nom du
 * moteur ne suffit a l'expliquer. D'ou une fiche : un texte qu'on LIT, ouvert
 * sur place, sans quitter l'application ni ouvrir un navigateur.
 *
 * POURQUOI UN SEUL COMPOSANT POUR LES DEUX. Le bouton et la fiche partagent
 * l'etat d'ouverture et la reference du bouton — le focus doit revenir a
 * l'endroit d'ou l'on est parti. Les separer obligerait les Parametres a tenir
 * cet etat et cette reference pour chacune des cinq lignes, pour rien.
 *
 * CE QUE CE FICHIER NE CONTIENT PAS : le texte des fiches. Il vit dans
 * `src/i18n/docs-traduction.ts`, indexe par moteur puis par langue. Ici, la
 * FORME seulement : l'ordre des questions, la hierarchie, le comportement.
 */

/* ------------------------------------------------------------- Libelles */

/**
 * A chaque section sa question. Les quatre libelles vivent dans le catalogue
 * et non dans les fiches : ils sont identiques d'un moteur a l'autre, et c'est
 * la structure qui doit poser l'ordre des questions, pas le redacteur.
 */
const CLE_QUESTION: Record<SectionFiche, Cle> = {
  sortie: "docs_trad_q_sortie",
  destinataire: "docs_trad_q_destinataire",
  duree: "docs_trad_q_duree",
  entrainement: "docs_trad_q_entrainement",
}

/**
 * Le ton d'une reponse est une couleur, et une couleur ne se lit pas au
 * clavier ni a voix haute. Chaque verdict est donc precede de son ton en
 * toutes lettres, visible seulement des lecteurs d'ecran.
 */
const CLE_TON: Record<TonReponse, Cle> = {
  sur: "docs_trad_ton_sur",
  vigilance: "docs_trad_ton_vigilance",
  risque: "docs_trad_ton_risque",
}

/** Ce qui peut recevoir le focus dans le panneau, pour le maintenir dedans. */
const SELECTEUR_FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/* --------------------------------------------------------------- Panneau */

/**
 * Le panneau lui-meme, monte dans un portail sur `<body>`.
 *
 * Le portail n'est pas une precaution de style : la liste des moteurs vit dans
 * une carte des Parametres, et une page qui defile. Rendu sur place, un panneau
 * `position: fixed` survivrait a l'overflow mais pas a un ancetre transforme —
 * et la page des Parametres en gagnera peut-etre un. Sur `<body>`, la question
 * ne se pose plus.
 *
 * Trois sorties, comme partout ailleurs dans l'application : la croix, Echap,
 * un clic hors du panneau. Rien d'autre ne ferme — surtout pas un clic dans le
 * texte, qu'on lit et qu'on selectionne.
 */
function PanneauFiche({ moteur, onClose }: { moteur: CodeMoteur; onClose: () => void }) {
  const { t, language } = useTranslation()
  const panneau = useRef<HTMLDivElement>(null)
  const idTitre = useId()
  /**
   * Une selection de texte qui demarre DANS le panneau et se relache dehors
   * produit un clic sur le voile. Sans cette memoire, surligner la derniere
   * ligne d'un paragraphe fermerait la fiche.
   */
  const presseSurLeVoile = useRef(false)

  const nom = nomMoteur(moteur, language)
  const fiche = ficheMoteur(moteur, language)

  // Le focus entre dans le panneau a l'ouverture, et n'en sort plus : c'est une
  // fenetre modale, tabuler jusqu'aux Parametres derriere elle n'aurait aucun
  // sens pour qui ne voit pas qu'ils sont couverts.
  useEffect(() => {
    const boite = panneau.current
    boite?.focus()

    const surTouche = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") {
        // En capture et propagation stoppee : la page des Parametres peut avoir
        // ses propres fenetres, une seule doit se fermer a la fois.
        evenement.stopPropagation()
        evenement.preventDefault()
        onClose()
        return
      }
      if (evenement.key !== "Tab" || !boite) return
      const cibles = Array.from(boite.querySelectorAll<HTMLElement>(SELECTEUR_FOCUSABLE))
      if (cibles.length === 0) {
        // Rien a atteindre : on garde le focus sur le panneau plutot que de le
        // laisser filer derriere.
        evenement.preventDefault()
        boite.focus()
        return
      }
      const premier = cibles[0]
      const dernier = cibles[cibles.length - 1]
      const actif = document.activeElement
      if (evenement.shiftKey && (actif === premier || actif === boite)) {
        evenement.preventDefault()
        dernier.focus()
      } else if (!evenement.shiftKey && actif === dernier) {
        evenement.preventDefault()
        premier.focus()
      }
    }

    document.addEventListener("keydown", surTouche, true)
    return () => document.removeEventListener("keydown", surTouche, true)
  }, [onClose])

  return createPortal(
    <div
      className="ftm-voile"
      onMouseDown={(evenement) => {
        presseSurLeVoile.current = evenement.target === evenement.currentTarget
      }}
      onClick={(evenement) => {
        if (evenement.target === evenement.currentTarget && presseSurLeVoile.current) onClose()
      }}
    >
      <div
        ref={panneau}
        className="ftm-panneau"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        tabIndex={-1}
      >
        <header className="ftm-tete">
          <div className="ftm-tete-texte">
            <p className="ftm-surtitre">{t("docs_trad_kicker")}</p>
            <h2 className="ftm-titre" id={idTitre}>
              {t("docs_trad_title", { moteur: nom })}
            </h2>
          </div>
          <button
            type="button"
            className="ftm-fermer"
            onClick={onClose}
            aria-label={t("docs_trad_close")}
            title={t("docs_trad_close")}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="ftm-corps">
          {fiche === null ? (
            <p className="ftm-vide">{t("docs_trad_missing")}</p>
          ) : (
            <>
              <p className="ftm-chapeau">{fiche.resume}</p>
              {/* Une liste ORDONNEE : l'ordre des quatre questions fait partie
                  de ce qui est dit, et un lecteur d'ecran doit l'entendre. */}
              <ol className="ftm-questions">
                {SECTIONS_FICHE.map((section) => {
                  const reponse = fiche.reponses[section]
                  return (
                    <li className="ftm-question" key={section}>
                      <h3 className="ftm-q">{t(CLE_QUESTION[section])}</h3>
                      <p className={`ftm-verdict ftm-ton-${reponse.ton}`}>
                        <span className="ftm-hors-ecran">{t(CLE_TON[reponse.ton])} : </span>
                        {reponse.verdict}
                      </p>
                      {reponse.paragraphes.map((paragraphe, rang) => (
                        <p className="ftm-p" key={rang}>
                          {paragraphe}
                        </p>
                      ))}
                    </li>
                  )
                })}
              </ol>
              {(fiche.source || fiche.maj) && (
                <footer className="ftm-pied">
                  {fiche.source && <p>{fiche.source}</p>}
                  {fiche.maj && <p>{t("docs_trad_updated", { date: fiche.maj })}</p>}
                </footer>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ---------------------------------------------------------------- Bouton */

/**
 * Le bouton d'acces, a poser a cote de chaque moteur de la liste.
 *
 * Il est FRERE du bouton de choix, jamais dedans : un bouton dans un bouton
 * n'est pas du HTML valide, et surtout le clic irait au mauvais. Le moteur se
 * choisit en cliquant la ligne, la fiche s'ouvre en cliquant le « i » — les
 * deux gestes ne se marchent pas dessus.
 *
 * Le focus revient ici a la fermeture, quelle qu'en soit la maniere. C'est tout
 * l'interet de garder l'etat dans le bouton plutot que dans la page.
 */
export default function BoutonFicheMoteur({ moteur }: { moteur: CodeMoteur }) {
  const { t, language } = useTranslation()
  const [ouverte, setOuverte] = useState(false)
  const bouton = useRef<HTMLButtonElement>(null)

  const fermer = useCallback(() => {
    setOuverte(false)
    // Rendu avant le demontage du portail : le bouton existe encore, il recoit
    // le focus, et le demontage ne le renvoie donc pas sur <body>.
    bouton.current?.focus()
  }, [])

  const libelle = t("docs_trad_open", { moteur: nomMoteur(moteur, language) })

  return (
    <>
      <button
        ref={bouton}
        type="button"
        className="ftm-acces"
        onClick={() => setOuverte(true)}
        aria-label={libelle}
        aria-haspopup="dialog"
        aria-expanded={ouverte}
        title={libelle}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9.5" />
          <line x1="12" y1="11" x2="12" y2="16.5" />
          <line x1="12" y1="7.6" x2="12" y2="7.7" />
        </svg>
      </button>
      {ouverte && <PanneauFiche moteur={moteur} onClose={fermer} />}
    </>
  )
}
