import { apiRequest, ApiError } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { ecrireSecret, effacerSecret, lireSecret, ouvrirCoffre } from "./coffre-chiffre"
import { getOrCreateWebDeviceId } from "./appareils-service"
import { assurerCleCompte } from "./e2ee-compte"
import { deballerCle, emballerCle, genererPaireCompte, type ContexteEmballage } from "./e2ee-groupe"
import { assembler, partager } from "./e2ee-shamir"
import { ouvrir, poserSerrureContacts, relierAuMotDePasse } from "./e2ee-sauvegarde"

/**
 * LES CONTACTS DE RÉCUPÉRATION, CÔTÉ NAVIGATEUR (27/11/2026, chantier 2).
 *
 * 🔴 JUMEAU DE `alanya/lib/services/e2ee/e2ee_contacts_recuperation.dart`.
 *
 * Trois rôles :
 *  - le PROPRIÉTAIRE choisit trois contacts : un secret neuf est posé comme
 *    serrure « contacts », partagé en 2 sur 3, chaque part scellée pour la clé
 *    de compte d'un contact ;
 *  - le CONTACT ouvre sa part avec sa clé de compte et la rescelle pour la clé
 *    éphémère de l'appareil qui demande — il ne voit jamais le secret ;
 *  - l'APPAREIL QUI DEMANDE réunit deux parts, refait le secret, ouvre la
 *    serrure « contacts » et refait la serrure « mot de passe ».
 *
 * ⚠️ LE SERVEUR NE VOIT QUE DES PARTS SCELLÉES ET DES CLÉS PUBLIQUES.
 */

const OCTETS_SECRET = 32

function versB64(o: Uint8Array): string {
  let t = ""
  for (let i = 0; i < o.length; i++) t += String.fromCharCode(o[i])
  return btoa(t)
}

function depuisB64(b64: string): Uint8Array {
  const t = atob(b64)
  const o = new Uint8Array(t.length)
  for (let i = 0; i < t.length; i++) o[i] = t.charCodeAt(i)
  return o
}

/** La part d'un contact, scellée pour sa clé de compte. Jumeau du mobile. */
function contextePart(
  proprietaire: string,
  contact: string,
  generation: number,
  versionCompte: number,
): ContexteEmballage {
  return {
    convId: `recuperation:${proprietaire}`,
    destinataireId: contact,
    version: generation,
    versionCompte,
  }
}

/** La part rescellée pour l'appareil qui demande. Jumeau du mobile. */
function contexteAide(demande: string, proprietaire: string, indice: number): ContexteEmballage {
  return { convId: `contacts:${demande}`, destinataireId: proprietaire, version: indice, versionCompte: 1 }
}

/* ══════════════════ LE PROPRIÉTAIRE ══════════════════ */

export interface MonContact {
  contactId: string
  indice: number
  etat: "invite" | "accepte" | "refuse"
  nom: string | null
  avatarUrl: string | null
}

export async function mesContactsRecuperation(): Promise<{
  generation: number
  actif: boolean
  contacts: MonContact[]
}> {
  return apiRequest("/api/e2ee/contacts-recuperation", { cache: "no-store" })
}

/** Les comptes qui ont une clé de compte (seuls eux peuvent recevoir une part). */
export async function clesDeCompte(ids: string[]): Promise<Map<string, { version: number; publique: string }>> {
  if (ids.length === 0) return new Map()
  const r = await apiRequest<{ cles: { userId: string; version: number; publique: string }[] }>(
    `/api/e2ee/cles-compte?ids=${encodeURIComponent(ids.join(","))}`,
  )
  return new Map(r.cles.map((c) => [c.userId, { version: c.version, publique: c.publique }]))
}

/**
 * Confie la récupération à trois contacts. LÈVE en cas d'échec — l'écran le dit.
 *
 * ⚠️ LA SERRURE D'ABORD, LES PARTS ENSUITE : le serveur refuse des parts sans
 * serrure « contacts ». Un nouveau partage la remplace, et les parts d'avant
 * n'ouvrent plus rien.
 */
export async function confierAuxContacts(contactIds: string[]): Promise<void> {
  const moi = getMyUserId()
  if (!moi || contactIds.length !== 3) throw new Error("trois contacts")
  const cles = await clesDeCompte(contactIds)
  if (contactIds.some((id) => !cles.has(id))) throw new Error("clé de compte manquante")
  const { generation: avant } = await mesContactsRecuperation()
  const generation = avant + 1

  const secret = crypto.getRandomValues(new Uint8Array(OCTETS_SECRET))
  if (!(await poserSerrureContacts(versB64(secret)))) throw new Error("serrure non posée")
  const parts = partager(secret, 3, 2)
  const corps = await Promise.all(
    contactIds.map(async (contactId, i) => {
      const cle = cles.get(contactId)!
      return {
        contactId,
        indice: parts[i].indice,
        versionCompte: cle.version,
        part: await emballerCle(
          parts[i].valeur,
          depuisB64(cle.publique),
          contextePart(moi, contactId, generation, cle.version),
        ),
      }
    }),
  )
  secret.fill(0)
  await apiRequest("/api/e2ee/contacts-recuperation", { method: "PUT", body: { generation, parts: corps } })
}

export async function retirerContactsRecuperation(): Promise<void> {
  await apiRequest("/api/e2ee/contacts-recuperation", { method: "DELETE" })
}

/* ══════════════════ LE CONTACT ══════════════════ */

export interface InvitationRecuperation {
  id: string
  ownerId: string
  nom: string | null
}

export interface DemandeAide {
  id: string
  ownerId: string
  nom: string | null
  clePublique: string
  generation: number
  indice: number
  part: string
  versionCompte: number
}

export async function aTraiterRecuperation(): Promise<{
  invitations: InvitationRecuperation[]
  demandes: DemandeAide[]
}> {
  try {
    return await apiRequest("/api/e2ee/contacts-recuperation/a-traiter", { cache: "no-store" })
  } catch {
    return { invitations: [], demandes: [] }
  }
}

export async function repondreInvitation(id: string, accepte: boolean): Promise<boolean> {
  try {
    await apiRequest(`/api/e2ee/contacts-recuperation/invitations/${encodeURIComponent(id)}`, {
      method: "POST",
      body: { accepte },
    })
    return true
  } catch {
    return false
  }
}

/**
 * J'aide : ma part, ouverte avec MA clé de compte, rescellée pour la clé
 * éphémère de l'appareil qui demande. Je ne vois jamais le secret.
 */
export async function aider(d: DemandeAide): Promise<boolean> {
  const moi = getMyUserId()
  if (!moi) return false
  try {
    const cle = await assurerCleCompte()
    if (!cle || cle.version !== d.versionCompte) return false
    const valeur = await deballerCle(d.part, cle.priv, contextePart(d.ownerId, moi, d.generation, d.versionCompte))
    const enveloppe = await emballerCle(valeur, depuisB64(d.clePublique), contexteAide(d.id, d.ownerId, d.indice))
    valeur.fill(0)
    await apiRequest(`/api/e2ee/demandes-contacts/${encodeURIComponent(d.id)}/reponse`, {
      method: "POST",
      body: { accord: true, enveloppe },
    })
    return true
  } catch (e) {
    console.warn("[e2ee] aide non envoyée :", e)
    return false
  }
}

export async function refuserAide(d: DemandeAide): Promise<boolean> {
  try {
    await apiRequest(`/api/e2ee/demandes-contacts/${encodeURIComponent(d.id)}/reponse`, {
      method: "POST",
      body: { accord: false },
    })
    return true
  } catch {
    return false
  }
}

/* ══════════════════ L'APPAREIL QUI DEMANDE ══════════════════ */

const CLE_DEMANDE_CONTACTS = "archive.demande-contacts"

interface DemandeLocale {
  id: string
  priv: string
}

export type IssueAide =
  | { etat: "envoyee"; id: string }
  | { etat: "trop"; jusquA: string | null }
  | { etat: "impossible" }

/** Demande l'aide des contacts de récupération. */
export async function demanderAideAuxContacts(): Promise<IssueAide> {
  try {
    const paire = await genererPaireCompte()
    const r = await apiRequest<{ id: string }>("/api/e2ee/demandes-contacts", {
      method: "POST",
      body: { appareil: getOrCreateWebDeviceId(), clePublique: versB64(paire.pub) },
    })
    await ouvrirCoffre()
    ecrireSecret(CLE_DEMANDE_CONTACTS, { id: r.id, priv: versB64(paire.priv) })
    return { etat: "envoyee", id: r.id }
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) {
      const jusquA = (e.payload as { error?: { jusquA?: string } } | undefined)?.error?.jusquA ?? null
      return { etat: "trop", jusquA }
    }
    return { etat: "impossible" }
  }
}

export type IssueRelectureAide =
  | { etat: "attente"; accords: number }
  | { etat: "recue" }
  | { etat: "refusee" }
  | { etat: "expiree" }
  | { etat: "echec" }
  | { etat: "aucune" }

/**
 * Relit la demande. Deux accords : les parts sont ouvertes, assemblées, la
 * serrure « contacts » s'ouvre avec le secret, et — si [motDePasse] est connu —
 * la serrure « mot de passe » est refaite. `echec` : les parts n'ouvrent pas
 * la serrure (partage changé entre-temps) ; rien n'est rangé.
 */
export async function relireAideContacts(motDePasse?: string): Promise<IssueRelectureAide> {
  let locale: DemandeLocale | undefined
  try {
    await ouvrirCoffre()
    locale = lireSecret<DemandeLocale>(CLE_DEMANDE_CONTACTS)
  } catch {
    return { etat: "aucune" }
  }
  if (!locale) return { etat: "aucune" }
  const moi = getMyUserId()
  if (!moi) return { etat: "attente", accords: 0 }
  const oublier = () => {
    try {
      effacerSecret(CLE_DEMANDE_CONTACTS)
    } catch {
      // la demande expirera d'elle-même
    }
  }

  let r: { etat: string; accords: number; parts?: { indice: number; enveloppe: string }[] }
  try {
    r = await apiRequest(`/api/e2ee/demandes-contacts/${encodeURIComponent(locale.id)}`, { cache: "no-store" })
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      oublier()
      return { etat: "aucune" }
    }
    return { etat: "attente", accords: 0 }
  }
  if (r.etat === "ouverte" && !r.parts) return { etat: "attente", accords: r.accords }
  if (r.etat !== "ouverte") {
    oublier()
    return { etat: r.etat === "refusee" ? "refusee" : "expiree" }
  }

  const priv = depuisB64(locale.priv)
  try {
    const parts = await Promise.all(
      r.parts!.map(async (p) => ({
        indice: p.indice,
        valeur: await deballerCle(p.enveloppe, priv, contexteAide(locale!.id, moi, p.indice)),
      })),
    )
    const secret = assembler(parts.slice(0, 2))
    const ok = await ouvrir("contacts", versB64(secret))
    secret.fill(0)
    if (!ok) {
      oublier()
      return { etat: "echec" }
    }
  } catch {
    oublier()
    return { etat: "echec" }
  }
  oublier()
  try {
    await apiRequest(`/api/e2ee/demandes-contacts/${encodeURIComponent(locale.id)}/fin`, { method: "POST" })
  } catch {
    // Le serveur effacera à l'expiration.
  }
  if (motDePasse) void relierAuMotDePasse(motDePasse)
  return { etat: "recue" }
}

/** Une demande d'aide de ce navigateur attend-elle encore ? */
export async function aideEnAttente(): Promise<boolean> {
  try {
    await ouvrirCoffre()
    return !!lireSecret<DemandeLocale>(CLE_DEMANDE_CONTACTS)
  } catch {
    return false
  }
}
