import { apiRequest } from "../lib/api-client"
import {
  type Contact,
  type ContactColor,
  loadContacts,
  persistContacts,
  toInitials,
} from "../data/contacts"

/** Contact tel que renvoye par le backend Next.js. */
interface BackendContact {
  id: string
  alias: string | null
  isBlocked?: boolean
  user: {
    id: string
    publicNumber: string
    pseudo: string | null
    avatarUrl?: string | null
    statusMsg?: string | null
  }
}

interface ContactsListResponse {
  contacts: BackendContact[]
}

const COLOR_WHEEL: ContactColor[] = ["amber", "blue", "violet", "teal", "rose"]

function pickColor(id: string): ContactColor {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return COLOR_WHEEL[sum % COLOR_WHEEL.length]
}

function toFrontContact(c: BackendContact): Contact {
  const name = c.alias?.trim() || c.user.pseudo?.trim() || c.user.publicNumber
  return {
    id: c.id,
    name,
    initials: toInitials(name),
    color: pickColor(c.id),
    online: false, // pas d'info de presence via REST sur ce backend
    email: "",
    // Le champ "phone" du front porte le numero Alanya (6 ou 8 chiffres).
    phone: c.user.publicNumber,
    avatar: c.user.avatarUrl ?? null,
  }
}

/**
 * GET /api/contacts — Charge la liste depuis le backend.
 * Si le backend echoue, on retombe sur le cache localStorage (pas de mock).
 */
export async function fetchContacts(): Promise<Contact[]> {
  try {
    const response = await apiRequest<ContactsListResponse>("/api/contacts")
    const contacts = (response.contacts ?? []).map(toFrontContact)
    persistContacts(contacts)
    return contacts
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[contacts] fetch a echoue", error)
    return loadContacts()
  }
}

/** POST /api/contacts — Ajoute un contact par son numero Alanya (6 ou 8 chiffres), avec alias optionnel. */
export async function addContactByPhone(rawNumber: string, alias?: string): Promise<Contact> {
  const publicNumber = rawNumber.replace(/\D/g, "")
  const response = await apiRequest<BackendContact>("/api/contacts", {
    method: "POST",
    body: { publicNumber, alias: alias?.trim() || undefined },
  })
  return toFrontContact(response)
}

/** DELETE /api/contacts/{id} — Retire un contact. */
export async function removeContactById(id: string): Promise<void> {
  await apiRequest<void>(`/api/contacts/${id}`, { method: "DELETE" })
}
