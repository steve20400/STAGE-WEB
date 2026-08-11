/**
 * Pourquoi la session s'est fermee, quand ce n'est pas l'utilisateur qui l'a
 * voulu.
 *
 * Conserve dans `sessionStorage` et non `localStorage` : le message doit
 * survivre a la redirection vers l'ecran de connexion — qui remonte toute
 * l'application — mais pas a la fermeture du navigateur. Une explication vieille
 * de trois jours n'explique plus rien.
 *
 * Deux ecrivains, un seul lecteur :
 *
 *  - `auth-provider` quand l'evenement temps reel arrive, navigateur ouvert ;
 *  - `tryRefreshTokens` quand l'onglet etait FERME au moment de l'eviction et
 *    ne l'apprend qu'a sa reouverture — le seul cas que le temps reel ne peut
 *    pas couvrir.
 */
const CLE = "alanya-message-deconnexion"

export const MESSAGE_EVICTION = "Votre compte a été ouvert sur un autre appareil."

export function poseMessageDeconnexion(message: string): void {
  try {
    sessionStorage.setItem(CLE, message)
  } catch {
    // Mode privé ou stockage plein : on perd l'explication, pas la session.
  }
}

/**
 * Lit le message ET l'efface : il ne doit pas reapparaitre au prochain retour
 * sur l'ecran de connexion.
 */
export function consommeMessageDeconnexion(): string | null {
  try {
    const valeur = sessionStorage.getItem(CLE)
    if (valeur) sessionStorage.removeItem(CLE)
    return valeur
  } catch {
    return null
  }
}
