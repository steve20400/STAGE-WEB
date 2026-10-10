import { apiRequest, ApiError } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { chiffrerPour, deposer, idAppareil, ouvrirSessions, type EnveloppeSortante } from "./e2ee-service"
import { ecrireChargeTrousseau, genererCleGroupe, type MotifTrousseau, type VersionCle } from "./e2ee-groupe"
import { noteGroupe, rangerTrousseau, trousseauAvecRepli } from "./e2ee-groupe-fil"
import { noteEtatChiffrement } from "./e2ee-fil"

/**
 * LES GESTES D'ADMINISTRATEUR D'UN GROUPE CHIFFRÉ — lot 5, cours chapitre 35.
 *
 *   · ACTIVER : le serveur réserve la version 1, CET appareil tire la clé et
 *     la distribue à chaque appareil de chaque membre (et aux miens) ;
 *   · AJOUTER : le nouveau membre reçoit TOUT le trousseau — il lit
 *     l'historique (décision du user, « pas comme WhatsApp ») ;
 *   · EXCLURE ou CHANGER LA CLÉ : le serveur réserve la version n + 1, cet
 *     appareil la tire et la distribue aux membres RESTANTS.
 *
 * 🔴 LA CLÉ N'EST RANGÉE QU'APRÈS LA RÉSERVATION DU SERVEUR. Tirée avant, puis
 * refusée (un autre administrateur a été plus rapide), elle resterait dans le
 * trousseau local sous un numéro qui désigne, chez tous les autres, une AUTRE
 * clé : la vraie serait alors refusée à sa réception (« version déjà connue
 * avec une autre clé »), et cet appareil ne lirait plus rien du groupe.
 *
 * ⚠️ RÉSERVER PUIS NE PAS DISTRIBUER BLOQUE LES ENVOIS (navigateur fermé
 * entre les deux) : personne n'a la nouvelle version. Le remède est le geste
 * « changer la clé », par n'importe quel administrateur.
 */

/** Plafond d'un dépôt côté serveur (`ENVELOPPES_MAX`). */
const PAR_DEPOT = 1000

/**
 * Versions par charge « trousseau » (chapitre 38).
 *
 * 🔴 PAS DE LIMITE AU NOMBRE DE CLÉS (décision du user, 10/10/2026). Une
 * enveloppe ne dépasse pas 64 Ko côté serveur ; un trousseau entier y tenait
 * jusqu'à ~560 versions, au-delà la distribution échouait. On le DÉCOUPE :
 * 400 versions font ~34 Ko de clair, ~46 Ko d'enveloppe. Chaque morceau est un
 * trousseau valide, et la réception les fusionne (`fusionnerTrousseau`).
 */
export const VERSIONS_PAR_CHARGE = 400

/** Découpe les versions en morceaux de [taille], dans l'ordre. */
export function decouperVersions(versions: VersionCle[], taille = VERSIONS_PAR_CHARGE): VersionCle[][] {
  const tries = [...versions].sort((a, b) => a.n - b.n)
  const morceaux: VersionCle[][] = []
  for (let i = 0; i < tries.length; i += taille) morceaux.push(tries.slice(i, i + taille))
  return morceaux
}

export interface BilanDistribution {
  /** Combien d'appareils ont reçu le trousseau. */
  appareils: number
  /** Les membres sans aucun appareil chiffré : ils ne recevront rien. */
  sansAppareil: string[]
  /** Les membres pour qui l'ouverture de session a échoué. */
  echecs: string[]
}

/**
 * Envoie un trousseau, hors fil, à chaque appareil de [destinataires].
 *
 * ⚠️ MOI COMPRIS : mes AUTRES appareils doivent aussi recevoir la clé. CET
 * appareil est exclu — il l'a déjà.
 *
 * ⚠️ UN MEMBRE INJOIGNABLE N'ARRÊTE PAS LES AUTRES : il est compté, et le
 * reste du groupe reçoit sa clé.
 */
export async function distribuerTrousseau(
  convId: string,
  motif: MotifTrousseau,
  versions: VersionCle[],
  destinataires: string[],
): Promise<BilanDistribution> {
  const moi = getMyUserId()
  const charges = decouperVersions(versions).map((morceau) =>
    ecrireChargeTrousseau({ convId, motif, versions: morceau }),
  )
  const enveloppes: EnveloppeSortante[] = []
  const bilan: BilanDistribution = { appareils: 0, sansAppareil: [], echecs: [] }
  for (const uid of new Set(destinataires)) {
    try {
      const appareils = await ouvrirSessions(uid, uid === moi ? idAppareil() : undefined)
      if (appareils.length === 0) {
        if (uid !== moi) bilan.sansAppareil.push(uid)
        continue
      }
      for (const charge of charges) enveloppes.push(...(await chiffrerPour(uid, appareils, charge)))
    } catch (err) {
      console.warn(`[e2ee] trousseau non chiffré pour ${uid.slice(0, 8)} :`, err)
      bilan.echecs.push(uid)
    }
  }
  for (let i = 0; i < enveloppes.length; i += PAR_DEPOT) {
    await deposer(convId, enveloppes.slice(i, i + PAR_DEPOT))
  }
  bilan.appareils = enveloppes.length
  return bilan
}

/** Les membres ACTIFS du groupe, selon le serveur. */
async function membres(convId: string): Promise<{ id: string; publicNumber?: string }[]> {
  const r = await apiRequest<{ members: { id: string; publicNumber?: string }[] }>(
    `/api/conversations/${encodeURIComponent(convId)}/members`,
  )
  return r.members ?? []
}

function codeErreur(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined
  return (err.payload as { error?: { code?: string } } | undefined)?.error?.code
}

/**
 * ACTIVE le chiffrement d'un groupe — administrateur seulement (le serveur le
 * vérifie).
 *
 * `deja` : quelqu'un l'avait déjà activé ; sa clé arrivera par la relève.
 */
export async function activerGroupe(
  convId: string,
): Promise<{ deja: boolean; bilan?: BilanDistribution }> {
  const r = await apiRequest<{ deja: boolean; cleVersion: number }>(
    `/api/conversations/${encodeURIComponent(convId)}/e2ee`,
    { method: "POST", body: { appareil: idAppareil() } },
  )
  noteEtatChiffrement(convId, true)
  noteGroupe(convId, true)
  if (r.deja) return { deja: true }

  const v1: VersionCle = { n: 1, cle: genererCleGroupe(), creeLe: Date.now() }
  const versions = await rangerTrousseau(convId, [v1])
  const bilan = await distribuerTrousseau(
    convId,
    "ACTIVATION",
    versions,
    (await membres(convId)).map((m) => m.id),
  )
  return { deja: false, bilan }
}

/**
 * Le nouveau membre reçoit TOUT le trousseau : il lira l'historique depuis
 * l'activation (décision du user).
 */
export async function partagerAvecNouveaux(
  convId: string,
  userIds: string[],
): Promise<BilanDistribution> {
  const versions = await trousseauAvecRepli(convId)
  if (versions.length === 0) {
    throw new Error("Cet appareil n'a pas la clé du groupe : impossible de la partager.")
  }
  return distribuerTrousseau(convId, "AJOUT", versions, userIds)
}

/**
 * Nouvelle version de la clé : après une EXCLUSION, ou sur demande (MANUEL).
 *
 * Rend `null` si un autre administrateur l'a changée au même moment : sa clé
 * arrive par la relève, et il n'y a rien à faire ici.
 */
export async function changerCle(
  convId: string,
  motif: "EXCLUSION" | "MANUEL",
): Promise<{ version: number; bilan: BilanDistribution } | null> {
  const etat = await apiRequest<{ cleVersion?: number }>(
    `/api/conversations/${encodeURIComponent(convId)}/e2ee`,
    { cache: "no-store" },
  )
  const attendue = (etat.cleVersion ?? 0) + 1
  try {
    await apiRequest(`/api/conversations/${encodeURIComponent(convId)}/e2ee/versions`, {
      method: "POST",
      body: { attendue, appareil: idAppareil(), motif },
    })
  } catch (err) {
    if (codeErreur(err) === "VERSION_CONFLIT") return null
    throw err
  }
  const neuve: VersionCle = { n: attendue, cle: genererCleGroupe(), creeLe: Date.now() }
  // Avec l'historique que j'ai : les anciennes versions ne s'oublient pas.
  const versions = await rangerTrousseau(convId, [...(await trousseauAvecRepli(convId)), neuve])
  const bilan = await distribuerTrousseau(
    convId,
    motif,
    versions,
    (await membres(convId)).map((m) => m.id),
  )
  return { version: attendue, bilan }
}

/**
 * Après un ajout par numéro : retrouve les comptes ajoutés et leur partage le
 * trousseau.
 */
export async function partagerApresAjout(
  convId: string,
  numeros: string[],
): Promise<BilanDistribution> {
  const voulus = new Set(numeros)
  const ajoutes = (await membres(convId)).filter((m) => m.publicNumber && voulus.has(m.publicNumber))
  return partagerAvecNouveaux(
    convId,
    ajoutes.map((m) => m.id),
  )
}
