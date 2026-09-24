/**
 * LE COFFRE LOCAL, CHIFFRÉ — le magasin sous `e2ee-store.ts`.
 *
 * 🔴 CE QU'IL GARDE : les clés PRIVÉES de cet appareil et l'état du Double
 * Ratchet. C'est-à-dire tout ce qui permet de lire les messages. Rien de ce qui
 * entre ici ne doit ressortir en clair, et rien de ce qui est ici ne doit
 * partir sur le réseau.
 *
 * ── CE QUE ÇA APPORTE, ET CE QUE ÇA N'APPORTE PAS ──────────────────────
 *
 * Avant, tout vivait en `localStorage`, en clair. Une ligne de JavaScript sur
 * cette origine — extension, script tiers, injection — lisait l'identité, les
 * pré-clés et les sessions, et pouvait les RECOPIER AILLEURS. Le vol était
 * silencieux, définitif, et rejouable à froid sur une autre machine.
 *
 * ✅ CE QUI CHANGE : la clé du coffre est un `CryptoKey` NON EXTRACTIBLE. Le
 *    navigateur refuse de rendre sa matière — `exportKey` lève. On peut s'en
 *    servir, jamais l'emporter. Un attaquant ne peut plus prendre une copie et
 *    la déchiffrer chez lui : il doit exécuter du code ICI, maintenant.
 *
 * ✅ CE QUI CHANGE AUSSI : une lecture naïve du magasin ne rend que du chiffré.
 *
 * ❌ CE QUE ÇA NE FAIT PAS : un script hostile sur cette origine peut toujours
 *    UTILISER la clé et déchiffrer en direct. Le chiffrement local ne remplace
 *    pas une CSP, et ne rend pas une XSS inoffensive.
 *
 * ❌ CE QUE ÇA NE FAIT PAS NON PLUS : les navigateurs ne garantissent pas la
 *    protection AU REPOS d'une clé logicielle. Qui accède au profil du
 *    navigateur sur le disque n'est pas arrêté par cette barrière.
 *
 * ⚠️ ON PASSE DONC DE « COPIER ET PARTIR » À « ÊTRE PRÉSENT ET AGIR ». C'est un
 * vrai gain, et ce n'est pas une protection absolue. Le dire est plus utile que
 * de laisser croire le contraire.
 *
 * ── LE DEVICE ID N'EST PAS ICI, ET C'EST VOULU ─────────────────────────
 *
 * `alanya.e2ee.deviceId` reste en `localStorage`, en clair. Ce n'est PAS un
 * secret : c'est l'identifiant d'appareil que la connexion envoie déjà au
 * serveur. Le chiffrer obligerait `idAppareil()` — appelé partout, de façon
 * synchrone — à devenir asynchrone, pour un gain de sécurité nul.
 */

/* ══════════════════ LE MAGASIN ══════════════════ */

const BASE = "alanya-coffre-e2ee"
const VERSION = 1
const MAGASIN_CLE = "cle"
const MAGASIN_SECRETS = "secrets"
const ID_CLE = "principale"

/** Le préfixe de l'ancien coffre, pour la reprise. */
const PREFIXE_ANCIEN = "alanya.e2ee."

/** Celui-là ne déménage pas — voir l'en-tête. */
const CLE_DEVICE = "alanya.e2ee.deviceId"

interface Enregistre {
  cle: string
  iv: ArrayBuffer
  chiffre: ArrayBuffer
}

function ouvrirBase(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const requete = indexedDB.open(BASE, VERSION)
    requete.onupgradeneeded = () => {
      const db = requete.result
      if (!db.objectStoreNames.contains(MAGASIN_CLE)) {
        db.createObjectStore(MAGASIN_CLE)
      }
      if (!db.objectStoreNames.contains(MAGASIN_SECRETS)) {
        db.createObjectStore(MAGASIN_SECRETS, { keyPath: "cle" })
      }
    }
    requete.onsuccess = () => resoudre(requete.result)
    requete.onerror = () => rejeter(requete.error ?? new Error("IndexedDB refusé"))
  })
}

function promesse<T>(requete: IDBRequest<T>): Promise<T> {
  return new Promise((resoudre, rejeter) => {
    requete.onsuccess = () => resoudre(requete.result)
    requete.onerror = () => rejeter(requete.error ?? new Error("requête refusée"))
  })
}

/* ══════════════════ LA CLÉ ══════════════════ */

/**
 * Récupère la clé du coffre, ou en crée une.
 *
 * 🔴 `extractable: false` EST LA LIGNE QUI PORTE TOUT CE FICHIER. Avec `true`,
 * le coffre chiffré ne vaudrait pas mieux que `localStorage` : il suffirait
 * d'exporter la clé rangée juste à côté des secrets qu'elle protège.
 *
 * ⚠️ UN `CryptoKey` SE RANGE TEL QUEL DANS INDEXEDDB. C'est ce qui rend la
 * chose possible : le navigateur le sérialise par sa propre voie, sans jamais
 * exposer sa matière au JavaScript.
 */
async function cleDuCoffre(db: IDBDatabase): Promise<CryptoKey> {
  const lecture = db.transaction(MAGASIN_CLE, "readonly").objectStore(MAGASIN_CLE)
  const existante = await promesse(lecture.get(ID_CLE))
  if (existante) return existante as CryptoKey

  const neuve = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])

  const ecriture = db.transaction(MAGASIN_CLE, "readwrite").objectStore(MAGASIN_CLE)
  await promesse(ecriture.put(neuve, ID_CLE))
  return neuve
}

/* ══════════════════ L'ÉTAT EN MÉMOIRE ══════════════════ */

/*
 * ⚠️ POURQUOI UNE COPIE EN MÉMOIRE, ET POURQUOI ELLE FAIT AUTORITÉ.
 *
 * `StorageType`, l'interface de la bibliothèque Signal, appelle nos lectures au
 * milieu d'un déchiffrement. IndexedDB est asynchrone ; `localStorage` ne
 * l'était pas. Tout convertir en asynchrone remonterait jusque dans le
 * protocole, qu'on ne réécrit pas.
 *
 * On charge donc TOUT au démarrage, on sert les lectures depuis la mémoire, et
 * on persiste les écritures derrière. Le coffre tient dans quelques dizaines de
 * kilo-octets : quarante sessions au plus, plafonnées par la bibliothèque
 * elle-même.
 *
 * ⚠️ CONSÉQUENCE À CONNAÎTRE : une écriture perdue entre la mémoire et le
 * disque perd une session. C'est déjà le risque d'aujourd'hui — `localStorage`
 * pouvait lever sur un quota. On persiste donc SANS ATTENDRE, sans regroupement
 * différé : le gain de performance ne vaudrait pas la fenêtre de perte.
 */
const memoire = new Map<string, unknown>()

let base: IDBDatabase | null = null
let cle: CryptoKey | null = null
let ouverture: Promise<void> | null = null
let pret = false

/**
 * La file d'écriture.
 *
 * ⚠️ SÉRIALISÉE, ET CE N'EST PAS DU CONFORT : deux écritures de la MÊME clé
 * lancées en parallèle peuvent se terminer dans le désordre, et la plus
 * ancienne écraserait la plus récente. Pour une session de ratchet, cela veut
 * dire revenir en arrière — et ne plus rien savoir déchiffrer.
 */
let file: Promise<unknown> = Promise.resolve()

function enFile(travail: () => Promise<unknown>): void {
  file = file.then(travail).catch((e) => {
    console.error("[e2ee] écriture du coffre impossible :", e)
  })
}

/* ══════════════════ OUVERTURE ET REPRISE ══════════════════ */

/**
 * Ouvre le coffre : base, clé, chargement en mémoire, reprise de l'ancien.
 *
 * ⚠️ IDEMPOTENTE ET CONCURRENTE. Deux appels simultanés partagent la même
 * ouverture : sans cela, deux `generateKey` pourraient courir et le second
 * écraserait la clé du premier — tous les secrets déjà écrits deviendraient
 * illisibles.
 */
export function ouvrirCoffre(): Promise<void> {
  if (ouverture) return ouverture
  ouverture = (async () => {
    base = await ouvrirBase()
    cle = await cleDuCoffre(base)

    const magasin = base.transaction(MAGASIN_SECRETS, "readonly").objectStore(MAGASIN_SECRETS)
    const tous = (await promesse(magasin.getAll())) as Enregistre[]

    for (const e of tous) {
      try {
        const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: e.iv }, cle, e.chiffre)
        memoire.set(e.cle, JSON.parse(new TextDecoder().decode(clair)))
      } catch {
        /*
         * ⚠️ UNE ENTRÉE ILLISIBLE N'ARRÊTE PAS LES AUTRES. Elle signale une clé
         * qui a changé sous nos pieds — profil restauré, base recréée. Mieux
         * vaut repartir avec ce qui reste que refuser d'ouvrir : le pire serait
         * de bloquer l'application sur un secret qu'on ne récupérera pas.
         */
        console.warn(`[e2ee] entrée illisible dans le coffre : ${e.cle}`)
      }
    }

    pret = true
    await reprendreAncienCoffre()
  })()
  return ouverture
}

/**
 * Déménage l'ancien coffre `localStorage` vers celui-ci, une fois.
 *
 * 🔴 SANS CETTE REPRISE, CHAQUE UTILISATEUR PERDRAIT SON IDENTITÉ à la mise à
 * jour. Il en publierait une neuve, et l'ancienne resterait en base, muette —
 * on fabriquerait à grande échelle le problème des identités mortes, et chaque
 * message partirait en double dont un exemplaire illisible.
 *
 * ⚠️ ON N'EFFACE L'ANCIEN QU'APRÈS QUE LE NOUVEAU A ÉTÉ ÉCRIT SUR LE DISQUE.
 * Effacer d'abord, c'est perdre l'identité si la page se ferme entre les deux.
 */
async function reprendreAncienCoffre(): Promise<void> {
  if (typeof localStorage === "undefined") return

  const repris: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const brute = localStorage.key(i)
      if (!brute || !brute.startsWith(PREFIXE_ANCIEN) || brute === CLE_DEVICE) continue

      const courte = brute.slice(PREFIXE_ANCIEN.length)
      // Déjà repris lors d'un démarrage précédent : on ne réécrit pas par-dessus
      // ce que la session en cours a pu faire évoluer depuis.
      if (memoire.has(courte)) {
        repris.push(brute)
        continue
      }
      const valeur = localStorage.getItem(brute)
      if (valeur === null) continue
      memoire.set(courte, JSON.parse(valeur))
      await persiste(courte)
      repris.push(brute)
    }
  } catch (e) {
    console.error("[e2ee] reprise de l'ancien coffre interrompue :", e)
    return
  }

  for (const brute of repris) {
    try {
      localStorage.removeItem(brute)
    } catch {
      /* rien de plus à faire : le doublon est inoffensif */
    }
  }
  if (repris.length > 0) {
    console.info(`[e2ee] ${repris.length} secret(s) déménagé(s) vers le coffre chiffré.`)
  }
}

/* ══════════════════ ÉCRITURE ══════════════════ */

async function persiste(cleSecret: string): Promise<void> {
  if (!base || !cle) return
  const valeur = memoire.get(cleSecret)
  if (valeur === undefined) return

  // ⚠️ UN IV NEUF À CHAQUE CHIFFREMENT. Le réutiliser avec la même clé ne
  // dégrade pas AES-GCM : il le casse.
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const chiffre = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cle,
    new TextEncoder().encode(JSON.stringify(valeur)),
  )

  const magasin = base.transaction(MAGASIN_SECRETS, "readwrite").objectStore(MAGASIN_SECRETS)
  await promesse(magasin.put({ cle: cleSecret, iv: iv.buffer, chiffre } satisfies Enregistre))
}

async function retire(cleSecret: string): Promise<void> {
  if (!base) return
  const magasin = base.transaction(MAGASIN_SECRETS, "readwrite").objectStore(MAGASIN_SECRETS)
  await promesse(magasin.delete(cleSecret))
}

/* ══════════════════ L'INTERFACE SYNCHRONE ══════════════════ */

/**
 * ⚠️ AVERTIT SI L'ON LIT AVANT D'AVOIR OUVERT. Un coffre non ouvert répond
 * « vide », et un coffre vide fait générer une identité NEUVE — le défaut le
 * plus coûteux du chiffrement, et le plus silencieux. On préfère une ligne
 * bruyante dans la console à une identité de plus en base.
 */
function verifieOuvert(): void {
  if (!pret) {
    console.error(
      "[e2ee] coffre lu avant `ouvrirCoffre()` — une identité neuve risque d'être créée.",
    )
  }
}

export function lireSecret<T>(cleSecret: string): T | undefined {
  verifieOuvert()
  return memoire.get(cleSecret) as T | undefined
}

export function ecrireSecret(cleSecret: string, valeur: unknown): void {
  verifieOuvert()
  memoire.set(cleSecret, valeur)
  enFile(() => persiste(cleSecret))
}

export function effacerSecret(cleSecret: string): void {
  memoire.delete(cleSecret)
  enFile(() => retire(cleSecret))
}

/** Les clés rangées — sert à retirer toutes les sessions d'un correspondant. */
export function clesSecrets(): string[] {
  return [...memoire.keys()]
}

/** Attend que tout ce qui est en file soit écrit. Pour les bancs, et la sortie. */
export function coffreEcrit(): Promise<unknown> {
  return file
}

/**
 * Referme le coffre SANS RIEN EFFACER.
 *
 * ⚠️ À NE PAS CONFONDRE AVEC `viderCoffre()`. Celui-ci détache l'état en
 * mémoire ; le disque garde tout, et le prochain `ouvrirCoffre()` recharge.
 * Se tromper de fonction à la déconnexion laisserait les clés privées en place.
 *
 * Sert quand le magasin change sous nos pieds — deux identités éprouvées dans
 * un même processus, ou un changement de compte sans déconnexion complète.
 */
export async function refermerCoffre(): Promise<void> {
  await coffreEcrit()
  memoire.clear()
  try {
    base?.close()
  } catch {
    /* déjà fermée */
  }
  base = null
  cle = null
  pret = false
  ouverture = null
}

/**
 * Vide le coffre — déconnexion.
 *
 * 🔴 LA CLÉ PART AUSSI, et c'est le point : sans elle, ce qu'un effacement
 * incomplet laisserait derrière lui est du bruit. Garder la clé pour
 * « réutiliser le coffre » reviendrait à garder de quoi relire.
 */
export async function viderCoffre(): Promise<void> {
  memoire.clear()
  await coffreEcrit()
  try {
    if (base) {
      const tx = base.transaction([MAGASIN_SECRETS, MAGASIN_CLE], "readwrite")
      await promesse(tx.objectStore(MAGASIN_SECRETS).clear())
      await promesse(tx.objectStore(MAGASIN_CLE).clear())
    }
  } catch (e) {
    console.error("[e2ee] le coffre n'a pas pu être vidé :", e)
  }
  cle = null
  pret = false
  ouverture = null
}
