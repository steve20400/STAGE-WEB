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

/** La silhouette du nuage, dans un repère de 1000 × 420 étiré au texte. */
const TRACE_NUAGE =
  "M 90 385 L 910 385 A 75 75 0 0 0 965 255 A 95 95 0 0 0 860 125 A 115 115 0 0 0 665 70 A 135 135 0 0 0 430 55 A 115 115 0 0 0 225 95 A 95 95 0 0 0 60 200 A 90 90 0 0 0 90 385 Z"

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
          {/* Le titre dans un nuage (demande du user, 20/11/2026) : une
              silhouette de nuage dont le bord est effiloché par un bruit
              (feTurbulence) puis estompé, avec une ombre douce sur le pourtour,
              pour un rendu proche d'un vrai nuage. Le texte, lui, reste net. */}
          <div className="fct-nuage">
            <svg className="fct-nuage-forme" viewBox="0 0 1000 420" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <filter id="fct-nuage-effiloche" x="-8%" y="-15%" width="116%" height="130%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.011 0.028" numOctaves="3" seed="7" result="bruit" />
                  <feDisplacementMap in="SourceGraphic" in2="bruit" scale="26" xChannelSelector="R" yChannelSelector="G" />
                </filter>
              </defs>
              <g filter="url(#fct-nuage-effiloche)">
                {/* Le pourtour ombré, un peu plus large que le corps. */}
                <path className="fct-nuage-ombre" d={TRACE_NUAGE} vectorEffect="non-scaling-stroke" />
                <path className="fct-nuage-corps" d={TRACE_NUAGE} />
              </g>
            </svg>
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
