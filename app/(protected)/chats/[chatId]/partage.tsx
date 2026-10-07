import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { useTranslation } from "../../../../src/i18n"
import {
  aUnFichier,
  donneesAPartager,
  fichierAPartager,
  partageable,
  partageSystemeDisponible,
  texteAPartager,
  type MessageAPartager,
} from "../../../../src/services/partage-externe"
import "./partage.css"

/**
 * « PARTAGER » — demande du user, 07/10/2026.
 *
 * Deux destinations, comme sur le mobile :
 *   - DANS ALANYA WORK : vers une ou plusieurs discussions — c'est le
 *     transfert, qui garde le contenu chiffré si le fil l'est ;
 *   - AUTRES APPLICATIONS : la feuille de partage du système (WhatsApp,
 *     Telegram, Gmail…), où le contenu sort d'Alanya, déchiffré.
 *
 * 🔴 LE PARTAGE SYSTÈME EXIGE UN GESTE RÉCENT. Le navigateur refuse d'ouvrir la
 * feuille si le clic date de plus de quelques secondes ; or préparer un fichier
 * — le télécharger, le déchiffrer — peut prendre plus longtemps. Si le premier
 * essai est refusé pour cette raison, le fichier est prêt : un bouton
 * « Partager maintenant » fournit le geste qui manquait.
 *
 * ⚠️ UN NAVIGATEUR SANS PARTAGE (Firefox, Chrome sous Linux) : le fichier est
 * téléchargé, le texte copié, et on le dit.
 */
export function FenetrePartage({
  msg,
  onFermer,
  onDansAlanya,
  onInfo,
  onErreur,
}: {
  msg: MessageAPartager
  onFermer: () => void
  /** Ouvre le transfert vers une ou plusieurs discussions. */
  onDansAlanya: () => void
  onInfo: (texte: string) => void
  onErreur: (texte: string) => void
}) {
  const { t } = useTranslation()
  const [etat, setEtat] = useState<"choix" | "preparation" | "pret">("choix")
  const [donnees, setDonnees] = useState<ShareData | null>(null)

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer()
    }
    document.addEventListener("keydown", surTouche)
    return () => document.removeEventListener("keydown", surTouche)
  }, [onFermer])

  /** Sans feuille de partage : on télécharge le fichier, on copie le texte. */
  const repli = async () => {
    try {
      if (aUnFichier(msg)) {
        const fichier = await fichierAPartager(msg)
        const url = URL.createObjectURL(fichier)
        const lien = document.createElement("a")
        lien.href = url
        lien.download = fichier.name
        document.body.appendChild(lien)
        lien.click()
        lien.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
        onInfo(t("partage_indisponible"))
      } else {
        await navigator.clipboard.writeText(texteAPartager(msg))
        onInfo(t("partage_texte_copie"))
      }
    } catch {
      onErreur(t("partage_echec"))
    }
    onFermer()
  }

  const partager = async (d: ShareData) => {
    try {
      await navigator.share(d)
      onFermer()
    } catch (e) {
      const nom = e instanceof DOMException ? e.name : ""
      // L'utilisateur a refermé la feuille : rien à dire.
      if (nom === "AbortError") {
        onFermer()
        return
      }
      // Le geste a expiré pendant la préparation : on en redemande un.
      if (nom === "NotAllowedError") {
        setDonnees(d)
        setEtat("pret")
        return
      }
      onErreur(t("partage_echec"))
      onFermer()
    }
  }

  const versAutresApplications = async () => {
    if (!partageSystemeDisponible()) {
      await repli()
      return
    }
    setEtat("preparation")
    let d: ShareData
    try {
      d = await donneesAPartager(msg)
    } catch {
      onErreur(t("partage_echec"))
      onFermer()
      return
    }
    // Un fichier que ce navigateur ne sait pas partager : on le télécharge.
    if (!partageable(d)) {
      await repli()
      return
    }
    await partager(d)
  }

  return createPortal(
    <div className="partage-voile" onClick={onFermer} role="presentation">
      <div
        className="partage-feuille"
        role="dialog"
        aria-modal="true"
        aria-label={t("msg_partager")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="partage-titre">{t("msg_partager")}</div>
        {etat === "choix" && (
          <>
            <button
              type="button"
              className="partage-option"
              onClick={() => {
                onFermer()
                onDansAlanya()
              }}
            >
              <span className="partage-icone marque" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 17 20 12 15 7" />
                  <path d="M4 18v-2a4 4 0 014-4h12" />
                </svg>
              </span>
              <span className="partage-libelles">
                <span className="partage-libelle">{t("partage_dans_alanya")}</span>
                <span className="partage-detail">{t("partage_dans_alanya_detail")}</span>
              </span>
            </button>
            <button type="button" className="partage-option" onClick={() => void versAutresApplications()}>
              <span className="partage-icone" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
                  <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
                </svg>
              </span>
              <span className="partage-libelles">
                <span className="partage-libelle">{t("partage_autres_apps")}</span>
                <span className="partage-detail">{t("partage_autres_apps_detail")}</span>
              </span>
            </button>
          </>
        )}
        {etat === "preparation" && (
          <div className="partage-attente" role="status">
            <span className="partage-sablier" aria-hidden="true" />
            {t("partage_preparation")}
          </div>
        )}
        {etat === "pret" && donnees && (
          <button type="button" className="partage-maintenant" onClick={() => void partager(donnees)}>
            {t("partage_pret")}
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
