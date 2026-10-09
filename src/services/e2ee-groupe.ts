/**
 * CHIFFREMENT DES GROUPES — le trousseau de groupe (lot 1).
 *
 * Conception : `backend-alanya/docs/2026-10-08-e2ee-groupes-conception.md`, § 2.
 * Cours : chapitres 31 et 32. JUMEAU EXACT de
 * `alanya/lib/services/e2ee/e2ee_groupe.dart` : un octet de différence, et un
 * message du web ne se lit plus sur le téléphone. Les vecteurs
 * `alanya/test/donnees/vecteur_groupe_*.json` tiennent les deux.
 *
 *   · une clé de groupe par VERSION, 32 octets tirés au hasard ;
 *   · un message chiffré UNE fois (AES-256-GCM), lié à son contexte par des
 *     données associées, et SIGNÉ par l'appareil expéditeur (XEdDSA) ;
 *   · le trousseau (toutes les versions) voyage dans une enveloppe Signal à
 *     deux, sous la charge « G1 ».
 */
import obtenirSignal from "@privacyresearch/libsignal-protocol-typescript"

/** Le seul format de message de groupe connu. */
export const FORMAT_GROUPE = 0x01
/** Préfixe de la charge « trousseau » : un caractère nul, impossible à taper. */
export const PREFIXE_TROUSSEAU = "\u0000G1"

const TAILLE_CLE = 32
const TAILLE_NONCE = 12
const TAILLE_ETIQUETTE = 16
const TAILLE_SIGNATURE = 64

/** Un message de groupe ou un trousseau refusé : on le dit, on ne devine pas. */
export class GroupeInvalide extends Error {}

/** Tout ce qui lie un chiffré à SA place. */
export interface ContexteGroupe {
  convId: string
  messageId: string
  version: number
  expediteurId: string
  deviceId: number
}

/* ══════════════════ OUTILS ══════════════════ */

const utf8 = new TextEncoder()

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const sortie = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) {
    sortie.set(p, i)
    i += p.length
  }
  return sortie
}

function versB64(o: Uint8Array): string {
  let s = ""
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000))
  return btoa(s)
}

function depuisB64(b: string): Uint8Array<ArrayBuffer> {
  const s = atob(b)
  const o = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i)
  return o
}

function tampon(o: Uint8Array): ArrayBuffer {
  return o.slice().buffer as ArrayBuffer
}

type Courbe = Awaited<ReturnType<typeof obtenirSignal>>["Curve"]
let courbe: Promise<Courbe> | null = null

/** La courbe de la bibliothèque Signal (signatures XEdDSA, comme le mobile). */
function laCourbe(): Promise<Courbe> {
  // Sous Node (bancs), le module CommonJS arrive enveloppé : `default.default`.
  const fabrique = ((obtenirSignal as unknown as { default?: typeof obtenirSignal }).default ??
    obtenirSignal) as typeof obtenirSignal
  courbe ??= fabrique().then((s) => s.Curve)
  return courbe
}

/* ══════════════════ LA SIGNATURE ══════════════════ */

/**
 * Signe `message` avec la clé PRIVÉE d'identité de cet appareil (32 octets).
 */
export async function signer(clePrivee: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const c = await laCourbe()
  return new Uint8Array(c.calculateSignature(tampon(clePrivee), tampon(message)))
}

/**
 * La signature est-elle VALIDE ?
 *
 * 🔴 PIÈGE DE LA BIBLIOTHÈQUE WEB, ET IL EST CRITIQUE (cours, chapitre 32).
 * Son `Curve.verifySignature` rend… `true` quand la signature est INVALIDE :
 * il relaie tel quel `curve25519.verify`, dont la documentation avoue que
 * « le fait que verify renvoie vrai quand une signature est invalide peut
 * prêter à confusion ». Celui du mobile rend `true` quand elle est VALIDE.
 * Appeler l'un comme l'autre aurait accepté toutes les fausses signatures et
 * refusé toutes les vraies.
 *
 * ⚠️ D'OÙ CE NOM, et la négation au seul endroit où elle existe. Les vecteurs
 * croisés contiennent une signature FALSIFIÉE qui doit être refusée des deux
 * côtés : c'est elle qui garde ce piège fermé.
 */
export async function signatureValide(
  clePublique: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (signature.length !== TAILLE_SIGNATURE) return false
  const c = await laCourbe()
  try {
    const invalide = c.verifySignature(tampon(clePublique), tampon(message), tampon(signature))
    return invalide === false
  } catch {
    // Clé publique mal formée : pas une signature valide.
    return false
  }
}

/* ══════════════════ LA CLÉ ET LE MESSAGE ══════════════════ */

/** Une clé de groupe neuve : 32 octets du générateur sûr du navigateur. */
export function genererCleGroupe(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(TAILLE_CLE))
}

/**
 * Les données associées : ce qui colle le chiffré à SA place.
 *
 * ⚠️ UN SÉPARATEUR QUI NE PEUT PAS APPARAÎTRE DANS LES CHAMPS (`\n`) : des
 * identifiants UUID, un entier, un numéro d'appareil. Sans lui, deux contextes
 * différents pourraient s'écrire pareil une fois collés.
 */
export function donneesAssociees(c: ContexteGroupe): Uint8Array<ArrayBuffer> {
  for (const v of [c.convId, c.messageId, c.expediteurId]) {
    if (!v || v.includes("\n")) throw new GroupeInvalide("contexte mal formé")
  }
  if (!Number.isInteger(c.version) || c.version < 1) throw new GroupeInvalide("version invalide")
  if (!Number.isInteger(c.deviceId) || c.deviceId < 0) throw new GroupeInvalide("appareil invalide")
  return utf8.encode(
    `alanya-groupe-v1\n${c.convId}\n${c.messageId}\n${c.version}\n${c.expediteurId}\n${c.deviceId}`,
  ) as Uint8Array<ArrayBuffer>
}

/**
 * Chiffre et signe un message de groupe. `clair` est la charge v2 du message,
 * inchangée (`ecrireCharge`, e2ee-media.ts).
 *
 * Rend `base64( 0x01 | nonce(12) | chiffré+étiquette | signature(64) )`.
 *
 * `nonceImpose` n'existe que pour les vecteurs : un nonce réutilisé avec la
 * même clé détruit la confidentialité de GCM.
 */
export async function chiffrerMessageGroupe(
  clair: string,
  cle: Uint8Array,
  contexte: ContexteGroupe,
  clePriveeIdentite: Uint8Array,
  nonceImpose?: Uint8Array,
): Promise<string> {
  if (cle.length !== TAILLE_CLE) throw new GroupeInvalide("clé de groupe invalide")
  const aad = donneesAssociees(contexte)
  const nonce = nonceImpose ?? crypto.getRandomValues(new Uint8Array(TAILLE_NONCE))
  if (nonce.length !== TAILLE_NONCE) throw new GroupeInvalide("nonce invalide")
  const k = await crypto.subtle.importKey("raw", tampon(cle), "AES-GCM", false, ["encrypt"])
  const chiffre = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: tampon(nonce), additionalData: aad, tagLength: 128 },
      k,
      utf8.encode(clair),
    ),
  )
  const signature = await signer(clePriveeIdentite, concat(aad, nonce, chiffre))
  return versB64(concat(new Uint8Array([FORMAT_GROUPE]), nonce, chiffre, signature))
}

/**
 * Vérifie PUIS déchiffre un message de groupe. Lève [GroupeInvalide].
 *
 * `clePubliqueIdentite` : la clé d'identité de l'appareil expéditeur TELLE QUE
 * CET APPAREIL LA CONNAÎT DÉJÀ (session à deux) — jamais une clé redemandée au
 * serveur pour l'occasion, qu'un serveur malveillant pourrait fausser.
 *
 * ⚠️ LA SIGNATURE D'ABORD. Un message mal signé ne doit même pas être
 * déchiffré : on ne fait rien du contenu d'un inconnu.
 */
export async function dechiffrerMessageGroupe(
  corps: string,
  cle: Uint8Array,
  contexte: ContexteGroupe,
  clePubliqueIdentite: Uint8Array,
): Promise<string> {
  let brut: Uint8Array<ArrayBuffer>
  try {
    brut = depuisB64(corps)
  } catch {
    throw new GroupeInvalide("corps illisible")
  }
  if (brut.length < 1 + TAILLE_NONCE + TAILLE_ETIQUETTE + TAILLE_SIGNATURE) {
    throw new GroupeInvalide("corps trop court")
  }
  if (brut[0] !== FORMAT_GROUPE) throw new GroupeInvalide("format inconnu")
  if (cle.length !== TAILLE_CLE) throw new GroupeInvalide("clé de groupe invalide")

  const nonce = brut.subarray(1, 1 + TAILLE_NONCE)
  const chiffre = brut.subarray(1 + TAILLE_NONCE, brut.length - TAILLE_SIGNATURE)
  const signature = brut.subarray(brut.length - TAILLE_SIGNATURE)
  const aad = donneesAssociees(contexte)

  if (!(await signatureValide(clePubliqueIdentite, concat(aad, nonce, chiffre), signature))) {
    throw new GroupeInvalide("signature refusée : expéditeur ou contenu falsifié")
  }
  const k = await crypto.subtle.importKey("raw", tampon(cle), "AES-GCM", false, ["decrypt"])
  try {
    const clair = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: tampon(nonce), additionalData: aad, tagLength: 128 },
      k,
      tampon(chiffre),
    )
    return new TextDecoder("utf-8", { fatal: true }).decode(clair)
  } catch {
    throw new GroupeInvalide("déchiffrement refusé : mauvaise clé, mauvaise version ou contexte déplacé")
  }
}

/* ══════════════════ LA CHARGE « TROUSSEAU » ══════════════════ */

export type MotifTrousseau = "ACTIVATION" | "AJOUT" | "EXCLUSION" | "MANUEL" | "APPAREIL"
const MOTIFS: readonly MotifTrousseau[] = ["ACTIVATION", "AJOUT", "EXCLUSION", "MANUEL", "APPAREIL"]

export interface VersionCle {
  n: number
  cle: Uint8Array
  creeLe: number
}

export interface Trousseau {
  convId: string
  motif: MotifTrousseau
  versions: VersionCle[]
}

/**
 * Le clair à chiffrer pour transmettre un trousseau, d'appareil à appareil.
 *
 * ⚠️ ORDRE DES CHAMPS FIXE, et le même que le mobile : les vecteurs comparent
 * les deux chaînes octet pour octet. Versions triées par numéro.
 */
export function ecrireChargeTrousseau(t: Trousseau): string {
  const versions = [...t.versions].sort((a, b) => a.n - b.n)
  return (
    PREFIXE_TROUSSEAU +
    JSON.stringify({
      v: 1,
      type: "trousseau",
      convId: t.convId,
      motif: t.motif,
      versions: versions.map((x) => ({ n: x.n, cle: versB64(x.cle), creeLe: x.creeLe })),
    })
  )
}

/** Ce clair est-il un trousseau ? (Avant d'essayer de le lire.) */
export function estChargeTrousseau(clair: string): boolean {
  return clair.startsWith(PREFIXE_TROUSSEAU)
}

/**
 * Lit et VÉRIFIE une charge trousseau.
 *
 * `convIdEnveloppe` : le fil auquel le serveur a rattaché l'enveloppe. Il doit
 * être celui écrit DANS le chiffré : le serveur ne peut pas rattacher un
 * trousseau à un autre groupe.
 *
 * ⚠️ QUI A LE DROIT D'ENVOYER UN TROUSSEAU (administrateur, ou le même compte)
 * se vérifie plus haut, avec la liste des membres : ce module ne la connaît pas.
 */
export function lireChargeTrousseau(clair: string, convIdEnveloppe: string): Trousseau {
  if (!estChargeTrousseau(clair)) throw new GroupeInvalide("pas une charge trousseau")
  let brut: unknown
  try {
    brut = JSON.parse(clair.slice(PREFIXE_TROUSSEAU.length))
  } catch {
    throw new GroupeInvalide("trousseau illisible")
  }
  const c = brut as { v?: unknown; type?: unknown; convId?: unknown; motif?: unknown; versions?: unknown }
  if (c.v !== 1 || c.type !== "trousseau") throw new GroupeInvalide("trousseau mal formé")
  if (typeof c.convId !== "string" || c.convId !== convIdEnveloppe) {
    throw new GroupeInvalide("trousseau rattaché à un autre groupe que le sien")
  }
  if (!MOTIFS.includes(c.motif as MotifTrousseau)) throw new GroupeInvalide("motif inconnu")
  if (!Array.isArray(c.versions) || c.versions.length === 0) throw new GroupeInvalide("trousseau vide")
  const vues = new Set<number>()
  const versions = c.versions.map((x: unknown) => {
    const v = x as { n?: unknown; cle?: unknown; creeLe?: unknown }
    if (!Number.isInteger(v.n) || (v.n as number) < 1) throw new GroupeInvalide("numéro de version invalide")
    if (vues.has(v.n as number)) throw new GroupeInvalide("version en double")
    vues.add(v.n as number)
    if (typeof v.cle !== "string") throw new GroupeInvalide("clé absente")
    let cle: Uint8Array
    try {
      cle = depuisB64(v.cle)
    } catch {
      throw new GroupeInvalide("clé illisible")
    }
    if (cle.length !== TAILLE_CLE) throw new GroupeInvalide("clé de mauvaise taille")
    if (typeof v.creeLe !== "number" || !Number.isFinite(v.creeLe)) throw new GroupeInvalide("date invalide")
    return { n: v.n as number, cle, creeLe: v.creeLe }
  })
  return { convId: c.convId, motif: c.motif as MotifTrousseau, versions: versions.sort((a, b) => a.n - b.n) }
}

/**
 * Fusionne un trousseau reçu dans celui qu'on a.
 *
 * 🔴 UNE VERSION DÉJÀ CONNUE AVEC UNE AUTRE CLÉ EST REFUSÉE. Personne — ni un
 * membre, ni le serveur qui relaierait un faux trousseau — ne doit pouvoir
 * REMPLACER une clé existante : les messages déjà chiffrés avec elle
 * deviendraient illisibles, ou pire, lisibles par un autre.
 */
export function fusionnerTrousseau(connu: VersionCle[], recu: VersionCle[]): VersionCle[] {
  const parN = new Map(connu.map((v) => [v.n, v]))
  for (const v of recu) {
    const deja = parN.get(v.n)
    if (deja) {
      if (versB64(deja.cle) !== versB64(v.cle)) {
        throw new GroupeInvalide(`la version ${v.n} est déjà connue avec une autre clé`)
      }
      continue
    }
    parN.set(v.n, v)
  }
  return [...parN.values()].sort((a, b) => a.n - b.n)
}
