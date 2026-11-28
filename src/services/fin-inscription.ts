/**
 * LA FIN DE L'INSCRIPTION EST EN COURS (28/11/2026).
 *
 * 🐛 LE CODE DE RÉCUPÉRATION NE S'AFFICHAIT JAMAIS. Créer le compte connecte
 * aussitôt : le garde des pages publiques (`PublicOnlyRoute`) voyait alors un
 * utilisateur connecté sur la page d'inscription et l'envoyait vers la
 * restauration — l'écran de fin, avec l'Alanya ID et le code, disparaissait
 * avant d'avoir été vu (signalé par le user).
 *
 * La page d'inscription l'allume avant de créer le compte ; « Continuer »
 * l'éteint. Tant qu'il est allumé, le garde laisse la page finir.
 */
let enCours = false

export function commencerFinInscription(): void {
  enCours = true
}

export function terminerFinInscription(): void {
  enCours = false
}

export function finInscriptionEnCours(): boolean {
  return enCours
}
