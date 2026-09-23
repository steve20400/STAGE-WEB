import { ApiError, apiRequest } from "../lib/api-client"
import { estChiffree } from "./e2ee-fil"
import { langueInitiale, traduire, type Cle } from "../i18n"
import {
  compterTraductions,
  deduplique,
  ecrireLangueDetectee,
  ecrireTraduction,
  empreinteTexte,
  lireLangueDetectee,
  lireTraduction,
  oublierEmpreinte,
  viderTraductions,
  type EtatCacheTraductions,
  type MoteurTraduction,
} from "./traduction-cache"
import {
  MOTEUR_PAR_DEFAUT,
  estCodeMoteur,
  moteurSurAppareil,
  type CodeMoteur,
} from "./traduction-fournisseurs"
import {
  detecterLangue,
  disponibiliteCouple,
  libererTraducteurs,
  normaliserLangue,
  telechargerCouple,
  traduireLocalement,
  traductionLocalePresente,
} from "./traduction-locale"

/**
 * Orchestration de la traduction des messages.
 *
 * Cascade, par message : cache local, puis LE MOTEUR CHOISI, puis un echec
 * explicite. Aucun repli silencieux d'un moteur sur un autre : celui qui a
 * choisi le navigateur ne verra pas son texte partir chez un tiers parce que le
 * couple de langues n'etait pas installe, et celui qui a choisi DeepL ne verra
 * pas une traduction du navigateur signee DeepL. Quand le moteur choisi ne peut
 * pas repondre, l'interface le dit et renvoie vers les Parametres.
 *
 * Le moteur du navigateur reste le defaut : gratuit, et rien ne sort de
 * l'appareil.
 */

/* ---------------------------------------------------------------- Moteur */

/**
 * Le choix part avec le compte a la deconnexion (voir `session-reset.ts`).
 * L'absence de valeur vaut « navigateur » : le defaut de securite est aussi le
 * defaut de repli, donc un stockage illisible ne peut pas faire sortir un
 * message de l'appareil.
 */
const CLE_MOTEUR = "alanya-traduction-moteur-v1"

/**
 * Ancienne cle, du temps ou le reglage etait un interrupteur local/en-ligne et
 * ou « en ligne » ne pouvait vouloir dire qu'Azure — c'est nommement ce que la
 * fenetre de consentement annoncait alors. On reporte donc ce choix sur azure,
 * et on efface l'ancienne cle : la migration n'a lieu qu'une fois, et un
 * utilisateur qui n'avait rien accepte reste sur le navigateur.
 */
const CLE_MODE_HERITEE = "alanya-traduction-mode-v1"

const abonnesAuMoteur = new Set<(moteur: CodeMoteur) => void>()

/**
 * LE MOTEUR POUR UNE CONVERSATION DONNEE.
 *
 * 🔴 DANS UN FIL CHIFFRE, LE MOTEUR DE L'APPAREIL EST IMPOSE — quel que soit
 * le reglage de l'utilisateur.
 *
 * POURQUOI. Le reglage du moteur et l'etat chiffre d'une conversation ont ete
 * ecrits par des gens differents, a des moments differents, et rien ne les
 * reliait. Un utilisateur qui avait choisi Azure six mois plus tot envoyait
 * donc le texte dechiffre de ses conversations chiffrees a Microsoft — et a
 * un cache PARTAGE entre comptes — pendant que l'ecran affichait « chiffre ».
 *
 * ⚠️ IL NE L'AURAIT JAMAIS SU. Rien dans l'interface ne rapproche les deux
 * reglages. C'est la pire forme de fuite : celle que l'utilisateur declenche
 * lui-meme en croyant etre protege.
 *
 * ⚠️ CE N'EST PAS UN DEFAUT DU RELAIS. Il fait exactement ce pour quoi il a
 * ete ecrit, et le defaut par defaut etait deja le bon moteur. Le trou est un
 * trou de PERIMETRE, et il se bouche ici, au seul endroit ou le moteur est
 * choisi.
 */
export function moteurPourConversation(conversationId: string): CodeMoteur {
  if (estChiffree(conversationId)) return MOTEUR_PAR_DEFAUT
  return lireMoteurTraduction()
}

/**
 * ⚠️ NE PLUS APPELER DIRECTEMENT POUR TRADUIRE. Cette fonction rend le reglage
 * BRUT, sans savoir de quelle conversation il s'agit : elle sert aux Reglages,
 * qui affichent ce choix. Pour traduire, c'est `moteurPourConversation`.
 */
export function lireMoteurTraduction(): CodeMoteur {
  try {
    const enregistre = localStorage.getItem(CLE_MOTEUR)
    if (estCodeMoteur(enregistre)) return enregistre
    if (localStorage.getItem(CLE_MODE_HERITEE) === "en-ligne") {
      localStorage.setItem(CLE_MOTEUR, "azure")
      localStorage.removeItem(CLE_MODE_HERITEE)
      return "azure"
    }
  } catch {
    // Stockage illisible : on retombe sur le moteur de l'appareil.
  }
  return MOTEUR_PAR_DEFAUT
}

/**
 * Ne doit etre appele, pour un moteur distant, qu'apres la fenetre de
 * consentement : ce service ne sait pas si l'utilisateur a lu l'avertissement,
 * c'est l'interface qui en repond.
 */
export function definirMoteurTraduction(moteur: CodeMoteur): void {
  try {
    localStorage.setItem(CLE_MOTEUR, moteur)
    localStorage.removeItem(CLE_MODE_HERITEE)
  } catch {
    // Sans stockage, le choix ne survivra pas a la session — mais il s'applique.
  }
  for (const abonne of abonnesAuMoteur) abonne(moteur)
}

/** Notifie les ecrans ouverts, y compris depuis un autre onglet du meme navigateur. */
export function sAbonnerAuMoteurTraduction(abonne: (moteur: CodeMoteur) => void): () => void {
  abonnesAuMoteur.add(abonne)
  return () => abonnesAuMoteur.delete(abonne)
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (evenement) => {
    if (evenement.key !== CLE_MOTEUR) return
    const moteur = lireMoteurTraduction()
    for (const abonne of abonnesAuMoteur) abonne(moteur)
  })
}

/* ------------------------------------- Traduction automatique par conversation */

/**
 * Traduction continue, conversation par conversation.
 *
 * ACTIVE PAR DEFAUT : recevoir un message dans une langue qu'on ne lit pas est
 * la situation ou l'on a besoin d'aide sans savoir la demander, et exiger un
 * clic sur chaque bulle ferait de la fonction un reglage d'expert. On
 * n'enregistre donc que les EXCEPTIONS — les conversations ou l'utilisateur a
 * coupe la traduction. Une carte vide veut dire « tout se traduit ».
 *
 * Le format supporte l'ancien reglage sans migration : les entrees `true`
 * ecrites quand le defaut etait l'inverse restent lues comme actives.
 *
 * Stocke en localStorage et NON dans le magasin `conversations` :
 * `cacheConversations` ecrase l'objet entier par un `put()` a chaque
 * synchronisation, le drapeau disparaitrait a la premiere mise a jour de la
 * liste. Le stockage local est de toute facon le bon endroit — la langue de
 * lecture est celle de l'appareil, pas du compte.
 */
const CLE_AUTO = "alanya-traduction-auto-v1"

function lireAuto(): Record<string, boolean> {
  try {
    const brut = localStorage.getItem(CLE_AUTO)
    if (!brut) return {}
    const valeur = JSON.parse(brut) as unknown
    return valeur && typeof valeur === "object" ? (valeur as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

export function traductionAutoActive(conversationId: string): boolean {
  if (!conversationId) return false
  return lireAuto()[conversationId] !== false
}

/** Rend l'etat enregistre, pour que l'appelant affiche ce qui a ete retenu. */
export function definirTraductionAuto(conversationId: string, active: boolean): boolean {
  if (!conversationId) return false
  const carte = lireAuto()
  // Le defaut etant « actif », reactiver revient a effacer l'exception.
  if (active) delete carte[conversationId]
  else carte[conversationId] = false
  try {
    localStorage.setItem(CLE_AUTO, JSON.stringify(carte))
  } catch {
    // Preference perdue au rechargement : sans consequence sur la vie privee.
  }
  // Le reglage se change depuis les informations de la conversation, alors que
  // c'est le fil des messages qui l'applique — deux composants qui ne se
  // connaissent pas, et que le panneau soit incruste a cote du fil ou ouvert en
  // pleine page sur telephone. Un evenement les accorde sans faire remonter
  // l'etat jusqu'a un ancetre commun qui n'existe pas.
  try {
    window.dispatchEvent(
      new CustomEvent(EVENEMENT_TRADUCTION_AUTO, { detail: { conversationId, active } })
    )
  } catch {
    // Hors navigateur : personne n'ecoute, il n'y a rien a accorder.
  }
  return active
}

/** Emis a chaque changement du reglage, avec `{ conversationId, active }` en detail. */
export const EVENEMENT_TRADUCTION_AUTO = "alanya:traduction-auto"

/* ---------------------------------------------------------------- Erreurs */

export type CodeErreurTraduction =
  | "meme-langue"
  | "local-indisponible"
  | "moteur-indisponible"
  | "quota"
  | "service"

const CLE_PAR_CODE: Record<CodeErreurTraduction, Cle> = {
  "meme-langue": "trad_err_same_language",
  "local-indisponible": "trad_err_local_unavailable",
  "moteur-indisponible": "trad_err_engine_unavailable",
  quota: "trad_err_quota",
  service: "trad_err_service",
}

/**
 * Porte a la fois un code, pour que l'interface decide quoi proposer (par
 * exemple ouvrir la fenetre de consentement sur `en-ligne-desactive`), et un
 * message deja traduit, pour qu'un affichage brut reste lisible.
 */
export class TraductionError extends Error {
  code: CodeErreurTraduction

  constructor(code: CodeErreurTraduction) {
    super(traduire(langueInitiale(), CLE_PAR_CODE[code]))
    this.name = "TraductionError"
    this.code = code
  }
}

/* ---------------------------------------------------------------- Etat */

export type EtatTraduction = "local-actif" | "a-telecharger" | "indisponible" | "en-ligne"

/** Le moteur du navigateur existe-t-il, independamment de tout couple de langues. */
export function moteurLocalPresent(): boolean {
  return traductionLocalePresente()
}

/**
 * Ce que l'interface doit annoncer pour un couple donne. Sonde a l'execution :
 * il n'existe aucune liste statique fiable des couples supportes, et un paquet
 * installe peut avoir ete evince depuis la derniere session.
 */
export async function etatTraduction(source: string, cible: string): Promise<EtatTraduction> {
  if (!moteurSurAppareil(lireMoteurTraduction())) return "en-ligne"
  if (!traductionLocalePresente()) return "indisponible"
  const etat = await disponibiliteCouple(source, cible)
  if (etat === "available") return "local-actif"
  if (etat === "downloadable" || etat === "downloading") return "a-telecharger"
  return "indisponible"
}

/**
 * Declenche l'installation des composants d'un couple. Seul appel autorise :
 * celui d'un clic dans les Parametres. Hors geste utilisateur, le navigateur
 * refuse.
 */
export async function telechargerComposants(
  source: string,
  cible: string,
  surProgression?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<boolean> {
  const etat = await telechargerCouple(source, cible, surProgression, signal)
  return etat === "available"
}

/**
 * LES TROIS LANGUES INSTALLEES A LA PREMIERE ACTIVATION : francais, anglais,
 * chinois — vers la langue de lecture.
 *
 * ⚠️ LE NAVIGATEUR TELECHARGE DES COUPLES, PAS DES LANGUES. « Le paquet
 * francais » n'existe pas : ce qui s'installe, c'est `fr -> cible`. Trois
 * langues font donc au plus trois couples, et lesquels depend de la langue de
 * l'utilisateur — pas d'une liste fixe.
 *
 * ⚠️ A APPELER DANS LE GESTE DE L'UTILISATEUR, jamais apres un `await` de
 * reseau. Le navigateur refuse d'installer un composant hors d'un clic, et un
 * aller-retour intercale AVANT le premier telechargement perdrait le geste :
 * la fonction ne demanderait alors rien du tout, en silence.
 *
 * Rend le nombre de couples REELLEMENT installes. Ne leve jamais : un paquet
 * qui n'arrive pas laisse la traduction passer par le relais en ligne, ce qui
 * marche — plus lentement, et sans rien casser.
 */
export const LANGUES_INITIALES = ["fr", "en", "zh"] as const

export async function installerPaquetsInitiaux(
  cible: string,
  surProgression?: (langue: string, fraction: number) => void
): Promise<{ installes: number; echecs: string[] }> {
  const cibleNormalisee = normaliserLangue(cible)
  let installes = 0
  const echecs: string[] = []

  for (const langue of LANGUES_INITIALES) {
    // ⚠️ RIEN A FAIRE POUR SA PROPRE LANGUE : traduire du francais vers le
    // francais n'a pas de couple, et le demander echouerait pour rien.
    if (normaliserLangue(langue) === cibleNormalisee) continue

    try {
      const etat = await etatTraduction(langue, cibleNormalisee)
      // Deja la, ou moteur en ligne : dans les deux cas il n'y a rien a
      // installer. On ne retelecharge jamais ce qui est present.
      if (etat === "local-actif" || etat === "en-ligne") continue
      if (etat === "indisponible") {
        echecs.push(langue)
        continue
      }
      const ok = await telechargerComposants(langue, cibleNormalisee, (fraction) =>
        surProgression?.(langue, fraction)
      )
      if (ok) installes += 1
      else echecs.push(langue)
    } catch {
      echecs.push(langue)
    }
  }

  return { installes, echecs }
}

/* ---------------------------------------------------------------- Detection */

/**
 * Langue d'un texte, mise en cache : sans cela, chaque rendu de bulle
 * relancerait une detection, donc du travail sur le fil principal a chaque
 * defilement.
 */
export async function detecterLangueMessage(texte: string): Promise<string | null> {
  const propre = texte.trim()
  if (!propre) return null
  const empreinte = await empreinteTexte(propre)
  return deduplique(`det:${empreinte}`, async () => {
    const enCache = await lireLangueDetectee(empreinte)
    if (enCache) return enCache
    const detectee = await detecterLangue(propre)
    if (detectee) await ecrireLangueDetectee(empreinte, detectee)
    return detectee
  })
}

/**
 * Un message merite-t-il un bouton de traduction ?
 *
 * Repond `false` quand la langue est manifestement la meme, et `true` quand
 * elle est inconnue : un doute ne doit pas priver l'utilisateur du bouton,
 * alors qu'une certitude inutile encombre l'interface.
 */
export async function messageTraduisible(texte: string, cible: string): Promise<boolean> {
  const propre = texte.trim()
  if (!propre) return false
  const source = await detecterLangueMessage(propre)
  if (!source) return true
  return normaliserLangue(source) !== normaliserLangue(cible)
}

/* ---------------------------------------------------------------- Relais */

/**
 * Source inconnue : le navigateur ne sait pas detecter, c'est le relais qui
 * tranchera. La valeur sert aussi de cle de cache, pour qu'une seconde lecture
 * du meme message par le meme navigateur ne reparte pas en ligne.
 */
const SOURCE_INCONNUE = "auto"

/** Le relais accepte au plus vingt elements par appel. */
const TAILLE_LOT_RELAIS = 20

interface ElementRelais {
  empreinte: string
  texte: string
  source?: string
}

interface ResultatRelais {
  empreinte: string
  texte: string
  source: string
  moteur?: string
}

/**
 * Recul en memoire apres un 429 ou un 502.
 *
 * Sans lui, un defilement continu rejouerait l'appel a chaque bulle sur un
 * service deja casse ou un quota deja epuise. Il ne survit pas au rechargement :
 * c'est une politesse envers le fournisseur, pas une sanction.
 *
 * La CAUSE est retenue avec l'echeance. Sans elle, toutes les bulles refusees
 * pendant la pause annoncaient « service indisponible » — y compris apres un
 * 429, ou l'utilisateur a droit a la vraie explication : son quota du jour est
 * epuise. Les deux messages n'appellent pas la meme patience, l'un se compte en
 * secondes et l'autre en heures.
 */
let pauseRelaisJusqua = 0
let causePause: Extract<CodeErreurTraduction, "quota" | "service"> = "service"
const PAUSE_QUOTA_MS = 5 * 60 * 1000
const PAUSE_SERVICE_MS = 30 * 1000

/** Met le relais en pause, en retenant pourquoi. */
function suspendreRelais(cause: "quota" | "service", duree: number): void {
  pauseRelaisJusqua = Date.now() + duree
  causePause = cause
}

/** Code d'erreur du backend, quand il en donne un : { error: { message, code } }. */
function codeBackend(erreur: ApiError): string {
  const charge = erreur.payload
  if (charge && typeof charge === "object" && "error" in charge) {
    const detail = (charge as { error?: { code?: unknown } }).error
    if (detail && typeof detail === "object" && typeof detail.code === "string") return detail.code
  }
  return ""
}

async function appelerRelais(
  cible: string,
  moteur: CodeMoteur,
  elements: ElementRelais[],
  /**
   * ⚠️ ANNONCEE AU SERVEUR POUR QU'IL PUISSE REFUSER. Le client impose deja le
   * moteur de l'appareil sur un fil chiffre : si cette valeur arrive ici avec
   * une conversation chiffree, c'est que quelque chose a contourne la regle, et
   * le serveur doit pouvoir dire non de son cote.
   */
  conversationId: string,
): Promise<ResultatRelais[]> {
  if (Date.now() < pauseRelaisJusqua) throw new TraductionError(causePause)
  try {
    const reponse = await apiRequest<{ results?: ResultatRelais[] }>("/api/translate", {
      method: "POST",
      body: {
        target: cible,
        provider: moteur,
        items: elements,
        ...(conversationId ? { convId: conversationId } : {}),
      },
    })
    return reponse?.results ?? []
  } catch (erreur) {
    if (erreur instanceof ApiError) {
      if (erreur.status === 429) {
        suspendreRelais("quota", PAUSE_QUOTA_MS)
        throw new TraductionError("quota")
      }
      // Le moteur choisi n'est pas servi par ce serveur — nom inconnu, moteur
      // d'appareil demande au relais, ou cle absente cote serveur. Ces trois
      // cas sont PERMANENTS : le message doit renvoyer vers les Parametres
      // plutot que vers un bouton « reessayer » qui echouera toujours, et
      // surtout le relais ne doit PAS etre mis en pause. Une pause punirait les
      // autres moteurs — dont celui que l'utilisateur va choisir en reponse a
      // ce message — pour une panne qui n'existe pas.
      const code = codeBackend(erreur)
      if (
        code === "PROVIDER_UNKNOWN" ||
        code === "PROVIDER_LOCAL" ||
        code === "PROVIDER_UNAVAILABLE"
      ) {
        throw new TraductionError("moteur-indisponible")
      }
      // `PROVIDER_FAILED` est l'exact oppose : le moteur est bien servi, c'est
      // l'appel qui a echoue. Passager, donc pause courte et « reessayer ».
      if (code === "PROVIDER_FAILED" || erreur.status >= 500 || erreur.status === 0) {
        suspendreRelais("service", PAUSE_SERVICE_MS)
      }
    }
    throw new TraductionError("service")
  }
}

/* ---------------------------------------------------------------- Traduction */

export interface ResultatTraduction {
  texte: string
  source: string
  cible: string
  moteur: MoteurTraduction
}

interface Demande {
  texte: string
  empreinte: string
  source: string | null
}

async function preparer(
  texte: string,
  cible: string,
  /**
   * Langue DECLAREE par l'utilisateur pour cette conversation.
   *
   * 🔴 QUAND ELLE EST LA, LA DETECTION N'EST MEME PAS TENTEE. C'est tout l'objet
   * du reglage : la detection se trompait de langue source, ou renoncait sur les
   * textes courts — « ok merci », « bonjour » — qui sont justement les plus
   * nombreux dans une messagerie. L'utilisateur, lui, sait dans quelle langue
   * ecrit son correspondant. On le croit, et on cesse de deviner.
   */
  sourceDeclaree?: string | null
): Promise<Demande> {
  const propre = texte.trim()
  const empreinte = await empreinteTexte(propre)
  const declaree = normaliserLangue(sourceDeclaree ?? "") || null
  const source = declaree ?? (normaliserLangue(await detecterLangueMessage(propre)) || null)
  if (source && source === normaliserLangue(cible)) throw new TraductionError("meme-langue")
  return { texte: propre, empreinte, source }
}

/**
 * Le cache est interroge POUR LE MOTEUR CHOISI et pour lui seul : une entree
 * ecrite par un autre moteur repondrait a cote, et masquerait au passage le
 * changement de moteur que l'utilisateur vient de faire.
 */
async function lireEnCache(
  demande: Demande,
  cible: string,
  moteur: CodeMoteur
): Promise<ResultatTraduction | null> {
  const sources = demande.source ? [demande.source, SOURCE_INCONNUE] : [SOURCE_INCONNUE]
  for (const source of sources) {
    const entree = await lireTraduction(demande.empreinte, source, cible, moteur)
    if (entree) {
      return { texte: entree.texte, source: entree.source, cible, moteur: entree.moteur }
    }
  }
  return null
}

/**
 * Traduit un message vers une langue.
 *
 * Un seul message a la fois, a la demande : traduire tout un fil pour un
 * utilisateur qui en lit une ligne multiplierait la depense par trente et
 * enverrait la conversation entiere a un tiers en reponse a une seule
 * intention.
 */
export async function traduireMessage(
  texte: string,
  cible: string,
  /**
   * 🔴 OBLIGATOIRE, ET C'EST DELIBERE.
   *
   * Un parametre facultatif se serait oublie au premier nouvel appelant, et
   * l'oubli aurait rouvert la fuite en silence. Le rendre obligatoire fait
   * porter la regle par le compilateur au lieu de la memoire : on ne PEUT
   * plus traduire sans dire de quelle conversation il s'agit.
   *
   * C'est la lecon du chapitre 4 : quand l'ordre ou le contexte comptent,
   * c'est a la fonction de l'exiger, pas au lecteur de s'en souvenir.
   */
  conversationId: string,
  /** Voir `preparer` : renseignee, elle supprime l'etape de detection. */
  sourceDeclaree?: string | null
): Promise<ResultatTraduction> {
  const cibleNormalisee = normaliserLangue(cible)
  const moteur = moteurPourConversation(conversationId)
  const demande = await preparer(texte, cibleNormalisee, sourceDeclaree)
  // Le moteur entre dans la cle de deduplication : changer de moteur puis
  // redemander la meme bulle doit relancer un vrai travail, pas rendre la
  // promesse en cours de l'ancien moteur.
  const cleVol = `trad:${moteur}|${demande.empreinte}|${cibleNormalisee}`

  return deduplique(cleVol, async () => {
    const enCache = await lireEnCache(demande, cibleNormalisee, moteur)
    if (enCache) return enCache

    if (moteurSurAppareil(moteur)) {
      // Seconde detection, souple, quand la stricte a renonce : elle abandonne
      // sur les textes courts — « Bonjour », « ok merci » — qui sont justement
      // les plus nombreux dans une messagerie. Sans elle, le moteur du
      // navigateur n'aurait aucun couple a ouvrir pour ces messages-la.
      // ⚠️ `demande.source` porte deja la langue DECLAREE quand il y en a une :
      // cette seconde detection ne s'execute donc que faute de declaration.
      const source =
        demande.source ??
        normaliserLangue((await detecterLangue(demande.texte, { souple: true })) ?? "")
      if (source && source !== cibleNormalisee) {
        const local = await essayerLocal([demande], cibleNormalisee, source)
        if (local[0]) return local[0]
      }
      // Pas de repli sur le relais : l'utilisateur a choisi que rien ne sorte
      // de son appareil, un echec local ne vaut pas autorisation de sortir.
      throw new TraductionError("local-indisponible")
    }

    const enLigne = await traduireParRelais([demande], cibleNormalisee, moteur, conversationId)
    const resultat = enLigne[0]
    if (!resultat) throw new TraductionError("service")
    return resultat
  })
}

/**
 * Traduit plusieurs messages, pour la fenetre visible d'une conversation.
 *
 * Un seul appel au relais pour tout le lot, mais un enregistrement de cache par
 * texte : le lot est un detail de transport, il ne doit pas devenir l'unite de
 * reutilisation. Les elements en echec valent `null` plutot que de faire
 * echouer tout le lot.
 */
export async function traduireMessages(
  textes: string[],
  cible: string,
  /** Obligatoire, meme raison que `traduireMessage`. */
  conversationId: string
): Promise<(ResultatTraduction | null)[]> {
  const cibleNormalisee = normaliserLangue(cible)
  const moteur = moteurPourConversation(conversationId)
  const resultats: (ResultatTraduction | null)[] = new Array(textes.length).fill(null)

  const demandes: { index: number; demande: Demande }[] = []
  for (let index = 0; index < textes.length; index += 1) {
    try {
      const demande = await preparer(textes[index], cibleNormalisee)
      const enCache = await lireEnCache(demande, cibleNormalisee, moteur)
      if (enCache) resultats[index] = enCache
      else demandes.push({ index, demande })
    } catch {
      // Meme langue ou texte vide : rien a traduire pour cette bulle.
    }
  }
  if (!demandes.length) return resultats

  if (moteurSurAppareil(moteur)) {
    // Le moteur du navigateur ne traite qu'un couple a la fois : on regroupe
    // par source. Les textes dont la source reste inconnue n'ont pas de couple
    // a ouvrir et restent en version originale — aucun repli en ligne ici.
    const parSource = new Map<string, { index: number; demande: Demande }[]>()
    for (const entree of demandes) {
      if (!entree.demande.source) continue
      const groupe = parSource.get(entree.demande.source) ?? []
      groupe.push(entree)
      parSource.set(entree.demande.source, groupe)
    }
    for (const [source, groupe] of parSource) {
      const locaux = await essayerLocal(
        groupe.map((e) => e.demande),
        cibleNormalisee,
        source
      )
      groupe.forEach((entree, position) => {
        resultats[entree.index] = locaux[position]
      })
    }
    return resultats
  }

  try {
    const enLigne = await traduireParRelais(
      demandes.map((e) => e.demande),
      cibleNormalisee,
      moteur,
      conversationId,
    )
    demandes.forEach((entree, position) => {
      resultats[entree.index] = enLigne[position] ?? null
    })
  } catch {
    // Quota, panne, moteur non servi : les bulles concernees restent en version
    // originale, c'est a l'interface d'expliquer pourquoi.
  }
  return resultats
}

/**
 * Etage local. Ne leve jamais : un moteur absent ou un couple non installe est
 * un cas nominal, l'orchestrateur passe simplement a l'etage suivant.
 */
async function essayerLocal(
  demandes: Demande[],
  cible: string,
  source: string
): Promise<(ResultatTraduction | null)[]> {
  if (!traductionLocalePresente()) return demandes.map(() => null)
  try {
    const traduits = await traduireLocalement(
      source,
      cible,
      demandes.map((d) => d.texte)
    )
    const resultats: (ResultatTraduction | null)[] = []
    for (let index = 0; index < demandes.length; index += 1) {
      const texte = traduits[index]
      if (!texte) {
        resultats.push(null)
        continue
      }
      const demande = demandes[index]
      await ecrireTraduction(demande.empreinte, source, cible, texte, "navigateur")
      // Second enregistrement sous la source inconnue quand la detection
      // stricte avait renonce — ce qui est le cas ORDINAIRE des messages
      // courts, « ok », « merci », « a demain », les plus nombreux d'une
      // messagerie. La source utilisee ici vient de la detection souple, mais
      // la prochaine lecture repassera par la stricte, n'obtiendra toujours
      // rien, et ira donc chercher sous « auto ». Sans cette seconde ecriture,
      // l'entree existait sans jamais pouvoir etre relue : le moteur du
      // navigateur retraduisait ces messages-la a chaque affichage. C'est le
      // meme jumelage que fait `traduireParRelais` pour l'etage en ligne.
      if (!demande.source) {
        await ecrireTraduction(demande.empreinte, SOURCE_INCONNUE, cible, texte, "navigateur")
      }
      resultats.push({ texte, source, cible, moteur: "navigateur" })
    }
    return resultats
  } catch {
    // Couple non installe, texte trop long, modele evince : tous ces cas sont
    // nominaux et se traitent de la meme facon — on laisse l'etage suivant
    // decider. Aucun echec n'est mis en cache, sans quoi une panne passagere
    // resterait figee dans IndexedDB comme l'a montre le cache d'apercus.
    return demandes.map(() => null)
  }
}

/**
 * Etage en ligne, pour un moteur distant explicitement choisi.
 *
 * Le moteur voyage dans la requete : c'est lui qui decide chez qui le texte
 * part, et le relais refuse par `PROVIDER_LOCAL` un moteur d'appareil. Le
 * moteur rendu par le relais est ignore au profit de celui qui a ete demande :
 * la bulle doit nommer le fournisseur que l'utilisateur a choisi, et le cache
 * etre relu sous cette meme cle.
 */
async function traduireParRelais(
  demandes: Demande[],
  cible: string,
  moteur: CodeMoteur,
  conversationId: string,
): Promise<(ResultatTraduction | null)[]> {
  if (moteurSurAppareil(moteur)) throw new TraductionError("local-indisponible")

  const parEmpreinte = new Map<string, ResultatTraduction>()
  for (let debut = 0; debut < demandes.length; debut += TAILLE_LOT_RELAIS) {
    const lot = demandes.slice(debut, debut + TAILLE_LOT_RELAIS)
    const reponses = await appelerRelais(
      cible,
      moteur,
      lot.map((d) => ({
        empreinte: d.empreinte,
        texte: d.texte,
        ...(d.source ? { source: d.source } : {}),
      })),
      conversationId,
    )
    for (const reponse of reponses) {
      if (!reponse?.texte || !reponse.empreinte) continue
      const source = normaliserLangue(reponse.source) || SOURCE_INCONNUE
      await ecrireTraduction(reponse.empreinte, source, cible, reponse.texte, moteur)
      // Second enregistrement sous la source inconnue : sans detection locale,
      // la prochaine lecture n'aura toujours pas de source a mettre dans la cle.
      const demande = lot.find((d) => d.empreinte === reponse.empreinte)
      if (demande && !demande.source) {
        await ecrireTraduction(reponse.empreinte, SOURCE_INCONNUE, cible, reponse.texte, moteur)
      }
      parEmpreinte.set(reponse.empreinte, { texte: reponse.texte, source, cible, moteur })
    }
  }
  return demandes.map((d) => parEmpreinte.get(d.empreinte) ?? null)
}

/* ---------------------------------------------------------------- Entretien */

/**
 * Efface les traductions d'un texte, toutes cibles confondues.
 *
 * A appeler a la reception de `message_deleted`, tant que le contenu est encore
 * dans l'etat React : c'est le seul instant ou l'empreinte est calculable, une
 * fois le message efface il ne reste plus rien pour retrouver ses entrees.
 */
export async function oublierTraductionsDuTexte(texte: string): Promise<void> {
  const propre = texte?.trim()
  if (!propre) return
  await oublierEmpreinte(await empreinteTexte(propre))
}

/** Nombre d'entrees et taille estimee, pour l'affichage dans les Parametres. */
export function compterCacheTraductions(): Promise<EtatCacheTraductions> {
  return compterTraductions()
}

/**
 * Vide les traductions enregistrees. Les paquets de langue installes par le
 * navigateur ne sont PAS effaces : ils ne nous appartiennent pas, et c'est leur
 * persistance qui rend la session suivante instantanee.
 */
export async function viderCacheTraductions(): Promise<void> {
  await viderTraductions()
}

/** A appeler au changement de conversation : les modeles n'ont plus a etre retenus. */
export function libererMoteurLocal(): void {
  libererTraducteurs()
}

/* ----------------- Dernier echec de traduction ----------------- */

/**
 * LA DERNIERE PANNE DE TRADUCTION, retenue au lieu d'etre criee.
 *
 * ⚠️ Un avis paraissait a CHAQUE ouverture de discussion : la memoire etait
 * remise a zero au changement de conversation, si bien que le meme moteur en
 * panne se plaignait dix fois par jour — pour une chose que l'utilisateur ne
 * peut pas corriger depuis une conversation.
 *
 * Un avertissement qui revient sans cesse cesse d'etre lu, et couvre ceux qui
 * comptent. On le retient donc ici, et les PARAMETRES le disent une fois — la
 * ou l'on peut changer de moteur.
 *
 * Range par APPAREIL et non par compte : c'est le moteur de traduction de ce
 * navigateur qui est en panne, pas quelque chose qui appartient a l'utilisateur.
 */
const CLE_ECHEC_TRADUCTION = "alanya.traduction.dernier-echec"

export function retenirEchecTraduction(code: string): void {
  try {
    localStorage.setItem(CLE_ECHEC_TRADUCTION, JSON.stringify({ code, quand: Date.now() }))
  } catch {
    // Stockage plein ou refuse : la traduction marche toujours, on n'a perdu
    // qu'un diagnostic.
  }
}

export function dernierEchecTraduction(): { code: string; quand: number } | null {
  try {
    const brut = localStorage.getItem(CLE_ECHEC_TRADUCTION)
    if (!brut) return null
    const lu = JSON.parse(brut) as { code?: unknown; quand?: unknown }
    if (typeof lu.code !== "string" || typeof lu.quand !== "number") return null
    return { code: lu.code, quand: lu.quand }
  } catch {
    return null
  }
}

/** Efface la trace — appele quand une traduction reussit enfin. */
export function oublierEchecTraduction(): void {
  try {
    localStorage.removeItem(CLE_ECHEC_TRADUCTION)
  } catch {
    /* sans consequence */
  }
}
