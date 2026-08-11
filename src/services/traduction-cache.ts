import { initIndexedDB } from "../indexedDB/schema"

/**
 * Cache local des traductions de messages.
 *
 * Il existe pour deux raisons qui vont dans le meme sens : ne pas repayer une
 * traduction deja obtenue, et surtout ne pas RE-EXPOSER deux fois le meme texte
 * prive a un tiers. C'est pour cela qu'il n'y a volontairement aucun TTL : une
 * traduction ne perime pas, et l'expirer forcerait a renvoyer le message.
 *
 * L'application mobile, elle, ne cache rien (`lib/core/translate_service.dart`) :
 * chaque affichage retraduit et renvoie le contenu. Le web diverge ici, et c'est
 * assume.
 */

/** Type du moteur ayant produit la traduction, affiche sous la bulle. */
export type MoteurTraduction = "local" | "en-ligne"

export interface EntreeTraduction {
  cle: string
  texte: string
  source: string
  cible: string
  moteur: MoteurTraduction
  creeLe: number
  luLe: number
}

/**
 * Plafond d'entrees. A ~400 octets par entree cela represente 8 a 10 Mo, a
 * comparer aux 150 Mo deja concedes au cache d'apercus de medias : la
 * traduction ne doit pas devenir le poste de stockage dominant.
 */
const MAX_ENTREES = 20_000

/** Balayage d'eviction tous les N ecrits, pas a chaque traduction. */
const ECRITURES_ENTRE_EVICTIONS = 200

/**
 * `luLe` n'est reecrit que passe ce delai. Sans ce seuil, chaque bulle affichee
 * declencherait une ecriture IndexedDB au defilement.
 */
const FRAICHEUR_LU_MS = 24 * 60 * 60 * 1000

/**
 * Au-dela de ce nombre de langues cibles distinctes, la moins recemment servie
 * est supprimee. Les allers-retours entre deux langues sont frequents et ne
 * doivent rien couter ; accumuler neuf cibles, non.
 */
const MAX_LANGUES_CIBLES = 3

/**
 * Invalidation en masse, sur le modele de `PURGE_MARKER_KEY` de
 * media-preview-cache. La generation vit en localStorage et NON dans la cle :
 * une generation dans la cle laisserait les anciennes entrees en place a
 * consommer du quota sans jamais etre relues.
 */
const MARQUEUR_GENERATION = "alanya_traduction_cache_generation"
const GENERATION = "2026-08-initial"

const MAGASIN = "traductions"

/**
 * Borne haute d'une plage de cles commencant par une empreinte. U+FFFF trie
 * apres tout caractere que peut contenir un separateur de cle.
 */
const BORNE_HAUTE = "\uffff"

/**
 * Repli quand IndexedDB est indisponible (navigation privee, quota epuise,
 * migration bloquee par un autre onglet). Le cache est une optimisation : il ne
 * doit jamais empecher une traduction d'aboutir, seulement cesser de survivre a
 * la session.
 */
const memoire = new Map<string, EntreeTraduction>()

let ecrituresDepuisEviction = 0

/* ---------------------------------------------------------------- Empreinte */

/**
 * Empreinte du CONTENU : SHA-256 tronque a 128 bits (32 hexa).
 *
 * Elle remplace l'identifiant de message, et ce choix regle seul plusieurs
 * problemes : les identifiants optimistes (`tmp-…`, `outbox_…`) qui deviennent
 * des identifiants serveur ne laissent aucune entree orpheline, une edition de
 * message invalide structurellement sans code d'invalidation a ecrire, et les
 * « ok », « merci » ou messages transferes se dedupliquent gratuitement.
 */
export async function empreinteTexte(texte: string): Promise<string> {
  const normalise = texte.trim().normalize("NFC")
  const sousCrypto = globalThis.crypto?.subtle
  if (sousCrypto) {
    try {
      const octets = await sousCrypto.digest("SHA-256", new TextEncoder().encode(normalise))
      const vue = new Uint8Array(octets, 0, 16)
      let hexa = ""
      for (const octet of vue) hexa += octet.toString(16).padStart(2, "0")
      return hexa
    } catch {
      // Contexte non securise : on retombe sur l'empreinte de secours.
    }
  }
  return empreinteDeSecours(normalise)
}

/**
 * `crypto.subtle` n'existe qu'en contexte securise. Sur un deploiement servi en
 * HTTP, le cache doit continuer de fonctionner : cette empreinte n'a aucune
 * propriete cryptographique, elle n'a besoin que d'etre deterministe et de
 * repartir assez bien pour un cache local. Le prefixe evite toute confusion
 * avec une vraie empreinte si le site repasse en HTTPS.
 */
function empreinteDeSecours(texte: string): string {
  const graines = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]
  const morceaux = graines.map((graine) => {
    let h = graine >>> 0
    for (let i = 0; i < texte.length; i += 1) {
      h ^= texte.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, "0")
  })
  return `x${morceaux.join("").slice(0, 31)}`
}

/** Clef d'une traduction. L'empreinte est en tete : voir `oublierEmpreinte`. */
function cleTraduction(empreinte: string, source: string, cible: string): string {
  return `${empreinte}|${source}|${cible}`
}

/** Clef d'une detection de langue, dans le meme magasin et le meme espace de cles. */
function cleDetection(empreinte: string): string {
  return `det|${empreinte}`
}

/* ------------------------------------------------------------------- Acces */

/** Une seule purge de generation par session, meme si dix bulles arrivent ensemble. */
let purgeUnique: Promise<void> | null = null

function purgerSiGenerationPerimee(): Promise<void> {
  if (!purgeUnique) {
    purgeUnique = (async () => {
      try {
        if (localStorage.getItem(MARQUEUR_GENERATION) === GENERATION) return
        const db = await initIndexedDB()
        await db.clear(MAGASIN)
        localStorage.setItem(MARQUEUR_GENERATION, GENERATION)
      } catch {
        // Sans stockage, il n'y a rien de perime a purger.
      }
    })()
  }
  return purgeUnique
}

async function lireEntree(cle: string): Promise<EntreeTraduction | null> {
  await purgerSiGenerationPerimee()
  try {
    const db = await initIndexedDB()
    const entree = (await db.get(MAGASIN, cle)) as EntreeTraduction | undefined
    if (entree) {
      void toucher(entree)
      return entree
    }
    return null
  } catch {
    return memoire.get(cle) ?? null
  }
}

/**
 * Rafraichit la date de derniere lecture, qui pilote l'eviction LRU. Bornee a
 * une ecriture par jour et par entree, sinon le simple defilement du fil
 * ecrirait dans IndexedDB a chaque bulle affichee.
 */
async function toucher(entree: EntreeTraduction): Promise<void> {
  if (Date.now() - entree.luLe < FRAICHEUR_LU_MS) return
  try {
    const db = await initIndexedDB()
    await db.put(MAGASIN, { ...entree, luLe: Date.now() })
  } catch {
    // Le LRU perdra en precision, rien de plus.
  }
}

async function ecrireEntree(entree: EntreeTraduction): Promise<void> {
  try {
    const db = await initIndexedDB()
    await db.put(MAGASIN, entree)
    ecrituresDepuisEviction += 1
    await evincerSiNecessaire()
  } catch {
    memoire.set(entree.cle, entree)
  }
}

/** Traduction en cache, ou null. Ne leve jamais. */
export async function lireTraduction(
  empreinte: string,
  source: string,
  cible: string
): Promise<EntreeTraduction | null> {
  return lireEntree(cleTraduction(empreinte, source, cible))
}

/**
 * Enregistre une traduction reussie.
 *
 * Aucun echec n'arrive jamais ici — quota atteint, paquet absent, 429, 502 :
 * rien n'est ecrit. Le bug documente en tete de `media-preview-cache.ts` (une
 * reponse invalide enregistree, relue avant le reseau, survivant au correctif)
 * ne doit pas se rejouer sur du texte de message.
 */
export async function ecrireTraduction(
  empreinte: string,
  source: string,
  cible: string,
  texte: string,
  moteur: MoteurTraduction
): Promise<void> {
  const maintenant = Date.now()
  await ecrireEntree({
    cle: cleTraduction(empreinte, source, cible),
    texte,
    source,
    cible,
    moteur,
    creeLe: maintenant,
    luLe: maintenant,
  })
  await limiterLanguesCibles(cible)
}

/** Langue detectee d'un texte, mise en cache pour ne pas redetecter a chaque rendu. */
export async function lireLangueDetectee(empreinte: string): Promise<string | null> {
  const entree = await lireEntree(cleDetection(empreinte))
  return entree?.texte ?? null
}

export async function ecrireLangueDetectee(empreinte: string, langue: string): Promise<void> {
  const maintenant = Date.now()
  await ecrireEntree({
    cle: cleDetection(empreinte),
    texte: langue,
    source: langue,
    cible: "",
    moteur: "local",
    creeLe: maintenant,
    luLe: maintenant,
  })
}

/**
 * Supprime tout ce qui concerne un texte, toutes cibles confondues.
 *
 * C'est precisement ce que permet l'empreinte en tete de cle, et la raison pour
 * laquelle elle ne peut pas etre « rangee » ailleurs dans la cle en revue.
 * Appele a la reception de `message_deleted`, au seul instant ou le contenu est
 * encore dans l'etat React et l'empreinte donc calculable.
 */
export async function oublierEmpreinte(empreinte: string): Promise<void> {
  try {
    const db = await initIndexedDB()
    const plage = IDBKeyRange.bound(empreinte, empreinte + BORNE_HAUTE)
    const tx = db.transaction(MAGASIN, "readwrite")
    let curseur = await tx.store.openCursor(plage)
    while (curseur) {
      await curseur.delete()
      curseur = await curseur.continue()
    }
    await tx.done
    await db.delete(MAGASIN, cleDetection(empreinte))
  } catch {
    // Suppression au mieux : elle ne doit pas faire echouer la suppression du message.
  }
  for (const cle of Array.from(memoire.keys())) {
    if (cle.startsWith(empreinte) || cle === cleDetection(empreinte)) memoire.delete(cle)
  }
}

/* ---------------------------------------------------------------- Entretien */

/** Retire les entrees les moins recemment lues tant que le plafond est depasse. */
async function evincerSiNecessaire(): Promise<void> {
  if (ecrituresDepuisEviction < ECRITURES_ENTRE_EVICTIONS) return
  ecrituresDepuisEviction = 0
  try {
    const db = await initIndexedDB()
    let restantes = await db.count(MAGASIN)
    if (restantes <= MAX_ENTREES) return
    const tx = db.transaction(MAGASIN, "readwrite")
    let curseur = await tx.store.index("luLe").openCursor()
    while (curseur && restantes > MAX_ENTREES) {
      await curseur.delete()
      restantes -= 1
      curseur = await curseur.continue()
    }
    await tx.done
  } catch {
    // L'entretien du cache ne doit rien interrompre.
  }
}

/**
 * Cibles deja vues pendant cette session : le balayage ci-dessous lit tout le
 * magasin, il ne doit se declencher qu'a l'apparition d'une nouvelle cible et
 * non a chaque traduction enregistree.
 */
const ciblesConnues = new Set<string>()

/**
 * Changer de langue cible ne purge rien : les allers-retours sont frequents et
 * le LRU borne deja le cout. Mais une cible oubliee depuis longtemps ne merite
 * pas de place, on ne garde donc que les plus recemment servies.
 */
async function limiterLanguesCibles(cibleCourante: string): Promise<void> {
  if (ciblesConnues.has(cibleCourante)) return
  ciblesConnues.add(cibleCourante)
  try {
    const db = await initIndexedDB()
    const toutes = (await db.getAll(MAGASIN)) as EntreeTraduction[]
    const dernierUsage = new Map<string, number>()
    for (const entree of toutes) {
      if (!entree.cible) continue
      dernierUsage.set(entree.cible, Math.max(dernierUsage.get(entree.cible) ?? 0, entree.luLe))
    }
    if (dernierUsage.size <= MAX_LANGUES_CIBLES) return
    const classees = Array.from(dernierUsage.entries()).sort((a, b) => b[1] - a[1])
    for (const [cible] of classees.slice(MAX_LANGUES_CIBLES)) {
      if (cible === cibleCourante) continue
      const tx = db.transaction(MAGASIN, "readwrite")
      let curseur = await tx.store.index("cible").openCursor(IDBKeyRange.only(cible))
      while (curseur) {
        await curseur.delete()
        curseur = await curseur.continue()
      }
      await tx.done
    }
  } catch {
    // Idem : optimisation, pas obligation.
  }
}

export interface EtatCacheTraductions {
  entrees: number
  octets: number
}

/**
 * Compte et taille estimee, pour l'affichage dans les Parametres.
 *
 * Les paquets de langue installes par le navigateur ne sont PAS comptes ici :
 * ils ne nous appartiennent pas, ne sont pas purgeables par nous, et c'est leur
 * persistance qui rend la session suivante instantanee.
 */
export async function compterTraductions(): Promise<EtatCacheTraductions> {
  try {
    const db = await initIndexedDB()
    const toutes = (await db.getAll(MAGASIN)) as EntreeTraduction[]
    const octets = toutes.reduce(
      (somme, entree) => somme + entree.cle.length * 2 + entree.texte.length * 2 + 48,
      0
    )
    return { entrees: toutes.length, octets }
  } catch {
    return { entrees: memoire.size, octets: 0 }
  }
}

/** Vide le cache local. N'efface aucun paquet de langue du navigateur. */
export async function viderTraductions(): Promise<void> {
  memoire.clear()
  ciblesConnues.clear()
  try {
    const db = await initIndexedDB()
    await db.clear(MAGASIN)
  } catch {
    // Rien a vider si le stockage est inaccessible.
  }
}

/* ------------------------------------------------------------ Single-flight */

const enVol = new Map<string, Promise<unknown>>()

/**
 * Deduplique les demandes identiques encore en cours.
 *
 * Neutralise d'un coup le double montage de StrictMode, le defilement rapide
 * qui redemande la meme bulle, et deux bulles au texte identique entrant
 * ensemble dans la fenetre visible.
 */
export function deduplique<T>(cle: string, fabrique: () => Promise<T>): Promise<T> {
  const enCours = enVol.get(cle) as Promise<T> | undefined
  if (enCours) return enCours
  const promesse = fabrique().finally(() => {
    enVol.delete(cle)
  })
  enVol.set(cle, promesse)
  return promesse
}
