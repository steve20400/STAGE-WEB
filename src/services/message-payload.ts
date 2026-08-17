/**
 * Charges utiles des messages CONTACT et LOCATION.
 *
 * ⚠️ **MIROIR EXACT de `backend-alanya/src/lib/message-payload.mjs`**, et du
 * miroir Flutter `lib/models/message_payload.dart`. Le format est décidé côté
 * SERVEUR — seul point que les trois clients traversent — et le serveur refuse
 * à l'entrée une charge qui ne s'y conforme pas.
 *
 * Ne jamais faire évoluer ce fichier seul : c'est exactement ainsi que les
 * appels Web → Android sont restés bloqués plusieurs jours, une règle partagée
 * ayant été changée d'un seul côté.
 *
 *   CONTACT  {"v":1,"contacts":[{"name":"Jean Dupont",
 *                               "phones":["+237691234567"],
 *                               "alanyaId":"12345678",
 *                               "avatarUrl":"https://…"}]}
 *
 *   LOCATION {"v":1,"location":{"lat":3.848,"lng":11.502,
 *                               "accuracy":12.5,"label":"Douala"}}
 */

export interface SharedContact {
  name: string | null
  phones: string[]
  alanyaId: string | null
  avatarUrl: string | null
}

export interface SharedLocation {
  lat: number
  lng: number
  accuracy: number | null
  label: string | null
}

function litJson(content: string | null | undefined): Record<string, unknown> | null {
  if (!content) return null
  try {
    const valeur = JSON.parse(content)
    return valeur !== null && typeof valeur === "object" ? (valeur as Record<string, unknown>) : null
  } catch {
    // Un contenu qui n'est pas du JSON n'est pas une anomalie : c'est le cas de
    // tous les messages TEXT. L'appelant retombe sur son affichage habituel.
    return null
  }
}

function texte(valeur: unknown, maxi: number): string | null {
  if (typeof valeur !== "string") return null
  const t = valeur.trim()
  if (t.length === 0) return null
  return t.slice(0, maxi)
}

/** Nombre d'une charge, ou null si ce n'en est pas un. */
function nombre(valeur: unknown): number | null {
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null
}

/** Contacts d'un message CONTACT, ou null si la charge est invalide. */
export function contactsDepuisContenu(content: string | null | undefined): SharedContact[] | null {
  const brut = litJson(content)?.["contacts"]
  if (!Array.isArray(brut) || brut.length === 0) return null

  const contacts: SharedContact[] = []
  for (const c of brut) {
    if (c === null || typeof c !== "object") continue
    const entree = c as Record<string, unknown>
    const name = texte(entree["name"], 200)
    const phones: string[] = []
    const phonesBrut = entree["phones"]
    if (Array.isArray(phonesBrut)) {
      for (const p of phonesBrut) {
        const t = texte(p, 40)
        if (t) phones.push(t)
        if (phones.length >= 10) break
      }
    }
    // Un contact sans nom ET sans numéro n'a rien d'affichable.
    if (name === null && phones.length === 0) continue
    contacts.push({
      name,
      phones,
      alanyaId: texte(entree["alanyaId"], 10),
      avatarUrl: texte(entree["avatarUrl"], 500),
    })
  }
  return contacts.length > 0 ? contacts.slice(0, 10) : null
}

/** Position d'un message LOCATION, ou null si la charge est invalide. */
export function positionDepuisContenu(content: string | null | undefined): SharedLocation | null {
  const brut = litJson(content)?.["location"]
  if (brut === null || typeof brut !== "object") return null
  const entree = brut as Record<string, unknown>

  const lat = nombre(entree["lat"])
  const lng = nombre(entree["lng"])
  if (lat === null || lng === null) return null
  // Bornes du serveur : une longitude de 200 n'afficherait qu'une carte vide,
  // sans que rien ne dise d'où vient le problème.
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

  const acc = nombre(entree["accuracy"])
  return {
    lat,
    lng,
    accuracy: acc !== null && acc >= 0 ? acc : null,
    label: texte(entree["label"], 200),
  }
}

/** Titre affichable d'un contact : le nom, sinon le premier numéro. */
export function nomAffichable(c: SharedContact): string {
  if (c.name) return c.name
  if (c.phones.length > 0) return c.phones[0]
  return "Contact"
}

/**
 * Libellé d'une ligne pour un message structuré (liste de conversations,
 * citation d'une réponse). Sans lui, ces endroits afficheraient le JSON brut.
 */
export function apercuStructure(type: string, content: string | null | undefined): string | null {
  if (type === "contact" || type === "CONTACT") {
    const contacts = contactsDepuisContenu(content)
    if (contacts === null) return "👤 Contact"
    const premier = nomAffichable(contacts[0])
    if (contacts.length === 1) return `👤 ${premier}`
    const autres = contacts.length - 1
    return `👤 ${premier} et ${autres} autre${autres > 1 ? "s" : ""}`
  }
  if (type === "location" || type === "LOCATION") {
    const position = positionDepuisContenu(content)
    if (position === null) return "📍 Position"
    return position.label ? `📍 ${position.label}` : "📍 Position partagée"
  }
  return null
}
