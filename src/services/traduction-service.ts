import { ApiError, apiRequest } from "../lib/api-client"
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
 * Cascade, par message : cache local, puis moteur du navigateur, puis — et
 * seulement si l'utilisateur l'a explicitement accepte — le relais backend.
 * Chaque etage qui reussit evite l'etage suivant, ce qui protege a la fois la
 * facture et le contenu des messages.
 *
 * Le mode EN LIGNE ne s'active jamais tout seul, y compris quand le local
 * echoue : c'est la seule garantie qui vaille pour un utilisateur qui a choisi
 * que ses messages ne sortent pas de son appareil.
 */

/* ---------------------------------------------------------------- Mode */

export type ModeTraduction = "local" | "en-ligne"

/**
 * Le mode part avec le compte a la deconnexion (voir `session-reset.ts`).
 * L'absence de valeur vaut « local » : le defaut de securite est aussi le
 * defaut de repli, donc un stockage illisible ne peut pas faire sortir un
 * message de l'appareil.
 */
const CLE_MODE = "alanya-traduction-mode-v1"

const abonnesAuMode = new Set<(mode: ModeTraduction) => void>()

export function lireModeTraduction(): ModeTraduction {
  try {
    return localStorage.getItem(CLE_MODE) === "en-ligne" ? "en-ligne" : "local"
  } catch {
    return "local"
  }
}

/**
 * Ne doit etre appele qu'apres la fenetre de consentement pour « en-ligne » :
 * ce service ne sait pas si l'utilisateur a lu l'avertissement, c'est
 * l'interface qui en repond.
 */
export function definirModeTraduction(mode: ModeTraduction): void {
  try {
    localStorage.setItem(CLE_MODE, mode)
  } catch {
    // Sans stockage, le choix ne survivra pas a la session — mais il s'applique.
  }
  for (const abonne of abonnesAuMode) abonne(mode)
}

/** Notifie les ecrans ouverts, y compris depuis un autre onglet du meme navigateur. */
export function sAbonnerAuModeTraduction(abonne: (mode: ModeTraduction) => void): () => void {
  abonnesAuMode.add(abonne)
  return () => abonnesAuMode.delete(abonne)
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (evenement) => {
    if (evenement.key !== CLE_MODE) return
    const mode = lireModeTraduction()
    for (const abonne of abonnesAuMode) abonne(mode)
  })
}

/* ------------------------------------- Traduction automatique par conversation */

/**
 * Conversations dont l'utilisateur a demande la traduction continue. Stocke en
 * localStorage et NON dans le magasin `conversations` : `cacheConversations`
 * ecrase l'objet entier par un `put()` a chaque synchronisation, le drapeau
 * disparaitrait a la premiere mise a jour de la liste.
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
  return lireAuto()[conversationId] === true
}

export function definirTraductionAuto(conversationId: string, active: boolean): void {
  const carte = lireAuto()
  if (active) carte[conversationId] = true
  else delete carte[conversationId]
  try {
    localStorage.setItem(CLE_AUTO, JSON.stringify(carte))
  } catch {
    // Preference perdue au rechargement : sans consequence sur la vie privee.
  }
}

/* ---------------------------------------------------------------- Erreurs */

export type CodeErreurTraduction =
  | "meme-langue"
  | "local-indisponible"
  | "en-ligne-desactive"
  | "quota"
  | "service"

const CLE_PAR_CODE: Record<CodeErreurTraduction, Cle> = {
  "meme-langue": "trad_err_same_language",
  "local-indisponible": "trad_err_local_unavailable",
  "en-ligne-desactive": "trad_err_online_disabled",
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
  if (lireModeTraduction() === "en-ligne") return "en-ligne"
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
 */
let pauseRelaisJusqua = 0
const PAUSE_QUOTA_MS = 5 * 60 * 1000
const PAUSE_SERVICE_MS = 30 * 1000

async function appelerRelais(cible: string, elements: ElementRelais[]): Promise<ResultatRelais[]> {
  if (Date.now() < pauseRelaisJusqua) throw new TraductionError("service")
  try {
    const reponse = await apiRequest<{ results?: ResultatRelais[] }>("/api/translate", {
      method: "POST",
      body: { target: cible, items: elements },
    })
    return reponse?.results ?? []
  } catch (erreur) {
    if (erreur instanceof ApiError) {
      if (erreur.status === 429) {
        pauseRelaisJusqua = Date.now() + PAUSE_QUOTA_MS
        throw new TraductionError("quota")
      }
      if (erreur.status >= 500 || erreur.status === 0) {
        pauseRelaisJusqua = Date.now() + PAUSE_SERVICE_MS
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

async function preparer(texte: string, cible: string): Promise<Demande> {
  const propre = texte.trim()
  const empreinte = await empreinteTexte(propre)
  const source = normaliserLangue(await detecterLangueMessage(propre)) || null
  if (source && source === normaliserLangue(cible)) throw new TraductionError("meme-langue")
  return { texte: propre, empreinte, source }
}

async function lireEnCache(demande: Demande, cible: string): Promise<ResultatTraduction | null> {
  const sources = demande.source ? [demande.source, SOURCE_INCONNUE] : [SOURCE_INCONNUE]
  for (const source of sources) {
    const entree = await lireTraduction(demande.empreinte, source, cible)
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
export async function traduireMessage(texte: string, cible: string): Promise<ResultatTraduction> {
  const cibleNormalisee = normaliserLangue(cible)
  const demande = await preparer(texte, cibleNormalisee)
  const cleVol = `trad:${demande.empreinte}|${cibleNormalisee}`

  return deduplique(cleVol, async () => {
    const enCache = await lireEnCache(demande, cibleNormalisee)
    if (enCache) return enCache

    // Le moteur local passe AVANT le relais, meme quand la detection stricte a
    // renonce : elle abandonne sur les textes courts — « Bonjour », « ok merci »
    // — qui sont justement les plus nombreux dans une messagerie. Sans ce
    // second essai, ces messages-la partaient tous en ligne, a rebours du mode
    // par defaut, et payants.
    const source =
      demande.source ??
      normaliserLangue((await detecterLangue(demande.texte, { souple: true })) ?? "")
    if (source && source !== cibleNormalisee) {
      const local = await essayerLocal([demande], cibleNormalisee, source)
      if (local[0]) return local[0]
    }

    const enLigne = await traduireParRelais([demande], cibleNormalisee)
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
  cible: string
): Promise<(ResultatTraduction | null)[]> {
  const cibleNormalisee = normaliserLangue(cible)
  const resultats: (ResultatTraduction | null)[] = new Array(textes.length).fill(null)

  const demandes: { index: number; demande: Demande }[] = []
  for (let index = 0; index < textes.length; index += 1) {
    try {
      const demande = await preparer(textes[index], cibleNormalisee)
      const enCache = await lireEnCache(demande, cibleNormalisee)
      if (enCache) resultats[index] = enCache
      else demandes.push({ index, demande })
    } catch {
      // Meme langue ou texte vide : rien a traduire pour cette bulle.
    }
  }
  if (!demandes.length) return resultats

  // Le moteur local ne traite qu'un couple a la fois : on regroupe par source.
  const parSource = new Map<string, { index: number; demande: Demande }[]>()
  const sansSource: { index: number; demande: Demande }[] = []
  for (const entree of demandes) {
    if (!entree.demande.source) sansSource.push(entree)
    else {
      const groupe = parSource.get(entree.demande.source) ?? []
      groupe.push(entree)
      parSource.set(entree.demande.source, groupe)
    }
  }

  const restants: { index: number; demande: Demande }[] = [...sansSource]
  for (const [source, groupe] of parSource) {
    const locaux = await essayerLocal(
      groupe.map((e) => e.demande),
      cibleNormalisee,
      source
    )
    groupe.forEach((entree, position) => {
      const local = locaux[position]
      if (local) resultats[entree.index] = local
      else restants.push(entree)
    })
  }

  if (!restants.length) return resultats

  try {
    const enLigne = await traduireParRelais(
      restants.map((e) => e.demande),
      cibleNormalisee
    )
    restants.forEach((entree, position) => {
      resultats[entree.index] = enLigne[position] ?? null
    })
  } catch {
    // Mode en ligne refuse, quota, panne : les bulles concernees restent en
    // version originale, c'est a l'interface d'expliquer pourquoi.
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
      await ecrireTraduction(demandes[index].empreinte, source, cible, texte, "local")
      resultats.push({ texte, source, cible, moteur: "local" })
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
 * Etage en ligne. Exige un mode explicitement choisi : l'echec du local n'est
 * jamais une autorisation d'envoyer le texte a un tiers.
 */
async function traduireParRelais(
  demandes: Demande[],
  cible: string
): Promise<(ResultatTraduction | null)[]> {
  if (lireModeTraduction() !== "en-ligne") {
    throw new TraductionError(
      traductionLocalePresente() ? "en-ligne-desactive" : "local-indisponible"
    )
  }

  const parEmpreinte = new Map<string, ResultatTraduction>()
  for (let debut = 0; debut < demandes.length; debut += TAILLE_LOT_RELAIS) {
    const lot = demandes.slice(debut, debut + TAILLE_LOT_RELAIS)
    const reponses = await appelerRelais(
      cible,
      lot.map((d) => ({
        empreinte: d.empreinte,
        texte: d.texte,
        ...(d.source ? { source: d.source } : {}),
      }))
    )
    for (const reponse of reponses) {
      if (!reponse?.texte || !reponse.empreinte) continue
      const source = normaliserLangue(reponse.source) || SOURCE_INCONNUE
      await ecrireTraduction(reponse.empreinte, source, cible, reponse.texte, "en-ligne")
      // Second enregistrement sous la source inconnue : sans detection locale,
      // la prochaine lecture n'aura toujours pas de source a mettre dans la cle.
      const demande = lot.find((d) => d.empreinte === reponse.empreinte)
      if (demande && !demande.source) {
        await ecrireTraduction(reponse.empreinte, SOURCE_INCONNUE, cible, reponse.texte, "en-ligne")
      }
      parEmpreinte.set(reponse.empreinte, {
        texte: reponse.texte,
        source,
        cible,
        moteur: "en-ligne",
      })
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
