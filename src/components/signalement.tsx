import { useState, type FormEvent } from "react"
import { apiRequest, codeErreurApi } from "../lib/api-client"
import { bloquer } from "../services/blocked-service"
import { useTranslation } from "../i18n"
import { useToast } from "./toast"
import "./signalement.css"

/**
 * SIGNALER (18/11/2026, exigence du Play Store pour une messagerie et pour
 * l'IA générative) : un message, un compte, un groupe ou une réponse de
 * l'Assistant. Le signalement arrive dans la file de modération de la console
 * (`POST /api/signalements`, console › Signalements).
 *
 * 🔴 DANS UN FIL CHIFFRÉ, LE SERVEUR NE LIT RIEN. Le texte du SEUL message
 * signalé part avec le signalement (`extrait`) — la personne qui signale le
 * sait : la fenêtre le lui dit.
 */
export type CibleSignalement =
  | { type: "message"; messageId: string; extrait?: string; chiffre: boolean; auteurNumero?: string | null }
  | { type: "user"; userId: string; numero?: string | null }
  | { type: "group"; convId: string }
  | { type: "ia"; aiMessageId: string }

const MOTIFS = ["harassment", "hate", "violence", "sexual", "scam", "spam", "impersonation", "other"] as const

export function FenetreSignalement({ cible, onFermer }: { cible: CibleSignalement; onFermer: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [motif, setMotif] = useState<(typeof MOTIFS)[number] | null>(null)
  const [note, setNote] = useState("")
  const [bloquerAussi, setBloquerAussi] = useState(false)
  const [enCours, setEnCours] = useState(false)

  const numeroABloquer =
    cible.type === "user" ? cible.numero : cible.type === "message" ? cible.auteurNumero : null
  const titre = {
    message: t("sig_titre_message"),
    user: t("sig_titre_compte"),
    group: t("sig_titre_groupe"),
    ia: t("sig_titre_ia"),
  }[cible.type]

  const envoyer = async (e: FormEvent) => {
    e.preventDefault()
    if (!motif || enCours) return
    setEnCours(true)
    const corps: Record<string, unknown> = { cible: cible.type, motif }
    if (note.trim()) corps.note = note.trim().slice(0, 1000)
    if (cible.type === "message") {
      corps.messageId = cible.messageId
      if (cible.chiffre && cible.extrait) corps.extrait = cible.extrait.slice(0, 4000)
    }
    if (cible.type === "user") corps.userId = cible.userId
    if (cible.type === "group") corps.convId = cible.convId
    if (cible.type === "ia") corps.aiMessageId = cible.aiMessageId
    try {
      await apiRequest("/api/signalements", { method: "POST", body: corps })
      if (bloquerAussi && numeroABloquer) await bloquer(numeroABloquer).catch(() => undefined)
      toast.success(t("sig_merci"))
      onFermer()
    } catch (err) {
      if (codeErreurApi(err) === "ALREADY_REPORTED") {
        toast.info(t("sig_deja"))
        onFermer()
      } else {
        toast.error(t("sig_echec"))
      }
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="sig-voile" role="dialog" aria-modal="true" aria-label={titre} onClick={onFermer}>
      <form className="sig-fenetre" onSubmit={envoyer} onClick={(e) => e.stopPropagation()}>
        <h2>{titre}</h2>
        {cible.type === "message" && cible.chiffre && <p className="sig-info">{t("sig_info_chiffre")}</p>}
        {cible.type === "ia" && <p className="sig-info">{t("sig_info_ia")}</p>}
        <fieldset>
          <legend>{t("sig_motif")}</legend>
          {MOTIFS.map((m) => (
            <label key={m} className="sig-choix">
              <input type="radio" name="motif" checked={motif === m} onChange={() => setMotif(m)} />
              {t(`sig_m_${m}`)}
            </label>
          ))}
        </fieldset>
        <label className="sig-note">
          {t("sig_note")}
          <textarea value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} />
        </label>
        {numeroABloquer && (
          <label className="sig-choix">
            <input type="checkbox" checked={bloquerAussi} onChange={(e) => setBloquerAussi(e.target.checked)} />
            {t("sig_bloquer_aussi")}
          </label>
        )}
        <div className="sig-actions">
          <button type="button" onClick={onFermer}>
            {t("cancel")}
          </button>
          <button type="submit" className="sig-envoyer" disabled={!motif || enCours}>
            {t("sig_envoyer")}
          </button>
        </div>
      </form>
    </div>
  )
}
