/**
 * L'ÉTAT D'UN MESSAGE ENVOYÉ NE REDESCEND JAMAIS.
 *
 * 🔴 JUMEAU DE `alanya/lib/features/chat/statut_envoi.dart`. Module PUR, sans
 * import : éprouvé par `scripts/statut-envoi.mjs`.
 */

/** Le rang d'un état : en cours, envoyé et en échec ne disent rien du destinataire. */
export function rangStatut(statut: string | undefined): number {
  switch (statut) {
    case "read":
      return 2
    case "delivered":
      return 1
    default:
      return 0
  }
}

/**
 * L'état à afficher quand la réponse du serveur remplace la bulle provisoire.
 *
 * 🐛 UNE COURSE (signalée sur mobile le 28/09/2026, présente ici aussi). Le
 * serveur prévient le destinataire AVANT d'attendre la notification push de
 * Google, et ne répond à l'expéditeur qu'APRÈS. Un destinataire qui a la
 * conversation ouverte lit : la bulle reçoit « lu »… puis la réponse la
 * remplaçait par une bulle « envoyé », pour toujours.
 */
export function statutFusionne<S extends string>(affiche: S, recu: S): S {
  return rangStatut(recu) >= rangStatut(affiche) ? recu : affiche
}
