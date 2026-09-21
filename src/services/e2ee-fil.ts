import { apiRequest } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { identitesChangees as identitesChangeesInternes } from "./e2ee-store"
import {
  chiffrerPour,
  dechiffrer,
  deposer,
  ouvrirSessions,
  relever,
  acquitter,
  type EnveloppeRecue,
} from "./e2ee-service"

/**
 * LE CHIFFREMENT, BRANCHÉ AU FIL DE DISCUSSION.
 *
 * 🔴 CE FICHIER EST LA SEULE COUTURE entre le fil ordinaire et le chiffrement.
 * `messages-service.ts` ne connaît que deux fonctions d'ici — envoyer, et
 * rapprocher ce qu'on a reçu. Tout le reste du fil ignore que le chiffrement
 * existe, et c'est ce qui permet de ne pas réécrire l'écran.
 *
 * ── L'ORDRE DES DEUX ÉCRITURES, ET POURQUOI IL EST DANS CE SENS ─────────
 *
 * Un message chiffré s'écrit en DEUX temps : la ligne du fil, puis les
 * enveloppes qui portent le texte. On crée donc la ligne D'ABORD, pour en
 * connaître l'identifiant, et on y rattache les enveloppes ensuite.
 *
 * ⚠️ IL EXISTE DONC UN INSTANT où la ligne existe sans son contenu. Si le
 * dépôt des enveloppes échoue, le destinataire voit un message vide. C'est
 * assumé, et c'est le moindre mal : l'inverse — déposer puis créer la ligne —
 * laisserait des enveloppes orphelines qu'aucun fil ne réclamerait jamais, et
 * que personne ne verrait pour les corriger. Un message vide se voit et se
 * renvoie.
 */

/* ══════════════════ SAVOIR SI ÇA CHIFFRE ══════════════════ */

/**
 * Les conversations dont on sait qu'elles sont chiffrées.
 *
 * ⚠️ UN CACHE, PAS UNE VÉRITÉ. Le serveur reste seul juge : ce cache évite un
 * aller-retour par message, rien de plus. Il est alimenté par la liste des
 * conversations, qui porte déjà `e2eeActif`.
 */
const chiffrees = new Map<string, boolean>()

export function noteEtatChiffrement(convId: string, actif: boolean): void {
  chiffrees.set(convId, actif)
}

export function estChiffree(convId: string): boolean {
  return chiffrees.get(convId) === true
}

export interface EtatE2ee {
  e2eeActif: boolean
  activable: boolean
  motif: "HORS_PERIMETRE" | "GROUPE_NON_SUPPORTE" | "CLES_MANQUANTES" | null
  sansCles: string[]
}

export async function lireEtatE2ee(convId: string): Promise<EtatE2ee> {
  const r = await apiRequest<EtatE2ee>(
    `/api/conversations/${encodeURIComponent(convId)}/e2ee`,
    { cache: "no-store" },
  )
  noteEtatChiffrement(convId, r.e2eeActif)
  return r
}

export async function activerE2ee(convId: string): Promise<void> {
  await apiRequest(`/api/conversations/${encodeURIComponent(convId)}/e2ee`, {
    method: "POST",
  })
  noteEtatChiffrement(convId, true)
}

/* ══════════════════ ENVOYER ══════════════════ */

interface MessageCree {
  id: string
  createdAt: string
}

/**
 * Qui est en face, dans une conversation à deux ?
 *
 * ⚠️ L'APPELANT NE LE SAIT PAS. `sendChatMessage` ne reçoit qu'un identifiant
 * de conversation — c'est tout ce dont le fil en clair a besoin, le serveur
 * se chargeant de la distribution. Le chiffrement, lui, doit savoir POUR QUI
 * il chiffre : c'est la différence de fond entre les deux régimes, et elle
 * remonte jusqu'ici.
 */
async function correspondant(convId: string): Promise<string> {
  const moi = getMyUserId()
  const r = await apiRequest<{ members: { id: string }[] }>(
    `/api/conversations/${encodeURIComponent(convId)}/members`,
  )
  const autres = r.members.map((m) => m.id).filter((id) => id !== moi)
  /*
   * ⚠️ EXACTEMENT UN AUTRE, sans quoi on refuse. Zéro, c'est la conversation
   * avec soi-même ; plusieurs, c'est un groupe — et le serveur a déjà refusé
   * de chiffrer l'un comme l'autre. Deviner ici contredirait sa décision.
   */
  if (autres.length !== 1) {
    throw new Error(
      "Le chiffrement ne couvre que les conversations entre deux personnes.",
    )
  }
  return autres[0]
}

/**
 * Envoie un message dans une conversation chiffrée.
 *
 * ⚠️ PAR LA ROUTE REST, ET NON PAR LE WEBSOCKET. Le chemin WebSocket
 * transporte le contenu et le fait suivre ; l'adapter demanderait de toucher
 * `ws-server.mjs`, qui n'a rien à voir avec le chiffrement. Un message chiffré
 * emprunte donc le repli REST, déjà éprouvé. On y perd la remise instantanée —
 * le destinataire recevra à sa prochaine relève — et c'est la dette la plus
 * visible de ce premier jet.
 */
export async function envoyerChiffre(
  convId: string,
  texte: string,
): Promise<MessageCree> {
  const destinataireId = await correspondant(convId)

  /*
   * ⚠️ LES SESSIONS S'OUVRENT À CHAQUE ENVOI, et ce n'est pas un gaspillage :
   * la bibliothèque ne refait pas le travail si la session existe déjà. Le
   * coût est un aller-retour, contre le risque d'ignorer un appareil que le
   * correspondant vient d'ajouter — auquel cas il ne lirait rien, sans que
   * personne ne s'en doute.
   */
  const devices = await ouvrirSessions(destinataireId)
  if (devices.length === 0) {
    throw new Error("Ce correspondant n'a aucun appareil capable de déchiffrer.")
  }

  // 1. La ligne du fil, SANS contenu. Le serveur la refuserait autrement.
  const message = await apiRequest<MessageCree>(
    `/api/conversations/${encodeURIComponent(convId)}/messages`,
    { method: "POST", body: { type: "TEXT", chiffre: true } },
  )

  // 2. Les enveloppes, rattachées à cette ligne.
  const enveloppes = await chiffrerPour(destinataireId, devices, texte)
  await deposer(convId, enveloppes, message.id)

  return message
}

/* ══════════════════ RECEVOIR ══════════════════ */

/**
 * Relève tout ce qui attend cet appareil et rend le clair, par message.
 *
 * 🔴 ON N'ACQUITTE QU'APRÈS DÉCHIFFREMENT RÉUSSI. Acquitter puis échouer
 * perdrait le message DÉFINITIVEMENT : personne d'autre ne le détient, et le
 * serveur ne peut pas le reconstituer.
 *
 * ⚠️ UNE ENVELOPPE ILLISIBLE N'ARRÊTE PAS LES AUTRES. Un déchiffrement qui
 * échoue — session perdue, appareil réinstallé — ne doit pas empêcher de lire
 * les messages qui suivent. On la laisse en attente et on continue.
 */
export async function releverEtDechiffrer(): Promise<Map<string, string>> {
  const parMessage = new Map<string, string>()
  let recues: EnveloppeRecue[] = []
  try {
    recues = await relever()
  } catch {
    // Pas de relève possible : on n'a rien à ajouter, l'écran reste en l'état.
    return parMessage
  }

  const acquittables: string[] = []
  for (const e of recues) {
    try {
      const clair = await dechiffrer(e)
      if (e.messageId) parMessage.set(e.messageId, clair)
      acquittables.push(e.id)
    } catch (err) {
      console.warn(
        `[e2ee] enveloppe ${e.id.slice(0, 8)} illisible — elle N'EST PAS ` +
          "acquittée, on préfère la garder que la perdre.",
        err,
      )
    }
  }
  await acquitter(acquittables).catch(() => undefined)
  return parMessage
}

/* ══════════════════ LA BANNIÈRE ══════════════════ */

/**
 * À partir de quel message le fil est-il chiffré ?
 *
 * 🔴 LES ANCIENS MESSAGES RESTENT LISIBLES, et c'est une décision, pas un
 * oubli : le serveur ne peut pas les chiffrer rétroactivement — il faudrait
 * qu'un client les relise, les chiffre et les repose, ce qui suppose qu'il les
 * ait tous, et que personne n'ait changé d'appareil depuis.
 *
 * ⚠️ IL FAUT DONC LE DIRE. Un fil où la moitié des messages est protégée et
 * l'autre non, sans rien qui marque la frontière, laisse croire que TOUT l'est.
 * La bannière est la seule chose qui empêche ce malentendu.
 */
export interface Frontiere {
  /** L'identifiant du premier message chiffré, ou `null` s'il n'y en a pas. */
  premierChiffre: string | null
}

/**
 * Trouve la frontière dans une liste de messages déjà triée par date.
 *
 * ⚠️ ON SE FIE AU RATTACHEMENT D'ENVELOPPE, PAS À L'ABSENCE DE CONTENU : un
 * message en clair peut légitimement n'avoir aucun texte — un média sans
 * légende. Les confondre placerait la bannière avant la première photo du fil.
 */
export function frontiereChiffrement(
  messages: { id: string; chiffre?: boolean }[],
): Frontiere {
  const premier = messages.find((m) => m.chiffre === true)
  return { premierChiffre: premier?.id ?? null }
}

/* ══════════════════ L'AVERTISSEMENT DE CLÉ ══════════════════ */

export { identitesChangees, oublierAvertissement } from "./e2ee-store"

/**
 * La clé de ce correspondant a-t-elle changé depuis l'ouverture ?
 *
 * 🔴 LE SEUL SIGNAL QUI PUISSE RÉVÉLER UNE INTERPOSITION. Réinstallation ou
 * interception : les deux se ressemblent, et seul l'utilisateur peut trancher
 * — en comparant un code de sécurité hors de ce canal.
 */
export function cleAChange(userId: string): boolean {
  return identitesChangeesInternes().includes(userId)
}
