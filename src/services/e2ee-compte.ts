import { apiRequest, ApiError } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { ouvrirCoffre, lireSecret, ecrireSecret, coffreEcrit } from "./coffre-chiffre"
import { chiffrerPourArchive, dechiffrerDepuisArchive } from "./e2ee-sauvegarde"
import { genererPaireCompte } from "./e2ee-groupe"

/**
 * LA CLÉ DU COMPTE — chiffrement des groupes v2, lot 4 (11/11/2026).
 * Conception côté serveur : `docs/2026-11-11-e2ee-groupes-v2-conception.md`, § 3.1.
 *
 * ⚠️ JUMEAU DE `alanya/lib/services/e2ee/e2ee_compte.dart` : même copie
 * serveur (chiffrée par la clé maîtresse de l'archive, données associées
 * `alanya-compte-v1\n<compte>\n<version>`), donc une clé créée sur le
 * téléphone s'ouvre dans le navigateur, et l'inverse.
 *
 * Une paire Curve25519 par COMPTE : elle ouvre les emballages de groupe. Le
 * mot de passe tapé à la connexion ouvre la clé maîtresse, qui ouvre cette
 * clé, qui ouvre tous les groupes — sans qu'aucun autre appareil soit en ligne.
 */

export interface CleCompte {
  version: number
  /** 33 octets, format Signal. */
  pub: Uint8Array
  /** 32 octets. */
  priv: Uint8Array
}

interface CleRangee {
  version: number
  pub: string
  priv: string
}

const CLE_COFFRE = "compte.cle"
const utf8 = new TextEncoder()

const versB64 = (o: Uint8Array): string => {
  let s = ""
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000))
  return btoa(s)
}
const depuisB64 = (b: string): Uint8Array => {
  const s = atob(b)
  const o = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i)
  return o
}

/** Jumeau mobile : `aadCleCompte` dans `e2ee_compte.dart`. */
export function aadCleCompte(compte: string, version: number): Uint8Array {
  return utf8.encode(`alanya-compte-v1\n${compte}\n${version}`)
}

let memoire: CleCompte | null = null
let enCours: Promise<CleCompte | null> | null = null

/** La clé de compte de ce navigateur, sans réseau. `null` : pas encore là. */
export async function cleCompteLocale(): Promise<CleCompte | null> {
  if (memoire) return memoire
  await ouvrirCoffre()
  const r = lireSecret<CleRangee>(CLE_COFFRE)
  if (!r) return null
  memoire = { version: r.version, pub: depuisB64(r.pub), priv: depuisB64(r.priv) }
  return memoire
}

async function ranger(cle: CleCompte): Promise<void> {
  memoire = cle
  await ouvrirCoffre()
  ecrireSecret(CLE_COFFRE, { version: cle.version, pub: versB64(cle.pub), priv: versB64(cle.priv) })
  await coffreEcrit()
}

function codeErreur(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined
  return (err.payload as { error?: { code?: string } } | undefined)?.error?.code
}

interface CleServeur {
  version: number
  publique: string
  priveeChiffree: string
}

async function adopter(serveur: CleServeur, moi: string): Promise<CleCompte | null> {
  const clair = await dechiffrerDepuisArchive(serveur.priveeChiffree, aadCleCompte(moi, serveur.version))
  if (clair === null) return null
  const cle = { version: serveur.version, pub: depuisB64(serveur.publique), priv: depuisB64(clair) }
  await ranger(cle)
  return cle
}

/**
 * La clé de compte, à coup sûr si c'est possible : celle du coffre, sinon
 * celle du serveur ouverte par la clé maîtresse, sinon une neuve déposée
 * (version 1). `null` quand l'archive n'est pas ouverte : les groupes
 * continuent alors par l'ancien chemin. Une seule demande à la fois.
 */
export async function assurerCleCompte(): Promise<CleCompte | null> {
  const deja = await cleCompteLocale()
  if (deja) return deja
  enCours ??= assurer().finally(() => {
    enCours = null
  })
  return enCours
}

async function assurer(): Promise<CleCompte | null> {
  const moi = getMyUserId()
  if (!moi) return null
  const r = await apiRequest<{ cle: CleServeur | null }>("/api/e2ee/compte", { cache: "no-store" })
  if (r.cle) return adopter(r.cle, moi)

  const paire = await genererPaireCompte()
  const cle: CleCompte = { version: 1, pub: paire.pub, priv: paire.priv }
  const priveeChiffree = await chiffrerPourArchive(versB64(cle.priv), aadCleCompte(moi, cle.version))
  // Archive fermée : impossible de déposer une clé que les autres appareils
  // pourraient ouvrir. On attend qu'elle s'ouvre.
  if (!priveeChiffree) return null
  try {
    await apiRequest("/api/e2ee/compte", {
      method: "PUT",
      body: { version: cle.version, publique: versB64(cle.pub), priveeChiffree },
    })
  } catch (err) {
    // Un autre de mes appareils l'a créée entre-temps : on prend la sienne.
    if (codeErreur(err) === "VERSION_COMPTE") {
      const relu = await apiRequest<{ cle: CleServeur | null }>("/api/e2ee/compte", { cache: "no-store" })
      return relu.cle ? adopter(relu.cle, moi) : null
    }
    throw err
  }
  await ranger(cle)
  return cle
}

/** Déconnexion : le coffre est vidé à part ; on oublie la copie en mémoire. */
export function oublierCleCompte(): void {
  memoire = null
}
