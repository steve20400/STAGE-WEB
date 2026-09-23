import { apiRequest, ApiError } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { deposerBloc, restaurer, type MessageArchive } from "./e2ee-archive"
import {
  ajouterSerrure,
  creerArchive,
  normaliserCleRecuperation,
  ouvrirArchive,
  tirerCleRecuperation,
  type Serrure,
  type TypeSerrure,
} from "./e2ee-serrures"

/**
 * LA SAUVEGARDE, VUE DE L'APPLICATION.
 *
 * 🔴 CE FICHIER EST LA SEULE COUTURE entre le fil de discussion et l'archive.
 * `messages-service.ts` n'en connaît qu'une fonction — `archiver` — et ignore
 * tout du reste : serrures, blocs, clé maîtresse.
 *
 * ── POURQUOI UN TAMPON, ET PAS UN DÉPÔT PAR MESSAGE ─────────────────
 *
 * Un bloc par message ferait une requête réseau par message, et un chiffré de
 * 200 octets pour 30 octets de texte — l'en-tête AES-GCM et le JSON pèsent plus
 * que la charge. On accumule donc, et on dépose par lots.
 *
 * ⚠️ MAIS PAS TROP LONGTEMPS. Ce qui est dans le tampon n'est PAS sauvegardé :
 * si le navigateur se ferme, ces messages-là sont perdus pour l'archive. Le
 * seuil est donc bas, et le temps d'attente court.
 */

/* ══════════════════ L'ÉTAT ══════════════════ */

let maitresse: CryptoKey | null = null
let tampon: MessageArchive[] = []
let minuteur: ReturnType<typeof setTimeout> | null = null

/**
 * ⚠️ DIX MESSAGES OU DIX SECONDES, CELUI QUI VIENT D'ABORD.
 *
 * Le second est le plus important : quelqu'un qui échange trois messages puis
 * ferme l'onglet ne doit pas les perdre. Sans le minuteur, ils attendraient le
 * dixième — qui pourrait ne jamais venir.
 */
const LOT = 10
const ATTENTE_MS = 10_000

/**
 * Dépose ce qui attend quand la page s'efface.
 *
 * 🔴 C'EST LE CAS DE PERTE LE PLUS FRÉQUENT, et de loin : on écrit trois
 * messages, on ferme l'onglet. Sans ce garde-fou, ces trois-là n'entrent
 * jamais dans l'archive — et ce sont ceux dont l'absence se remarque le plus,
 * puisque ce sont les derniers.
 *
 * ⚠️ `visibilitychange`, PAS `beforeunload`. Les navigateurs mobiles ne
 * déclenchent PAS `beforeunload` quand on quitte l'application — c'est
 * précisément le moment qu'on veut couvrir. `visibilitychange` part dans les
 * deux cas.
 *
 * ⚠️ CE N'EST PAS UNE GARANTIE. Le navigateur peut être tué avant que la
 * requête parte. C'est pour cela que le tampon reste PETIT : dix messages au
 * plus, dix secondes au plus. On réduit la fenêtre, on ne la ferme pas.
 */
function surEffacement(): void {
  if (typeof document === "undefined") return
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void vider()
  })
}

/** Posé une seule fois, à la première ouverture de l'archive. */
let ecouteurPose = false

/* ══════════════════ LES SERRURES, CÔTÉ RÉSEAU ══════════════════ */

export async function lireSerrures(): Promise<Serrure[]> {
  try {
    const r = await apiRequest<{ serrures: Serrure[] }>("/api/e2ee/coffre")
    return r.serrures ?? []
  } catch {
    return []
  }
}

async function poserSerrure(serrure: Serrure): Promise<void> {
  await apiRequest("/api/e2ee/coffre", { method: "PUT", body: serrure })
}

/** L'archive est-elle en place sur ce compte ? */
export async function sauvegardeActive(): Promise<boolean> {
  return (await lireSerrures()).length > 0
}

/* ══════════════════ METTRE EN PLACE ══════════════════ */

/**
 * Crée l'archive et pose ses premières serrures.
 *
 * ⚠️ LES SERRURES PARTENT AVANT LE PREMIER BLOC, et le serveur l'exige. Un bloc
 * chiffré par une clé maîtresse que rien ne protège encore serait perdu pour
 * toujours si le navigateur se fermait entre les deux.
 *
 * Rend la clé de récupération SI elle a été demandée — c'est la seule fois où
 * elle existe en clair, et l'écran doit la montrer immédiatement.
 */
export async function activerSauvegarde(opts: {
  motDePasse?: string
  avecCleRecuperation?: boolean
}): Promise<{ cleRecuperation: string | null }> {
  const secrets: Partial<Record<TypeSerrure, string>> = {}
  let cleRecuperation: string | null = null

  if (opts.motDePasse) secrets.motdepasse = opts.motDePasse
  if (opts.avecCleRecuperation) {
    cleRecuperation = tirerCleRecuperation()
    secrets.recuperation = cleRecuperation
  }

  if (Object.keys(secrets).length === 0) {
    throw new Error("Il faut au moins une serrure : sans elle, rien ne se rouvre.")
  }

  const { maitresse: neuve, serrures } = await creerArchive(secrets)
  for (const s of serrures) await poserSerrure(s)

  maitresse = neuve
  if (!ecouteurPose) {
    surEffacement()
    ecouteurPose = true
  }
  return { cleRecuperation }
}

/**
 * Ajoute une serrure à une archive existante.
 *
 * 🔴 IL FAUT DÉJÀ SAVOIR OUVRIR. C'est exactement ce que l'utilisateur vit : pour
 * ajouter son mot de passe, il doit fournir un secret qui marche déjà. On ne
 * pose pas une serrure sur une porte qu'on ne sait pas ouvrir.
 *
 * ⚠️ RIEN N'EST RECHIFFRÉ — on ré-enveloppe 32 octets. Une archive de cent
 * mégaoctets gagne une serrure en quelques millisecondes.
 */
export async function ajouterUneSerrure(
  secretConnu: string,
  typeConnu: TypeSerrure,
  nouveauType: TypeSerrure,
  nouveauSecret?: string,
): Promise<{ cleRecuperation: string | null }> {
  const serrures = await lireSerrures()
  const connue = serrures.find((s) => s.type === typeConnu)
  if (!connue) throw new Error("Cette serrure n'existe pas sur ce compte.")

  let secret = nouveauSecret ?? ""
  let cleRecuperation: string | null = null
  if (nouveauType === "recuperation") {
    cleRecuperation = tirerCleRecuperation()
    secret = cleRecuperation
  }
  if (!secret) throw new Error("Aucun secret fourni pour la nouvelle serrure.")

  const posee = await ajouterSerrure(secretConnu, connue, nouveauType, secret)
  await poserSerrure(posee)
  return { cleRecuperation }
}

/* ══════════════════ OUVRIR ══════════════════ */

/**
 * Ouvre l'archive avec un secret, et garde la clé pour la session.
 *
 * ⚠️ LA CLÉ RESTE EN MÉMOIRE, PAS SUR LE DISQUE. La ranger reviendrait à poser
 * une quatrième serrure que l'utilisateur n'a pas choisie, ouverte par le seul
 * fait d'avoir accès au navigateur.
 */
export async function ouvrir(type: TypeSerrure, secret: string): Promise<boolean> {
  const serrures = await lireSerrures()
  const serrure = serrures.find((s) => s.type === type)
  if (!serrure) return false

  const propre = type === "recuperation" ? normaliserCleRecuperation(secret) : secret
  try {
    maitresse = await ouvrirArchive(propre, serrure)
    if (!ecouteurPose) {
      surEffacement()
      ecouteurPose = true
    }
    return true
  } catch {
    /*
     * ⚠️ UN ÉCHEC ICI VEUT DIRE « MAUVAIS SECRET », ET RIEN D'AUTRE. AES-GCM
     * authentifie : il n'y a pas de cas où la clé serait bonne et le
     * déchiffrement échouerait. Chercher une autre cause ferait perdre du temps.
     */
    maitresse = null
    return false
  }
}

/** La sauvegarde est-elle ouverte dans cette session ? */
export function estOuverte(): boolean {
  return maitresse !== null
}

/** Referme — déconnexion, ou changement de compte. */
export function refermer(): void {
  maitresse = null
  tampon = []
  if (minuteur) {
    clearTimeout(minuteur)
    minuteur = null
  }
}

/* ══════════════════ ARCHIVER AU FIL DE L'EAU ══════════════════ */

/**
 * Range un message dans le tampon, et dépose quand il est temps.
 *
 * 🔴 APPELÉE AU MÊME ENDROIT QUE LA MISE EN CACHE, et c'est délibéré : ce qui
 * est affiché à l'utilisateur est ce qui est sauvegardé. Deux chemins distincts
 * finiraient par diverger, et la divergence ne se verrait qu'au moment de
 * restaurer — c'est-à-dire trop tard.
 *
 * ⚠️ NE LÈVE JAMAIS, ET NE BLOQUE RIEN. Un dépôt raté ne doit pas empêcher de
 * lire ni d'envoyer. Au pire, ce lot-là n'est pas sauvegardé.
 *
 * ⚠️ SANS ARCHIVE OUVERTE, ON NE FAIT RIEN — pas même accumuler. Garder du clair
 * en mémoire pour une sauvegarde qui n'existe pas serait le garder pour rien.
 */
export function archiver(message: MessageArchive): void {
  if (!maitresse) return
  if (!message.texte) return

  tampon.push(message)

  if (tampon.length >= LOT) {
    void vider()
    return
  }
  if (!minuteur) {
    minuteur = setTimeout(() => void vider(), ATTENTE_MS)
  }
}

/**
 * Dépose ce qui attend.
 *
 * ⚠️ LE TAMPON EST VIDÉ AVANT L'APPEL RÉSEAU, pas après. Sans cela, un message
 * arrivé pendant le dépôt serait emporté par le `tampon = []` qui suit, et
 * perdu sans que rien ne le signale.
 */
export async function vider(): Promise<void> {
  if (minuteur) {
    clearTimeout(minuteur)
    minuteur = null
  }
  if (!maitresse || tampon.length === 0) return

  const lot = tampon
  tampon = []

  const depose = await deposerBloc(maitresse, lot)
  if (!depose) {
    /*
     * ⚠️ ON REMET LE LOT EN TÊTE, on ne le jette pas. Le réseau revient presque
     * toujours ; jeter perdrait des messages que l'utilisateur croit
     * sauvegardés.
     *
     * ⚠️ EN TÊTE ET NON EN QUEUE : l'ordre chronologique doit tenir, sinon la
     * restauration rendrait un fil dans le désordre.
     */
    tampon = [...lot, ...tampon]
    if (!minuteur) minuteur = setTimeout(() => void vider(), ATTENTE_MS)
  }
}

/* ══════════════════ RESTAURER ══════════════════ */

/**
 * Relit toute l'archive.
 *
 * ⚠️ NE REMPLIT PAS LE CACHE ELLE-MÊME. Elle rend les messages ; c'est
 * l'appelant qui décide quoi en faire — et c'est ce qui permet de montrer un
 * décompte avant d'écrire quoi que ce soit.
 */
export async function restaurerTout(): Promise<{
  messages: MessageArchive[]
  blocsIllisibles: number
}> {
  if (!maitresse) throw new Error("L'archive n'est pas ouverte.")
  return restaurer(maitresse)
}

/* ══════════════════ TOUT EFFACER ══════════════════ */

/**
 * Supprime l'archive du serveur — blocs ET serrures.
 *
 * ⚠️ IRRÉVERSIBLE, ET L'ÉCRAN DOIT LE DIRE AVANT. Personne ne peut reconstituer
 * ce qui part ici, nous pas davantage que l'utilisateur.
 */
export async function toutEffacer(): Promise<void> {
  await apiRequest("/api/e2ee/archive", { method: "DELETE" })
  refermer()
}

/** Le compte est-il hors périmètre pour la sauvegarde ? */
export function estHorsPerimetre(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false
  const charge = e.payload as { error?: { code?: unknown } } | undefined
  return charge?.error?.code === "HORS_PERIMETRE"
}

/** Mon identifiant — sert à ne pas archiver pour quelqu'un d'autre. */
export function moi(): string | null {
  return getMyUserId()
}
