import { apiRequest } from "../lib/api-client"
import type { Cle } from "../i18n"

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
export const LAST_SEEN_LABELS: Record<LastSeenVisibility, Cle> = {
  2: "privacy_everyone",
  1: "privacy_my_contacts",
  0: "privacy_nobody",
}

export interface PrivacySettings {
  /** Envoyer la confirmation de lecture a l'expediteur. */
  readReceipts: boolean
  lastSeenVisibility: LastSeenVisibility
  /**
   * Chiffrer les NOUVELLES conversations — pour tout le compte.
   *
   * 🔴 IL A REMPLACÉ LE BOUCLIER DE CHAQUE DISCUSSION (décision du user,
   * 12/10/2026). Avant, il fallait l'activer discussion par discussion depuis
   * un bouton de l'en-tête ; désormais les clients chiffrent dès qu'ils le
   * peuvent, et ce réglage est le seul endroit où l'on peut dire non.
   *
   * ⚠️ LE COUPER N'OUVRE RIEN DE CE QUI EST DÉJÀ FERMÉ : le chiffrement ne se
   * défait pas. Les conversations déjà chiffrées le restent, et l'écran le dit.
   */
  chiffrementActif: boolean
}

/** Valeurs par defaut du backend : lecture confirmee, presence publique. */
export const PRIVACY_DEFAULTS: PrivacySettings = {
  readReceipts: true,
  lastSeenVisibility: 2,
  // ⚠️ CHIFFRÉ PAR DÉFAUT, ici comme sur le serveur : un serveur plus ancien
  // qui ne rend pas ce champ doit laisser le client protéger, pas se taire.
  chiffrementActif: true,
}

function toVisibility(value: unknown): LastSeenVisibility {
  return value === 0 || value === 1 || value === 2 ? value : PRIVACY_DEFAULTS.lastSeenVisibility
}

/** GET /api/account/privacy */
export async function fetchPrivacy(): Promise<PrivacySettings> {
  const data = await apiRequest<{
    readReceipts?: number
    lastSeenVisibility?: number
    chiffrementActif?: boolean
  }>("/api/account/privacy")
  return {
    readReceipts: (data.readReceipts ?? 1) !== 0,
    lastSeenVisibility: toVisibility(
      data.lastSeenVisibility ?? PRIVACY_DEFAULTS.lastSeenVisibility
    ),
    chiffrementActif: data.chiffrementActif ?? PRIVACY_DEFAULTS.chiffrementActif,
  }
}

/**
 * POST /api/account/privacy — n'envoie que les champs fournis, comme le mobile.
 * Les booleens voyagent en 1/0, le backend attendant des entiers.
 */
export async function savePrivacy(patch: Partial<PrivacySettings>): Promise<void> {
  // ⚠️ Un booléen VRAI pour le chiffrement, des entiers pour les deux autres :
  // c'est ce que le serveur attend, champ par champ.
  const body: Record<string, number | boolean> = {}
  if (patch.readReceipts !== undefined) body.readReceipts = patch.readReceipts ? 1 : 0
  if (patch.lastSeenVisibility !== undefined) body.lastSeenVisibility = patch.lastSeenVisibility
  if (patch.chiffrementActif !== undefined) body.chiffrementActif = patch.chiffrementActif
  if (Object.keys(body).length === 0) return
  await apiRequest<void>("/api/account/privacy", { method: "POST", body })
}
