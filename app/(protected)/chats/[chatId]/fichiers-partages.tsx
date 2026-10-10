import { useEffect, useMemo, useState } from "react"

import { useTranslation } from "../../../../src/i18n"
import { useToast } from "../../../../src/components/toast"
import {
  chargerFichiersPartages,
  type FichierPartage,
  type GenreFichier,
} from "../../../../src/services/fichiers-partages"
import { urlApercu } from "../../../../src/services/e2ee-media"
import { ouvrirMediaChiffre } from "../../../../src/services/e2ee-media-ouverture"
import { resolveMediaUrl } from "../../../../src/services/media-service"
import { formatBytes } from "../../../../src/services/messages-service"
import { videoPosterUrl } from "../../../../src/services/media-thumbnail"
import { DocumentViewer } from "./chat"
import "./fichiers-partages.css"

type Filtre = "tous" | GenreFichier

const FILTRES: Array<{ cle: Filtre; libelle: string }> = [
  { cle: "tous", libelle: "cinfo_filtre_tous" },
  { cle: "image", libelle: "cinfo_filtre_images" },
  { cle: "video", libelle: "cinfo_filtre_videos" },
  { cle: "document", libelle: "cinfo_filtre_documents" },
  { cle: "autre", libelle: "cinfo_filtre_autres" },
]

/**
 * L'ONGLET « FICHIERS » DE LA PAGE INFOS — demande du user, 10/10/2026 : « on ne
 * voit pas les fichiers partagés […] on doit pouvoir les trier : image, vidéo,
 * document, autre ».
 *
 * Images et vidéos en grille de vignettes, documents et autres en liste. Un
 * clic ouvre le fichier dans LA visionneuse de l'application — la même que
 * dans la discussion, avec son bouton « Télécharger ». Un fichier chiffré est
 * déchiffré dans ce navigateur au moment de l'ouvrir.
 */
export function FichiersPartages({
  convId,
  nomDe,
  onCompte,
}: {
  convId: string
  /** Le nom à afficher pour un expéditeur (« Vous » pour soi). */
  nomDe: (expediteurId: string) => string
  onCompte?: (n: number) => void
}) {
  const { t, language } = useTranslation()
  const { error } = useToast()
  const [fichiers, setFichiers] = useState<FichierPartage[] | null>(null)
  const [echec, setEchec] = useState(false)
  const [filtre, setFiltre] = useState<Filtre>("tous")
  const [enCours, setEnCours] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState<{ url: string; nom: string; mime: string; local: boolean } | null>(null)

  useEffect(() => {
    let vivant = true
    setFichiers(null)
    setEchec(false)
    chargerFichiersPartages(convId)
      .then((liste) => {
        if (!vivant) return
        setFichiers(liste)
        onCompte?.(liste.length)
      })
      .catch(() => {
        if (vivant) setEchec(true)
      })
    return () => {
      vivant = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId])

  const comptes = useMemo(() => {
    const c: Record<Filtre, number> = { tous: 0, image: 0, video: 0, document: 0, autre: 0 }
    for (const f of fichiers ?? []) {
      c.tous++
      c[f.genre]++
    }
    return c
  }, [fichiers])

  const visibles = useMemo(
    () => (fichiers ?? []).filter((f) => filtre === "tous" || f.genre === filtre),
    [fichiers, filtre]
  )

  /** Le fichier en clair : déchiffré ici s'il est chiffré, sinon son adresse. */
  async function adresseDe(f: FichierPartage): Promise<{ url: string; local: boolean }> {
    if (f.descripteur) {
      const blob = await ouvrirMediaChiffre(f.descripteur)
      return { url: URL.createObjectURL(blob), local: true }
    }
    return { url: resolveMediaUrl(f.url ?? ""), local: false }
  }

  async function ouvrir(f: FichierPartage) {
    if (enCours) return
    setEnCours(f.cle)
    try {
      const { url, local } = await adresseDe(f)
      setOuvert({ url, nom: f.nom, mime: f.mime, local })
    } catch {
      error(t("e2ee_media_echec"))
    } finally {
      setEnCours(null)
    }
  }

  async function telecharger(f: FichierPartage) {
    try {
      const lien = document.createElement("a")
      if (f.descripteur) {
        const url = URL.createObjectURL(await ouvrirMediaChiffre(f.descripteur))
        lien.href = url
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else {
        lien.href = resolveMediaUrl(f.url ?? "", { download: true })
        lien.target = "_blank"
      }
      lien.download = f.nom
      lien.rel = "noreferrer"
      document.body.appendChild(lien)
      lien.click()
      lien.remove()
    } catch {
      error(t("e2ee_media_echec"))
    }
  }

  function fermer() {
    if (ouvert?.local) URL.revokeObjectURL(ouvert.url)
    setOuvert(null)
  }

  const date = (d: Date) =>
    d.toLocaleDateString(language, { day: "numeric", month: "short", year: "numeric" })

  if (echec) return <div className="fp-vide">{t("cinfo_fichiers_erreur")}</div>
  if (!fichiers) return <div className="fp-vide">{t("cinfo_fichiers_chargement")}</div>
  if (fichiers.length === 0) return <div className="fp-vide">{t("cinfo_no_shared_file")}</div>

  const enGrille = filtre === "image" || filtre === "video"

  return (
    <div className="fp">
      <div className="fp-filtres" role="tablist">
        {FILTRES.map((f) => (
          <button
            key={f.cle}
            type="button"
            role="tab"
            aria-selected={filtre === f.cle}
            className={`fp-filtre${filtre === f.cle ? " on" : ""}`}
            onClick={() => setFiltre(f.cle)}
          >
            {t(f.libelle as never)} <span className="fp-nb">{comptes[f.cle]}</span>
          </button>
        ))}
      </div>

      {visibles.length === 0 && <div className="fp-vide">{t("cinfo_aucun_dans_filtre")}</div>}

      {enGrille ? (
        <div className="fp-grille">
          {visibles.map((f) => (
            <button
              key={f.cle}
              type="button"
              className="fp-tuile"
              onClick={() => void ouvrir(f)}
              aria-label={f.nom}
              title={`${f.nom} · ${nomDe(f.expediteurId)} · ${date(f.date)}`}
            >
              <Vignette f={f} />
              {f.genre === "video" && <span className="fp-lecture" aria-hidden="true" />}
              {enCours === f.cle && <span className="fp-sablier" aria-hidden="true" />}
            </button>
          ))}
        </div>
      ) : (
        <div className="fp-liste">
          {visibles.map((f) => (
            <div key={f.cle} className="fp-ligne" onClick={() => void ouvrir(f)} role="button" tabIndex={0}>
              <span className="fp-mini">
                <Vignette f={f} />
              </span>
              <span className="fp-texte">
                <span className="fp-nom">{f.nom}</span>
                <span className="fp-meta">
                  {[formatBytes(f.taille), nomDe(f.expediteurId), date(f.date)].filter(Boolean).join(" · ")}
                </span>
              </span>
              {enCours === f.cle ? (
                <span className="fp-sablier petit" aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  className="fp-dl"
                  aria-label={t("download")}
                  onClick={(e) => {
                    e.stopPropagation()
                    void telecharger(f)
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {ouvert && (
        <DocumentViewer url={ouvert.url} name={ouvert.nom} mime={ouvert.mime} isMe={false} onClose={fermer} />
      )}
    </div>
  )
}

/**
 * La vignette d'un fichier : l'aperçu reçu avec un fichier chiffré (une image,
 * quel que soit le type), la photo elle-même en clair, la première image d'une
 * vidéo en clair — sinon une pastille avec l'extension.
 */
function Vignette({ f }: { f: FichierPartage }) {
  const apercu = f.descripteur?.apercu ? urlApercu(f.descripteur.apercu) : null
  if (apercu) return <img className="fp-img" src={apercu} alt="" loading="lazy" />
  if (f.url && f.genre === "image") {
    return <img className="fp-img" src={resolveMediaUrl(f.url)} alt="" loading="lazy" />
  }
  if (f.url && f.genre === "video") {
    return <video className="fp-img" src={videoPosterUrl(resolveMediaUrl(f.url))} preload="metadata" muted playsInline />
  }
  const ext = (f.nom.split(".").pop() ?? "").slice(0, 4).toUpperCase()
  return <span className={`fp-type ${f.genre}`}>{ext || "?"}</span>
}
