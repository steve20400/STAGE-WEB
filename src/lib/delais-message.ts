/**
 * LES DÉLAIS POUR REVENIR SUR UN MESSAGE — décision du user, 07/10/2026.
 *
 *   - MODIFIER : 2 heures après l'envoi ;
 *   - SUPPRIMER POUR TOUT LE MONDE : 24 heures après l'envoi.
 *
 * « Supprimer pour moi » n'a pas de délai : il ne touche que son propre écran.
 *
 * ⚠️ L'ÉCRAN ANTICIPE, LE SERVEUR TRANCHE. Ces fonctions ne servent qu'à ne
 * pas proposer une action que le serveur refuserait — sa règle, sur SON
 * horloge, vit dans `backend-alanya/src/lib/delais-message.mjs`. Mêmes valeurs
 * que le mobile (`lib/core/delais_message.dart`).
 */

export const DELAI_MODIFICATION_MS = 2 * 60 * 60 * 1000
export const DELAI_SUPPRESSION_POUR_TOUS_MS = 24 * 60 * 60 * 1000

/** Les codes que rend le serveur quand le délai est dépassé. */
export const DELAI_MODIFICATION_DEPASSE = "DELAI_MODIFICATION_DEPASSE"
export const DELAI_SUPPRESSION_DEPASSE = "DELAI_SUPPRESSION_DEPASSE"

function age(envoyeLe: Date | undefined, maintenant: number): number {
  const t = envoyeLe?.getTime()
  // Date inconnue : on ne peut pas prouver que le délai est passé.
  return t === undefined || Number.isNaN(t) ? 0 : maintenant - t
}

export function peutEncoreModifier(envoyeLe: Date | undefined, maintenant = Date.now()): boolean {
  return age(envoyeLe, maintenant) <= DELAI_MODIFICATION_MS
}

export function peutEncoreSupprimerPourTous(
  envoyeLe: Date | undefined,
  maintenant = Date.now()
): boolean {
  return age(envoyeLe, maintenant) <= DELAI_SUPPRESSION_POUR_TOUS_MS
}
