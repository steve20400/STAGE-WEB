import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useParams } from "react-router-dom"

import { useAuth } from "../../../../src/components/auth-provider"
import { useToast } from "../../../../src/components/toast"
import { useTranslation } from "../../../../src/i18n"
import { formatAlanyaNumber } from "../../../../src/lib/alanya-number"
import type { DescripteurMedia } from "../../../../src/services/e2ee-media"
import { ensurePdfWorker } from "../../../../src/services/pdf-worker"
import { appareilNavigateur, dateLisible } from "../../../../src/services/signature-document"
import {
  copieSignee,
  noterConsultation,
  telechargerFichier,
} from "../../../../src/services/sortie-document-sensible"
import "./visionneuse-sensible.css"

/**
 * LA VISIONNEUSE D'UN DOCUMENT SENSIBLE DANS LE NAVIGATEUR (22/10/2026).
 *
 * Jusqu'au 22/10, le web renvoyait vers l'application mobile. Le user a levé
 * l'interdiction de télécharger et de partager : le navigateur ouvre donc le
 * document, comme le mobile —
 *   - la signature « Consulté par Alanya … · Chrome · Windows · date » court
 *     aux QUATRE BORDS ;
 *   - la consultation est notée au serveur ;
 *   - Télécharger et Partager donnent une copie SIGNÉE (bords, métadonnées,
 *     code de trace noté au serveur), jamais le fichier d'origine.
 *
 * Le PDF est dessiné par PDF.js, pas par le lecteur du navigateur : celui-ci a
 * son propre bouton « Télécharger », qui donnerait l'original non signé.
 *
 * ⚠️ Un navigateur ne sait pas interdire la capture d'écran : la signature aux
 * bords est la réponse — la capture porte le nom de qui l'a faite.
 */
export function VisionneuseSensible({
  d,
  clair,
  isMe,
  onFermer,
}: {
  d: DescripteurMedia
  /** Le fichier déchiffré. */
  clair: Blob
  /** Le document vient de moi : mon Alanya ID est aussi celui de l'expéditeur. */
  isMe: boolean
  onFermer: () => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { info, error } = useToast()
  const convId = useParams().chatId
  const alanyaId = user?.phone ?? ""
  const expediteurId = isMe ? alanyaId : undefined
  const onInfo = (texte: string) => info(t("sens_titre"), texte)
  const onErreur = (texte: string) => error(t("sens_titre"), texte)
  const [url] = useState(() => URL.createObjectURL(clair))
  const [occupe, setOccupe] = useState(false)
  /** Copie prête, quand le navigateur a refusé un partage trop tardif. */
  const [enAttente, setEnAttente] = useState<File | null>(null)
  const [quand] = useState(() => new Date())

  const genre =
    d.mime === "application/pdf" || (d.nom ?? "").toLowerCase().endsWith(".pdf")
      ? "pdf"
      : d.mime.startsWith("image/")
        ? "image"
        : d.mime.startsWith("video/")
          ? "video"
          : "autre"

  const signature = t("sens_filigrane", {
    num: formatAlanyaNumber(alanyaId),
    appareil: appareilNavigateur(),
    date: dateLisible(quand),
  })

  useEffect(() => {
    noterConsultation(d, convId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id])

  useEffect(() => () => URL.revokeObjectURL(url), [url])

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer()
    }
    document.addEventListener("keydown", surTouche)
    return () => document.removeEventListener("keydown", surTouche)
  }, [onFermer])

  const preparer = (geste: "TELECHARGEMENT" | "PARTAGE") =>
    copieSignee({ clair, d, geste, alanyaId, convId, expediteurId })

  const telecharger = async () => {
    setOccupe(true)
    try {
      const c = await preparer("TELECHARGEMENT")
      telechargerFichier(c.fichier)
      if (!c.signee) onInfo(t("sens_copie_non_signee"))
    } catch {
      onErreur(t("partage_echec"))
    } finally {
      setOccupe(false)
    }
  }

  const envoyerAuSysteme = async (fichier: File) => {
    try {
      await navigator.share({ files: [fichier] })
      setEnAttente(null)
    } catch (e) {
      const nom = e instanceof DOMException ? e.name : ""
      if (nom === "AbortError") {
        setEnAttente(null)
        return
      }
      // La signature a pris trop de temps : le navigateur veut un clic récent.
      if (nom === "NotAllowedError") {
        setEnAttente(fichier)
        return
      }
      setEnAttente(null)
      onErreur(t("partage_echec"))
    }
  }

  const partager = async () => {
    setOccupe(true)
    try {
      const c = await preparer("PARTAGE")
      if (!c.signee) onInfo(t("sens_copie_non_signee"))
      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [c.fichier] })) {
        await envoyerAuSysteme(c.fichier)
      } else {
        // Sans partage de fichiers (Firefox, Chrome sous Linux) : on télécharge.
        telechargerFichier(c.fichier)
        onInfo(t("partage_indisponible"))
      }
    } catch {
      onErreur(t("partage_echec"))
    } finally {
      setOccupe(false)
    }
  }

  const bloquer = (e: React.SyntheticEvent) => e.preventDefault()

  return createPortal(
    <div className="vs-fond" role="dialog" aria-modal="true" aria-label={d.nom ?? t("sens_titre")}>
      <header className="vs-barre">
        <span className="vs-titre">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <span>{d.nom ?? t("sens_titre")}</span>
        </span>
        {enAttente ? (
          <button type="button" className="vs-bouton accent" onClick={() => void envoyerAuSysteme(enAttente)}>
            {t("partage_pret")}
          </button>
        ) : (
          <>
            <button type="button" className="vs-bouton" onClick={() => void telecharger()} disabled={occupe}>
              {t("download")}
            </button>
            <button type="button" className="vs-bouton" onClick={() => void partager()} disabled={occupe}>
              {t("msg_partager")}
            </button>
          </>
        )}
        <button type="button" className="vs-fermer" onClick={onFermer} aria-label={t("close")}>
          ×
        </button>
      </header>

      <div className="vs-scene" onContextMenu={bloquer}>
        <div className="vs-contenu">
          {genre === "pdf" && <PagesPdf clair={clair} />}
          {genre === "image" && <img src={url} alt="" draggable={false} className="vs-image" />}
          {genre === "video" && (
            <video
              src={url}
              controls
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              className="vs-video"
            />
          )}
          {genre === "autre" && <p className="vs-message">{t("sens_format")}</p>}
        </div>
        {/* La signature court aux quatre bords, sans capter les clics. */}
        <span className="vs-bord haut" aria-hidden="true">{signature}</span>
        <span className="vs-bord bas" aria-hidden="true">{signature}</span>
        <span className="vs-bord gauche" aria-hidden="true">{signature}</span>
        <span className="vs-bord droite" aria-hidden="true">{signature}</span>
      </div>
    </div>,
    document.body,
  )
}

/** Toutes les pages, dessinées par PDF.js à la largeur de la fenêtre. */
function PagesPdf({ clair }: { clair: Blob }) {
  const { t } = useTranslation()
  const hote = useRef<HTMLDivElement>(null)
  const [etat, setEtat] = useState<"chargement" | "pret" | "echec">("chargement")

  useEffect(() => {
    let annule = false
    let tache: { destroy?: () => unknown; promise: Promise<unknown> } | undefined
    const dessiner = async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
        await ensurePdfWorker(pdfjs)
        const t2 = pdfjs.getDocument({ data: new Uint8Array(await clair.arrayBuffer()) })
        tache = t2
        const pdf = await t2.promise
        const conteneur = hote.current
        if (!conteneur || annule) return
        conteneur.replaceChildren()
        const largeur = Math.min(conteneur.clientWidth || 800, 900)
        const densite = Math.min(window.devicePixelRatio || 1, 2)
        for (let n = 1; n <= pdf.numPages && !annule; n++) {
          const page = await pdf.getPage(n)
          const naturel = page.getViewport({ scale: 1 })
          const vue = page.getViewport({ scale: (largeur / naturel.width) * densite })
          const toile = document.createElement("canvas")
          toile.width = Math.round(vue.width)
          toile.height = Math.round(vue.height)
          toile.style.width = `${Math.round(vue.width / densite)}px`
          toile.className = "vs-page"
          const ctx = toile.getContext("2d")
          if (!ctx) continue
          ctx.fillStyle = "#ffffff"
          ctx.fillRect(0, 0, toile.width, toile.height)
          await page.render({ canvasContext: ctx, viewport: vue }).promise
          conteneur.appendChild(toile)
          if (n === 1) setEtat("pret")
        }
        if (!annule) setEtat("pret")
      } catch {
        if (!annule) setEtat("echec")
      }
    }
    void dessiner()
    return () => {
      annule = true
      void tache?.destroy?.()
    }
  }, [clair])

  return (
    <>
      {etat === "chargement" && <p className="vs-message">{t("loading_pdf")}</p>}
      {etat === "echec" && <p className="vs-message">{t("sens_format")}</p>}
      <div ref={hote} className="vs-pages" />
    </>
  )
}
