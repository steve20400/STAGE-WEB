import { useState } from "react"
import { useToast } from "../../../src/components/toast"
import { loadContacts } from "../../../src/data/contacts"
import { normalizePhoneNumber } from "../../../src/data/session-user"
import { createMeeting } from "../../../src/services/meetings-service"

interface CreateMeetingModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function CreateMeetingModal({ isOpen, onClose, onSuccess }: CreateMeetingModalProps) {
  const { success, error: showError } = useToast()

  const [step, setStep] = useState<"details" | "participants">("details")
  const [objet, setObjet] = useState("")
  const [typeMedia, setTypeMedia] = useState(1) // 1 = audio, 2 = video
  const [duree, setDuree] = useState("3600")
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
      showError("Objet requis", "Veuillez entrer un objet pour la réunion")
      return
    }

    setLoading(true)
    try {
      const participantNumbers = Array.from(selectedParticipants)
      await createMeeting({
        objet: objet.trim(),
        type_media: typeMedia,
        duree: parseInt(duree, 10) || 3600,
        participantNumbers: participantNumbers.length > 0 ? participantNumbers : undefined,
      })
      success("Réunion créée!")
      setObjet("")
      setTypeMedia(1)
      setDuree("3600")
      setSelectedParticipants(new Set())
      setStep("details")
      onClose()
      onSuccess()
    } catch (err) {
      showError(
        err instanceof Error ? err.message : "Impossible de créer la réunion"
      )
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Créer une réunion</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {step === "details" ? (
          <div className="modal-body">
            <div className="form-group">
              <label>Objet *</label>
              <input
                type="text"
                placeholder="Ex: Réunion d'équipe"
                value={objet}
                onChange={(e) => setObjet(e.target.value)}
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label>Type</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    value="1"
                    checked={typeMedia === 1}
                    onChange={() => setTypeMedia(1)}
                  />
                  Audio
                </label>
                <label>
                  <input
                    type="radio"
                    value="2"
                    checked={typeMedia === 2}
                    onChange={() => setTypeMedia(2)}
                  />
                  Vidéo
                </label>
              </div>
            </div>

            <div className="form-group">
              <label>Durée (secondes)</label>
              <input
                type="number"
                value={duree}
                onChange={(e) => setDuree(e.target.value)}
                min="300"
                max="28800"
              />
              <small>5 min min, 8 h max</small>
            </div>

            <div className="form-group">
              <label>Participants ({selectedParticipants.size})</label>
              <button
                className="btn-secondary"
                onClick={() => setStep("participants")}
              >
                Ajouter participants
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <input
              type="text"
              placeholder="Rechercher par nom ou Alanya ID"
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
                  {searchQuery ? "Aucun contact trouvé" : "Aucun contact"}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="modal-footer">
          {step === "participants" && (
            <button className="btn-secondary" onClick={() => setStep("details")}>
              Retour
            </button>
          )}
          <button
            className="btn-primary"
            onClick={step === "details" ? () => setStep("participants") : handleCreate}
            disabled={loading || (step === "details" && !objet.trim())}
          >
            {loading ? "Création..." : step === "details" ? "Suivant" : "Créer"}
          </button>
        </div>
      </div>
    </div>
  )
}
