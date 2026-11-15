import { apiRequest } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { loadCachedMessages } from "./indexeddb-cache"
import { chiffrerPour, idAppareil, ouvrirSessions } from "./e2ee-service"
import { creerRenvois, type MessageEnCache } from "./e2ee-renvois-coeur.ts"

/**
 * RENVOI PAR L'EXPÉDITEUR (piste B, 15/11/2026) — le branchement réel.
 *
 * Un message chiffré pour mes seuls anciens appareils, qu'aucun n'a relevé,
 * est illisible ici : personne ne l'a chiffré pour ce navigateur. Je le
 * DEMANDE ; le serveur choisit lui-même les messages éligibles et sonne leurs
 * expéditeurs (`e2ee_renvoi`). Un appareil de l'expéditeur retrouve le clair
 * dans SON cache, le rechiffre pour moi et le dépose. La relève ordinaire
 * remplit ensuite la bulle.
 *
 * La logique est dans `e2ee-renvois-coeur.ts`, éprouvée par
 * `scripts/e2ee-renvois-test.mjs`.
 */
const renvois = creerRenvois({
  api: (chemin, options) => apiRequest(chemin, options as Parameters<typeof apiRequest>[1]),
  monAppareil: idAppareil,
  moi: getMyUserId,
  lireMessages: async (convId) => (await loadCachedMessages(convId, 5000)) as MessageEnCache[],
  ouvrirSessions: (userId) => ouvrirSessions(userId),
  chiffrerPour,
  avertir: (texte, erreur) => console.warn(texte, erreur),
})

export const demanderRenvois = renvois.demander
export const servirRenvois = renvois.servir
