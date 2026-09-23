/**
 * L'ARCHIVE CHIFFRÉE — retrouver son historique sur un nouvel appareil.
 *
 * 🔴 ON SAUVEGARDE LES MESSAGES, PAS LES CLÉS SIGNAL. C'est LA décision de
 * conception de ce chantier, et elle va contre l'intuition.
 *
 * Restaurer la clé d'identité ne rendrait RIEN : le Double Ratchet dérive une
 * clé par message et la détruit après usage. C'est la forward secrecy, et c'est
 * exactement ce qu'on a voulu. Une sauvegarde de clés à la manière de
 * Matrix/Element n'a de sens que parce que leurs sessions Megolm couvrent des
 * centaines de messages ; chez nous, il n'y a rien de tel à sauvegarder.
 *
 * ⚠️ L'ARCHIVE NE RESTAURE DONC PAS L'IDENTITÉ. Le nouvel appareil en publie une
 * neuve, et les correspondants voient « la clé a changé » — ce qui est vrai.
 * L'historique et la capacité à recevoir sont deux choses indépendantes, et
 * c'est ce qui rend l'ensemble robuste.
 *
 * ── CE QUI SORT DE L'APPAREIL ────────────────────────────────────────
 *
 * Des blocs opaques. Le serveur voit leur taille et leur date, jamais leur
 * contenu — il n'a pas la clé maîtresse et ne peut pas l'obtenir (sauf par la
 * serrure « mot de passe », voir `e2ee-serrures.ts`, et c'est écrit là-bas).
 */

import { apiRequest } from "../lib/api-client"

/** Un message, tel qu'il se range dans l'archive. */
export interface MessageArchive {
  id: string
  convId: string
  expediteurId: string
  texte: string
  /** Millisecondes. */
  quand: number
  /**
   * ⚠️ RÉSERVÉ AUX MÉDIAS, VIDE POUR L'INSTANT.
   *
   * Le chiffrement des médias est remis (décision du user, 21/09/2026). Mais le
   * FORMAT doit leur faire place dès maintenant : une archive écrite sans ce
   * champ devrait être entièrement relue et réécrite le jour où ils arrivent —
   * chez chaque utilisateur, avec le risque que cela suppose.
   */
  medias?: { id: string; nom: string; type: string }[]
}

/** Un bloc chiffré, tel qu'il voyage et se range. */
interface BlocChiffre {
  iv: string
  contenu: string
}

/**
 * La version du format.
 *
 * ⚠️ DANS LE BLOC, PAS À CÔTÉ. Une archive se relit des mois plus tard, par une
 * version du client qui n'existe pas encore. Sans numéro à l'intérieur, la
 * première évolution du format obligerait à deviner — et deviner sur des
 * données chiffrées qu'on ne peut pas inspecter avant de les déchiffrer.
 */
const VERSION = 1

interface ContenuBloc {
  v: number
  messages: MessageArchive[]
}

function versB64(buf: ArrayBuffer): string {
  const o = new Uint8Array(buf)
  let s = ""
  const morceau = 0x8000
  for (let i = 0; i < o.length; i += morceau) {
    s += String.fromCharCode(...o.subarray(i, i + morceau))
  }
  return btoa(s)
}

/**
 * ⚠️ REND UN `ArrayBuffer`, PAS UN `Uint8Array`.
 *
 * TypeScript 5.7 a resserré `BufferSource` : un `Uint8Array` y est refusé parce
 * que son `.buffer` pourrait être un `SharedArrayBuffer`, que WebCrypto
 * n'accepte pas. Rendre le tampon lui-même supprime l'ambiguïté à la source,
 * plutôt que de la faire taire par un `as` à chaque appel — un `as` de plus
 * aurait masqué le jour où le type dit quelque chose de vrai.
 */
function depuisB64(b64: string): ArrayBuffer {
  const s = atob(b64)
  const o = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i)
  return o.buffer
}

/* ══════════════════ CHIFFRER / DÉCHIFFRER UN BLOC ══════════════════ */

export async function chiffrerBloc(
  maitresse: CryptoKey,
  messages: MessageArchive[],
): Promise<BlocChiffre> {
  // ⚠️ UN IV NEUF PAR BLOC. Voir `e2ee-serrures.ts` : le réutiliser casse AES-GCM.
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const charge: ContenuBloc = { v: VERSION, messages }
  const contenu = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    maitresse,
    new TextEncoder().encode(JSON.stringify(charge)),
  )
  return { iv: versB64(iv.buffer), contenu: versB64(contenu) }
}

export async function dechiffrerBloc(
  maitresse: CryptoKey,
  bloc: BlocChiffre,
): Promise<MessageArchive[]> {
  const clair = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: depuisB64(bloc.iv) },
    maitresse,
    depuisB64(bloc.contenu),
  )
  const charge = JSON.parse(new TextDecoder().decode(clair)) as ContenuBloc

  /*
   * ⚠️ UNE VERSION INCONNUE NE SE DEVINE PAS. Un client ancien devant une
   * archive plus récente doit s'arrêter là, pas tenter d'en tirer ce qu'il
   * croit comprendre : il rendrait des messages tronqués sans le dire, et
   * l'utilisateur penserait avoir tout récupéré.
   */
  if (charge.v > VERSION) {
    throw new Error(
      `Ce bloc a été écrit par une version plus récente (format ${charge.v}). ` +
        "Mettez l'application à jour avant de restaurer.",
    )
  }
  return charge.messages ?? []
}

/* ══════════════════ DÉPOSER ══════════════════ */

/**
 * Dépose un bloc sur le serveur.
 *
 * 🔴 AU FIL DE L'EAU, PAS AU MOMENT DU DÉPART. C'est le point que tout le monde
 * rate : une sauvegarde qu'on lance « quand on change de téléphone » ne sert
 * qu'à ceux qui en changent tranquillement. Le cas qui compte vraiment, c'est
 * le téléphone tombé dans l'eau — et un téléphone cassé n'exporte rien.
 *
 * ⚠️ NE LÈVE JAMAIS. Un dépôt raté ne doit pas empêcher de lire ses messages.
 * On perd au pire la sauvegarde de ce lot-là, et le suivant rattrapera : les
 * messages restent dans le cache local tant qu'ils n'en sont pas sortis.
 */
export async function deposerBloc(
  maitresse: CryptoKey,
  messages: MessageArchive[],
): Promise<boolean> {
  if (messages.length === 0) return false
  try {
    const bloc = await chiffrerBloc(maitresse, messages)
    await apiRequest("/api/e2ee/archive", {
      method: "POST",
      body: {
        iv: bloc.iv,
        contenu: bloc.contenu,
        /*
         * ⚠️ LE NOMBRE DE MESSAGES EST ANNONCÉ EN CLAIR, et c'est assumé : le
         * serveur doit pouvoir borner une archive sans l'ouvrir. C'est une
         * métadonnée, au même titre que la taille — que le chiffrement ne cache
         * pas davantage.
         */
        nbMessages: messages.length,
      },
    })
    return true
  } catch (e) {
    console.warn("[e2ee] dépôt d'archive impossible — on réessaiera :", e)
    return false
  }
}

/* ══════════════════ RESTAURER ══════════════════ */

/**
 * Relit toute l'archive et rend les messages en clair.
 *
 * ⚠️ UN BLOC ILLISIBLE N'ARRÊTE PAS LES AUTRES. Un bloc corrompu, ou écrit par
 * une version plus récente, ne doit pas faire perdre les cinq années qui le
 * précèdent. On le signale, on continue, et on dit à la fin combien ont échoué —
 * une restauration silencieusement partielle serait pire qu'un échec net.
 */
export async function restaurer(
  maitresse: CryptoKey,
): Promise<{ messages: MessageArchive[]; blocsIllisibles: number }> {
  const reponse = await apiRequest<{ blocs: BlocChiffre[] }>("/api/e2ee/archive")
  const blocs = reponse.blocs ?? []

  const messages: MessageArchive[] = []
  let blocsIllisibles = 0

  for (const bloc of blocs) {
    try {
      messages.push(...(await dechiffrerBloc(maitresse, bloc)))
    } catch (e) {
      blocsIllisibles++
      console.warn("[e2ee] bloc d'archive illisible :", e)
    }
  }

  /*
   * ⚠️ DÉDOUBLONNÉ PAR IDENTIFIANT. Les blocs se recouvrent forcément : un
   * message peut être déposé deux fois si le premier dépôt a échoué après
   * l'écriture mais avant la confirmation. Sans ce passage, l'utilisateur
   * verrait des messages en double après restauration.
   */
  const parId = new Map<string, MessageArchive>()
  for (const m of messages) parId.set(m.id, m)

  return {
    messages: [...parId.values()].sort((a, b) => a.quand - b.quand),
    blocsIllisibles,
  }
}
