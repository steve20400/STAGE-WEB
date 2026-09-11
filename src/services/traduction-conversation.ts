import { apiRequest } from "../lib/api-client"
import { normaliserLangue } from "./traduction-locale"

/**
 * LES RÉGLAGES DE TRADUCTION D'UNE CONVERSATION, ET L'INTERRUPTEUR GÉNÉRAL.
 *
 * 🔴 POURQUOI CE MODULE EXISTE. Le moteur devait deviner seul la langue de
 * chaque message entrant, et se trompait souvent — mauvaise langue source, ou
 * pas de traduction du tout. L'utilisateur, lui, sait parfaitement dans quelle
 * langue son correspondant écrit. Le lui faire déclarer une fois SUPPRIME la
 * devinette au lieu d'essayer de l'améliorer.
 *
 * ⚠️ LA VÉRITÉ EST AU SERVEUR, ce fichier n'en tient qu'une copie. « Dans quelle
 * langue écrit cette personne » est une propriété de la PERSONNE, pas de
 * l'appareil : la redéclarer sur chaque navigateur serait absurde. Le cache
 * local n'est là que pour ne pas faire un aller-retour réseau à chaque message
 * reçu — et pour que la première fournée de messages s'affiche déjà juste après
 * un rechargement, avant que la liste des conversations ne soit revenue.
 */

/* ─────────────────────────────────────────── Le type */

export interface ReglagesTraduction {
  /** Langue déclarée du correspondant. `null` = détection automatique. */
  langueSource: string | null
  /**
   * Traduction de CETTE conversation, en trois états.
   *
   * 🔴 `null` N'EST PAS `false`. Il veut dire « suit le réglage général », et
   * c'est le troisième état sans lequel tout le mécanisme s'effondre : avec un
   * booléen, l'application confondrait « jamais touché par l'utilisateur » et
   * « éteint volontairement », et activer le général rallumerait des
   * conversations qu'on avait expressément éteintes.
   */
  auto: boolean | null
}

const VIDE: ReglagesTraduction = { langueSource: null, auto: null }

/* ─────────────────────────────────────────── Le cache */

const CLE_CACHE = "alanya-traduction-conversations-v1"
const CLE_GLOBALE = "alanya-traduction-globale-v1"
/** Ancienne carte `{ convId: false }`, d'avant les trois états. */
const CLE_HERITEE = "alanya-traduction-auto-v1"
const CLE_MIGRATION = "alanya-traduction-migration-v1"

/** Émis à chaque changement, avec `{ conversationId }` ou `{}` pour le général. */
export const EVENEMENT_REGLAGES_TRADUCTION = "alanya:traduction-reglages"

let memoire: Record<string, ReglagesTraduction> | null = null

function lireDisque(): Record<string, ReglagesTraduction> {
  try {
    const brut = localStorage.getItem(CLE_CACHE)
    if (!brut) return {}
    const valeur = JSON.parse(brut) as unknown
    return valeur && typeof valeur === "object"
      ? (valeur as Record<string, ReglagesTraduction>)
      : {}
  } catch {
    return {}
  }
}

function carte(): Record<string, ReglagesTraduction> {
  if (memoire === null) {
    memoire = lireDisque()
    migrerDepuisAncienneCarte()
  }
  return memoire
}

function ecrireDisque(): void {
  try {
    localStorage.setItem(CLE_CACHE, JSON.stringify(memoire ?? {}))
  } catch {
    // Quota plein ou navigation privée : on garde la copie en mémoire, et le
    // serveur reste la référence au prochain chargement de la liste.
  }
}

function prevenir(conversationId?: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent(EVENEMENT_REGLAGES_TRADUCTION, { detail: { conversationId } })
    )
  } catch {
    // Hors navigateur : personne n'écoute, il n'y a rien à accorder.
  }
}

/* ─────────────────────────────────────────── La migration */

/**
 * REPREND L'ANCIEN RÉGLAGE SANS RIEN ÉTEINDRE.
 *
 * 🔴 SANS CETTE MIGRATION, LA TRADUCTION S'ARRÊTERAIT POUR TOUT LE MONDE le jour
 * du déploiement. L'ancien `traductionAutoActive` rendait `true` PAR DÉFAUT :
 * toute conversation traduisait, sauf celles qu'on avait explicitement éteintes.
 * Le nouveau modèle fait hériter du réglage général, lequel part éteint. Sans
 * rien faire, chaque conversation jamais réglée cesserait donc de traduire, sans
 * que personne ait rien demandé ni ne comprenne pourquoi.
 *
 * On allume donc le général une fois, et on reprend les exceptions telles
 * quelles. Le comportement observé ne change pas d'un iota.
 *
 * ⚠️ AUCUN TÉLÉCHARGEMENT N'EST DÉCLENCHÉ ICI. Les paquets des trois langues ne
 * s'installent qu'à une activation VOLONTAIRE : le navigateur refuse de toute
 * façon un téléchargement hors d'un geste de l'utilisateur, et ces comptes-là
 * traduisent déjà — ils n'ont besoin de rien.
 */
function migrerDepuisAncienneCarte(): void {
  try {
    if (localStorage.getItem(CLE_MIGRATION) === "1") return
    localStorage.setItem(CLE_MIGRATION, "1")

    if (localStorage.getItem(CLE_GLOBALE) === null) {
      localStorage.setItem(CLE_GLOBALE, "1")
    }

    const brut = localStorage.getItem(CLE_HERITEE)
    if (!brut) return
    const ancienne = JSON.parse(brut) as Record<string, boolean>
    if (!ancienne || typeof ancienne !== "object") return

    for (const [convId, actif] of Object.entries(ancienne)) {
      // L'ancienne carte ne retenait QUE les exceptions, toujours `false` :
      // « activé » s'y écrivait en effaçant l'entrée.
      if (actif === false && memoire && !memoire[convId]) {
        memoire[convId] = { langueSource: null, auto: false }
      }
    }
    ecrireDisque()
  } catch {
    // Rien de vital : au pire le général part éteint et l'utilisateur le
    // rallume. On ne casse pas le chargement du module pour ça.
  }
}

/* ─────────────────────────────────────────── L'interrupteur général */

export function traductionGlobaleActive(): boolean {
  try {
    carte() // force la migration au premier accès
    return localStorage.getItem(CLE_GLOBALE) === "1"
  } catch {
    return false
  }
}

export function definirTraductionGlobale(active: boolean): boolean {
  try {
    localStorage.setItem(CLE_GLOBALE, active ? "1" : "0")
  } catch {
    // Préférence perdue au rechargement, sans conséquence.
  }
  prevenir()
  return active
}

/** Le général a-t-il déjà été activé au moins une fois ? */
export function traductionGlobaleDejaActivee(): boolean {
  try {
    return localStorage.getItem(CLE_GLOBALE) !== null
  } catch {
    return false
  }
}

/* ─────────────────────────────────────────── Lecture */

/** Les réglages connus d'une conversation. Jamais `null` : le vide est un état. */
export function reglagesDe(conversationId: string): ReglagesTraduction {
  if (!conversationId) return VIDE
  return carte()[conversationId] ?? VIDE
}

/**
 * Range ce que le serveur vient de dire. Appelé à la lecture de la liste des
 * conversations, qui porte déjà les deux champs.
 *
 * ⚠️ NE PRÉVIENT QUE SI QUELQUE CHOSE A CHANGÉ. Cette fonction est appelée pour
 * chaque conversation à chaque rafraîchissement de la liste ; émettre à chaque
 * fois ferait recalculer toutes les bulles de la conversation ouverte plusieurs
 * fois par minute, pour rien.
 */
export function memoriserReglages(
  conversationId: string,
  recus: Partial<ReglagesTraduction>
): void {
  if (!conversationId) return
  const c = carte()
  const avant = c[conversationId] ?? VIDE
  const apres: ReglagesTraduction = {
    langueSource: recus.langueSource ?? null,
    auto: recus.auto ?? null,
  }
  if (avant.langueSource === apres.langueSource && avant.auto === apres.auto) return
  c[conversationId] = apres
  ecrireDisque()
  prevenir(conversationId)
}

/**
 * Cette conversation doit-elle se traduire toute seule ?
 *
 * 🔴 LE RÉGLAGE LOCAL PRIME TOUJOURS SUR LE GÉNÉRAL. C'est la règle entière, et
 * elle tient en une ligne parce que le troisième état existe : une conversation
 * qui n'a jamais été réglée porte `null` et suit le général ; une conversation
 * réglée porte `true` ou `false` et lui résiste.
 */
export function traductionActivePour(conversationId: string): boolean {
  const { auto } = reglagesDe(conversationId)
  if (auto !== null) return auto
  return traductionGlobaleActive()
}

/**
 * La langue à passer au moteur pour les messages REÇUS de cette conversation,
 * ou `null` pour laisser la détection faire son travail.
 *
 * ⚠️ REND `null` QUAND LA LANGUE DÉCLARÉE EST CELLE DE LECTURE — et l'appelant
 * doit alors ne rien traduire du tout. Voir [traduireCetteConversation].
 */
export function langueSourceDe(conversationId: string): string | null {
  return reglagesDe(conversationId).langueSource
}

/**
 * Faut-il traduire les messages de cette conversation vers [langueLecture] ?
 *
 * 🔴 DÉCLARER LA LANGUE DU CORRESPONDANT COMME LA SIENNE ÉTEINT LA TRADUCTION.
 * Cela paraît évident et c'est pourtant le cas qui coûte le plus cher si on
 * l'oublie : aucun appel au moteur, aucun téléchargement de paquet, aucune
 * latence — au lieu d'un aller-retour par message pour s'entendre dire que la
 * source et la cible sont identiques.
 *
 * ⚠️ LA COMPARAISON SE FAIT AU MOMENT DE TRADUIRE, jamais au moment de choisir.
 * Quelqu'un qui déclare « français » puis passe son interface en anglais doit
 * voir la traduction reprendre : figer la décision au moment du choix
 * l'enfermerait dans un réglage devenu faux.
 */
export function traduireCetteConversation(
  conversationId: string,
  langueLecture: string
): boolean {
  if (!traductionActivePour(conversationId)) return false
  const source = langueSourceDe(conversationId)
  if (!source) return true
  return normaliserLangue(source) !== normaliserLangue(langueLecture)
}

/* ─────────────────────────────────────────── Écriture */

interface ReponseServeur {
  convId: string
  langueSource: string | null
  auto: boolean | null
}

/**
 * Envoie un réglage au serveur et retient ce qu'il a VRAIMENT enregistré.
 *
 * ⚠️ LE CACHE EST MIS À JOUR AVANT L'APPEL, et corrigé après. L'interrupteur
 * doit basculer sous le doigt : attendre le réseau donnerait un bouton qui
 * paraît mort une demi-seconde. En cas de refus, la valeur du serveur reprend sa
 * place — l'écran ne peut donc pas rester sur une promesse fausse.
 */
async function envoyer(
  conversationId: string,
  corps: Record<string, unknown>,
  optimiste: ReglagesTraduction
): Promise<ReglagesTraduction> {
  const c = carte()
  const avant = c[conversationId] ?? VIDE
  c[conversationId] = optimiste
  ecrireDisque()
  prevenir(conversationId)

  try {
    const reponse = await apiRequest<ReponseServeur>(
      `/api/conversations/${conversationId}/traduction`,
      { method: "POST", body: corps }
    )
    const retenu: ReglagesTraduction = {
      langueSource: reponse.langueSource ?? null,
      auto: reponse.auto ?? null,
    }
    c[conversationId] = retenu
    ecrireDisque()
    prevenir(conversationId)
    return retenu
  } catch (err) {
    c[conversationId] = avant
    ecrireDisque()
    prevenir(conversationId)
    throw err
  }
}

/** Déclare la langue du correspondant, ou `null` pour revenir à la détection. */
export function definirLangueSource(
  conversationId: string,
  langue: string | null
): Promise<ReglagesTraduction> {
  const actuel = reglagesDe(conversationId)
  return envoyer(
    conversationId,
    { langueSource: langue },
    { ...actuel, langueSource: langue }
  )
}

/** Règle cette conversation : `true`, `false`, ou `null` pour suivre le général. */
export function definirAutoConversation(
  conversationId: string,
  auto: boolean | null
): Promise<ReglagesTraduction> {
  const actuel = reglagesDe(conversationId)
  return envoyer(conversationId, { auto }, { ...actuel, auto })
}
