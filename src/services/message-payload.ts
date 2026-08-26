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

/**
 * Longueur maximale d'un message, en caracteres.
 *
 * 🔴 CE N'EST PAS UN CHOIX D'INTERFACE, c'est la taille de la colonne :
 * `message.content` est un `VARCHAR(500)` depuis le 25/08/2026. Le serveur
 * COUPE ce qui depasse (`tronqueContenu` dans `message-payload.mjs`), donc sans
 * cette borne a la saisie l'utilisateur ecrit un texte, l'envoie, et en voit
 * arriver une version raccourcie sans que rien ne l'ait prevenu.
 *
 * ⚠️ MIROIR de `LONGUEUR_MAX_CONTENU` cote serveur et de `longueurMaxContenu`
 * dans `alanya/lib/models/message_payload.dart`. La changer ici seul ne
 * changerait rien : c'est la base qui tranche.
 */
export const LONGUEUR_MAX_CONTENU = 500

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

/**
 * Version de la charge, écrite dans `v`. Un client plus ancien la lit et sait.
 *
 * ⚠️ MIROIR de `VERSION_CHARGE` (serveur) et de `versionCharge` (Flutter).
 */
export const VERSION_CHARGE = 1

/**
 * Encode la charge d'un message CONTACT.
 *
 * ⚠️ MIROIR EXACT de `encodeContacts` dans
 * `alanya/lib/models/message_payload.dart` : mêmes clés, même ordre, et surtout
 * mêmes OMISSIONS. Un champ nul est ABSENT de la charge, il n'y figure pas à
 * `null` — c'est ce que le mobile envoie déjà, c'est ce que le serveur relit, et
 * c'est aussi ce qui tient la charge sous la longueur de la colonne (voir
 * [LONGUEUR_MAX_CONTENU] : le serveur REFUSE une charge structurée trop longue
 * au lieu de la couper, parce que couper du JSON le détruit).
 *
 * Le lecteur — [contactsDepuisContenu] — écarte un contact sans nom ET sans
 * numéro : cet encodeur fait de même, sinon l'expéditeur verrait dans sa propre
 * bulle une fiche que le destinataire, lui, ne verrait jamais.
 */
export function encodeContacts(contacts: SharedContact[]): string {
  const charge = contacts
    .filter((c) => (c.name ?? "").trim().length > 0 || c.phones.length > 0)
    .slice(0, 10)
    .map((c) => {
      const entree: Record<string, unknown> = {}
      const nom = (c.name ?? "").trim()
      if (nom.length > 0) entree["name"] = nom.slice(0, 200)
      if (c.phones.length > 0) entree["phones"] = c.phones.slice(0, 10)
      if (c.alanyaId) entree["alanyaId"] = c.alanyaId.slice(0, 10)
      if (c.avatarUrl) entree["avatarUrl"] = c.avatarUrl.slice(0, 500)
      return entree
    })
  return JSON.stringify({ v: VERSION_CHARGE, contacts: charge })
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
