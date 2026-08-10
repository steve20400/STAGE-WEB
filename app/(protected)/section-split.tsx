import type { ReactNode } from "react"
import { useTranslation, type Cle } from "../../src/i18n"
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
  /* Des CLES, pas des libelles : l'arbre de routes est construit une seule fois
     au demarrage. Un texte deja traduit y resterait fige dans la langue du
     chargement, et ne suivrait pas un changement de langue. */
  title: Cle
  subtitle: Cle
}

export default function SectionSplit({ children, icon, title, subtitle }: SectionSplitProps) {
  const { t } = useTranslation()
  return (
    <div className="section-split">
      <div className="section-split-list">{children}</div>
      <div className="section-split-panel">
        <div className="section-split-badge">{icon}</div>
        <div className="section-split-title">{t(title)}</div>
        <div className="section-split-sub">{t(subtitle)}</div>
      </div>
    </div>
  )
}
