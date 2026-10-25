import { useEffect, useRef, useState } from "react"

import { useTranslation } from "../../i18n"
import { creerSticker, type Sticker } from "../../services/stickers-service"
import { FenetreSticker } from "./fenetre-sticker"

/**
 * CRÉER UN STICKER (25/10/2026, « comme WhatsApp ») — jumeau de
 * `creer_sticker_screen.dart` : une photo, cadrée dans un carré (glisser pour
 * déplacer, molette ou curseur pour zoomer), un texte facultatif, une forme.
 * « Envoyer » la range en tête de « Mes créations » et l'envoie aussitôt.
 *
 * Le rendu se fait sur un `<canvas>` de 512 px : ce que le serveur attend
 * (`POST /api/stickers/assets`, PNG). Les coins hors de la forme restent
 * TRANSPARENTS.
 */
type Forme = "arrondi" | "rond" | "carre"
const COTE = 512
const APERCU = 280

export function CreateurSticker({ onFermer, onCree }: { onFermer: () => void; onCree: (s: Sticker) => void }) {
  const { t } = useTranslation()
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [decalage, setDecalage] = useState({ x: 0, y: 0 })
  const [texte, setTexte] = useState("")
  const [forme, setForme] = useState<Forme>("arrondi")
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState(false)
  const apercu = useRef<HTMLCanvasElement>(null)
  const glisse = useRef<{ x: number; y: number } | null>(null)

  function charger(fichier: File | undefined) {
    if (!fichier) return
    const url = URL.createObjectURL(fichier)
    const img = new Image()
    img.onload = () => {
      setImage(img)
      setZoom(1)
      setDecalage({ x: 0, y: 0 })
    }
    img.onerror = () => setErreur(true)
    img.src = url
  }

  /** Dessine le sticker sur `canvas`, à `cote` pixels : l'aperçu comme l'export. */
  function dessiner(canvas: HTMLCanvasElement, cote: number) {
    const ctx = canvas.getContext("2d")
    if (!ctx || !image) return
    canvas.width = cote
    canvas.height = cote
    ctx.clearRect(0, 0, cote, cote)
    ctx.save()
    const rayon = forme === "rond" ? cote / 2 : forme === "arrondi" ? cote * 0.094 : 0
    ctx.beginPath()
    ctx.roundRect(0, 0, cote, cote, rayon)
    ctx.clip()
    // « cover » : le petit côté de la photo remplit le carré, puis zoom et décalage.
    const base = Math.max(cote / image.width, cote / image.height) * zoom
    const l = image.width * base
    const h = image.height * base
    const echelle = cote / APERCU
    ctx.drawImage(image, (cote - l) / 2 + decalage.x * echelle, (cote - h) / 2 + decalage.y * echelle, l, h)
    ctx.restore()
    const mots = texte.trim()
    if (mots) {
      const taille = cote * 0.1
      ctx.font = `900 ${taille}px "DM Sans", sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "bottom"
      ctx.lineJoin = "round"
      ctx.lineWidth = taille * 0.18
      ctx.strokeStyle = "#000"
      ctx.fillStyle = "#fff"
      const y = cote - cote * 0.05
      ctx.strokeText(mots, cote / 2, y, cote * 0.92)
      ctx.fillText(mots, cote / 2, y, cote * 0.92)
    }
  }

  useEffect(() => {
    if (apercu.current) dessiner(apercu.current, APERCU * (window.devicePixelRatio || 1))
  })

  async function envoyer() {
    setEnvoi(true)
    setErreur(false)
    try {
      const canvas = document.createElement("canvas")
      dessiner(canvas, COTE)
      const png = await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("PNG"))), "image/png"))
      onCree(await creerSticker(png))
    } catch {
      setErreur(true)
      setEnvoi(false)
    }
  }

  return (
    <FenetreSticker titre={t("stickers_creer_titre")} onFermer={onFermer} libelleFermer={t("close")}>
      <div className="stk-createur">
        {!image ? (
          <label className="stk-choisir">
            <input type="file" accept="image/*" onChange={(e) => charger(e.target.files?.[0])} data-champ="photo" />
            <span>{t("stickers_creer_aide")}</span>
            <strong className="stk-action plein">{t("stickers_galerie")}</strong>
          </label>
        ) : (
          <>
            <canvas
              ref={apercu}
              className="stk-cadre"
              style={{ width: APERCU, height: APERCU }}
              onPointerDown={(e) => {
                glisse.current = { x: e.clientX - decalage.x, y: e.clientY - decalage.y }
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (glisse.current) setDecalage({ x: e.clientX - glisse.current.x, y: e.clientY - glisse.current.y })
              }}
              onPointerUp={() => (glisse.current = null)}
              onWheel={(e) => setZoom((z) => Math.min(5, Math.max(1, z - e.deltaY / 500)))}
            />
            <p className="stk-description">{t("stickers_cadre_aide")}</p>
            <input
              type="range"
              min={1}
              max={5}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="zoom"
              className="stk-zoom"
            />
            <div className="stk-recherche" style={{ width: "100%" }}>
              <input
                type="text"
                maxLength={40}
                value={texte}
                onChange={(e) => setTexte(e.target.value)}
                placeholder={t("stickers_texte")}
                aria-label={t("stickers_texte")}
                data-champ="texte"
              />
            </div>
            <div className="stk-recu-actions">
              {(["arrondi", "rond", "carre"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`stk-action${forme === f ? " plein" : ""}`}
                  onClick={() => setForme(f)}
                >
                  {t(`stickers_forme_${f}`)}
                </button>
              ))}
            </div>
            {erreur && <p className="stk-description">{t("stickers_erreur")}</p>}
            <div className="stk-createur-pied">
              <button type="button" className="stk-action" disabled={envoi} onClick={() => setImage(null)}>
                {t("stickers_autre_photo")}
              </button>
              <button type="button" className="stk-action plein" disabled={envoi} onClick={() => void envoyer()} data-action="envoyer">
                {t("stickers_envoyer")}
              </button>
            </div>
          </>
        )}
      </div>
    </FenetreSticker>
  )
}
