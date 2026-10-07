import { useEffect, useState } from "react"

import { useTranslation } from "../../../../src/i18n"
import type { DescripteurMedia } from "../../../../src/services/e2ee-media"
import { FichierInvalide, urlApercu } from "../../../../src/services/e2ee-media"
import { ouvrirMediaChiffre } from "../../../../src/services/e2ee-media-ouverture"
import { formatBytes } from "../../../../src/services/messages-service"
import "./media-chiffre.css"

/**
 * UN MÉDIA CHIFFRÉ DANS UNE BULLE — cours, chapitre 23.
 *
 * 🔴 L'APERÇU S'AFFICHE TOUT DE SUITE, SANS RIEN TÉLÉCHARGER. Il est arrivé
 * dans l'enveloppe, avec la clé : photo floutée, première image de la vidéo,
 * première page du document. Les dimensions aussi — la bulle prend sa taille
 * d'emblée, et le fil ne saute pas quand l'image nette arrive.
 *
 * Puis, selon le genre :
 *   - photo : téléchargée et déchiffrée d'office, elle remplace l'aperçu ;
 *   - vidéo, vocal, document : sur demande — on ne fait pas télécharger
 *     cinquante mégaoctets à qui fait défiler un fil.
 *
 * ⚠️ UN FICHIER ALTÉRÉ LE DIT. Si l'empreinte ou le déchiffrement échoue, on
 * n'affiche ni image cassée ni rien de trompeur : un message dit que le
 * fichier reçu n'est pas celui qui a été envoyé.
 *
 * 🐛 UNE PHOTO OU UN DOCUMENT S'OUVRE DANS LE LECTEUR DE L'APPLICATION
 * (signalé par le user le 06/10/2026). La photo s'ouvrait dans un simple voile
 * noir, sans bouton pour la télécharger ni pour fermer ; le document, lui, se
 * téléchargeait d'office sans s'ouvrir. Ce composant ne dessine plus de
 * visionneuse : il rend le fichier déchiffré à la discussion, qui l'ouvre dans
 * la MÊME galerie que les albums et la MÊME visionneuse que les documents en
 * clair.
 */
export function MediaChiffre({
  d,
  isMe,
  typeFichier,
  onOuvrirImage,
  onOuvrirDocument,
}: {
  d: DescripteurMedia
  isMe: boolean
  /** Pastille du type de document (« PDF », « ZIP »…), la même qu'en clair. */
  typeFichier?: { color: string; label: string }
  /** Ouvre la photo déchiffrée (adresse `blob:`) dans la galerie. */
  onOuvrirImage: (url: string) => void
  /** Ouvre le document déchiffré (adresse `blob:`) dans la visionneuse. */
  onOuvrirDocument: (url: string) => void
}) {
  const { t } = useTranslation()
  const genre = d.mime.startsWith("image/")
    ? "image"
    : d.mime.startsWith("video/")
      ? "video"
      : d.mime.startsWith("audio/")
        ? "audio"
        : "document"

  const [url, setUrl] = useState<string | null>(null)
  const [etat, setEtat] = useState<"attente" | "chargement" | "pret" | "altere" | "echec">("attente")

  const lancer = () => {
    setEtat("chargement")
    ouvrirMediaChiffre(d)
      .then((blob) => {
        setUrl(URL.createObjectURL(blob))
        setEtat("pret")
      })
      .catch((e) => setEtat(e instanceof FichierInvalide ? "altere" : "echec"))
  }
  const charger = () => {
    if (etat === "chargement" || etat === "pret") return
    lancer()
  }

  // La photo se charge d'elle-même ; le reste attend un geste.
  useEffect(() => {
    if (genre === "image") charger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id])

  // Le blob vit le temps de la bulle.
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])

  const apercu = d.apercu ? urlApercu(d.apercu) : null
  const ratio = d.largeur && d.hauteur ? `${d.largeur} / ${d.hauteur}` : undefined

  if (etat === "altere" || etat === "echec") {
    return (
      <span className="mc-erreur" role="status">
        {t(etat === "altere" ? "e2ee_media_altere" : "e2ee_media_echec")}
        {etat === "echec" && (
          <button type="button" onClick={lancer} className="mc-reessayer">
            {t("retry")}
          </button>
        )}
      </span>
    )
  }

  if (genre === "image") {
    return (
      <button
        type="button"
        className="mc-visuel"
        style={{ aspectRatio: ratio }}
        onClick={() => url && onOuvrirImage(url)}
        aria-label={d.nom ?? t("photo")}
      >
        {apercu && <img src={apercu} alt="" className="mc-apercu flou" />}
        {url && <img src={url} alt="" className="mc-net" />}
        {etat === "chargement" && <span className="mc-sablier" aria-hidden="true" />}
      </button>
    )
  }

  if (genre === "video") {
    return url ? (
      <video className="mc-video" src={url} controls autoPlay style={{ aspectRatio: ratio }} />
    ) : (
      <button type="button" className="mc-visuel" style={{ aspectRatio: ratio }} onClick={charger}>
        {apercu && <img src={apercu} alt="" className="mc-apercu" />}
        <span className={`mc-lecture${etat === "chargement" ? " charge" : ""}`} aria-hidden="true" />
        {d.dureeMs ? <span className="mc-duree">{duree(d.dureeMs)}</span> : null}
      </button>
    )
  }

  if (genre === "audio") {
    return url ? (
      <audio className="mc-audio" src={url} controls autoPlay />
    ) : (
      <button type="button" className={`mc-vocal${isMe ? " moi" : ""}`} onClick={charger}>
        <span className={`mc-lecture petit${etat === "chargement" ? " charge" : ""}`} aria-hidden="true" />
        <span>{t("voice_message")}</span>
        {d.dureeMs ? <span className="mc-duree-texte">{duree(d.dureeMs)}</span> : null}
      </button>
    )
  }

  /*
   * DOCUMENT : LE MÊME CADRE QU'UN DOCUMENT EN CLAIR.
   *
   * 🐛 « TU AS RÉDUIT LE CADRE DES DOCUMENTS » (signalé par le user le
   * 07/10/2026). Dans un fil chiffré, un document n'était qu'une petite carte
   * — vignette de 44 px, la taille d'un message — quand le même PDF en clair
   * montre sa première page en grand. Les fils étant désormais chiffrés, tous
   * les documents avaient « rétréci ». La première page arrive dans
   * l'enveloppe : on l'affiche en grand, sans rien télécharger.
   *
   * 🐛 ET LA CARTE DÉBORDAIT DE MA BULLE sur téléphone : elle réclamait 280 px
   * quelle que soit la place. Elle demande sa largeur, mais `max-width: 100%`
   * la borne à la bulle — même règle que la photo.
   *
   * Un clic l'OUVRE dans la visionneuse, d'où on le télécharge.
   */
  const ouvrirDocument = () => {
    if (url) {
      onOuvrirDocument(url)
      return
    }
    if (etat === "chargement") return
    setEtat("chargement")
    ouvrirMediaChiffre(d)
      .then((blob) => {
        const u = URL.createObjectURL(blob)
        setUrl(u)
        setEtat("pret")
        onOuvrirDocument(u)
      })
      .catch((e) => setEtat(e instanceof FichierInvalide ? "altere" : "echec"))
  }
  const type = typeFichier ?? { color: "#6b7280", label: (d.nom?.split(".").pop() ?? "").slice(0, 4).toUpperCase() || "DOC" }
  return (
    <button
      type="button"
      className={`mc-document${isMe ? " moi" : ""}`}
      onClick={ouvrirDocument}
      aria-label={d.nom ?? t("file")}
    >
      {apercu && (
        <span className="mc-doc-page">
          <img src={apercu} alt="" />
        </span>
      )}
      <span className="mc-doc-ligne">
        <span
          className="mc-doc-type"
          style={{ color: type.color, background: `${type.color}1f` }}
          aria-hidden="true"
        >
          {type.label}
        </span>
        <span className="mc-doc-texte">
          <span className="mc-doc-nom">{d.nom ?? t("file")}</span>
          <span className="mc-doc-detail">
            {[formatBytes(d.taille), d.pages ? `${d.pages} p.` : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        {etat === "chargement" ? (
          <span className="mc-doc-attente" aria-label={t("loading")} />
        ) : (
          <svg className="mc-doc-ouvrir" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        )}
      </span>
    </button>
  )
}

/**
 * La bulle d'un média chiffré dont CET appareil n'a pas la clé — enveloppe
 * jamais reçue ici, ou illisible. Même règle que pour un texte : le dire.
 */
export function MediaChiffreIndisponible() {
  const { t } = useTranslation()
  return <span className="mc-erreur">{t("e2ee_media_indisponible")}</span>
}

function duree(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * UNE TUILE DE GRILLE pour un média chiffré — photos envoyées à la suite,
 * regroupées à l'affichage (décision du user, 03/10/2026 : un message par
 * photo, mais une grille à l'écran).
 *
 * Photo : déchiffrée et affichée nette ; vidéo : sa première image, venue de
 * l'enveloppe. En attendant, l'aperçu flouté.
 */
export function TuileChiffree({ d, taille }: { d: DescripteurMedia; taille: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const image = d.mime.startsWith("image/")
  useEffect(() => {
    if (!image) return
    let vivant = true
    let cree: string | null = null
    void ouvrirMediaChiffre(d)
      .then((blob) => {
        if (!vivant) return
        cree = URL.createObjectURL(blob)
        setUrl(cree)
      })
      .catch(() => undefined)
    return () => {
      vivant = false
      if (cree) URL.revokeObjectURL(cree)
    }
  }, [d, image])
  const apercu = d.apercu ? urlApercu(d.apercu) : null
  const style = { width: taille, height: taille, objectFit: "cover" as const, display: "block" }
  if (url) return <img src={url} alt="" style={style} />
  if (apercu) return <img src={apercu} alt="" style={{ ...style, filter: image ? "blur(6px)" : undefined }} />
  return <span style={{ ...style, background: "var(--bg-elevated)" }} />
}
