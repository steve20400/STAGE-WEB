import { apiRequest } from "../lib/api-client"
import { depuisContacts, poser } from "./noms-donnes"
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
    // L'API l'envoie depuis toujours et on le jetait : sans lui, aucune
    // recherche par expediteur ne pouvait aboutir.
    userId: c.user.id,
    name,
    initials: toInitials(name),
    color: pickColor(c.id),
    online: false, // pas d'info de presence via REST sur ce backend
    email: "",
    // Le champ "phone" du front porte le numero Alanya.
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
    return await fetchContactsDuServeur()
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[contacts] fetch a echoue", error)
    return loadContacts()
  }
}

/**
 * La même lecture, mais SANS REPLI : elle échoue quand le serveur ne répond
 * pas.
 *
 * ⚠️ À PRÉFÉRER DÈS QU'UNE ABSENCE DOIT SIGNIFIER QUELQUE CHOSE. Le repli de
 * `fetchContacts` rend le cache local, qui peut être vide ou en retard : y
 * chercher quelqu'un et ne pas l'y trouver ne prouve pas qu'il n'est pas un
 * contact. Le bandeau « cette personne ne fait pas partie de vos contacts »
 * ne doit rien affirmer sur une telle base.
 */
export async function fetchContactsDuServeur(): Promise<Contact[]> {
  const response = await apiRequest<ContactsListResponse>("/api/contacts")
  /*
   * 🔴 LE REGISTRE DES NOMS DONNÉS SE REMPLIT ICI, et nulle part ailleurs :
   * c'est le seul endroit qui voie passer les alias BRUTS. `toFrontContact`
   * les fond aussitôt dans `name`, et après lui l'information est perdue.
   * Un compte qui refuse d'être renommé arrive déjà avec `alias: null`.
   */
  depuisContacts(response.contacts ?? [])
  const contacts = (response.contacts ?? []).map(toFrontContact)
  persistContacts(contacts)
  return contacts
}

/** POST /api/contacts — Ajoute un contact par son numero Alanya, avec alias optionnel. */
export async function addContactByPhone(rawNumber: string, alias?: string): Promise<Contact> {
  const publicNumber = rawNumber.replace(/\D/g, "")
  const response = await apiRequest<BackendContact>("/api/contacts", {
    method: "POST",
    body: { publicNumber, alias: alias?.trim() || undefined },
  })
  // ⚠️ ON PREND L'ALIAS DE LA RÉPONSE, pas celui qu'on a demandé : le serveur
  // l'ignore pour un compte qui refuse d'être renommé, et le registre doit
  // dire la vérité plutôt que notre intention.
  poser(response.user?.id, response.alias)
  return toFrontContact(response)
}

/**
 * Range un contact fraichement ajoute dans le cache local, pour que les autres
 * ecrans le connaissent sans attendre un rechargement.
 */
export function memoriserContact(contact: Contact) {
  const connus = loadContacts()
  if (connus.some((c) => c.id === contact.id)) return
  persistContacts([...connus, contact])
}

/** DELETE /api/contacts/{id} — Retire un contact. */
export async function removeContactById(id: string): Promise<void> {
  await apiRequest<void>(`/api/contacts/${id}`, { method: "DELETE" })
}
