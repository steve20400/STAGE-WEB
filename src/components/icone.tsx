import type { CSSProperties, ReactNode } from "react"

/**
 * ICÔNES EN TRAIT — à la place des émojis dans l'interface (consigne du user,
 * 14/11/2026 : « pas de stickers sur les interfaces, utilise les icônes »).
 *
 * Trait de 2 px sur une grille de 24, couleur héritée du texte
 * (`currentColor`) : l'icône suit le thème et la couleur de son parent, comme
 * les SVG déjà dessinés à la main dans l'application.
 *
 * Les émojis restent permis dans le CONTENU choisi par l'utilisateur
 * (réactions, sélecteur d'émojis, messages), jamais comme décor d'interface.
 */

export type NomIcone =
  | "etincelles"
  | "repere"
  | "alerte"
  | "cadenas"
  | "cadenas-ouvert"
  | "micro"
  | "musique"
  | "film"
  | "epingle"
  | "outil"
  | "crayon"
  | "personne"
  | "imprimante-barree"
  | "bouclier"
  | "oeil"
  | "oeil-barre"
  | "envoyer"
  | "rogner"
  | "pivoter"
  | "cadre-libre"
  | "carre"
  | "valider"

const TRACES: Record<NomIcone, ReactNode> = {
  etincelles: (
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </>
  ),
  repere: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  alerte: (
    <>
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  cadenas: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  "cadenas-ouvert": (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.8-1.2" />
    </>
  ),
  micro: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 18v4" />
    </>
  ),
  musique: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  film: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5" />
    </>
  ),
  epingle: (
    <>
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z" />
    </>
  ),
  outil: (
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
  ),
  crayon: (
    <>
      <path d="M17 3l4 4L8 20H4v-4z" />
      <path d="M14 6l4 4" />
    </>
  ),
  personne: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  "imprimante-barree": (
    <>
      <path d="M6 9V3h12v6" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="7" />
      <path d="M3 3l18 18" />
    </>
  ),
  bouclier: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  oeil: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "oeil-barre": (
    <>
      <path d="M9.9 5.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.8 3.7" />
      <path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M14.1 14.1a3 3 0 0 1-4.2-4.2" />
      <path d="M2 2l20 20" />
    </>
  ),
  rogner: (
    <>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </>
  ),
  pivoter: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  "cadre-libre": (
    <>
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    </>
  ),
  carre: <rect x="4" y="4" width="16" height="16" rx="2" />,
  valider: <path d="M20 6L9 17l-5-5" />,
  envoyer: (
    <>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </>
  ),
}

export function Icone({
  nom,
  taille = 16,
  style,
  className,
}: {
  nom: NomIcone
  taille?: number
  style?: CSSProperties
  className?: string
}) {
  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "inline-block", verticalAlign: "-0.15em", flex: "none", ...style }}
    >
      {TRACES[nom]}
    </svg>
  )
}
