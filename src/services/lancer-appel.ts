import type { NavigateFunction } from "react-router-dom"
import type { CallType } from "./calls-service"
import {
  AppelAbandonne,
  annulerPreparation,
  appelEnPreparation,
  preparerAppelSortant,
  startOutgoingCall,
} from "./call-manager"

/** L'adresse de l'ecran d'appel tant que le serveur n'a pas cree l'appel. */
export const ID_APPEL_EN_PREPARATION = "nouveau"

/**
 * Lance un appel en ouvrant son ecran TOUT DE SUITE, comme WhatsApp
 * (06/11/2026) : avant la conversation, avant la creation de l'appel.
 *
 * L'ecran s'ouvre a l'adresse `/calls/nouveau`, puis cette adresse est
 * REMPLACEE par la vraie des que le serveur repond — le bouton Retour ne
 * ramene donc pas sur un ecran d'appel fantome.
 *
 * [conversation] rend l'identifiant de la conversation qui porte l'appel :
 * souvent un `createPrivateChat`, parfois une valeur deja connue.
 *
 * Rend l'identifiant de l'appel, ou nul si l'utilisateur a raccroche pendant
 * la preparation. En cas d'echec, l'ecran se referme et l'erreur remonte a
 * l'appelant, qui l'affiche comme avant.
 */
export async function lancerAppel(
  navigate: NavigateFunction,
  options: {
    conversation: () => Promise<string>
    type: CallType
    titre: string
    avatarUrl?: string | null
    returnTo: string
  }
): Promise<string | null> {
  const adresse = (id: string) =>
    `/calls/${id}?type=${options.type}&returnTo=${encodeURIComponent(options.returnTo)}`
  const prepare = preparerAppelSortant(options.type, options.titre, options.avatarUrl ?? null)
  if (prepare) navigate(adresse(ID_APPEL_EN_PREPARATION))
  try {
    const convId = await options.conversation()
    // Raccroche pendant la recherche de la conversation : on s'arrete la.
    if (prepare && !appelEnPreparation()) return null
    const callId = await startOutgoingCall(convId, options.type, options.titre)
    navigate(adresse(callId), { replace: prepare })
    return callId
  } catch (err) {
    if (err instanceof AppelAbandonne) return null
    annulerPreparation()
    throw err
  }
}
