import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CONTACT_COLORS } from "../../../src/data/contacts"
import { useContacts } from "../../../src/hooks/use-contacts"
import { useToast } from "../../../src/components/toast"
import { addContactByPhone } from "../../../src/services/contacts-service"
import { createPrivateChat } from "../../../src/services/chats-service"
import { startOutgoingCall } from "../../../src/services/call-manager"
import {
  ALANYA_NUMBER_FORMATTED_MAX_LENGTH,
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../../../src/lib/alanya-number"
import { avatarDisplaySrc } from "../../../src/lib/avatar"
import { RowActionsMenu } from "../../../src/components/row-actions-menu"
import {
  bloquer,
  debloquer,
  listerBloques,
  type PersonneBloquee,
} from "../../../src/services/blocked-service"
import "../calls/calls-page.css"

/**
 * Repertoire : liste des contacts + formulaire d'enregistrement d'un contact
 * par son Alanya ID (6 ou 8 chiffres) avec alias optionnel.
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
  /**
   * Personnes bloquees, par numero Alanya. Il faut la LIGNE de blocage et pas
   * seulement l'etat : c'est son identifiant qui sert a debloquer.
   */
  const [bloques, setBloques] = useState<PersonneBloquee[]>([])

  useEffect(() => {
    let annule = false
    void listerBloques().then((liste) => {
      if (!annule) setBloques(liste)
    })
    return () => {
      annule = true
    }
  }, [])

  const blocageDe = (numero: string) =>
    bloques.find((b) => (b.publicNumber ?? "").replace(/\D/g, "") === numero.replace(/\D/g, "")) ??
    null

  const basculerBlocage = async (numero: string, nom: string) => {
    const existant = blocageDe(numero)
    try {
      if (existant) {
        await debloquer(existant.idBlock)
        setBloques((liste) => liste.filter((b) => b.idBlock !== existant.idBlock))
        success("Debloque", `${nom} peut de nouveau vous ecrire.`)
      } else {
        const ligne = await bloquer(numero)
        setBloques((liste) => [...liste, ligne])
        success("Bloque", `${nom} ne peut plus vous ecrire.`)
      }
    } catch (err) {
      error(
        existant ? "Deblocage impossible" : "Blocage impossible",
        err instanceof Error ? err.message : undefined
      )
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (contact) => contact.name.toLowerCase().includes(q) || contact.phone.includes(q)
    )
  }, [contacts, query])

  const canSave = isValidAlanyaNumber(newNumber)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave || saving) return
    const number = normalizeAlanyaNumber(newNumber)

    if (contacts.some((contact) => contact.phone === number)) {
      error("Contact existant", "Cet Alanya ID est deja dans votre repertoire.")
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

  return (
    <div className="calls-root" style={{ padding: "20px 0" }}>
      <div className="calls-head" style={{ marginBottom: 14 }}>
        <div className="calls-title-row page-title-row">
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
              placeholder="Alanya ID (ex. 12 34 56 78)"
              value={formatAlanyaNumber(newNumber)}
              onChange={(e) => setNewNumber(formatAlanyaNumber(e.target.value))}
              inputMode="numeric"
              maxLength={ALANYA_NUMBER_FORMATTED_MAX_LENGTH}
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
              L'Alanya ID est affiche dans les parametres de chaque utilisateur.
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
              <div
                className="call-av"
                style={{ background: color.bg, color: color.fg, overflow: "hidden" }}
              >
                {avatarDisplaySrc(contact.avatar) ? (
                  <img
                    src={avatarDisplaySrc(contact.avatar)!}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      borderRadius: "50%",
                    }}
                  />
                ) : (
                  contact.initials
                )}
                {contact.online && <div className="ncm-online" />}
              </div>

              <div className="call-info">
                <div className="call-name">{contact.name}</div>
                <div className="call-detail">Alanya ID : {formatAlanyaNumber(contact.phone)}</div>
              </div>

              <div className="call-right">
                <RowActionsMenu
                  ariaLabel={`Actions pour ${contact.name}`}
                  actions={[
                    { label: "Envoyer un message", onSelect: () => void openChat(contact.phone) },
                    {
                      label: "Appel audio",
                      onSelect: () => void callContact(contact.phone, contact.name, "audio"),
                    },
                    {
                      label: "Appel video",
                      onSelect: () => void callContact(contact.phone, contact.name, "video"),
                    },
                    blocageDe(contact.phone)
                      ? {
                          label: "Debloquer",
                          onSelect: () => void basculerBlocage(contact.phone, contact.name),
                        }
                      : {
                          label: "Bloquer",
                          onSelect: () => void basculerBlocage(contact.phone, contact.name),
                          danger: true,
                        },
                    {
                      label: "Supprimer le contact",
                      onSelect: () => setConfirmDelete(contact.id),
                      danger: true,
                    },
                  ]}
                />
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
