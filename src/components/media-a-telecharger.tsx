import { useTranslation } from "../i18n"
import "./media-a-telecharger.css"

/**
 * LA PLACE D'UN MÉDIA REÇU QU'ON N'A PAS TÉLÉCHARGÉ — le téléchargement
 * automatique de sa famille est éteint (`services/telechargement-auto.ts`).
 *
 * Elle occupe la place du média pour que le fil ne saute pas au moment où il
 * arrive, dit son POIDS — c'est ce qui décide qu'on le télécharge ou non sur
 * un forfait — et un clic le fait venir.
 *
 * Quand un aperçu flouté est déjà là (photo chiffrée : il arrive dans
 * l'enveloppe, sans rien télécharger), on le montre : on reconnaît mieux une
 * photo floue qu'une case vide.
 */
export function MediaATelecharger({
  famille,
  taille,
  apercu,
  ratio,
  dureeMs,
  chargement,
  onTelecharger,
}: {
  famille: "photo" | "video"
  /** Poids déjà mis en forme (« 2,4 Mo »), s'il est connu. */
  taille?: string | null
  /** Aperçu flouté déjà présent, sans téléchargement. */
  apercu?: string | null
  /** Proportions du média (« 4 / 3 »), si on les connaît. */
  ratio?: string
  dureeMs?: number
  /** Le téléchargement est parti : on le montre au lieu du bouton. */
  chargement?: boolean
  onTelecharger: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={`mat-tuile${apercu ? " avec-apercu" : ""}`}
      style={ratio ? { aspectRatio: ratio } : undefined}
      onClick={(e) => {
        // La bulle porte le glisser-pour-répondre et son propre menu.
        e.stopPropagation()
        if (!chargement) onTelecharger()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={`${t("download")}${taille ? ` (${taille})` : ""}`}
    >
      {apercu ? (
        <img src={apercu} alt="" className="mat-apercu" />
      ) : (
        <span className="mat-fond" aria-hidden="true">
          {famille === "video" ? <IconeVideo /> : <IconePhoto />}
        </span>
      )}
      <span className={`mat-pastille${chargement ? " charge" : ""}`}>
        {chargement ? <span className="mat-sablier" aria-hidden="true" /> : <IconeFleche />}
        {taille && <span className="mat-taille">{taille}</span>}
      </span>
      {famille === "video" && dureeMs ? (
        <span className="mat-duree">{duree(dureeMs)}</span>
      ) : null}
    </button>
  )
}

/**
 * Le bouton qui remplace l'APERÇU d'un document (PDF, texte) retenu. La ligne
 * du fichier — nom, poids, téléchargement — reste dessous, comme avant.
 */
export function ApercuATelecharger({
  taille,
  onTelecharger,
}: {
  taille?: string | null
  onTelecharger: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="mat-apercu-doc"
      onClick={(e) => {
        e.stopPropagation()
        onTelecharger()
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <IconeFleche />
      <span>{t("dl_show_preview")}</span>
      {taille && <span className="mat-taille">{taille}</span>}
    </button>
  )
}

/** Pastille posée sur une tuile de grille retenue (album de photos). */
export function PastilleATelecharger() {
  return (
    <span className="mat-pastille petite" aria-hidden="true">
      <IconeFleche />
    </span>
  )
}

function duree(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function IconeFleche() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
    </svg>
  )
}

function IconePhoto() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </svg>
  )
}

function IconeVideo() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="14" height="14" rx="2" />
      <path d="m22 8-6 4 6 4V8z" />
    </svg>
  )
}
