import { apiRequest } from "../lib/api-client"

/**
 * Reglages de confidentialite du compte, tels que le backend les expose.
 *
 * Le web affichait quatre bascules — confirmations de lecture, statut en ligne,
 * derniere connexion, photo de profil — qui n'etaient que des `useState` locaux
 * suivis d'un message « active ». Rien n'etait ni enregistre ni envoye : le
 * reglage disparaissait au rechargement.
 *
 * Le backend n'en connait que deux, ceux que le mobile utilise
 * (`account_repository.dart`) : `readReceipts` et `lastSeenVisibility`. Il n'y a
 * pas de reglage de visibilite de la photo de profil, d'ou son retrait de
 * l'ecran plutot qu'une promesse sans effet.
 */

/** Qui peut voir la derniere connexion et le statut en ligne. */
export type LastSeenVisibility = 0 | 1 | 2

/** Libelles du mobile, reprisa l'identique pour que les deux clients concordent. */
export const LAST_SEEN_LABELS: Record<LastSeenVisibility, string> = {
  2: "Tout le monde",
  1: "Mes contacts",
  0: "Personne",
}

export interface PrivacySettings {
  /** Envoyer la confirmation de lecture a l'expediteur. */
  readReceipts: boolean
  lastSeenVisibility: LastSeenVisibility
}

/** Valeurs par defaut du backend : lecture confirmee, presence publique. */
export const PRIVACY_DEFAULTS: PrivacySettings = {
  readReceipts: true,
  lastSeenVisibility: 2,
}

function toVisibility(value: unknown): LastSeenVisibility {
  return value === 0 || value === 1 || value === 2 ? value : PRIVACY_DEFAULTS.lastSeenVisibility
}

/** GET /api/account/privacy */
export async function fetchPrivacy(): Promise<PrivacySettings> {
  const data = await apiRequest<{ readReceipts?: number; lastSeenVisibility?: number }>(
    "/api/account/privacy"
  )
  return {
    readReceipts: (data.readReceipts ?? 1) !== 0,
    lastSeenVisibility: toVisibility(data.lastSeenVisibility ?? PRIVACY_DEFAULTS.lastSeenVisibility),
  }
}

/**
 * POST /api/account/privacy — n'envoie que les champs fournis, comme le mobile.
 * Les booleens voyagent en 1/0, le backend attendant des entiers.
 */
export async function savePrivacy(patch: Partial<PrivacySettings>): Promise<void> {
  const body: Record<string, number> = {}
  if (patch.readReceipts !== undefined) body.readReceipts = patch.readReceipts ? 1 : 0
  if (patch.lastSeenVisibility !== undefined) body.lastSeenVisibility = patch.lastSeenVisibility
  if (Object.keys(body).length === 0) return
  await apiRequest<void>("/api/account/privacy", { method: "POST", body })
}
