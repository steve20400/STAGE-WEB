import { apiRequest, ApiError } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { estChiffree } from "./e2ee-fil"
import { ecrireSecret, effacerSecret, lireSecret, ouvrirCoffre } from "./coffre-chiffre"
import { deposerBloc, restaurer, type MessageArchive } from "./e2ee-archive"
import {
  ajouterSerrure,
  cleDepuisMatiere,
  creerArchive,
  normaliserCleRecuperation,
  ouvrirArchiveBrute,
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

/** Où la clé maîtresse se range, dans le coffre local chiffré. */
const CLE_COFFRE = "archive.maitresse"

/**
 * Range la clé maîtresse dans le coffre local.
 *
 * 🐛 POURQUOI ELLE NE PEUT PAS RESTER EN MÉMOIRE, constaté le 23/09/2026 :
 * la navigation qui suit la connexion RECHARGE la page. Le module repart à
 * zéro, la clé disparaît, et l'archive se referme aussitôt après s'être
 * ouverte. J'avais écrit ici « elle reste en mémoire, pas sur le disque » —
 * c'était une prudence qui rendait la fonctionnalité inutilisable.
 *
 * ⚠️ CE QUE CELA COÛTE, ET IL FAUT L'ASSUMER. Le coffre local contient déjà
 * les clés privées Signal et le cache en clair : qui l'ouvre lit déjà tout ce
 * que CET appareil a vu. Mais l'archive va plus loin — elle porte l'historique
 * d'AVANT cet appareil. Y ranger la clé élargit donc ce qu'une compromission
 * du navigateur rapporte, de « ce que cet appareil a vu » à « toute
 * l'archive ».
 *
 * ⚠️ CE QUI LE REND ACCEPTABLE : le coffre est chiffré par une clé NON
 * EXTRACTIBLE, et la déconnexion le vide entièrement — la clé maîtresse part
 * avec. L'alternative était de redemander le mot de passe à chaque
 * rechargement de page, c'est-à-dire de ne pas livrer la fonctionnalité.
 */
async function ranger(matiere: ArrayBuffer): Promise<void> {
  try {
    await ouvrirCoffre()
    ecrireSecret(CLE_COFFRE, versB64Local(matiere))
  } catch (e) {
    // Le coffre peut être indisponible : on garde la clé en mémoire pour
    // cette session, et la restauration redemandera au prochain démarrage.
    console.warn("[e2ee] clé d'archive non rangée :", e)
  }
}

/**
 * Relit la clé maîtresse du coffre local.
 *
 * ⚠️ RENDUE NON EXTRACTIBLE. Elle a dû l'être pour être rangée ; elle n'a plus
 * à l'être pour servir. Chaque relecture resserre donc ce qu'on peut en faire.
 */
async function relire(): Promise<CryptoKey | null> {
  try {
    await ouvrirCoffre()
    const b64 = lireSecret<string>(CLE_COFFRE)
    if (!b64) return null
    return await crypto.subtle.importKey(
      "raw",
      depuisB64Local(b64),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    )
  } catch {
    return null
  }
}

function versB64Local(buf: ArrayBuffer): string {
  const o = new Uint8Array(buf)
  let t = ""
  for (let i = 0; i < o.length; i++) t += String.fromCharCode(o[i])
  return btoa(t)
}

function depuisB64Local(b64: string): ArrayBuffer {
  const t = atob(b64)
  const o = new Uint8Array(t.length)
  for (let i = 0; i < t.length; i++) o[i] = t.charCodeAt(i)
  return o.buffer
}

/**
 * La clé maîtresse de cette session — de la mémoire, ou du coffre.
 *
 * ⚠️ TOUT CE QUI A BESOIN DE LA CLÉ PASSE PAR ICI. Lire `maitresse`
 * directement marcherait tant que la page n'a pas été rechargée, et cesserait
 * de marcher ensuite — le défaut se verrait chez l'utilisateur, pas au test.
 */
async function laCle(): Promise<CryptoKey | null> {
  if (maitresse) return maitresse
  maitresse = await relire()
  return maitresse
}
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
  return (await lireCoffre()).serrures
}

/**
 * L'état du coffre : ses serrures, et si l'utilisateur l'a REFUSÉ.
 *
 * ⚠️ « PAS ENCORE ACTIVÉE » ET « REFUSÉE » NE SE CONFONDENT PAS. La première
 * appelle une activation silencieuse à la connexion ; la seconde l'interdit.
 * Les traiter pareil ferait réapparaître la sauvegarde chez quelqu'un qui
 * vient de la supprimer — et il la supprimerait encore, et encore.
 */
export async function lireCoffre(): Promise<{ serrures: Serrure[]; refusee: boolean }> {
  try {
    const r = await apiRequest<{ serrures: Serrure[]; refusee?: boolean }>(
      "/api/e2ee/coffre",
    )
    /*
     * ⚠️ ON NE FILTRE PLUS SUR L'APPAREIL, et c'est délibéré : savoir si CE
     * navigateur possède une clé d'accès demande une vérification de
     * l'utilisateur — Face ID, Windows Hello. On ne va pas la déclencher pour
     * afficher un écran de réglages.
     *
     * L'écran annonce donc combien d'appareils ont posé leur trousseau, ce qui
     * est vrai, plutôt que « posé ici », ce qu'on ne peut pas savoir sans
     * demander.
     */
    return { serrures: r.serrures ?? [], refusee: r.refusee === true }
  } catch {
    /*
     * ⚠️ UN ÉCHEC RÉSEAU VAUT « REFUSÉE », PAS « À ACTIVER ». Dans le doute on
     * ne crée rien : activer une sauvegarde par erreur envoie l'historique sur
     * nos serveurs sans que personne l'ait demandé, et c'est irréversible.
     */
    return { serrures: [], refusee: true }
  }
}

/**
 * Les types de serrure liés à UN APPAREIL.
 *
 * 🔴 UN TROUSSEAU APPARTIENT À UN APPAREIL, pas à une personne. Face ID sur le
 * téléphone et Windows Hello sur le portable sont deux secrets différents, et
 * les deux doivent ouvrir l'archive. Le mot de passe et la clé de récupération,
 * eux, suivent la personne.
 */
const LIEES_A_L_APPAREIL = new Set<TypeSerrure>(["trousseau"])

/**
 * Pose une serrure. `appareil` n'est requis que pour celles qui en dépendent.
 *
 * 🐛 IL NE VIENT PLUS DE `idAppareil()`, ET C'EST UNE CORRECTION. Ce numéro vit
 * dans `localStorage`, que la DÉCONNEXION PURGE : au retour, le navigateur
 * s'en attribuait un nouveau et la serrure posée la veille devenait
 * introuvable — alors que la clé d'accès, elle, marchait toujours.
 *
 * ⚠️ UNE SERRURE SE LIE À CE QUI PEUT L'OUVRIR. Pour le trousseau, c'est
 * l'identifiant de la clé d'accès, qui survit au vidage du navigateur.
 */
async function poserSerrure(serrure: Serrure, appareil = ""): Promise<void> {
  await apiRequest("/api/e2ee/coffre", {
    method: "PUT",
    body: {
      ...serrure,
      appareil: LIEES_A_L_APPAREIL.has(serrure.type) ? appareil : "",
    },
  })
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

  const { maitresse: neuve, matiere, serrures } = await creerArchive(secrets)
  for (const s of serrures) await poserSerrure(s)

  maitresse = neuve
  await ranger(matiere)

  /*
   * 🔴 ON SAUVEGARDE CE QUI EXISTE DÉJÀ, PAS SEULEMENT CE QUI SUIVRA.
   *
   * 🐛 Sans ce rattrapage, activer la sauvegarde aujourd'hui n'aurait protégé
   * que les messages de DEMAIN. Tout l'historique déjà échangé serait resté
   * dans le seul cache local — c'est-à-dire exactement ce qu'on cherche à ne
   * plus perdre. Et personne ne s'en serait aperçu avant de changer
   * d'appareil.
   *
   * ⚠️ LE CACHE LOCAL EST LA SEULE SOURCE POSSIBLE : le serveur ne détient
   * plus ces textes, les enveloppes ayant été acquittées. Ce qui n'est pas
   * dans ce cache est déjà perdu, et aucune activation ne le ramènera.
   */
  await rattraperLExistant()
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
  appareil = "",
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
  await poserSerrure(posee, appareil)
  return { cleRecuperation }
}

/**
 * Verse dans l'archive ce que le cache local contient déjà.
 *
 * ⚠️ PAR LOTS, ET SANS LEVER. Un compte bavard peut avoir des milliers de
 * messages en cache : un bloc unique dépasserait le plafond du serveur, et un
 * échec au milieu ne doit pas annuler ce qui est passé.
 */
async function rattraperLExistant(): Promise<number> {
  try {
    const { loadCachedConversations, loadCachedMessages } = await import(
      "./indexeddb-cache"
    )
    const convs = await loadCachedConversations()
    let n = 0
    for (const conv of convs) {
      if (!estChiffree(conv.id)) continue
      const messages = await loadCachedMessages(conv.id, 5000)
      for (const m of messages) {
        const texte = (m as { content?: string | null }).content
        if (!texte) continue
        archiver({
          id: String(m.id),
          convId: conv.id,
          expediteurId: String((m as { senderId?: string }).senderId ?? ""),
          texte,
          quand: Number((m as { createdAt?: number }).createdAt ?? Date.now()),
        })
        n++
        // Le tampon dépose tout seul au-delà du seuil ; on l'aide à la fin.
      }
    }
    await vider()
    if (n > 0) console.info(`[e2ee] ${n} message(s) déjà connus versés dans l'archive.`)
    return n
  } catch (e) {
    console.warn("[e2ee] rattrapage de l'historique existant incomplet :", e)
    return 0
  }
}

/* ══════════════════ LA SERRURE « TROUSSEAU » ══════════════════ */

/**
 * Pose la serrure du trousseau, en créant une clé d'accès.
 *
 * 🔴 IL FAUT DÉJÀ SAVOIR OUVRIR — comme pour toute serrure ajoutée. On ne pose
 * pas une clé sur une porte qu'on ne sait pas franchir.
 *
 * ⚠️ LA CLÉ D'ACCÈS EST CRÉÉE AVANT D'ÊTRE UTILE. Si l'utilisateur annule la
 * demande de vérification qui suit, une clé d'accès orpheline reste sur son
 * appareil. Ce n'est pas grave — elle ne donne accès à rien — mais il faut le
 * savoir : ce n'est pas une fuite, c'est un résidu.
 */
export async function ajouterTrousseau(
  secretConnu: string,
  typeConnu: TypeSerrure,
): Promise<void> {
  const { capacites, creerTrousseau } = await import("./e2ee-trousseau")

  const dispo = await capacites()
  if (!dispo.disponible) {
    throw new Error("Cet appareil ne sait pas fabriquer cette serrure.")
  }

  const moiId = getMyUserId()
  if (!moiId) throw new Error("Session introuvable.")

  const { secret, identifiant } = await creerTrousseau({ userId: moiId, nom: moiId })
  await ajouterUneSerrure(secretConnu, typeConnu, "trousseau", secret, identifiant)
}

/**
 * Ouvre l'archive par le trousseau de l'appareil.
 *
 * ⚠️ REND `false` SI L'UTILISATEUR ANNULE, sans distinction d'avec un échec.
 * L'écran affiche la même chose dans les deux cas — « ça n'a pas ouvert » —
 * et c'est suffisant : insister sur la différence n'aiderait personne.
 */
export async function ouvrirParTrousseau(): Promise<boolean> {
  const { ouvrirTrousseau } = await import("./e2ee-trousseau")
  const reponse = await ouvrirTrousseau()
  if (!reponse) return false

  /*
   * ⚠️ ON CHERCHE LA SERRURE DE CETTE CLÉ D'ACCÈS, pas « la » serrure trousseau.
   * Plusieurs appareils peuvent en avoir posé une ; celle du téléphone n'ouvre
   * rien depuis le portable, et essayer avec le mauvais secret échouerait sans
   * qu'on sache pourquoi.
   */
  const { serrures } = await lireCoffre()
  const sienne = serrures.find(
    (s) =>
      s.type === "trousseau" &&
      (s as Serrure & { appareil?: string }).appareil === reponse.identifiant,
  )
  if (!sienne) {
    console.info("[e2ee] cette clé d'accès n'a pas de serrure sur ce compte.")
    return false
  }

  return ouvrir("trousseau", reponse.secret, sienne)
}

/* ══════════════════ OUVRIR ══════════════════ */

/**
 * Ouvre l'archive avec un secret, et garde la clé pour la session.
 *
 * ⚠️ LA CLÉ RESTE EN MÉMOIRE, PAS SUR LE DISQUE. La ranger reviendrait à poser
 * une quatrième serrure que l'utilisateur n'a pas choisie, ouverte par le seul
 * fait d'avoir accès au navigateur.
 */
export async function ouvrir(
  type: TypeSerrure,
  secret: string,
  /**
   * ⚠️ LA SERRURE PEUT ÊTRE FOURNIE, et il le faut dès qu'il y en a plusieurs
   * du même type : le trousseau du téléphone et celui du portable portent tous
   * deux `type: "trousseau"`. Sans ce paramètre, on prendrait la première
   * venue et le déchiffrement échouerait sans qu'on sache pourquoi.
   */
  serrureChoisie?: Serrure,
): Promise<boolean> {
  const serrure = serrureChoisie ?? (await lireSerrures()).find((s) => s.type === type)
  if (!serrure) return false

  const propre = type === "recuperation" ? normaliserCleRecuperation(secret) : secret
  try {
    /*
     * ⚠️ LA MATIÈRE D'ABORD, LA CLÉ ENSUITE, ET DANS CET ORDRE. On range les
     * octets pour que l'archive survive au prochain rechargement, puis on
     * réimporte une clé NON extractible pour s'en servir. La forme exportable
     * ne vit que le temps de ces deux lignes.
     */
    const matiere = await ouvrirArchiveBrute(propre, serrure)
    await ranger(matiere)
    maitresse = await cleDepuisMatiere(matiere)
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

/**
 * La sauvegarde est-elle ouverte ?
 *
 * ⚠️ ASYNCHRONE, ET C'EST NÉCESSAIRE : après un rechargement de page, la clé
 * n'est plus en mémoire — elle est dans le coffre, qu'il faut ouvrir pour la
 * lire. Une version synchrone répondrait « non » à chaque premier appel.
 */
export async function estOuverte(): Promise<boolean> {
  return (await laCle()) !== null
}

/** Referme — déconnexion, ou changement de compte. */
export function refermer(): void {
  maitresse = null
  /*
   * ⚠️ ON RETIRE AUSSI LA COPIE DU COFFRE. L'oublier laisserait la clé sur
   * l'appareil après une déconnexion — exactement ce que `oublierCetAppareil`
   * s'emploie à empêcher pour les clés Signal.
   */
  effacerSecret(CLE_COFFRE)
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
  /*
   * ⚠️ SYNCHRONE À DESSEIN : appelée depuis le fil de discussion, à chaque
   * message. On accumule sans savoir encore si la clé est là ; `vider` la
   * demandera. Un tampon rempli sans archive se jette sans dommage.
   */
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
  const cle = await laCle()
  if (!cle || tampon.length === 0) {
    // Pas d'archive : le tampon n'a pas à grossir indéfiniment.
    if (!cle) tampon = []
    return
  }

  const lot = tampon
  tampon = []

  const depose = await deposerBloc(cle, lot)
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
  const cle = await laCle()
  if (!cle) throw new Error("L'archive n'est pas ouverte.")
  return restaurer(cle)
}

/* ══════════════════ LE CHANGEMENT DE MOT DE PASSE ══════════════════ */

/**
 * Ré-enveloppe la serrure « mot de passe » avec le nouveau.
 *
 * 🐛 SANS CECI, CHANGER DE MOT DE PASSE CASSE LA SAUVEGARDE EN SILENCE. La
 * serrure garde l'ANCIEN : la restauration automatique échoue à la connexion
 * suivante, et l'utilisateur découvre au pire moment — en changeant
 * d'appareil — que son historique ne revient pas.
 *
 * ⚠️ RIEN N'EST RECHIFFRÉ : on ré-enveloppe 32 octets. Une archive de cent
 * mégaoctets change de mot de passe en quelques millisecondes.
 *
 * ⚠️ IL FAUT L'ANCIEN MOT DE PASSE, et l'écran de changement l'a — il le
 * demande déjà pour se prouver. C'est la seule occasion : après coup, la
 * serrure ne s'ouvrirait plus.
 *
 * ⚠️ NE LÈVE JAMAIS. Le mot de passe du compte a déjà changé quand on arrive
 * ici ; échouer bruyamment laisserait croire que le changement n'a pas eu
 * lieu. On prévient dans la console, et les autres serrures restent.
 */
export async function suivreChangementMotDePasse(
  ancien: string,
  nouveau: string,
): Promise<boolean> {
  try {
    const serrures = await lireSerrures()
    const ancienne = serrures.find((s) => s.type === "motdepasse")
    if (!ancienne) return false

    const posee = await ajouterSerrure(ancien, ancienne, "motdepasse", nouveau)
    await poserSerrure(posee)
    console.info("[e2ee] la sauvegarde suit le nouveau mot de passe.")
    return true
  } catch (e) {
    console.error(
      "[e2ee] la serrure « mot de passe » n'a PAS suivi le changement — " +
        "la sauvegarde s'ouvre encore avec l'ancien.",
      e,
    )
    return false
  }
}

/* ══════════════════ LA RESTAURATION AUTOMATIQUE ══════════════════ */

/**
 * Rouvre l'archive à la connexion, avec le mot de passe qu'on vient de saisir.
 *
 * 🐛 LE DÉFAUT QUE CECI CORRIGE, SIGNALÉ LE 23/09/2026 : « je me déconnecte,
 * je me reconnecte, et tous les messages sont vides ».
 *
 * Ce n'était PAS un bogue, et c'est ce qui le rendait difficile à voir : trois
 * décisions correctes s'additionnaient.
 *
 *   ① la déconnexion efface le coffre — garder les clés privées après une
 *      déconnexion reviendrait à laisser de quoi lire sur l'appareil ;
 *   ② elle purge le cache local — sans quoi le compte suivant verrait les
 *      messages du précédent ;
 *   ③ les enveloppes sont acquittées, donc le serveur ne les ressert pas.
 *
 * Chacune est juste. Ensemble, elles font disparaître l'historique — et RIEN
 * ne prévenait.
 *
 * 🔴 LE MOT DE PASSE EST DÉJÀ LÀ, ET C'EST TOUT L'INTÉRÊT. L'utilisateur
 * vient de le taper pour se connecter : on ouvre l'archive avec, on restaure,
 * et on l'oublie. Rien à redemander, rien à retenir.
 *
 * ⚠️ IL NE DOIT ÊTRE GARDÉ NULLE PART. Il traverse cette fonction et en sort.
 * Le ranger, même en mémoire pour « plus tard », reviendrait à poser une
 * serrure que personne n'a choisie.
 *
 * ⚠️ NE LÈVE JAMAIS ET NE BLOQUE PAS LA CONNEXION. Pas d'archive, mauvais
 * secret, réseau coupé : on se connecte quand même. Empêcher quelqu'un
 * d'entrer parce qu'une restauration a échoué serait bien pire que l'absence
 * d'historique.
 */
/**
 * À la connexion : restaure si une archive existe, l'active sinon.
 *
 * 🔴 ACTIVÉE PAR DÉFAUT — décision du user, 23/09/2026 : « c'est plus
 * intuitif ». Perdre son historique en changeant d'appareil est un piège que
 * personne ne voit venir ; le défaut doit protéger, pas attendre qu'on sache
 * qu'il faut se protéger.
 *
 * ⚠️ CE QUE LE DÉFAUT COÛTE, ET IL FAUT LE SAVOIR : la seule serrure posable
 * sans rien demander est celle du MOT DE PASSE — celle qui ne protège pas
 * contre nous. Activer par défaut met donc l'historique de tout le monde sur
 * nos serveurs, sous une serrure que nous pourrions ouvrir si nous étions
 * compromis. C'est assumé, c'est écrit dans l'écran, et c'est désactivable.
 *
 * ⚠️ UN REFUS EST DÉFINITIF JUSQU'À NOUVEL ORDRE. Quelqu'un qui supprime sa
 * sauvegarde ne doit pas la retrouver recréée à la connexion suivante.
 *
 * ⚠️ PAS DE CLÉ DE RÉCUPÉRATION À L'ACTIVATION SILENCIEUSE : elle ne vaut que
 * montrée, et personne ne regarde. L'écran des réglages la propose ensuite.
 */
export async function activerOuRestaurerALaConnexion(
  motDePasse: string,
  ranger: (m: MessageArchive) => Promise<void>,
): Promise<number> {
  try {
    const { serrures, refusee } = await lireCoffre()

    if (serrures.length === 0) {
      if (refusee) {
        console.info("[e2ee] sauvegarde refusée sur ce compte — on n'y touche pas.")
        return 0
      }
      await activerSauvegarde({ motDePasse })
      console.info("[e2ee] sauvegarde activée automatiquement.")
      return 0
    }

    return await restaurerALaConnexion(motDePasse, ranger)
  } catch (e) {
    console.error("[e2ee] activation ou restauration à la connexion :", e)
    return 0
  }
}

export async function restaurerALaConnexion(
  motDePasse: string,
  ranger: (m: MessageArchive) => Promise<void>,
): Promise<number> {
  try {
    const serrures = await lireSerrures()
    if (!serrures.some((s) => s.type === "motdepasse")) {
      console.info("[e2ee] pas de sauvegarde par mot de passe sur ce compte.")
      return 0
    }

    if (!(await ouvrir("motdepasse", motDePasse))) {
      /*
       * ⚠️ CE CAS DOIT SE VOIR. Le mot de passe du COMPTE et celui de la
       * SAUVEGARDE peuvent différer — quelqu'un a changé son mot de passe
       * après avoir créé sa sauvegarde, et la serrure porte encore l'ancien.
       * Sans cette ligne, l'historique ne revient pas et rien ne dit pourquoi.
       */
      console.warn(
        "[e2ee] la sauvegarde ne s'ouvre pas avec ce mot de passe — " +
          "il a probablement changé depuis sa création.",
      )
      return 0
    }

    const { messages } = await restaurerTout()
    for (const m of messages) await ranger(m)
    console.info(`[e2ee] ${messages.length} message(s) restauré(s) depuis la sauvegarde.`)
    return messages.length
  } catch (e) {
    /*
     * 🔴 ON JOURNALISE, ON N'AVALE PAS. Un `catch` muet ici transforme un
     * défaut en « l'historique ne revient pas », sans piste — et c'est
     * exactement ce que j'avais écrit au premier jet.
     */
    console.error("[e2ee] restauration à la connexion impossible :", e)
    return 0
  }
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
