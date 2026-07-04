import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CONTACT_COLORS } from "../../../src/data/contacts"
import { useContacts } from "../../../src/hooks/use-contacts"
import { useToast } from "../../../src/components/toast"
import { addContactByPhone } from "../../../src/services/contacts-service"
import { createPrivateChat } from "../../../src/services/chats-service"
import { startOutgoingCall } from "../../../src/services/call-manager"
import "../calls/calls-page.css"

/**
 * Repertoire : liste des contacts + formulaire d'enregistrement d'un contact
 * par son numero Alanya (6 chiffres) avec alias optionnel.
 */
export default function ContactsPage() {
  const navigate = useNavigate()
  const { contacts, addContact, removeContact } = useContacts()
  const { success, error } = useToast()

  const [query, setQuery] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [newNumber, setNewNumber] = useState("")
  const [newAlias, setNewAlias] = useState("")
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (contact) => contact.name.toLowerCase().includes(q) || contact.phone.includes(q)
    )
  }, [contacts, query])

  const canSave = /^\d{6}$/.test(newNumber.replace(/\D/g, ""))

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave || saving) return
    const number = newNumber.replace(/\D/g, "")

    if (contacts.some((contact) => contact.phone === number)) {
      error("Contact existant", "Ce numero Alanya est deja dans votre repertoire.")
      return
    }

    setSaving(true)
    try {
      const contact = await addContactByPhone(number, newAlias)
      addContact(contact)
      success("Contact enregistre", `${contact.name} a ete ajoute a votre repertoire.`)
      setNewNumber("")
      setNewAlias("")
      setShowAdd(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible d'ajouter ce contact."
      error("Ajout impossible", message)
    } finally {
      setSaving(false)
    }
  }

  const openChat = async (publicNumber: string) => {
    try {
      const conversation = await createPrivateChat(publicNumber)
      navigate(`/chats/${conversation.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Conversation impossible."
      error("Erreur", message)
    }
  }

  const callContact = async (publicNumber: string, name: string, type: "audio" | "video") => {
    try {
      const conversation = await createPrivateChat(publicNumber)
      const callId = await startOutgoingCall(conversation.id, type, name)
      navigate(`/calls/${callId}?type=${type}&returnTo=/contacts`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Appel impossible."
      error("Appel impossible", message)
    }
  }

  const handleRemove = async (id: string) => {
    try {
      await removeContact(id)
      success("Contact retire", "Le contact a ete supprime de votre repertoire.")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Suppression impossible."
      error("Erreur", message)
    } finally {
      setConfirmDelete(null)
    }
  }

  const iconBtnStyle: React.CSSProperties = {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    padding: "7px 9px",
    color: "var(--text-secondary)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
  }

  return (
    <div className="calls-root" style={{ padding: "20px 0" }}>
      <div className="calls-head" style={{ marginBottom: 14 }}>
        <div className="calls-title-row">
          <h1 className="calls-title">Contacts</h1>
          <button className="new-call-btn" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? "Fermer" : "+ Nouveau contact"}
          </button>
        </div>

        {showAdd && (
          <form
            onSubmit={handleAdd}
            style={{
              marginTop: 14,
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
              padding: 14,
            }}
          >
            <input
              className="input-base"
              placeholder="Numero Alanya (6 chiffres)"
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              style={{ padding: "10px 12px", width: 200, fontSize: 13 }}
            />
            <input
              className="input-base"
              placeholder="Alias (optionnel)"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              maxLength={100}
              style={{ padding: "10px 12px", width: 220, fontSize: 13 }}
            />
            <button className="new-call-btn" type="submit" disabled={!canSave || saving}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Le numero Alanya est affiche dans les parametres de chaque utilisateur.
            </span>
          </form>
        )}

        <div className="calls-controls" style={{ marginTop: 14 }}>
          <div className="search-wrap">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              placeholder="Rechercher un contact..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="calls-body">
        {filtered.map((contact) => {
          const color = CONTACT_COLORS[contact.color]
          return (
            <div key={contact.id} className="call-item">
              <div className="call-av" style={{ background: color.bg, color: color.fg }}>
                {contact.initials}
                {contact.online && <div className="ncm-online" />}
              </div>

              <div className="call-info">
                <div className="call-name">{contact.name}</div>
                <div className="call-detail">Numero Alanya : {contact.phone}</div>
              </div>

              <div className="call-right" style={{ display: "flex", gap: 8 }}>
                <button
                  style={iconBtnStyle}
                  title="Envoyer un message"
                  aria-label="Message"
                  onClick={() => void openChat(contact.phone)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </button>
                <button
                  style={iconBtnStyle}
                  title="Appel audio"
                  aria-label="Appel audio"
                  onClick={() => void callContact(contact.phone, contact.name, "audio")}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                  </svg>
                </button>
                <button
                  style={iconBtnStyle}
                  title="Appel video"
                  aria-label="Appel video"
                  onClick={() => void callContact(contact.phone, contact.name, "video")}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" />
                  </svg>
                </button>
                <button
                  style={{ ...iconBtnStyle, color: "var(--danger)" }}
                  title="Supprimer le contact"
                  aria-label="Supprimer"
                  onClick={() => setConfirmDelete(contact.id)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="empty-state">
            <div className="empty-txt">
              {query ? "Aucun contact trouve" : "Aucun contact enregistre pour le moment"}
            </div>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 8500,
            background: "var(--overlay)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(360px, 100%)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 14,
              padding: 20,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 15,
                color: "var(--text-primary)",
                marginBottom: 8,
              }}
            >
              Supprimer ce contact ?
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              Vos conversations existantes ne seront pas supprimees.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  background: "none",
                  border: "1px solid var(--border-default)",
                  borderRadius: 8,
                  padding: "8px 14px",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Annuler
              </button>
              <button
                onClick={() => void handleRemove(confirmDelete)}
                style={{
                  background: "var(--danger)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 14px",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
