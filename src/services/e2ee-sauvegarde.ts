import { apiRequest, ApiError } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { estChiffree } from "./e2ee-fil"
import { ecrireSecret, effacerSecret, lireSecret, ouvrirCoffre } from "./coffre-chiffre"
import { deposerBloc, restaurer, type MessageArchive } from "./e2ee-archive"
import type { SuiviRestauration } from "../lib/restauration-progression"
import {
  ajouterSerrure,
  cleDepuisMatiere,
  creerArchive,
  normaliserCleRecuperation,
  ouvrirArchiveBrute,
  serrureDepuisMatiere,
  tirerCleRecuperation,
  type Serrure,
  type TypeSerrure,
} from "./e2ee-serrures"
import { deballerCle, emballerCle, genererPaireCompte, type ContexteEmballage } from "./e2ee-groupe"
import { getOrCreateWebDeviceId } from "./appareils-service"
import { sendSignalSauvegarde } from "./websocket-service"

/**
 * 🔴 LA CLÉ DU COMPTE DÈS QUE LA CLÉ MAÎTRESSE EST LÀ (groupes v2, 13/11/2026)
 * — jumeau de `restauration_screen.dart` sur le mobile.
 *
 * 🐛 Elle n'était tirée qu'à l'ouverture d'un groupe chiffré. Un compte neuf
 * ajouté à un groupe avant d'en avoir ouvert un n'avait donc aucune clé
 * publique sur le serveur : personne ne pouvait lui emballer la clé du groupe,
 * et il ne lisait rien tant qu'un membre ne revenait pas en ligne.
 *
 * Import dynamique : `e2ee-compte` importe ce module. En fond, ne lève jamais.
 */
function cleCompteDesMaintenant(): void {
  void import("./e2ee-compte")
    .then((m) => m.assurerCleCompte())
    .catch((err) => console.warn("[e2ee] clé de compte non créée :", err))
}

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

/**
 * La matière brute de la clé maîtresse, telle que le coffre la garde — pour
 * REFAIRE une serrure (27/11/2026). `null` si le coffre ne l'a pas.
 *
 * ⚠️ RIEN D'AUTRE NE DOIT S'EN SERVIR. L'usage courant passe par `laCle()`,
 * qui rend une clé non extractible.
 */
async function lireMatiere(): Promise<ArrayBuffer | null> {
  try {
    await ouvrirCoffre()
    const b64 = lireSecret<string>(CLE_COFFRE)
    return b64 ? depuisB64Local(b64) : null
  } catch {
    return null
  }
}

/* ══════════════════ LE BLOC DE CONTRÔLE (27/11/2026) ══════════════════ */

/*
 * 🔴 UNE CLÉ SE PROUVE AVANT DE SERVIR. Un texte connu, chiffré par la clé
 * maîtresse, vit sur le serveur : un appareil vérifie ainsi que la clé qu'il
 * tient — ou qu'on vient de lui transmettre — est LA bonne, avant de refaire
 * une serrure avec elle. Une clé restée d'une sauvegarde supprimée puis
 * recréée ailleurs fermerait sinon la sauvegarde pour de bon.
 *
 * ⚠️ MÊME FORME QUE LES COPIES DE TROUSSEAU : base64( 0x01 | nonce 12 |
 * AES-256-GCM ). Le jumeau mobile le fabrique avec `chiffrerCopie`.
 */
const TEXTE_CONTROLE = "alanya-controle-archive-v1"

function aadControle(compte: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`alanya.e2ee.controle\n${compte}`) as Uint8Array<ArrayBuffer>
}

async function dechiffrerAvec(
  matiere: ArrayBuffer,
  corps: string,
  aad: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const brut = new Uint8Array(depuisB64Local(corps))
  if (brut.length < 1 + 12 + 16 || brut[0] !== 0x01) throw new Error("bloc mal formé")
  const clair = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: brut.slice(1, 13), additionalData: aad },
    await cleDepuisMatiere(matiere),
    brut.slice(13),
  )
  return new TextDecoder().decode(clair)
}

/** Fabrique le bloc de contrôle de [matiere] pour le compte [compte]. */
export async function creerControle(matiere: ArrayBuffer, compte: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const chiffre = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aadControle(compte) },
      await cleDepuisMatiere(matiere),
      new TextEncoder().encode(TEXTE_CONTROLE),
    ),
  )
  const tout = new Uint8Array(1 + nonce.length + chiffre.length)
  tout[0] = 0x01
  tout.set(nonce, 1)
  tout.set(chiffre, 1 + nonce.length)
  return versB64Local(tout.buffer)
}

/** [matiere] ouvre-t-elle le bloc de contrôle ? Faux en cas de doute. */
export async function controleValide(matiere: ArrayBuffer, controle: string, compte: string): Promise<boolean> {
  try {
    return (await dechiffrerAvec(matiere, controle, aadControle(compte))) === TEXTE_CONTROLE
  } catch {
    return false
  }
}

/** Le coffre tel que le serveur le rend, avec les dates et le bloc de contrôle. */
interface EtatCoffre {
  serrures: Serrure[]
  refusee: boolean
  /** `undefined` : serveur d'avant cette date. */
  motDePasseChangeLe: string | null | undefined
  /** `undefined` : serveur d'avant le bloc ; `null` : pas encore posé. */
  controle: string | null | undefined
}

/** Lève sur une panne réseau — à l'appelant de décider. */
async function lireCoffreComplet(): Promise<EtatCoffre> {
  const r = await apiRequest<{
    serrures?: Serrure[]
    refusee?: boolean
    motDePasseChangeLe?: string | null
    controle?: string | null
  }>("/api/e2ee/coffre", { cache: "no-store" })
  return {
    serrures: r.serrures ?? [],
    refusee: r.refusee === true,
    motDePasseChangeLe: r.motDePasseChangeLe,
    controle: r.controle,
  }
}

/** Dépose le bloc de contrôle — une fois prouvée la clé. Ne lève jamais. */
async function deposerControle(matiere: ArrayBuffer): Promise<boolean> {
  const compte = moi()
  if (!compte) return false
  try {
    await apiRequest("/api/e2ee/controle", {
      method: "PUT",
      body: { controle: await creerControle(matiere, compte) },
    })
    return true
  } catch {
    return false
  }
}

/**
 * La clé de cet appareil, PROUVÉE — ou `null`.
 *
 * Par le bloc de contrôle s'il existe. Sinon par la copie de la clé de compte,
 * chiffrée par la même clé maîtresse : l'ouvrir prouve la clé, et l'on dépose
 * alors le bloc pour les suivants. Sans l'un ni l'autre, rien ne prouve la clé.
 */
async function matiereProuvee(controle: string | null | undefined): Promise<ArrayBuffer | null> {
  const matiere = await lireMatiere()
  const compte = moi()
  if (!matiere || !compte) return null
  if (typeof controle === "string") return (await controleValide(matiere, controle, compte)) ? matiere : null
  try {
    const r = await apiRequest<{ cle: { version: number; priveeChiffree: string } | null }>(
      "/api/e2ee/compte",
      { cache: "no-store" },
    )
    if (!r.cle) return null
    const aad = new TextEncoder().encode(
      `alanya-compte-v1\n${compte}\n${r.cle.version}`,
    ) as Uint8Array<ArrayBuffer>
    await dechiffrerAvec(matiere, r.cle.priveeChiffree, aad)
  } catch {
    return null
  }
  if (controle === null) await deposerControle(matiere)
  return matiere
}

/**
 * La serrure « mot de passe » refuse-t-elle [motDePasse] ? Alors elle est
 * périmée : on la refait avec la clé de cet appareil. Ne lève jamais ; rend
 * vrai si elle a été refaite.
 */
async function reparerSerrureSiPerimee(
  motDePasse: string,
  serrure: Serrure,
  /**
   * Le serveur la dit antérieure au dernier changement : même si elle s'ouvre,
   * on la repose (sel neuf, date neuve), sans quoi la question reviendrait à
   * chaque connexion.
   */
  refaireSiOuvre = false,
): Promise<boolean> {
  try {
    await ouvrirArchiveBrute(motDePasse, serrure)
    if (refaireSiOuvre) await relierAuMotDePasse(motDePasse)
    marquerEprouvee()
    return false // Elle s'ouvre : rien à réparer.
  } catch {
    // Elle refuse ce mot de passe : périmée.
  }
  try {
    const matiere = await lireMatiere()
    if (!matiere) return false
    await poserSerrure(await serrureDepuisMatiere("motdepasse", motDePasse, matiere))
    marquerEprouvee()
    console.info("[e2ee] serrure « mot de passe » périmée, refaite.")
    return true
  } catch (e) {
    console.warn("[e2ee] serrure périmée, réparation impossible :", e)
    return false
  }
}

/**
 * Relie l'archive ouverte au mot de passe [motDePasse] — déjà vérifié par
 * l'appelant — en refaisant sa serrure, même si une autre existe.
 *
 * 🔴 APRÈS UNE OUVERTURE PAR LES 12 MOTS (27/11/2026) : la serrure « mot de
 * passe » qui existe est justement celle qui n'a pas ouvert. La garder ferait
 * redemander les 12 mots sur chaque nouvel appareil.
 */
export async function relierAuMotDePasse(motDePasse: string): Promise<boolean> {
  if (!motDePasse) return false
  try {
    // ⚠️ La clé se prouve d'abord (bloc de contrôle) : la poser fausse
    // fermerait la sauvegarde aux autres appareils.
    let controle: string | null | undefined
    try {
      controle = (await lireCoffreComplet()).controle
    } catch {
      controle = undefined
    }
    const matiere = typeof controle === "string" ? await matiereProuvee(controle) : await lireMatiere()
    if (!matiere) return false
    await poserSerrure(await serrureDepuisMatiere("motdepasse", motDePasse, matiere))
    return true
  } catch (e) {
    console.warn("[e2ee] sauvegarde non reliée au mot de passe :", e)
    return false
  }
}

/**
 * Faut-il éprouver la serrure « mot de passe » ? (27/11/2026)
 *
 * 🔴 SEULEMENT SI ELLE EST PLUS ANCIENNE QUE LE DERNIER CHANGEMENT. L'éprouver
 * coûte un Argon2id — une à deux secondes, et de la mémoire, sur le fil
 * principal du navigateur. Le faire à chaque connexion figeait un téléphone
 * modeste pour rien.
 *
 * `changeLe` : `undefined` — serveur d'avant cette date, on éprouve comme
 * avant ; `null` — mot de passe jamais changé depuis, rien à éprouver.
 */
function aEprouver(serrure: Serrure, changeLe: string | null | undefined): boolean {
  if (changeLe === undefined) return true
  if (perimeeSelonDates(serrure, changeLe)) return true
  /*
   * ⚠️ DATE VIDE : mot de passe jamais changé depuis l'ajout de la colonne.
   * Une serrure posée AVANT a pu se périmer sans laisser de trace : on
   * l'éprouve UNE fois sur cet appareil, en silence.
   */
  return changeLe === null && !eprouveeIci()
}

/** La serrure est-elle plus ancienne que le dernier changement de mot de passe ? */
function perimeeSelonDates(serrure: Serrure, changeLe: string | null | undefined): boolean {
  if (typeof changeLe !== "string") return false
  const posee = serrure.updatedAt ? Date.parse(serrure.updatedAt) : NaN
  const change = Date.parse(changeLe)
  if (Number.isNaN(change)) return false
  return Number.isNaN(posee) || posee < change
}

const cleEprouvee = (compte: string) => `alanya-serrure-eprouvee-${compte}`

function eprouveeIci(): boolean {
  const compte = moi()
  if (!compte) return false
  try {
    return localStorage.getItem(cleEprouvee(compte)) === "1"
  } catch {
    return false
  }
}

function marquerEprouvee(): void {
  const compte = moi()
  if (!compte) return
  try {
    localStorage.setItem(cleEprouvee(compte), "1")
  } catch {
    // stockage indisponible : on éprouvera de nouveau, sans gravité.
  }
}

/**
 * Réessaie [travail] sur une erreur passagère : la plupart des échecs à faire
 * suivre la serrure sont des coupures réseau, et le nouveau mot de passe n'est
 * connu que maintenant.
 */
async function avecReessais<T>(travail: () => Promise<T>, attentes = [1500, 4000]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await travail()
    } catch (e) {
      if (i >= attentes.length) throw e
      await new Promise((r) => setTimeout(r, attentes[i]))
    }
  }
}

/** Une archive existe-t-elle pour ce compte ? Faux en cas de doute. */
export async function aUneArchive(): Promise<boolean> {
  try {
    return (await lireSerrures()).length > 0
  } catch {
    return false
  }
}

/** L'archive a-t-elle une clé de récupération ? Faux en cas de doute. */
export async function aUneCleDeRecuperation(): Promise<boolean> {
  try {
    return (await lireSerrures()).some((s) => s.type === "recuperation")
  } catch {
    return false
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
/**
 * Chiffre un clair avec la clé maîtresse de l'archive — pour la copie
 * personnelle du trousseau d'un groupe (lot 6, chapitre 35).
 *
 * Forme : base64( 0x01 | nonce 12 | AES-256-GCM(clair, `aad`) ). Le jumeau
 * mobile (`e2ee_trousseau_perso.dart`) écrit et lit exactement la même.
 *
 * Rend `null` si l'archive n'est pas ouverte sur cet appareil : rien à faire,
 * la copie sera déposée par un appareil qui l'a.
 */
export async function chiffrerPourArchive(clair: string, aad: Uint8Array): Promise<string | null> {
  const cle = await laCle()
  if (!cle) return null
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const chiffre = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad as Uint8Array<ArrayBuffer> },
      cle,
      new TextEncoder().encode(clair),
    ),
  )
  const tout = new Uint8Array(1 + nonce.length + chiffre.length)
  tout[0] = 0x01
  tout.set(nonce, 1)
  tout.set(chiffre, 1 + nonce.length)
  return versB64Local(tout.buffer)
}

/**
 * L'inverse. `null` si l'archive n'est pas ouverte ; LÈVE si le chiffré est
 * altéré ou d'une autre archive (GCM refuse).
 */
export async function dechiffrerDepuisArchive(corps: string, aad: Uint8Array): Promise<string | null> {
  const cle = await laCle()
  if (!cle) return null
  const brut = new Uint8Array(depuisB64Local(corps))
  if (brut.length < 1 + 12 + 16 || brut[0] !== 0x01) throw new Error("copie de trousseau mal formée")
  const clair = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: brut.slice(1, 13), additionalData: aad as Uint8Array<ArrayBuffer> },
    cle,
    brut.slice(13),
  )
  return new TextDecoder().decode(clair)
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
  cleCompteDesMaintenant()
  // La clé vient d'être tirée : c'est la bonne par définition (27/11/2026).
  void deposerControle(matiere)

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
    cleCompteDesMaintenant()
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
  // Un média sans légende s'archive aussi : c'est sa clé qui compte.
  if (!message.texte && !message.media) return

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
    const serrures = await avecReessais(lireSerrures)
    const ancienne = serrures.find((s) => s.type === "motdepasse")
    if (!ancienne) {
      /*
       * ⚠️ PAS DE SERRURE « MOT DE PASSE » (27/11/2026) : si cette archive
       * est ouverte ici, on la pose avec le nouveau — comme le fait déjà la
       * connexion sur le téléphone. Sinon il n'y a rien à faire suivre.
       */
      const matiere = await lireMatiere()
      if (!matiere || serrures.length === 0) return false
      await avecReessais(async () =>
        poserSerrure(await serrureDepuisMatiere("motdepasse", nouveau, matiere)),
      )
      return true
    }

    /*
     * ⚠️ SI L'ANCIEN N'OUVRE PLUS (27/11/2026) — la serrure était déjà
     * périmée —, la clé que cet appareil garde suffit à la refaire.
     */
    let posee: Serrure
    try {
      posee = await ajouterSerrure(ancien, ancienne, "motdepasse", nouveau)
    } catch {
      const matiere = await lireMatiere()
      if (!matiere) throw new Error("ni l'ancien mot de passe ni la clé de l'appareil")
      posee = await serrureDepuisMatiere("motdepasse", nouveau, matiere)
    }
    await avecReessais(() => poserSerrure(posee))
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

/* ══════════════════ COUCHE A : LA SERRURE AVEC LE MOT DE PASSE ══════════════════ */

/**
 * Fabrique, AVANT le changement de mot de passe, la serrure du nouveau
 * (27/11/2026). Elle part dans la même requête que lui et le serveur écrit les
 * deux ensemble : une coupure ne peut plus les séparer.
 *
 * La clé vient de l'ancienne serrure ouverte par l'ancien mot de passe — ce
 * qui la prouve — ou, si celle-ci est déjà périmée, de cet appareil, prouvée
 * par le bloc de contrôle. `null` : rien à joindre (pas de sauvegarde, ou
 * aucune clé sûre ici) ; le changement se fait sans, et la couche B prendra
 * le relais.
 */
export async function preparerSerrureMotDePasse(
  ancien: string,
  nouveau: string,
): Promise<Serrure | null> {
  try {
    const etat = await lireCoffreComplet()
    if (etat.serrures.length === 0) return null
    const ancienne = etat.serrures.find((s) => s.type === "motdepasse")
    if (ancienne) {
      try {
        const m = await ouvrirArchiveBrute(ancien, ancienne)
        return await serrureDepuisMatiere("motdepasse", nouveau, m)
      } catch {
        // Périmée : on passe à la clé de cet appareil.
      }
    }
    const m = await matiereProuvee(etat.controle)
    return m ? await serrureDepuisMatiere("motdepasse", nouveau, m) : null
  } catch {
    return null
  }
}

/* ══════════════════ COUCHE B : LA SERRURE PÉRIMÉE ══════════════════ */

/**
 * Cet appareil a-t-il la clé, alors que la serrure « mot de passe » ne suit
 * plus le mot de passe du compte ? (27/11/2026) Les autres appareils trouvent
 * alors la sauvegarde fermée : celui-ci peut la réparer, s'il connaît le mot
 * de passe actuel — d'où le bandeau qui le demande. Faux en cas de doute.
 */
export async function serrureMotDePassePerimee(): Promise<boolean> {
  if (!(await laCle())) return false
  let etat: EtatCoffre
  try {
    etat = await lireCoffreComplet()
  } catch {
    return false
  }
  if (etat.serrures.length === 0) return false
  if (!(await matiereProuvee(etat.controle))) return false
  const s = etat.serrures.find((x) => x.type === "motdepasse")
  return !s || perimeeSelonDates(s, etat.motDePasseChangeLe)
}

/* ══════════════════ COUCHE C : LA CLÉ PASSE D'UN APPAREIL À L'AUTRE ══════════════════ */

/*
 * 🔴 LE CAS QUE TOUT CELA RÈGLE (27/11/2026) : le mot de passe a changé, la
 * serrure n'a pas suivi, et l'on se connecte sur un NOUVEL appareil — la
 * sauvegarde y reste fermée. Un appareil déjà connecté, lui, a la clé.
 *
 * Le nouvel appareil tire une paire éphémère et dépose la publique ; l'autre
 * lui scelle la clé maîtresse (le format des emballages de groupe, éprouvé et
 * jumeau du mobile) ; le nouvel appareil la vérifie par le bloc de contrôle,
 * la range, et refait la serrure avec le mot de passe qu'il vient de taper.
 *
 * ⚠️ LE SERVEUR NE VOIT QUE DES CLÉS PUBLIQUES ET DU CHIFFRÉ. L'accord est
 * automatique quand le demandeur a prouvé le mot de passe actuel (il ouvrirait
 * de toute façon la serrure réparée) ; il est demandé à l'utilisateur après un
 * « mot de passe oublié ».
 */

/** Où la demande en cours attend, dans le coffre local : sa clé privée y est. */
const CLE_DEMANDE = "archive.demande"

interface DemandeLocale {
  id: string
  priv: string
  expireLe: string
}

function contexteDemande(id: string, compte: string): ContexteEmballage {
  return { convId: id, destinataireId: compte, version: 1, versionCompte: 1 }
}

function versB64Octets(o: Uint8Array): string {
  return versB64Local(o.slice().buffer)
}

/** « Chrome · Windows » : ce que l'autre appareil montre de celui-ci. */
function decrireNavigateur(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  const nav = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Web"
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : ""
  return os ? `${nav} · ${os}` : nav
}

function lireDemandeLocale(): DemandeLocale | null {
  try {
    const d = lireSecret<DemandeLocale>(CLE_DEMANDE)
    return d && typeof d.id === "string" && typeof d.priv === "string" ? d : null
  } catch {
    return null
  }
}

function oublierDemandeLocale(): void {
  try {
    effacerSecret(CLE_DEMANDE)
  } catch {
    // coffre indisponible : la demande expirera d'elle-même.
  }
}

/**
 * Demande la clé aux autres appareils du compte. [motDePasse] : celui qu'on
 * vient de taper, vérifié par le serveur — c'est ce qui rend l'accord
 * automatique possible. Rend l'identifiant de la demande, ou `null`.
 */
export async function demanderCleAuxAppareils(motDePasse?: string): Promise<string | null> {
  try {
    const paire = await genererPaireCompte()
    const r = await apiRequest<{ id: string; expireLe: string }>("/api/e2ee/demandes-cle", {
      method: "POST",
      body: {
        appareil: getOrCreateWebDeviceId(),
        libelle: decrireNavigateur(),
        clePublique: versB64Octets(paire.pub),
        ...(motDePasse ? { motDePasse } : {}),
      },
    })
    await ouvrirCoffre()
    ecrireSecret(CLE_DEMANDE, { id: r.id, priv: versB64Octets(paire.priv), expireLe: r.expireLe })
    sendSignalSauvegarde("demande_cle", r.id)
    return r.id
  } catch (e) {
    console.warn("[e2ee] demande de clé impossible :", e)
    return null
  }
}

/** Une demande de ce navigateur attend-elle encore ? */
export async function demandeCleEnAttente(): Promise<boolean> {
  try {
    await ouvrirCoffre()
  } catch {
    return false
  }
  const d = lireDemandeLocale()
  return d !== null && Date.parse(d.expireLe) > Date.now()
}

export type IssueDemande = "aucune" | "attente" | "recue" | "refusee" | "expiree" | "rejetee"

/**
 * Relit la demande de ce navigateur. `recue` : la clé est là, vérifiée et
 * rangée — la sauvegarde est ouverte. [motDePasse] : s'il est connu, la
 * serrure est refaite avec lui aussitôt (la couche B le fera sinon).
 *
 * `rejetee` : la clé reçue ne passe pas le bloc de contrôle. On ne s'en sert
 * pas — une clé fausse, rangée puis posée, fermerait la sauvegarde pour tous.
 */
export async function relireDemandeCle(motDePasse?: string): Promise<IssueDemande> {
  try {
    await ouvrirCoffre()
  } catch {
    return "aucune"
  }
  const locale = lireDemandeLocale()
  if (!locale) return "aucune"
  const compte = moi()
  if (!compte) return "attente"

  let r: { etat: string; enveloppe?: string }
  try {
    r = await apiRequest<{ etat: string; enveloppe?: string }>(
      `/api/e2ee/demandes-cle/${encodeURIComponent(locale.id)}`,
      { cache: "no-store" },
    )
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      oublierDemandeLocale()
      return "aucune"
    }
    return "attente"
  }
  if (r.etat === "ouverte") return "attente"

  if (r.etat === "servie" && r.enveloppe) {
    let matiere: ArrayBuffer
    try {
      const brut = await deballerCle(
        r.enveloppe,
        new Uint8Array(depuisB64Local(locale.priv)),
        contexteDemande(locale.id, compte),
      )
      matiere = brut.slice().buffer
    } catch {
      oublierDemandeLocale()
      return "rejetee"
    }
    let controle: string | null | undefined
    try {
      controle = (await lireCoffreComplet()).controle
    } catch {
      controle = undefined
    }
    // L'appareil qui sert dépose le bloc avant de servir : sans lui, refus.
    if (typeof controle !== "string" || !(await controleValide(matiere, controle, compte))) {
      oublierDemandeLocale()
      return "rejetee"
    }
    await ranger(matiere)
    maitresse = await cleDepuisMatiere(matiere)
    cleCompteDesMaintenant()
    if (!ecouteurPose) {
      surEffacement()
      ecouteurPose = true
    }
    oublierDemandeLocale()
    if (motDePasse) void relierAuMotDePasse(motDePasse)
    return "recue"
  }

  oublierDemandeLocale()
  if (r.etat === "refusee") return "refusee"
  // `livree` : relue par un autre onglet, qui a rangé la clé dans le coffre commun.
  if (r.etat === "livree" && (await laCle())) return "recue"
  return "expiree"
}

/** Une demande d'un AUTRE appareil du compte, vue par celui qui a la clé. */
export interface DemandeCle {
  id: string
  appareil: string
  libelle: string
  clePublique: string
  creeLe: string
  /** La clé peut partir sans rien demander (voir le serveur). */
  auto: boolean
}

/** Les demandes ouvertes des autres appareils — seulement si la clé est ici. */
export async function demandesCleOuvertes(): Promise<DemandeCle[]> {
  if (!(await laCle())) return []
  try {
    const r = await apiRequest<{ demandes?: DemandeCle[] }>(
      `/api/e2ee/demandes-cle?appareil=${encodeURIComponent(getOrCreateWebDeviceId())}`,
      { cache: "no-store" },
    )
    return r.demandes ?? []
  } catch {
    return []
  }
}

/**
 * Scelle la clé maîtresse pour l'appareil qui la demande.
 *
 * ⚠️ SEULEMENT UNE CLÉ PROUVÉE (bloc de contrôle, ou copie de la clé de
 * compte — le bloc est alors posé). Transmettre une clé fausse ferait plus de
 * mal que de ne rien transmettre.
 */
export async function servirDemandeCle(d: DemandeCle): Promise<boolean> {
  const compte = moi()
  if (!compte) return false
  let etat: EtatCoffre
  try {
    etat = await lireCoffreComplet()
  } catch {
    return false
  }
  const matiere = await matiereProuvee(etat.controle)
  if (!matiere) return false
  try {
    const enveloppe = await emballerCle(
      new Uint8Array(matiere),
      new Uint8Array(depuisB64Local(d.clePublique)),
      contexteDemande(d.id, compte),
    )
    await apiRequest(`/api/e2ee/demandes-cle/${encodeURIComponent(d.id)}/reponse`, {
      method: "POST",
      body: { enveloppe },
    })
    sendSignalSauvegarde("demande_cle_traitee", d.id)
    return true
  } catch (e) {
    console.warn("[e2ee] clé non transmise :", e)
    return false
  }
}

/**
 * « Ce n'est pas moi » : refuse, et le serveur déconnecte l'appareil. Rend son
 * identifiant, à annoncer au temps réel (`session_revoked`), ou `null`.
 */
export async function refuserDemandeCle(d: DemandeCle): Promise<string | null> {
  try {
    const r = await apiRequest<{ appareil?: string }>(
      `/api/e2ee/demandes-cle/${encodeURIComponent(d.id)}/refus`,
      { method: "POST" },
    )
    sendSignalSauvegarde("demande_cle_traitee", d.id)
    return r.appareil ?? null
  } catch {
    return null
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
  /*
   * ⚠️ UN SEUL CHEMIN : la page de restauration (28/09/2026) passe par
   * `restaurerALaConnexionSuivie`, et celle-ci aussi. Deux versions de la
   * même règle finiraient par diverger.
   */
  return (await restaurerALaConnexionSuivie(motDePasse, ranger)).restaures
}

/* ══════════════════ LA PAGE DE RESTAURATION ══════════════════ */

/**
 * Ce qu'a donné l'ouverture de l'archive à la connexion.
 *
 * ⚠️ « FERMÉE » ET « ÉCHEC » NE SE CONFONDENT PAS. Fermée : ce mot de passe
 * n'ouvre pas l'archive (il a changé, ou seule la clé de récupération la
 * protège) — réessayer n'y changera rien. Échec : réseau ou serveur.
 */
export type IssueConnexion = "rienARestaurer" | "restauree" | "fermee" | "echec"

/**
 * La restauration à la connexion, vue de la page qui la montre.
 *
 * 🐛 « UN NOUVEAU NAVIGATEUR NE CHARGE PAS L'ARCHIVE » (user, 28/09/2026).
 * Elle tournait en fond (`void` dans `auth-provider`) et chaque échec finissait
 * dans la console : un mot de passe changé, une archive sous la seule clé de
 * récupération, une coupure — même résultat, rien à l'écran.
 *
 * ⚠️ `lireCoffre` N'EST PAS UTILISÉ ICI : il fait passer une panne réseau pour
 * « refusée », ce qui est juste pour lui (ne rien créer dans le doute) mais
 * ferait dire « rien à restaurer » à une coupure.
 */
export async function restaurerALaConnexionSuivie(
  motDePasse: string,
  ranger: (m: MessageArchive) => Promise<void>,
  suivi?: SuiviRestauration,
): Promise<{ issue: IssueConnexion; restaures: number; illisibles: number }> {
  const rien = { issue: "rienARestaurer" as const, restaures: 0, illisibles: 0 }
  const echec = { issue: "echec" as const, restaures: 0, illisibles: 0 }
  const fermee = { issue: "fermee" as const, restaures: 0, illisibles: 0 }

  suivi?.({ etape: "ouverture", fait: 0 })

  let serrures: Serrure[]
  let refusee: boolean
  let motDePasseChangeLe: string | null | undefined
  let controle: string | null | undefined
  try {
    const etat = await lireCoffreComplet()
    serrures = etat.serrures
    refusee = etat.refusee
    motDePasseChangeLe = etat.motDePasseChangeLe
    controle = etat.controle
  } catch {
    return echec
  }

  if (serrures.length === 0) {
    // Pas d'archive : on l'active en silence (décision du 23/09/2026), sauf refus.
    if (refusee) return rien
    try {
      await activerSauvegarde({ motDePasse })
    } catch (e) {
      console.error("[e2ee] activation de la sauvegarde impossible :", e)
      return echec
    }
    return rien
  }

  // Ce navigateur a peut-être déjà la clé : pas besoin du mot de passe.
  let cle = await laCle()
  /*
   * 🔴 LA CLÉ DE CE NAVIGATEUR EST-ELLE ENCORE LA BONNE ? (27/11/2026) Si le
   * bloc de contrôle la refuse, elle vient d'une sauvegarde supprimée puis
   * recréée ailleurs : on l'oublie, et l'on rouvre par le mot de passe.
   */
  if (cle && typeof controle === "string") {
    const m = await lireMatiere()
    const compte = moi()
    if (m && compte && !(await controleValide(m, controle, compte))) {
      console.warn("[e2ee] la clé de ce navigateur n'est plus celle de la sauvegarde : oubliée.")
      maitresse = null
      try {
        effacerSecret(CLE_COFFRE)
      } catch {
        // coffre indisponible : la clé restera en mémoire nulle, sans plus.
      }
      cle = null
    }
  }
  const dejaSurAppareil = cle !== null
  if (!cle) {
    if (!serrures.some((s) => s.type === "motdepasse")) return fermee
    if (!(await ouvrir("motdepasse", motDePasse))) return fermee
    cle = await laCle()
    if (!cle) return echec
    // Elle vient de s'ouvrir avec ce mot de passe : la clé est la bonne. Si le
    // serveur la dit antérieure au dernier changement, on la repose pour que
    // la question ne revienne pas (27/11/2026).
    const ouverte = serrures.find((s) => s.type === "motdepasse")
    if (ouverte && perimeeSelonDates(ouverte, motDePasseChangeLe)) {
      void relierAuMotDePasse(motDePasse)
    }
    marquerEprouvee()
    // Ouverte par une serrure : la clé est prouvée, le bloc peut se poser.
    if (controle === null) {
      const m = await lireMatiere()
      if (m) void deposerControle(m)
    }
  }

  try {
    const { messages, blocsIllisibles, dernier } = await restaurer(cle, suivi)
    // Le rattrapage repartira d'ici : tout ce qui précède vient d'être rangé.
    ecrireCurseur(dernier)
    for (const [i, m] of messages.entries()) {
      if (i % 25 === 0) suivi?.({ etape: "rangement", fait: i, total: messages.length })
      await ranger(m)
    }
    suivi?.({ etape: "rangement", fait: messages.length, total: messages.length })
    console.info(`[e2ee] ${messages.length} message(s) restauré(s) depuis la sauvegarde.`)
    /*
     * 🔴 UNE SERRURE PÉRIMÉE SE RÉPARE ICI (27/11/2026). Après un mot de passe
     * oublié, ou un changement dont la serrure n'a pas suivi, elle garde
     * l'ANCIEN mot de passe : tout nouvel appareil trouvait l'archive fermée.
     * Ce navigateur l'ouvre avec sa clé, sans passer par elle — personne ne
     * la réparait.
     *
     * ⚠️ SEULEMENT SI LA CLÉ A LU QUELQUE CHOSE. Une clé restée d'une archive
     * supprimée puis recréée ailleurs n'est plus la bonne : refaire la serrure
     * avec elle fermerait l'archive pour de bon. Un message déchiffré prouve
     * que c'est la bonne. EN FOND : Argon2id prend une à deux secondes.
     */
    const serrureMdp = serrures.find((s) => s.type === "motdepasse")
    // Prouvée par le bloc (vérifié plus haut), ou par un message déchiffré.
    const prouvee = typeof controle === "string" || messages.length > 0
    if (dejaSurAppareil && prouvee) {
      if (!serrureMdp) {
        // Pas de serrure « mot de passe » : on la pose, comme le téléphone.
        void relierAuMotDePasse(motDePasse)
      } else if (aEprouver(serrureMdp, motDePasseChangeLe)) {
        void reparerSerrureSiPerimee(
          motDePasse,
          serrureMdp,
          perimeeSelonDates(serrureMdp, motDePasseChangeLe),
        )
      }
      if (controle === null) {
        const m = await lireMatiere()
        if (m) void deposerControle(m)
      }
    }
    return { issue: "restauree", restaures: messages.length, illisibles: blocsIllisibles }
  } catch (e) {
    console.error("[e2ee] restauration à la connexion impossible :", e)
    return echec
  }
}

/* ══════════════════ LE RATTRAPAGE (10/10/2026) ══════════════════ */

/*
 * 🐛 « JE N'ARRIVE PAS À VOIR CERTAINS MESSAGES CHIFFRÉS » (user, 10/10/2026,
 * fil Toti → steve). Cinq messages, dont une vidéo, envoyés pendant que le seul
 * navigateur de steve dormait ; il ouvre ensuite un NOUVEAU navigateur (son
 * téléphone), qui n'existait pas à l'envoi : aucune enveloppe pour lui. Ce
 * n'était ni le mot de passe ni la reprise par jeton — la clé de l'archive est
 * bien relue du coffre.
 *
 * ⚠️ L'ARCHIVE NE SE LISAIT QU'UNE FOIS, À LA CONNEXION. Quand un autre
 * appareil du compte relève ces messages et les archive, ce navigateur-ci ne
 * l'apprenait jamais : « indisponible » pour toujours.
 *
 * 🔴 D'OÙ LE RATTRAPAGE : un fil ouvert qui montre des messages indisponibles
 * relit les blocs déposés DEPUIS la dernière lecture (un curseur, le dernier
 * bloc lu), range tout ce qu'ils portent, et rend ce qu'il a trouvé.
 */

/**
 * Le curseur : le dernier bloc d'archive lu par cet appareil.
 *
 * ⚠️ EN `localStorage`, SOUS LE PRÉFIXE `alanya.e2ee.` : ce n'est pas un
 * secret (un identifiant de bloc), et ce préfixe est vidé à la déconnexion et
 * au changement de compte — un curseur ne survit pas à son compte.
 */
const CLE_CURSEUR = "alanya.e2ee.archive.curseur"

function lireCurseur(): string | null {
  try {
    return localStorage.getItem(CLE_CURSEUR)
  } catch {
    return null
  }
}

function ecrireCurseur(id: string | null): void {
  try {
    if (id) localStorage.setItem(CLE_CURSEUR, id)
    else localStorage.removeItem(CLE_CURSEUR)
  } catch {
    // Sans stockage, le prochain rattrapage relira tout : plus lent, pas faux.
  }
}

/** Entre deux rattrapages : un fil rechargé à chaque message n'en lance pas un à chaque fois. */
const RATTRAPAGE_REPOS_MS = 20_000
let dernierRattrapage = 0
let rattrapageEnCours: Promise<Map<string, MessageArchive>> | null = null

/**
 * Relit les blocs d'archive nouveaux, range leurs messages, et les rend par
 * identifiant.
 *
 * ⚠️ RANGE TOUT, pas seulement ce que le fil ouvert attend : les autres fils
 * en profitent, et le curseur avance d'un coup.
 *
 * ⚠️ UN CURSEUR INCONNU DU SERVEUR (archive effacée puis recréée) : on repart
 * du début, une fois.
 *
 * ⚠️ NE LÈVE JAMAIS. Sans archive ouverte, sans réseau : une carte vide, et le
 * message reste « indisponible », comme avant.
 */
export function rattraperDepuisArchive(
  ranger: (m: MessageArchive) => Promise<void>,
): Promise<Map<string, MessageArchive>> {
  if (rattrapageEnCours) return rattrapageEnCours
  if (Date.now() - dernierRattrapage < RATTRAPAGE_REPOS_MS) return Promise.resolve(new Map())
  dernierRattrapage = Date.now()

  rattrapageEnCours = (async () => {
    const trouves = new Map<string, MessageArchive>()
    const cle = await laCle()
    if (!cle) return trouves
    let lu: Awaited<ReturnType<typeof restaurer>>
    try {
      lu = await restaurer(cle, undefined, lireCurseur())
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 400) return trouves
      ecrireCurseur(null)
      try {
        lu = await restaurer(cle)
      } catch {
        return trouves
      }
    }
    for (const m of lu.messages) {
      try {
        await ranger(m)
        trouves.set(m.id, m)
      } catch {
        // Un rangement raté n'empêche pas les autres.
      }
    }
    ecrireCurseur(lu.dernier)
    if (lu.messages.length > 0) {
      console.info(`[e2ee] rattrapage : ${lu.messages.length} message(s) relu(s) dans l'archive.`)
    }
    return trouves
  })().finally(() => {
    rattrapageEnCours = null
  })
  return rattrapageEnCours
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
