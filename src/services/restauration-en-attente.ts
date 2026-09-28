/**
 * LE MOT DE PASSE, DE LA CONNEXION À LA PAGE DE RESTAURATION.
 *
 * 🔴 EN MÉMOIRE SEULEMENT, ET UNE SEULE FOIS. Ni `sessionStorage`, ni l'URL, ni
 * l'état de navigation (qui, lui, survit à un rechargement dans l'historique) :
 * le mot de passe traverse cette variable, la page le reprend, elle est vidée.
 *
 * ⚠️ IL S'EFFACE DE LUI-MÊME au bout d'une minute. Si la page n'est jamais
 * affichée — navigation détournée, onglet fermé — le secret ne doit pas rester
 * en mémoire pour la durée de la session.
 *
 * ⚠️ UN RECHARGEMENT LE PERD, et c'est voulu : la page entre alors dans la
 * session sans restaurer. Les réglages permettent de le faire ensuite.
 */

let enAttente: string | null = null
let minuteur: ReturnType<typeof setTimeout> | null = null

export function confierMotDePasse(motDePasse: string): void {
  enAttente = motDePasse
  if (minuteur) clearTimeout(minuteur)
  minuteur = setTimeout(() => {
    enAttente = null
    minuteur = null
  }, 60_000)
}

/**
 * Une restauration attend-elle sa page ? Sans rien consommer.
 *
 * ⚠️ POUR `PublicOnlyRoute` : dès que la session existe, il renvoie vers
 * `/chats` — il pourrait passer avant la navigation de la page de connexion
 * et sauter la restauration.
 */
export function restaurationEnAttente(): boolean {
  return enAttente !== null
}

/** Rend le mot de passe confié, et l'oublie. `null` s'il n'y en a pas. */
export function reprendreMotDePasse(): string | null {
  const m = enAttente
  enAttente = null
  if (minuteur) clearTimeout(minuteur)
  minuteur = null
  return m
}
