import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "../../../src/i18n"
import type { WebTranslationKey } from "../../../src/i18n/catalogue-web"
import { EnTetePublic, PiedPublic } from "../../../src/components/cadre-public"
import "./fonctionnalites.css"

/*
 * LA PAGE « FONCTIONNALITÉS » (20/11/2026), demandée par le user : le lien
 * « Fonctionnalités » de la barre du haut menait à une bande de trois chiffres.
 *
 * ⚠️ N'Y DÉCRIRE QUE CE QUE L'APPLICATION FAIT VRAIMENT, et sans nommer aucune
 * technologie ni aucun fournisseur : c'est une page publique.
 */
type Carte = { cle: string; icone: ReactNode }

/*
 * Le nuage, en lobes ronds qui se chevauchent, comme un cumulus : une base
 * allongée, un corps plein sous le texte, puis des bosses de tailles variées,
 * plus hautes au milieu. [cx, cy, rx, ry]
 *
 * DEUX DESSINS : étirer le dessin large dans la colonne d'un téléphone
 * déformait chaque lobe en œuf. Le second est pensé pour un bloc presque carré.
 */
type Lobe = [number, number, number, number]

/** Écran large : repère 1000 × 420. */
const LOBES_LARGE: Lobe[] = [
  [500, 318, 450, 92],
  [120, 300, 92, 82],
  [235, 225, 118, 112],
  [385, 160, 132, 128],
  [545, 128, 150, 138],
  [705, 168, 128, 122],
  [830, 238, 104, 100],
  [925, 305, 72, 70],
  [300, 300, 140, 96],
  [640, 290, 170, 104],
]

/** Téléphone : repère 600 × 560. */
const LOBES_ETROIT: Lobe[] = [
  [300, 330, 272, 190],
  [300, 470, 285, 78],
  [80, 430, 76, 72],
  [520, 440, 74, 70],
  [130, 250, 104, 100],
  [265, 165, 120, 112],
  [415, 195, 112, 106],
  [500, 300, 92, 90],
  [200, 455, 130, 86],
  [410, 455, 140, 88],
]

function Nuage({ forme, lobes, largeur, hauteur }: { forme: string; lobes: Lobe[]; largeur: number; hauteur: number }) {
  // Identifiants propres à chaque dessin : un dégradé défini dans le dessin
  // masqué (display: none) ne s'appliquerait plus à l'autre.
  const lumiere = `fct-nuage-lobe-${forme}`
  const doux = `fct-nuage-doux-${forme}`
  return (
    <svg
      className={`fct-nuage-forme fct-nuage-${forme}`}
      viewBox={`0 0 ${largeur} ${hauteur}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={lumiere} cx="50%" cy="32%" r="68%">
          <stop offset="0%" style={{ stopColor: "var(--nuage-lumiere)" }} />
          <stop offset="62%" style={{ stopColor: "var(--nuage-corps)" }} />
          <stop offset="100%" style={{ stopColor: "var(--nuage-dessous)" }} />
        </radialGradient>
        <filter id={doux} x="-6%" y="-12%" width="112%" height="124%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02 0.045" numOctaves="2" seed="3" result="bruit" />
          <feDisplacementMap in="SourceGraphic" in2="bruit" scale="9" xChannelSelector="R" yChannelSelector="G" result="bord" />
          <feGaussianBlur in="bord" stdDeviation="2.2" />
        </filter>
      </defs>
      <g filter={`url(#${doux})`}>
        {lobes.map(([cx, cy, rx, ry]) => (
          <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${lumiere})`} />
        ))}
      </g>
    </svg>
  )
}

const CARTES: Carte[] = [
  {
    cle: "messages",
    icone: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  },
  {
    cle: "appels",
    icone: (
      <>
        <path d="M23 7l-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
      </>
    ),
  },
  {
    cle: "reunions",
    icone: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
  },
  {
    cle: "groupes",
    icone: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
  {
    cle: "statuts",
    icone: (
      <>
        <circle cx="12" cy="12" r="9" strokeDasharray="4 3" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    cle: "chiffrement",
    icone: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
  },
  {
    cle: "appareils",
    icone: (
      <>
        <rect x="2" y="4" width="14" height="10" rx="2" />
        <path d="M6 18h6M9 14v4" />
        <rect x="17" y="8" width="5" height="12" rx="1" />
      </>
    ),
  },
  {
    cle: "traduction",
    icone: <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />,
  },
  {
    cle: "entreprises",
    icone: (
      <>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
      </>
    ),
  },
  {
    cle: "repondeur",
    icone: (
      <>
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      </>
    ),
  },
  {
    cle: "assistant",
    icone: (
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
    ),
  },
  {
    cle: "confidentialite",
    icone: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  },
]

export default function FonctionnalitesPage() {
  const { t } = useTranslation()
  const tr = (cle: string) => t(cle as WebTranslationKey)

  return (
    <div className="cp-page">
      <EnTetePublic action="connexion" />
      <main className="fct-corps cp-corps">
        <section className="fct-intro">
          {/* Le titre dans un nuage (demande du user, 20/11/2026) : des lobes
              éclairés par le haut, légèrement ombrés en dessous, aux bords
              adoucis — sans contour. Le texte, posé dessus, reste net. */}
          <div className="fct-nuage">
            <Nuage forme="large" lobes={LOBES_LARGE} largeur={1000} hauteur={420} />
            <Nuage forme="etroit" lobes={LOBES_ETROIT} largeur={600} hauteur={560} />
            <h1 className="fct-titre">{tr("fct_titre")}</h1>
            <p className="fct-sous-titre">{tr("fct_sous_titre")}</p>
          </div>
        </section>

        <ul className="fct-grille">
          {CARTES.map(({ cle, icone }) => (
            <li key={cle} className="fct-carte">
              <span className="fct-icone" aria-hidden="true">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {icone}
                </svg>
              </span>
              <h2 className="fct-carte-titre">{tr(`fct_${cle}_titre`)}</h2>
              <p className="fct-carte-texte">{tr(`fct_${cle}_texte`)}</p>
            </li>
          ))}
        </ul>

        <section className="fct-appel">
          <div>
            <h2 className="fct-appel-titre">{tr("fct_cta_titre")}</h2>
            <p className="fct-appel-texte">{tr("fct_cta_texte")}</p>
          </div>
          <div className="fct-appel-boutons">
            <Link to="/signup" className="fct-bouton-plein">
              {t("welcome_start")}
            </Link>
            <Link to="/login" className="fct-bouton-creux">
              {t("login")}
            </Link>
          </div>
        </section>
      </main>
      <PiedPublic />
    </div>
  )
}
