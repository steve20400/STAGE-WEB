import type { ReactNode } from "react"
import "./section-split.css"

/**
 * Cadre deux colonnes facon WhatsApp Web, reutilise pour les sections qui n'ont
 * pas de detail navigable (Appels, Statuts) : la liste occupe une colonne
 * etroite a gauche, un panneau d'accueil remplit la droite. Sur petit ecran,
 * seule la liste est affichee.
 */
interface SectionSplitProps {
  children: ReactNode
  icon: ReactNode
  title: string
  subtitle: string
}

export default function SectionSplit({ children, icon, title, subtitle }: SectionSplitProps) {
  return (
    <div className="section-split">
      <div className="section-split-list">{children}</div>
      <div className="section-split-panel">
        <div className="section-split-badge">{icon}</div>
        <div className="section-split-title">{title}</div>
        <div className="section-split-sub">{subtitle}</div>
      </div>
    </div>
  )
}
