import { apiRequest } from "../lib/api-client"
import { getOrCreateWebDeviceId } from "./appareils-service"
import { loadSessionUser, normalizePhoneNumber } from "../data/session-user"

/**
 * Pseudo d'appareil — « qui, dans l'equipe, a envoye ce message ».
 *
 * Ce n'est PAS un nom d'affichage : il n'apparait ni dans les contacts, ni dans
 * le profil, et aucun autre compte ne le voit jamais. Il sert a distinguer les
 * appareils d'un MEME compte, cas d'un numero professionnel partage entre
 * plusieurs agents.
 *
 * Le pseudo appartient au couple (compte, appareil) : changer de compte sur le
 * meme navigateur redemande un pseudo, et c'est voulu — c'est un autre poste de
 * travail du point de vue du compte.
 */

/** Cle de cache, par compte : deux comptes sur ce navigateur ont deux pseudos. */
function clePseudo(): string | null {
  const numero = normalizePhoneNumber(loadSessionUser()?.phone ?? "")
  return numero ? `alanya-pseudo-appareil-${numero}` : null
}

/** Pseudo connu localement, sans aller au reseau. */
export function pseudoEnCache(): string | null {
  const cle = clePseudo()
  if (!cle || typeof window === "undefined") return null
  return window.localStorage.getItem(cle)
}

function mettreEnCache(pseudo: string | null) {
  const cle = clePseudo()
  if (!cle || typeof window === "undefined") return
  if (pseudo) window.localStorage.setItem(cle, pseudo)
  else window.localStorage.removeItem(cle)
}

/**
 * Pseudo enregistre cote serveur pour ce couple (compte, appareil).
 *
 * Renvoie null quand il n'y en a pas — ce n'est pas une erreur, c'est la
 * reponse normale a la premiere connexion d'un compte sur cet appareil, et
 * c'est elle qui declenche la demande.
 */
export async function lirePseudoServeur(): Promise<string | null> {
  try {
    const reponse = await apiRequest<{ nomAgent: string | null }>(
      `/api/appareils/nom-agent?cookiesWebId=${encodeURIComponent(getOrCreateWebDeviceId())}`
    )
    mettreEnCache(reponse.nomAgent)
    return reponse.nomAgent
  } catch {
    // Reseau ou route absente : on ne bloque pas l'entree dans l'application.
    return null
  }
}

/** Enregistre ou remplace le pseudo de cet appareil pour le compte courant. */
export async function enregistrerPseudo(pseudo: string): Promise<string> {
  const propre = pseudo.trim().slice(0, 50)
  const reponse = await apiRequest<{ nomAgent: string | null }>("/api/appareils/nom-agent", {
    method: "POST",
    body: { cookiesWebId: getOrCreateWebDeviceId(), nomAgent: propre },
  })
  const enregistre = reponse.nomAgent ?? propre
  mettreEnCache(enregistre)
  return enregistre
}

/**
 * Faut-il demander un pseudo a cet utilisateur ?
 *
 * Le cache local repond sans reseau dans le cas courant. On n'interroge le
 * serveur que s'il est vide : c'est le cas d'une reconnexion apres nettoyage du
 * navigateur, ou le pseudo existe deja cote serveur et redemander serait
 * agacant.
 */
export async function pseudoManquant(): Promise<boolean> {
  if (pseudoEnCache()) return false
  return (await lirePseudoServeur()) === null
}
