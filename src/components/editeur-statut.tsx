import { useEffect, useRef, useState } from "react"
import { useTranslation } from "../i18n"
import "./editeur-statut.css"

/**
 * ÉCRIRE ET DESSINER SUR UNE PHOTO AVANT DE LA PUBLIER.
 *
 * ⚠️ IMAGES SEULEMENT, et ce n'est pas un oubli. Incruster du texte dans une
 * VIDÉO demande de la ré-encoder, et un navigateur ne sait pas le faire sans
 * `ffmpeg.wasm` — vingt-cinq mégaoctets à télécharger avant le premier envoi,
 * et sept à quinze minutes pour une minute de vidéo. Une vidéo passe donc
 * directement, sans éditeur : mieux vaut une fonction absente qu'une fonction
 * qui gèle l'onglet.
 *
 * ⚠️ TOUTES LES POSITIONS SONT RELATIVES (0 à 1), jamais en pixels.
 *
 * L'aperçu s'affiche à la taille de l'écran — 380 px de large sur un téléphone,
 * 900 sur un bureau — alors que l'export se fait à la taille RÉELLE de la photo,
 * souvent 4000 px. Des positions en pixels placeraient le texte au quart de sa
 * place à l'écran, et le trait d'un dessin serait un cheveu. Le rapport entre
 * les deux n'est connu qu'à l'export : tout est donc stocké en fraction de la
 * largeur et de la hauteur, et multiplié au dernier moment.
 */

/** Un texte posé sur l'image. Position en fraction (0 à 1). */
interface TexteAppose {
  id: number
  contenu: string
  x: number
  y: number
  couleur: string
  /** Taille en fraction de la HAUTEUR : elle suit l'image, pas l'écran. */
  taille: number
}

/** Un trait, suite de points en fraction. */
interface Trace {
  couleur: string
  epaisseur: number
  points: Array<{ x: number; y: number }>
}

const COULEURS = ["#ffffff", "#000000", "#e53935", "#fdd835", "#43a047", "#1e88e5", "#8e24aa"]
const TAILLE_TEXTE = 0.06
const EPAISSEUR_TRAIT = 0.006

export function EditeurStatut({
  fichier,
  onAnnuler,
  onValider,
}: {
  fichier: File
  onAnnuler: () => void
  onValider: (fichier: File) => void
}) {
  const { t } = useTranslation()
  const [urlApercu, setUrlApercu] = useState<string | null>(null)
  const [outil, setOutil] = useState<"aucun" | "dessin">("aucun")
  const [couleur, setCouleur] = useState(COULEURS[0])
  const [textes, setTextes] = useState<TexteAppose[]>([])
  const [traces, setTraces] = useState<Trace[]>([])
  const [saisieOuverte, setSaisieOuverte] = useState(false)
  const [saisie, setSaisie] = useState("")
  const [enCours, setEnCours] = useState(false)

  const cadre = useRef<HTMLDivElement>(null)
  const traceEnCours = useRef<Trace | null>(null)
  const deplace = useRef<number | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(fichier)
    setUrlApercu(url)
    return () => URL.revokeObjectURL(url)
  }, [fichier])

  /** Convertit un point de l'écran en fraction du cadre. */
  const enFraction = (e: { clientX: number; clientY: number }) => {
    const boite = cadre.current?.getBoundingClientRect()
    if (!boite || boite.width === 0 || boite.height === 0) return null
    return {
      x: Math.min(1, Math.max(0, (e.clientX - boite.left) / boite.width)),
      y: Math.min(1, Math.max(0, (e.clientY - boite.top) / boite.height)),
    }
  }

  const surPointerDown = (e: React.PointerEvent) => {
    if (outil !== "dessin") return
    const p = enFraction(e)
    if (!p) return
    // La capture suit le doigt HORS du cadre : sans elle, un trait qui déborde
    // s'interrompt net au bord et reprend ailleurs au retour.
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    traceEnCours.current = { couleur, epaisseur: EPAISSEUR_TRAIT, points: [p] }
    setTraces((prev) => [...prev, traceEnCours.current!])
  }

  const surPointerMove = (e: React.PointerEvent) => {
    if (deplace.current !== null) {
      const p = enFraction(e)
      if (!p) return
      setTextes((prev) =>
        prev.map((tx) => (tx.id === deplace.current ? { ...tx, x: p.x, y: p.y } : tx))
      )
      return
    }
    if (outil !== "dessin" || !traceEnCours.current) return
    const p = enFraction(e)
    if (!p) return
    traceEnCours.current.points.push(p)
    // Recopie du tableau pour que React repeigne : le tracé courant est muté en
    // place, ce qui évite de recréer tous les points à chaque mouvement.
    setTraces((prev) => [...prev.slice(0, -1), { ...traceEnCours.current! }])
  }

  const surPointerUp = () => {
    traceEnCours.current = null
    deplace.current = null
  }

  const ajouterTexte = () => {
    const contenu = saisie.trim()
    if (!contenu) {
      setSaisieOuverte(false)
      return
    }
    setTextes((prev) => [
      ...prev,
      { id: Date.now(), contenu, x: 0.5, y: 0.5, couleur, taille: TAILLE_TEXTE },
    ])
    setSaisie("")
    setSaisieOuverte(false)
  }

  /** Retire le dernier geste — trait ou texte, le plus récent des deux. */
  const annulerDernier = () => {
    const dernierTexte = textes[textes.length - 1]
    const dernierTrace = traces[traces.length - 1]
    if (!dernierTexte && !dernierTrace) return
    // Les textes portent une date en identifiant ; les tracés n'en ont pas. On
    // retire donc le texte s'il en existe un, sinon le tracé — assez juste pour
    // un geste d'annulation, qui vise presque toujours ce qu'on vient de faire.
    if (dernierTexte) setTextes((prev) => prev.slice(0, -1))
    else setTraces((prev) => prev.slice(0, -1))
  }

  /**
   * APLATIT tout dans une seule image.
   *
   * Le texte et les traits sont des éléments HTML à l'écran ; le serveur ne
   * reçoit qu'un fichier. On redessine donc l'image à sa taille RÉELLE, puis
   * les traits, puis les textes, en multipliant chaque fraction par les
   * dimensions réelles.
   */
  const publier = async () => {
    if (enCours) return
    setEnCours(true)
    try {
      // Rien n'a été ajouté : on renvoie le fichier d'origine, sans le
      // ré-encoder. Un aller-retour par le canvas coûterait de la qualité pour
      // ne rien changer.
      if (textes.length === 0 && traces.length === 0) {
        onValider(fichier)
        return
      }

      const bitmap = await createImageBitmap(fichier)
      const canvas = document.createElement("canvas")
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        onValider(fichier)
        return
      }
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()

      const L = canvas.width
      const H = canvas.height

      for (const trace of traces) {
        if (trace.points.length === 0) continue
        ctx.strokeStyle = trace.couleur
        ctx.lineWidth = Math.max(2, trace.epaisseur * H)
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.beginPath()
        ctx.moveTo(trace.points[0].x * L, trace.points[0].y * H)
        for (const p of trace.points.slice(1)) ctx.lineTo(p.x * L, p.y * H)
        ctx.stroke()
      }

      for (const tx of textes) {
        const taille = tx.taille * H
        ctx.font = `700 ${taille}px "DM Sans", sans-serif`
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        // Un liseré sombre sous le texte : un texte blanc sur ciel blanc, ou
        // noir sur ombre, serait illisible. Il vaut mieux qu'un fond opaque,
        // qui masquerait la photo.
        ctx.lineWidth = Math.max(2, taille * 0.12)
        ctx.strokeStyle = "rgba(0,0,0,0.55)"
        ctx.strokeText(tx.contenu, tx.x * L, tx.y * H)
        ctx.fillStyle = tx.couleur
        ctx.fillText(tx.contenu, tx.x * L, tx.y * H)
      }

      const blob = await new Promise<Blob | null>((r) =>
        canvas.toBlob(r, "image/jpeg", 0.9)
      )
      if (!blob) {
        onValider(fichier)
        return
      }
      const nom = fichier.name.replace(/\.[^.]+$/, "") + ".jpg"
      onValider(new File([blob], nom, { type: "image/jpeg" }))
    } catch {
      // L'édition a échoué : on publie l'original plutôt que de perdre la photo.
      onValider(fichier)
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="es-plein">
      <div className="es-barre">
        <button type="button" onClick={onAnnuler} aria-label={t("cancel")}>
          ×
        </button>
        <div className="es-outils">
          <button
            type="button"
            className={outil === "dessin" ? "on" : ""}
            onClick={() => setOutil((o) => (o === "dessin" ? "aucun" : "dessin"))}
            title={t("statut_dessiner")}
            aria-pressed={outil === "dessin"}
          >
            ✏️
          </button>
          <button
            type="button"
            onClick={() => setSaisieOuverte(true)}
            title={t("statut_ajouter_texte")}
          >
            T
          </button>
          <button
            type="button"
            onClick={annulerDernier}
            disabled={textes.length === 0 && traces.length === 0}
            title={t("statut_annuler_geste")}
          >
            ↶
          </button>
        </div>
      </div>

      <div
        ref={cadre}
        className={`es-cadre${outil === "dessin" ? " dessin" : ""}`}
        onPointerDown={surPointerDown}
        onPointerMove={surPointerMove}
        onPointerUp={surPointerUp}
        onPointerCancel={surPointerUp}
      >
        {urlApercu && <img src={urlApercu} alt="" draggable={false} />}

        {/* Les tracés, en SVG plutôt qu'en canvas : le repère est le même que
            celui des textes — des fractions — et un SVG se redimensionne avec
            le cadre sans se repeindre. */}
        <svg className="es-traces" viewBox="0 0 1 1" preserveAspectRatio="none">
          {traces.map((trace, i) => (
            <polyline
              key={i}
              points={trace.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={trace.couleur}
              strokeWidth={trace.epaisseur}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: `${trace.epaisseur * 100}%` }}
            />
          ))}
        </svg>

        {textes.map((tx) => (
          <span
            key={tx.id}
            className="es-texte"
            style={{
              left: `${tx.x * 100}%`,
              top: `${tx.y * 100}%`,
              color: tx.couleur,
              fontSize: `${tx.taille * 100}cqh`,
            }}
            onPointerDown={(e) => {
              // Déplacer un texte ne doit pas tracer un trait par-dessus.
              e.stopPropagation()
              deplace.current = tx.id
              ;(e.target as Element).setPointerCapture?.(e.pointerId)
            }}
          >
            {tx.contenu}
          </span>
        ))}
      </div>

      <div className="es-couleurs">
        {COULEURS.map((c) => (
          <button
            key={c}
            type="button"
            className={c === couleur ? "on" : ""}
            style={{ background: c }}
            onClick={() => setCouleur(c)}
            aria-label={c}
          />
        ))}
        <button type="button" className="es-publier" onClick={publier} disabled={enCours}>
          {t("l2_publish")}
        </button>
      </div>

      {saisieOuverte && (
        <div className="es-saisie">
          <input
            autoFocus
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") ajouterTexte()
              if (e.key === "Escape") setSaisieOuverte(false)
            }}
            placeholder={t("statut_ajouter_texte")}
            aria-label={t("statut_ajouter_texte")}
          />
          <button type="button" onClick={ajouterTexte}>
            {t("statut_poser")}
          </button>
        </div>
      )}
    </div>
  )
}
