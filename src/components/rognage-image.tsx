import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Icone } from "./icone"
import { useTranslation } from "../i18n"
import "./rognage-image.css"

/**
 * ROGNER ET FAIRE PIVOTER UNE PHOTO DE STATUT (14/11/2026, demande du user :
 * « comme sur WhatsApp ») — jumeau de `rognage_image_screen.dart` sur le mobile.
 *
 * Le cadre se décrit en FRACTIONS de l'image pivotée (0 → 1), comme les
 * annotations de l'éditeur : il ne dépend ni de la taille de l'écran ni de
 * celle de la photo. L'export redessine l'original, pivoté puis rogné, à sa
 * taille réelle (bornée à [BORD_MAX]), en JPEG comme l'éditeur.
 */

const BORD_MAX = 2560
/** Le plus petit côté permis, en fraction : en dessous, les poignées se chevauchent. */
const MINIMUM = 0.08

type Prise = "deplacer" | "hg" | "hd" | "bg" | "bd" | null
interface Cadre {
  l: number
  t: number
  r: number
  b: number
}
const ENTIER: Cadre = { l: 0, t: 0, r: 1, b: 1 }

export function RognageImage({
  fichier,
  onAnnuler,
  onValider,
}: {
  fichier: File
  onAnnuler: () => void
  onValider: (fichier: File) => void
}) {
  const { t } = useTranslation()
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [echec, setEchec] = useState(false)
  const [calcul, setCalcul] = useState(false)
  /** Quarts de tour dans le sens des aiguilles d'une montre (0 → 3). */
  const [quarts, setQuarts] = useState(0)
  const [cadre, setCadre] = useState<Cadre>(ENTIER)
  /** `null` = libre, sinon largeur / hauteur en pixels. */
  const [format, setFormat] = useState<number | null>(null)
  const [scene, setScene] = useState({ l: 0, h: 0 })

  const zone = useRef<HTMLDivElement>(null)
  const apercu = useRef<HTMLCanvasElement>(null)
  const prise = useRef<{ type: Prise; x: number; y: number; depart: Cadre }>({
    type: null,
    x: 0,
    y: 0,
    depart: ENTIER,
  })

  useEffect(() => {
    let annule = false
    let bmp: ImageBitmap | null = null
    createImageBitmap(fichier)
      .then((b) => {
        bmp = b
        if (annule) b.close()
        else setImage(b)
      })
      .catch(() => {
        if (!annule) setEchec(true)
      })
    return () => {
      annule = true
      bmp?.close()
    }
  }, [fichier])

  // La taille de la zone, suivie : la fenêtre peut changer de taille.
  useLayoutEffect(() => {
    const el = zone.current
    if (!el) return
    const mesurer = () => setScene({ l: el.clientWidth, h: el.clientHeight })
    mesurer()
    const ro = new ResizeObserver(mesurer)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const taillePivotee = image
    ? quarts % 2 === 1
      ? { l: image.height, h: image.width }
      : { l: image.width, h: image.height }
    : { l: 1, h: 1 }

  // L'image pivotée, contenue dans la zone avec une marge pour les poignées.
  const marge = 20
  const f = Math.min(
    Math.max(1, scene.l - 2 * marge) / taillePivotee.l,
    Math.max(1, scene.h - 2 * marge) / taillePivotee.h
  )
  const affichage = {
    l: taillePivotee.l * f,
    h: taillePivotee.h * f,
    x: (scene.l - taillePivotee.l * f) / 2,
    y: (scene.h - taillePivotee.h * f) / 2,
  }

  /** Dessine `image` pivotée de `q` quarts dans un contexte, à l'échelle `s`. */
  const dessiner = (ctx: CanvasRenderingContext2D, img: ImageBitmap, q: number) => {
    const w = img.width
    const h = img.height
    if (q === 1) {
      ctx.translate(h, 0)
      ctx.rotate(Math.PI / 2)
    } else if (q === 2) {
      ctx.translate(w, h)
      ctx.rotate(Math.PI)
    } else if (q === 3) {
      ctx.translate(0, w)
      ctx.rotate((3 * Math.PI) / 2)
    }
    ctx.drawImage(img, 0, 0)
  }

  // L'aperçu, redessiné quand l'image, le pivot ou la taille changent.
  useEffect(() => {
    const c = apercu.current
    if (!c || !image || affichage.l < 1) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(affichage.l * dpr)
    c.height = Math.round(affichage.h * dpr)
    const ctx = c.getContext("2d")
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(c.width / taillePivotee.l, c.height / taillePivotee.h)
    dessiner(ctx, image, quarts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, quarts, affichage.l, affichage.h])

  const cadreAuFormat = (fmt: number, tp = taillePivotee): Cadre => {
    let l = tp.l
    let h = tp.l / fmt
    if (h > tp.h) {
      h = tp.h
      l = h * fmt
    }
    const fl = l / tp.l
    const fh = h / tp.h
    return { l: (1 - fl) / 2, t: (1 - fh) / 2, r: (1 + fl) / 2, b: (1 + fh) / 2 }
  }

  /** Un quart de tour vers la GAUCHE, comme WhatsApp. Le cadre repart de l'image entière. */
  const pivoter = () => {
    const q = (quarts + 3) % 4
    setQuarts(q)
    if (image && format !== null) {
      const tp = q % 2 === 1 ? { l: image.height, h: image.width } : { l: image.width, h: image.height }
      setCadre(cadreAuFormat(format, tp))
    } else setCadre(ENTIER)
  }

  const choisirFormat = (fmt: number | null) => {
    setFormat(fmt)
    setCadre(fmt === null ? ENTIER : cadreAuFormat(fmt))
  }

  const reinitialiser = () => {
    setQuarts(0)
    setFormat(null)
    setCadre(ENTIER)
  }

  // ── Gestes ───────────────────────────────────────────────────────────────

  const debut = (e: React.PointerEvent, type: Prise) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    prise.current = { type, x: e.clientX, y: e.clientY, depart: cadre }
  }

  const suite = (e: React.PointerEvent) => {
    const p = prise.current
    if (!p.type || affichage.l < 1) return
    const dx = (e.clientX - p.x) / affichage.l
    const dy = (e.clientY - p.y) / affichage.h
    const d = p.depart

    if (p.type === "deplacer") {
      const largeur = d.r - d.l
      const hauteur = d.b - d.t
      const l = Math.min(Math.max(0, d.l + dx), 1 - largeur)
      const tp = Math.min(Math.max(0, d.t + dy), 1 - hauteur)
      setCadre({ l, t: tp, r: l + largeur, b: tp + hauteur })
      return
    }

    let { l, t: haut, r, b } = d
    if (p.type === "hg" || p.type === "bg") l += dx
    if (p.type === "hd" || p.type === "bd") r += dx
    if (p.type === "hg" || p.type === "hd") haut += dy
    if (p.type === "bg" || p.type === "bd") b += dy
    l = Math.min(Math.max(0, l), r - MINIMUM)
    r = Math.max(Math.min(1, r), l + MINIMUM)
    haut = Math.min(Math.max(0, haut), b - MINIMUM)
    b = Math.max(Math.min(1, b), haut + MINIMUM)

    // Format imposé : la hauteur suit la largeur, du côté du coin saisi.
    if (format !== null) {
      const hauteur = ((r - l) * taillePivotee.l) / format / taillePivotee.h
      if (p.type === "hg" || p.type === "hd") haut = b - hauteur
      else b = haut + hauteur
      if (haut < 0 || b > 1 || b - haut < MINIMUM) return
    }
    setCadre({ l, t: haut, r, b })
  }

  const fin = () => {
    prise.current.type = null
  }

  // ── Export ───────────────────────────────────────────────────────────────

  const valider = async () => {
    if (!image || calcul) return
    setCalcul(true)
    try {
      const tp = taillePivotee
      const x = cadre.l * tp.l
      const y = cadre.t * tp.h
      const largeur = (cadre.r - cadre.l) * tp.l
      const hauteur = (cadre.b - cadre.t) * tp.h
      const cote = Math.max(largeur, hauteur)
      const echelle = cote > BORD_MAX ? BORD_MAX / cote : 1
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(largeur * echelle))
      canvas.height = Math.max(1, Math.round(hauteur * echelle))
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("canvas")
      ctx.imageSmoothingQuality = "high"
      ctx.scale(echelle, echelle)
      ctx.translate(-x, -y)
      dessiner(ctx, image, quarts)
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92))
      if (!blob) throw new Error("blob")
      const nom = fichier.name.replace(/\.[^.]+$/, "") + ".jpg"
      onValider(new File([blob], nom, { type: "image/jpeg" }))
    } catch {
      setCalcul(false)
    }
  }

  const ecran = {
    left: affichage.x + cadre.l * affichage.l,
    top: affichage.y + cadre.t * affichage.h,
    width: (cadre.r - cadre.l) * affichage.l,
    height: (cadre.b - cadre.t) * affichage.h,
  }

  return (
    <div className="ri-plein" role="dialog" aria-modal="true" aria-label={t("rogner_titre")}>
      <div className="ri-barre">
        <button type="button" onClick={onAnnuler} aria-label={t("cancel")} title={t("cancel")}>
          ×
        </button>
        <span className="ri-titre">{t("rogner_titre")}</span>
        <button type="button" className="ri-texte" onClick={reinitialiser}>
          {t("rogner_reinitialiser")}
        </button>
      </div>

      <div ref={zone} className="ri-zone" onPointerMove={suite} onPointerUp={fin} onPointerCancel={fin}>
        {echec && <p className="ri-message">{t("rogner_illisible")}</p>}
        {!echec && !image && <p className="ri-message">…</p>}
        {image && (
          <>
            <canvas
              ref={apercu}
              className="ri-apercu"
              style={{ left: affichage.x, top: affichage.y, width: affichage.l, height: affichage.h }}
            />
            <div
              className="ri-cadre"
              style={ecran}
              onPointerDown={(e) => debut(e, "deplacer")}
            >
              <span className="ri-tiers ri-v1" />
              <span className="ri-tiers ri-v2" />
              <span className="ri-tiers ri-h1" />
              <span className="ri-tiers ri-h2" />
              {(["hg", "hd", "bg", "bd"] as const).map((coin) => (
                <span
                  key={coin}
                  className={`ri-poignee ri-${coin}`}
                  onPointerDown={(e) => debut(e, coin)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="ri-bas">
        <button type="button" onClick={pivoter} disabled={!image} title={t("rogner_pivoter")}>
          <Icone nom="pivoter" taille={18} />
          <span>{t("rogner_pivoter")}</span>
        </button>
        <button
          type="button"
          className={format === null ? "on" : ""}
          onClick={() => choisirFormat(null)}
          disabled={!image}
        >
          <Icone nom="cadre-libre" taille={18} />
          <span>{t("rogner_libre")}</span>
        </button>
        <button
          type="button"
          className={format === 1 ? "on" : ""}
          onClick={() => choisirFormat(1)}
          disabled={!image}
        >
          <Icone nom="carre" taille={18} />
          <span>{t("rogner_carre")}</span>
        </button>
        <button
          type="button"
          className="ri-valider"
          onClick={() => void valider()}
          disabled={!image || calcul}
          aria-label={t("rogner_valider")}
          title={t("rogner_valider")}
        >
          <Icone nom="valider" taille={22} />
        </button>
      </div>
    </div>
  )
}
