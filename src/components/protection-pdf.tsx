import { useState } from "react"

import { useTranslation } from "../i18n"
import { proprietaireAuHasard, type ProtectionPdf } from "../services/e2ee-media"
import { FenetreSticker } from "./stickers/fenetre-sticker"

/**
 * LE PDF SENSIBLE PROTÉGÉ, CÔTÉ WEB (26/10/2026) — jumeau de
 * `dialogue_protection_pdf.dart` et `infos_protection_pdf.dart` du mobile.
 *
 * {@link DialogueProtectionPdf} : à l'envoi, l'expéditeur règle une fois
 * l'impression et, s'il veut, deux mots de passe (4 caractères au moins,
 * identiques permis — choix du user). {@link InfosProtectionPdf} : sous le
 * message, les mots de passe en clair chez l'expéditeur, celui d'ouverture en
 * VUE UNIQUE chez le destinataire, et « Impression interdite ».
 */

const LONGUEUR_MIN = 4

/** Rendu par le dialogue : `protection` nulle = aucune (la copie sort comme avant). */
export type ChoixProtectionPdf = { protection: ProtectionPdf | null }

export function DialogueProtectionPdf({
  nombre,
  onValider,
  onAnnuler,
}: {
  nombre: number
  onValider: (c: ChoixProtectionPdf) => void
  onAnnuler: () => void
}) {
  const { t } = useTranslation()
  const [imprimer, setImprimer] = useState(true)
  const [motDePasse, setMotDePasse] = useState(false)
  const [ouverture, setOuverture] = useState("")
  const [proprietaire, setProprietaire] = useState("")
  const [verifie, setVerifie] = useState(false)
  const tropCourt = (v: string) => v.length < LONGUEUR_MIN
  const erreur = (v: string) => (verifie && tropCourt(v) ? t("pdfp_trop_court", { n: LONGUEUR_MIN }) : null)

  const valider = () => {
    if (!motDePasse) {
      onValider({ protection: imprimer ? null : { imprimer: false, proprietaire: proprietaireAuHasard() } })
      return
    }
    setVerifie(true)
    if (tropCourt(ouverture) || tropCourt(proprietaire)) return
    onValider({ protection: { imprimer, ouverture, proprietaire } })
  }

  const champ = (libelle: string, aide: string, valeur: string, changer: (v: string) => void, nomChamp: string) => (
    <label className="ppdf-champ">
      <span>{libelle}</span>
      <input type="password" value={valeur} onChange={(e) => changer(e.target.value)} data-champ={nomChamp} autoComplete="new-password" />
      {erreur(valeur) ? <em className="ppdf-erreur">{erreur(valeur)}</em> : <small>{aide}</small>}
    </label>
  )

  return (
    <FenetreSticker titre={t("pdfp_titre")} onFermer={onAnnuler} libelleFermer={t("close")}>
      <div className="ppdf">
        <p className="stk-description">{t(nombre > 1 ? "pdfp_intro_plusieurs" : "pdfp_intro", { n: nombre })}</p>
        <label className="ppdf-bascule">
          <input type="checkbox" checked={imprimer} onChange={(e) => setImprimer(e.target.checked)} data-champ="imprimer" />
          <span>{t("pdfp_imprimer")}</span>
        </label>
        <label className="ppdf-bascule">
          <input type="checkbox" checked={motDePasse} onChange={(e) => setMotDePasse(e.target.checked)} data-champ="mot-de-passe" />
          <span>
            {t("pdfp_mot_de_passe")}
            <small>{t("pdfp_mot_de_passe_aide")}</small>
          </span>
        </label>
        {motDePasse && (
          <>
            {champ(t("pdfp_ouverture"), t("pdfp_ouverture_aide"), ouverture, setOuverture, "ouverture")}
            {champ(t("pdfp_proprietaire"), t("pdfp_proprietaire_aide"), proprietaire, setProprietaire, "proprietaire")}
          </>
        )}
        <div className="stk-createur-pied">
          <button type="button" className="stk-action" onClick={onAnnuler}>
            {t("cancel")}
          </button>
          <button type="button" className="stk-action plein" onClick={valider} data-action="valider-protection">
            {t("ok")}
          </button>
        </div>
      </div>
    </FenetreSticker>
  )
}

const cleVue = (mediaId: string) => `alanya.pdf_mdp_vu.${mediaId}`
function dejaVu(mediaId: string): boolean {
  try {
    return localStorage.getItem(cleVue(mediaId)) === "1"
  } catch {
    return false
  }
}

export function InfosProtectionPdf({ protection, mediaId, isMe }: { protection: ProtectionPdf; mediaId: string; isMe: boolean }) {
  const { t } = useTranslation()
  const [vu, setVu] = useState(() => dejaVu(mediaId))
  const [revele, setRevele] = useState(false)

  const voir = () => {
    // Marqué AVANT d'être montré : recharger la page ne rend pas une seconde vue.
    try {
      localStorage.setItem(cleVue(mediaId), "1")
    } catch {
      /* stockage refusé : la vue unique ne tiendra que le temps de la page */
    }
    setVu(true)
    setRevele(true)
  }

  return (
    <div className="ppdf-infos" onClick={(e) => e.stopPropagation()}>
      {!protection.imprimer && <span>🖨️⃠ {t("pdfp_impression_interdite")}</span>}
      {protection.ouverture && isMe && (
        <>
          <span data-info="ouverture">
            🔓 {t("pdfp_ouverture")} : <code>{protection.ouverture}</code>
          </span>
          <span>
            🛡️ {t("pdfp_proprietaire")} : <code>{protection.proprietaire}</code>
          </span>
        </>
      )}
      {protection.ouverture && !isMe && !vu && (
        <button type="button" className="stk-action" onClick={voir} data-action="voir-mdp">
          👁 {t("pdfp_voir_une_fois")}
        </button>
      )}
      {protection.ouverture && !isMe && vu && !revele && <span>🙈 {t("pdfp_deja_vu")}</span>}
      {revele && protection.ouverture && (
        <FenetreSticker titre={t("pdfp_mdp_ouverture_titre")} onFermer={() => setRevele(false)} libelleFermer={t("close")}>
          <div className="stk-recu">
            <code className="ppdf-revele" data-info="revele">
              {protection.ouverture}
            </code>
            <p className="stk-description">{t("pdfp_vue_unique_avis")}</p>
            <div className="stk-recu-actions">
              <button type="button" className="stk-action" onClick={() => void navigator.clipboard?.writeText(protection.ouverture ?? "")}>
                {t("copy")}
              </button>
              <button type="button" className="stk-action plein" onClick={() => setRevele(false)}>
                OK
              </button>
            </div>
          </div>
        </FenetreSticker>
      )}
    </div>
  )
}
