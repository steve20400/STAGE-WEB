import { apiRequest, ApiError } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { chiffrerPourArchive, dechiffrerDepuisArchive } from "./e2ee-sauvegarde"
import { ecrireChargeTrousseau, lireChargeTrousseau, type VersionCle } from "./e2ee-groupe"

/**
 * MA COPIE DU TROUSSEAU D'UN GROUPE — lot 6, cours chapitre 35.
 *
 * Elle sert au NOUVEAU TÉLÉPHONE : il retrouve les clés de ses groupes sans
 * qu'aucun autre membre soit en ligne, et relit tout l'historique (le chiffré
 * des messages de groupe reste sur le serveur).
 *
 * 🔴 CHIFFRÉE PAR LA CLÉ MAÎTRESSE DE L'ARCHIVE PERSONNELLE, que le serveur
 * n'a jamais : elle s'ouvre avec le mot de passe (décision du user — rien à
 * retenir de plus). Le serveur range un chiffré opaque, et l'efface au départ
 * du groupe (routes `leave` et `members`).
 *
 * ⚠️ LES DONNÉES ASSOCIÉES LIENT LA COPIE À SON COMPTE ET À SON GROUPE : un
 * serveur qui servirait la copie d'un autre groupe (ou d'un autre compte) à
 * sa place la verrait refusée par GCM, avant même la lecture.
 *
 * Le clair est la charge « trousseau » ordinaire (`\u0000G1`, motif APPAREIL) :
 * même écriture, mêmes contrôles à la lecture que d'appareil à appareil.
 */

const utf8 = new TextEncoder()

/** Jumeau mobile : `aadCopie` dans `e2ee_trousseau_perso.dart`. */
export function aadCopie(compte: string, convId: string): Uint8Array {
  return utf8.encode(`alanya-trousseau-perso-v1\n${compte}\n${convId}`)
}

/**
 * Dépose (ou remplace) ma copie. Rend `false` sans rien faire si l'archive
 * n'est pas ouverte ici : un autre de mes appareils la déposera.
 *
 * ⚠️ NE LÈVE JAMAIS : la copie est un filet, son absence ne doit pas faire
 * échouer la réception d'un trousseau.
 */
export async function deposerCopie(convId: string, versions: VersionCle[]): Promise<boolean> {
  const moi = getMyUserId()
  if (!moi || versions.length === 0) return false
  try {
    const clair = ecrireChargeTrousseau({ convId, motif: "APPAREIL", versions })
    const corps = await chiffrerPourArchive(clair, aadCopie(moi, convId))
    if (!corps) return false
    await apiRequest(`/api/e2ee/trousseaux/${encodeURIComponent(convId)}`, {
      method: "PUT",
      body: { corps },
    })
    return true
  } catch (err) {
    console.warn("[e2ee] copie du trousseau non déposée :", err)
    return false
  }
}

/**
 * Relit ma copie de ce groupe. `null` : pas de copie, archive fermée, ou copie
 * refusée (altérée, d'un autre groupe).
 */
export async function lireCopie(convId: string): Promise<VersionCle[] | null> {
  const moi = getMyUserId()
  if (!moi) return null
  let corps: string
  try {
    corps = (
      await apiRequest<{ corps: string }>(`/api/e2ee/trousseaux/${encodeURIComponent(convId)}`, {
        cache: "no-store",
      })
    ).corps
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
  try {
    const clair = await dechiffrerDepuisArchive(corps, aadCopie(moi, convId))
    if (clair === null) return null
    return lireChargeTrousseau(clair, convId).versions
  } catch (err) {
    console.warn(`[e2ee] copie du trousseau de ${convId.slice(0, 8)} refusée :`, err)
    return null
  }
}

/** Toutes mes copies, pour un nouvel appareil : `convId → versions`. */
export async function lireToutesLesCopies(): Promise<Map<string, VersionCle[]>> {
  const moi = getMyUserId()
  const sortie = new Map<string, VersionCle[]>()
  if (!moi) return sortie
  const r = await apiRequest<{ trousseaux: { convId: string; corps: string }[] }>(
    "/api/e2ee/trousseaux",
    { cache: "no-store" },
  )
  for (const c of r.trousseaux ?? []) {
    try {
      const clair = await dechiffrerDepuisArchive(c.corps, aadCopie(moi, c.convId))
      if (clair === null) return sortie // archive fermée : rien ne s'ouvrira
      sortie.set(c.convId, lireChargeTrousseau(clair, c.convId).versions)
    } catch (err) {
      console.warn(`[e2ee] copie du trousseau de ${c.convId.slice(0, 8)} refusée :`, err)
    }
  }
  return sortie
}
