import { useState } from "react"
import { useToast } from "../../../src/components/toast"
import { loadContacts } from "../../../src/data/contacts"
import { normalizePhoneNumber } from "../../../src/data/session-user"
import { createMeeting } from "../../../src/services/meetings-service"
import { useTranslation } from "../../../src/i18n"

interface CreateMeetingModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

/**
 * Duree en secondes, deduite des deux horaires.
 *
 * Le formulaire demandait une duree en secondes — une question a laquelle
 * personne ne repond en pensant « 3600 ». On saisit un debut et une fin ; la
 * duree s'en deduit. Sans les deux, on laisse le serveur poser sa valeur par
 * defaut plutot que d'en inventer une.
 *
 * Bornee comme le serveur la borne : une fin anterieure au debut, ou au-dela
 * de vingt-quatre heures, ferait rejeter la creation entiere.
 */
function dureeDeduite(debut: string, fin: string): number | undefined {
  if (!debut || !fin) return undefined
  const secondes = Math.round((new Date(fin).getTime() - new Date(debut).getTime()) / 1000)
  if (!Number.isFinite(secondes) || secondes < 1) return undefined
  return Math.min(secondes, 86400)
}

export function CreateMeetingModal({ isOpen, onClose, onSuccess }: CreateMeetingModalProps) {
  const { t } = useTranslation()
  const { success, error: showError } = useToast()

  const [step, setStep] = useState<"details" | "participants">("details")
  const [objet, setObjet] = useState("")
  const [typeMedia, setTypeMedia] = useState(1)
  const [duree, setDuree] = useState("3600")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(false)

  const contacts = loadContacts()
  const filteredContacts = searchQuery.trim()
    ? contacts.filter((c) => {
        const query = searchQuery.toLowerCase()
        return (
          c.name.toLowerCase().includes(query) ||
          normalizePhoneNumber(c.phone).includes(normalizePhoneNumber(searchQuery))
        )
      })
    : contacts

  const handleCreate = async () => {
    if (!objet.trim()) {
      showError(t("meet_subject_required"), t("meet_subject_required_detail"))
      return
    }

    setLoading(true)
    try {
      const numeros = Array.from(selectedParticipants)
      await createMeeting({
        objet: objet.trim(),
        type: typeMedia === 2 ? "video" : "audio",
        // Le champ datetime-local rend « 2026-08-10T14:30 » : ni secondes, ni
        // fuseau. Le serveur exige un ISO complet et refusait la creation avec
        // un laconique « donnees invalides ». La conversion regle aussi le
        // fuseau : on saisit une heure locale, le serveur stocke de l'UTC.
        debut: startTime ? new Date(startTime).toISOString() : undefined,
        dureeSecondes: dureeDeduite(startTime, endTime),
        numerosInvites: numeros.length > 0 ? numeros : undefined,
      })
      success(t("meet_created"))
      setObjet("")
      setTypeMedia(1)
      setDuree("3600")
      setStartTime("")
      setEndTime("")
      setSelectedParticipants(new Set())
      setStep("details")
      onClose()
      onSuccess()
    } catch (err) {
      showError(err instanceof Error ? err.message : t("meet_create_failed"))
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("meet_create")}</h2>
          <button className="modal-close" onClick={onClose} aria-label={t("close")}>
            ✕
          </button>
        </div>

        {step === "details" ? (
          <div className="modal-body">
            <div className="form-group">
              <label>{t("meet_subject")} *</label>
              <input
                type="text"
                placeholder={t("meet_subject_placeholder")}
                value={objet}
                onChange={(e) => setObjet(e.target.value)}
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label>{t("meet_type")}</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    value="1"
                    checked={typeMedia === 1}
                    onChange={() => setTypeMedia(1)}
                  />
                  {t("cinfo_audio")}
                </label>
                <label>
                  <input
                    type="radio"
                    value="2"
                    checked={typeMedia === 2}
                    onChange={() => setTypeMedia(2)}
                  />
                  {t("video_label")}
                </label>
              </div>
            </div>

            <div className="form-group">
              <label>{t("meet_start_time")}</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>{t("meet_end_time")}</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>{t("meet_participants", { count: selectedParticipants.size })}</label>
              <button className="btn-secondary" onClick={() => setStep("participants")}>
                {t("meet_add_participants")}
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <input
              type="text"
              placeholder={t("meet_search_placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
              autoFocus
            />

            <div className="participants-list">
              {filteredContacts.map((contact) => (
                <label key={contact.id} className="participant-item">
                  <input
                    type="checkbox"
                    checked={selectedParticipants.has(contact.phone)}
                    onChange={(e) => {
                      const next = new Set(selectedParticipants)
                      if (e.target.checked) {
                        next.add(contact.phone)
                      } else {
                        next.delete(contact.phone)
                      }
                      setSelectedParticipants(next)
                    }}
                  />
                  <div className="participant-info">
                    <div>{contact.name}</div>
                    <small>{normalizePhoneNumber(contact.phone)}</small>
                  </div>
                </label>
              ))}
              {filteredContacts.length === 0 && (
                <div className="empty-search">
                  {searchQuery ? t("meet_no_contact_found") : t("meet_no_contact")}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="modal-footer">
          {step === "participants" && (
            <button className="btn-secondary" onClick={() => setStep("details")}>
              {t("back")}
            </button>
          )}
          <button
            className="btn-primary"
            onClick={step === "details" ? () => setStep("participants") : handleCreate}
            disabled={loading || (step === "details" && !objet.trim())}
          >
            {loading
              ? t("meet_creating")
              : step === "details"
                ? t("meet_next")
                : t("meet_create_btn")}
          </button>
        </div>
      </div>
    </div>
  )
}
