import { useEffect, useRef, useState, type PointerEvent as PointerEventReact } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "../i18n"
import { toInitials } from "../data/session-user"
import "./photo-profil.css"

/**
 * LA PHOTO DE PROFIL EN GRAND (01/11/2026, jumeau de `avatar_viewer_screen.dart`).
 *
 * Fond noir, la photo au centre ; sans photo, l'initiale. Un clic hors de la
 * photo, la croix ou Echap referment.
 */
export function VisionneusePhotoProfil({
  nom,
  src,
  onFermer,
}: {
  nom: string
  src: string | null
  onFermer: () => void
}) {
  const { t } = useTranslation()
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer()
    }
    window.addEventListener("keydown", touche)
    return () => window.removeEventListener("keydown", touche)
  }, [onFermer])

  return createPortal(
    <div className="pp-voile" role="dialog" aria-label={nom} onClick={onFermer}>
      <div className="pp-tete" onClick={(e) => e.stopPropagation()}>
        <span>{nom}</span>
        <button type="button" onClick={onFermer} aria-label={t("close")}>
          ✕
        </button>
      </div>
      {src ? (
        <img className="pp-photo" src={src} alt={nom} onClick={(e) => e.stopPropagation()} />
      ) : (
        <div className="pp-initiale" onClick={(e) => e.stopPropagation()}>
          {toInitials(nom)}
        </div>
      )}
    </div>,
    document.body,
  )
}

/**
 * UN CHOIX EN QUELQUES LIGNES, comme la feuille du mobile : « Voir la photo /
 * Modifier », « Voir le statut / Voir la photo de profil ».
 */
export function ChoixActions({
  titre,
  actions,
  onFermer,
}: {
  titre?: string
  actions: Array<{ libelle: string; onChoisir: () => void }>
  onFermer: () => void
}) {
  const { t } = useTranslation()
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer()
    }
    window.addEventListener("keydown", touche)
    return () => window.removeEventListener("keydown", touche)
  }, [onFermer])

  return createPortal(
    <div className="pp-voile clair" onClick={onFermer}>
      <div className="pp-choix" role="menu" onClick={(e) => e.stopPropagation()}>
        {titre && <div className="pp-choix-titre">{titre}</div>}
        {actions.map((a) => (
          <button
            key={a.libelle}
            type="button"
            role="menuitem"
            onClick={() => {
              onFermer()
              a.onChoisir()
            }}
          >
            {a.libelle}
          </button>
        ))}
        <button type="button" className="pp-choix-annuler" onClick={onFermer}>
          {t("cancel")}
        </button>
      </div>
    </div>,
    document.body,
  )
}

/**
 * RECADRER LA PHOTO AVANT DE LA METTRE SUR LE PROFIL (01/11/2026, jumeau de
 * `recadrage_photo_screen.dart`). On déplace la photo à la souris ou au doigt,
 * on zoome à la molette ou au curseur ; le cercle montre ce que les autres
 * verront. Rend une miniature carrée en data-URL JPEG.
 */
export function RecadreurPhoto({
  fichier,
  cote = 256,
  onValider,
  onAnnuler,
}: {
  fichier: File
  cote?: number
  onValider: (dataUrl: string) => void
  onAnnuler: () => void
}) {
  const { t } = useTranslation()
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [echec, setEchec] = useState(false)
  const [zoom, setZoom] = useState(1)
  // Position du coin haut-gauche de l'image dans la fenêtre.
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const glisse = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  // Le côté de la fenêtre, en pixels d'écran : 280 au plus, moins sur un petit
  // téléphone, marges comprises.
  const [fenetre] = useState(() => Math.max(200, Math.min(280, window.innerWidth - 80)))

  useEffect(() => {
    const url = URL.createObjectURL(fichier)
    const img = new Image()
    img.onload = () => {
      const base = fenetre / Math.min(img.naturalWidth, img.naturalHeight)
      // Centrée, le petit côté remplissant la fenêtre.
      setPos({
        x: (fenetre - img.naturalWidth * base) / 2,
        y: (fenetre - img.naturalHeight * base) / 2,
      })
      setImage(img)
    }
    img.onerror = () => setEchec(true)
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [fichier, fenetre])

  const base = image ? fenetre / Math.min(image.naturalWidth, image.naturalHeight) : 1
  const largeur = image ? image.naturalWidth * base * zoom : 0
  const hauteur = image ? image.naturalHeight * base * zoom : 0

  /** L'image couvre toujours la fenêtre : jamais de vide dans la photo. */
  const borner = (x: number, y: number, l = largeur, h = hauteur) => ({
    x: Math.min(0, Math.max(fenetre - l, x)),
    y: Math.min(0, Math.max(fenetre - h, y)),
  })

  /** Zoome autour du centre de la fenêtre. */
  const changerZoom = (nouveau: number) => {
    if (!image) return
    const z = Math.min(5, Math.max(1, nouveau))
    const centreX = (fenetre / 2 - pos.x) / zoom
    const centreY = (fenetre / 2 - pos.y) / zoom
    const l = image.naturalWidth * base * z
    const h = image.naturalHeight * base * z
    setZoom(z)
    setPos(borner(fenetre / 2 - centreX * z, fenetre / 2 - centreY * z, l, h))
  }

  const debut = (e: PointerEventReact<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    glisse.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
  }
  const bouge = (e: PointerEventReact<HTMLDivElement>) => {
    const g = glisse.current
    if (!g) return
    setPos(borner(g.px + e.clientX - g.x, g.py + e.clientY - g.y))
  }
  const fin = () => {
    glisse.current = null
  }

  const valider = () => {
    if (!image) return
    const echelle = base * zoom
    const canvas = document.createElement("canvas")
    canvas.width = cote
    canvas.height = cote
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(
      image,
      -pos.x / echelle,
      -pos.y / echelle,
      fenetre / echelle,
      fenetre / echelle,
      0,
      0,
      cote,
      cote,
    )
    onValider(canvas.toDataURL("image/jpeg", 0.85))
  }

  return createPortal(
    <div className="pp-voile">
      <div className="pp-recadreur" role="dialog" aria-label={t("crop_title")}>
        <div className="pp-recadreur-titre">{t("crop_title")}</div>
        {echec ? (
          <div className="pp-recadreur-echec">{t("crop_failed")}</div>
        ) : (
          <div
            className="pp-fenetre"
            style={{ width: fenetre, height: fenetre }}
            onPointerDown={debut}
            onPointerMove={bouge}
            onPointerUp={fin}
            onPointerCancel={fin}
            onWheel={(e) => changerZoom(zoom - e.deltaY / 500)}
          >
            {image && (
              <img
                src={image.src}
                alt=""
                draggable={false}
                style={{ left: pos.x, top: pos.y, width: largeur, height: hauteur }}
              />
            )}
            <div className="pp-masque" aria-hidden="true" />
          </div>
        )}
        <input
          className="pp-zoom"
          type="range"
          min={1}
          max={5}
          step={0.01}
          value={zoom}
          onChange={(e) => changerZoom(Number(e.target.value))}
          aria-label={t("crop_hint")}
          disabled={!image}
        />
        <div className="pp-recadreur-aide">{t("crop_hint")}</div>
        <div className="pp-recadreur-boutons">
          <button type="button" onClick={onAnnuler}>
            {t("cancel")}
          </button>
          <button type="button" className="principal" onClick={valider} disabled={!image}>
            {t("crop_validate")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
