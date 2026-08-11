/**
 * Mode LOCAL : enveloppe des API `Translator` et `LanguageDetector` du
 * navigateur (Chrome et Edge 138+, sur ordinateur).
 *
 * C'est le seul moteur qui satisfait litteralement la demande : les modeles
 * sont telecharges et geres par le navigateur, la traduction s'execute sur
 * l'appareil, rien ne part vers un tiers, et le cout est nul. C'est aussi le
 * premier levier d'economie du mode en ligne, puisque tout ce qui est traduit
 * ici n'est jamais facture.
 *
 * Ce fichier ne connait ni le cache, ni le relais, ni le mode choisi : il ne
 * repond qu'a « ce navigateur sait-il traduire ce couple, et comment ».
 */

/* ------------------------------------------------------- Types du navigateur */

/** Etats renvoyes par `availability()`, tels que definis par la specification. */
export type DisponibiliteCouple = "unavailable" | "downloadable" | "downloading" | "available"

interface MoniteurTelechargement {
  addEventListener(
    type: "downloadprogress",
    ecouteur: (evenement: { loaded: number }) => void
  ): void
}

interface OptionsCouple {
  sourceLanguage: string
  targetLanguage: string
  monitor?: (moniteur: MoniteurTelechargement) => void
  signal?: AbortSignal
}

interface InstanceTraducteur {
  translate(texte: string): Promise<string>
  destroy(): void
  measureInputUsage?(texte: string): Promise<number>
  inputQuota?: number
}

interface ResultatDetection {
  detectedLanguage: string
  confidence: number
}

interface InstanceDetecteur {
  detect(texte: string): Promise<ResultatDetection[]>
  destroy(): void
}

interface FabriqueTraducteur {
  availability(options: OptionsCouple): Promise<DisponibiliteCouple>
  create(options: OptionsCouple): Promise<InstanceTraducteur>
}

interface FabriqueDetecteur {
  availability(options?: { expectedInputLanguages?: string[] }): Promise<DisponibiliteCouple>
  create(options?: {
    monitor?: (moniteur: MoniteurTelechargement) => void
    signal?: AbortSignal
  }): Promise<InstanceDetecteur>
}

declare global {
  var Translator: FabriqueTraducteur | undefined

  var LanguageDetector: FabriqueDetecteur | undefined
}

/* ------------------------------------------------------------- Disponibilite */

/**
 * Presence du moteur local.
 *
 * On ne teste que `'Translator' in self` : `window.ai.translator` et
 * `window.translation` sont des surfaces d'anciennes versions d'essai, les
 * chercher ferait croire a une disponibilite qui n'existe plus.
 *
 * `LanguageDetector` est exige au meme titre : les deux expedient ensemble, et
 * sans detection il n'y a pas de langue source. Il n'existe volontairement
 * aucune detection de secours cote serveur — elle enverrait le contenu a un
 * tiers pour decider s'il faut l'envoyer a un tiers.
 */
export function traductionLocalePresente(): boolean {
  return typeof self !== "undefined" && "Translator" in self && "LanguageDetector" in self
}

/**
 * Codes de langue.
 *
 * Le catalogue du projet parle `no` la ou le navigateur et les detecteurs
 * renvoient `nb` (bokmal), et decline le chinois en `zh-Hans` / `zh-CN` la ou
 * le projet ne connait que `zh` simplifie. Sans cette normalisation, une
 * detection correcte serait lue comme une langue inconnue et le bouton de
 * traduction ne s'afficherait jamais.
 */
export function normaliserLangue(code: string | null | undefined): string {
  if (!code) return ""
  const court = code.toLowerCase().replace("_", "-")
  if (court === "nb" || court.startsWith("nb-") || court.startsWith("nn")) return "no"
  if (court.startsWith("zh")) return "zh"
  return court.slice(0, 2)
}

/**
 * Un seul objet d'options par couple, reutilise a l'identique par
 * `availability()` et par `create()`.
 *
 * Ce n'est pas une micro-optimisation : sonder la disponibilite avec des
 * options differentes de celles de la creation revient a interroger un autre
 * couple, et la reponse ne dit alors rien de ce qu'on s'apprete a faire.
 */
const optionsParCouple = new Map<string, OptionsCouple>()

/** Rapporteur de progression courant du couple, remplace a chaque telechargement. */
const progressionParCouple = new Map<string, (fraction: number) => void>()

function cleCouple(source: string, cible: string): string {
  return `${source}>${cible}`
}

function optionsCouple(source: string, cible: string): OptionsCouple {
  const cle = cleCouple(source, cible)
  const existantes = optionsParCouple.get(cle)
  if (existantes) return existantes
  const options: OptionsCouple = {
    sourceLanguage: source,
    targetLanguage: cible,
    // Le moniteur est TOUJOURS fourni : sans lui, un couple a telecharger
    // bloque sans rien signaler et l'interface parait figee.
    monitor(moniteur) {
      moniteur.addEventListener("downloadprogress", (evenement) => {
        // `loaded` va de 0 a 1, pas de 0 a 100.
        progressionParCouple.get(cle)?.(evenement.loaded)
      })
    },
  }
  optionsParCouple.set(cle, options)
  return options
}

/**
 * Disponibilite sondee pendant cette session.
 *
 * Elle n'est jamais persistee : un paquet de langue est evince par Chrome des
 * que l'espace disque libre passe sous 10 Go, une reponse d'hier ne dit donc
 * rien d'aujourd'hui. Le cache ne vit que le temps de l'onglet.
 */
const disponibiliteSondee = new Map<string, DisponibiliteCouple>()

export async function disponibiliteCouple(
  source: string,
  cible: string
): Promise<DisponibiliteCouple> {
  if (!traductionLocalePresente()) return "unavailable"
  if (source === cible) return "unavailable"
  const cle = cleCouple(source, cible)
  const connue = disponibiliteSondee.get(cle)
  if (connue) return connue
  try {
    const etat = await globalThis.Translator!.availability(optionsCouple(source, cible))
    disponibiliteSondee.set(cle, etat)
    return etat
  } catch {
    // Options refusees, couple inconnu, fonctionnalite desactivee par une
    // politique d'entreprise : dans tous les cas, on ne sait pas traduire.
    disponibiliteSondee.set(cle, "unavailable")
    return "unavailable"
  }
}

/** Oublie les sondages, pour reevaluer apres un telechargement ou un retour d'onglet. */
export function reevaluerDisponibilite(): void {
  disponibiliteSondee.clear()
}

/* ------------------------------------------------------------------- Instances */

/**
 * Un traducteur par couple, garde en memoire.
 *
 * Creer une instance par message serait le defaut le plus couteux possible :
 * chaque `create()` recharge le modele. Le pool est libere au changement de
 * conversation et quand l'onglet passe en arriere-plan, ou la memoire du modele
 * n'a plus de raison d'etre retenue.
 */
const pool = new Map<string, Promise<InstanceTraducteur>>()

function instanceCouple(source: string, cible: string): Promise<InstanceTraducteur> {
  const cle = cleCouple(source, cible)
  const existante = pool.get(cle)
  if (existante) return existante
  const promesse = globalThis
    .Translator!.create(optionsCouple(source, cible))
    .catch((erreur: unknown) => {
      // Une creation echouee ne doit pas rester dans le pool : la prochaine
      // tentative retomberait indefiniment sur la meme promesse rejetee.
      pool.delete(cle)
      throw erreur
    })
  pool.set(cle, promesse)
  return promesse
}

/** Detruit les traducteurs en memoire. Les paquets telecharges, eux, restent. */
export function libererTraducteurs(): void {
  for (const promesse of pool.values()) {
    void promesse.then(
      (instance) => instance.destroy(),
      () => undefined
    )
  }
  pool.clear()
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      libererTraducteurs()
      // Au retour, l'espace disque a pu changer : on resonde plutot que de
      // croire un etat vieux de plusieurs heures.
      reevaluerDisponibilite()
    }
  })
}

/* -------------------------------------------------------------- Telechargement */

export class TelechargementRefuse extends Error {}

/**
 * Telecharge les composants d'un couple.
 *
 * DOIT partir d'un clic de l'utilisateur : hors geste utilisateur, Chrome
 * repond `NotAllowedError`. Il n'existe donc aucun appel legitime a cette
 * fonction depuis un `useEffect` de montage.
 *
 * `surProgression` recoit une fraction entre 0 et 1. Des evenements sont emis
 * meme quand rien n'est reellement telecharge : leur presence ne prouve pas
 * qu'un paquet a ete installe.
 *
 * Un couple sans anglais coute deux paquets, le navigateur passant en interne
 * par l'anglais. Ce pivot ne doit jamais etre code ici : le faire soi-meme
 * doublerait les allers-retours et degraderait la qualite.
 */
export async function telechargerCouple(
  source: string,
  cible: string,
  surProgression?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<DisponibiliteCouple> {
  if (!traductionLocalePresente()) return "unavailable"
  const cle = cleCouple(source, cible)
  if (surProgression) progressionParCouple.set(cle, surProgression)
  try {
    // Le telechargement n'a pas d'appel dedie : c'est `create()` qui le
    // declenche, et c'est aussi lui qui revele l'etat reel du couple.
    const instance = await instanceCouple(source, cible)
    if (signal?.aborted) {
      instance.destroy()
      pool.delete(cle)
      throw new TelechargementRefuse("annule")
    }
    disponibiliteSondee.set(cle, "available")
    return "available"
  } catch (erreur) {
    disponibiliteSondee.delete(cle)
    if (erreur instanceof DOMException && erreur.name === "NotAllowedError") {
      throw new TelechargementRefuse(erreur.message)
    }
    throw erreur
  } finally {
    progressionParCouple.delete(cle)
  }
}

/* ---------------------------------------------------------------- Traduction */

/**
 * Taille d'un lot traite d'affilee.
 *
 * L'API n'a pas de Web Worker : `translate()` s'execute sur le fil principal.
 * Lancer trente traductions d'un coup fige l'interface le temps du dernier
 * message ; cinq laissent le fil rendre entre deux lots.
 */
const TAILLE_LOT = 5

/**
 * File sequentielle globale : deux ecrans qui traduisent en meme temps ne
 * doivent pas se disputer le fil principal.
 */
let file: Promise<unknown> = Promise.resolve()

function enfiler<T>(travail: () => Promise<T>): Promise<T> {
  const suivant = file.then(travail, travail)
  // La file ne doit pas s'arreter sur un echec de l'un de ses maillons.
  file = suivant.catch(() => undefined)
  return suivant
}

export class LocalIndisponible extends Error {}

/**
 * Traduit une liste de textes sur l'appareil, dans l'ordre recu.
 *
 * Leve `LocalIndisponible` si le moteur ou le couple manque : c'est
 * l'orchestrateur qui decide quoi faire de ce cas, pas cette couche.
 */
export async function traduireLocalement(
  source: string,
  cible: string,
  textes: string[]
): Promise<string[]> {
  if (!traductionLocalePresente()) throw new LocalIndisponible("moteur absent")
  const etat = await disponibiliteCouple(source, cible)
  // `downloadable` n'est pas une erreur, mais l'installation ne peut partir que
  // d'un clic dans les Parametres : traduire ici la declencherait en douce.
  if (etat !== "available") throw new LocalIndisponible(etat)

  return enfiler(async () => {
    const instance = await instanceCouple(source, cible)
    const resultats: string[] = []
    for (let debut = 0; debut < textes.length; debut += TAILLE_LOT) {
      const lot = textes.slice(debut, debut + TAILLE_LOT)
      for (const texte of lot) {
        resultats.push(await traduireUn(instance, texte))
      }
      // Une respiration entre deux lots : le fil principal rend la main.
      if (debut + TAILLE_LOT < textes.length) await new Promise((r) => setTimeout(r, 0))
    }
    return resultats
  })
}

/**
 * Un message trop long depasse le contexte du modele. Le mesurer avant coute
 * bien moins cher que de decouvrir l'echec apres avoir occupe le fil principal.
 */
async function traduireUn(instance: InstanceTraducteur, texte: string): Promise<string> {
  if (instance.measureInputUsage && typeof instance.inputQuota === "number") {
    try {
      const usage = await instance.measureInputUsage(texte)
      if (usage > instance.inputQuota) throw new LocalIndisponible("texte trop long")
    } catch (erreur) {
      if (erreur instanceof LocalIndisponible) throw erreur
      // La mesure est facultative : son echec ne doit pas empecher l'essai.
    }
  }
  return instance.translate(texte)
}

/* ----------------------------------------------------------------- Detection */

let detecteur: Promise<InstanceDetecteur> | null = null

/**
 * Langue d'un texte, detectee sur l'appareil, ou null.
 *
 * Un score faible vaut une absence de reponse : mieux vaut ne pas proposer de
 * traduction que d'en proposer une depuis la mauvaise langue, qui produirait un
 * charabia et, en mode en ligne, une depense pour rien.
 */
export async function detecterLangue(texte: string): Promise<string | null> {
  if (!traductionLocalePresente()) return null
  const propre = texte.trim()
  // Sur deux ou trois caracteres, la detection tire au sort.
  if (propre.length < 8) return null
  try {
    if (!detecteur) {
      detecteur = globalThis
        .LanguageDetector!.create({
          monitor(moniteur) {
            moniteur.addEventListener("downloadprogress", () => undefined)
          },
        })
        .catch((erreur: unknown) => {
          detecteur = null
          throw erreur
        })
    }
    const instance = await detecteur
    const resultats = await enfiler(() => instance.detect(propre))
    const meilleur = resultats?.[0]
    if (!meilleur || meilleur.confidence < 0.5) return null
    const langue = normaliserLangue(meilleur.detectedLanguage)
    return langue || null
  } catch {
    return null
  }
}
