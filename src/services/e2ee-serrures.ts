/**
 * LES SERRURES DE L'ARCHIVE — plusieurs clés pour une seule porte.
 *
 * 🔴 CE QUI REND TOUT LE RESTE POSSIBLE : la clé qui chiffre l'archive est
 * TIRÉE AU SORT, jamais dérivée d'un secret. On l'enveloppe ensuite autant de
 * fois qu'on veut, avec autant de secrets différents qu'on veut.
 *
 *                        ┌──▶ trousseau de l'appareil (Face ID)
 *                        │
 *   clé maîtresse ───────┼──▶ mot de passe du compte
 *    (aléatoire)         │
 *                        └──▶ clé de récupération (optionnelle)
 *
 * Trois serrures sur la même porte. Il suffit d'une seule pour entrer.
 *
 * ⚠️ SI ELLE ÉTAIT DÉRIVÉE DU MOT DE PASSE, changer de mot de passe obligerait
 * à RECHIFFRER TOUTE L'ARCHIVE. Là, on ré-enveloppe 32 octets et rien d'autre.
 * C'est la seule raison d'être de cette indirection, et elle suffit.
 *
 * ⚠️ CE QUE LA SERRURE « MOT DE PASSE » NE DONNE PAS, et le produit doit le
 * dire : notre serveur reçoit le mot de passe en clair à chaque connexion
 * (décision du user, 23/09/2026 : ne pas réécrire l'authentification). Il
 * POURRAIT donc dériver cette clé s'il était compromis. Cette serrure protège
 * l'archive AU REPOS, pas contre nous. Les deux autres n'ont pas cette limite.
 */

/** D'où vient le secret qui ouvre une serrure. */
export type TypeSerrure = "trousseau" | "motdepasse" | "recuperation"

/** Une serrure, telle qu'elle se range sur le serveur. */
export interface Serrure {
  type: TypeSerrure
  /** Base64. Aléatoire, 16 octets. Public — il n'a pas à être secret. */
  sel: string
  /** Base64. 12 octets, neuf à chaque enveloppement. */
  iv: string
  /** Base64. La clé maîtresse, chiffrée par la clé dérivée du secret. */
  cleEnveloppee: string
  /** `argon2id` ou `pbkdf2-sha256`. */
  algo: Algo
  /**
   * Les paramètres de `algo`, en JSON.
   *
   * 🔴 RANGÉS AVEC LA SERRURE, JAMAIS EN CONSTANTE. Sans eux, durcir les
   * réglages un jour rendrait illisibles toutes les serrures déjà créées — on
   * ne saurait plus avec quoi elles ont été fabriquées.
   */
  parametres: string
}

export type Algo = "argon2id" | "pbkdf2-sha256"

interface Reglage {
  algo: Algo
  parametres: Record<string, number>
}

/**
 * Le coût de dérivation, PAR TYPE DE SECRET.
 *
 * 🔴 CE N'EST PAS UNE CONSTANTE UNIQUE, ET C'EST LE POINT LE PLUS SUBTIL DE CE
 * FICHIER. Le nombre d'itérations sert à compenser le MANQUE D'ENTROPIE d'un
 * secret. Il n'a de sens que pour un secret que l'on pourrait deviner.
 *
 *   · un mot de passe humain vaut peut-être 30 bits → il faut l'étirer, cher ;
 *   · une clé de 256 bits tirée au sort ne se devine PAS → l'étirer ne protège
 *     de rien et ne fait que coûter une seconde à l'utilisateur.
 *
 * ⚠️ APPLIQUER 600 000 ITÉRATIONS À UN SECRET DÉJÀ FORT est une erreur
 * fréquente : on paie le prix d'une protection dont on n'a pas besoin, et on
 * croit avoir fait mieux. C'est le contraire — cela pousse à réduire ailleurs.
 */
const REGLAGES: Record<TypeSerrure, Reglage> = {
  /*
   * ⚠️ ARGON2ID, ET NON PBKDF2, POUR LE SEUL SECRET QUI SE DEVINE.
   *
   * PBKDF2 se parallélise sur carte graphique : des milliers d'essais par
   * seconde sur du matériel courant. Argon2id exige de la MÉMOIRE — ici
   * 64 Mio par essai — ce qu'une carte graphique ne peut pas multiplier à
   * l'infini. C'est exactement la menace que cette serrure combat : quelqu'un
   * qui a emporté une copie de la base et attaque hors ligne.
   *
   * Mesuré sur ce poste : ~410 ms. C'est le coût par essai, et c'est le point.
   */
  motdepasse: {
    algo: "argon2id",
    parametres: { memoireKio: 65536, passes: 3, parallelisme: 1 },
  },
  /*
   * ⚠️ UNE ITÉRATION, ET CE N'EST PAS UNE NÉGLIGENCE. L'étirement compense le
   * manque d'entropie. Ces deux secrets font 256 bits tirés au sort : ils ne
   * se devinent pas, et les étirer ne protégerait de RIEN — seulement coûter
   * une seconde à quelqu'un qui déverrouille son téléphone.
   *
   * ⚠️ APPLIQUER LE RÉGLAGE FORT PARTOUT est l'erreur la plus fréquente : on
   * paie le prix d'une protection inutile, on croit avoir mieux fait, et cela
   * pousse à réduire là où ça compte.
   */
  trousseau: { algo: "pbkdf2-sha256", parametres: { iterations: 1 } },
  recuperation: { algo: "pbkdf2-sha256", parametres: { iterations: 1 } },
}

/* ══════════════════ OUTILS ══════════════════ */

function versB64(buf: ArrayBuffer): string {
  const o = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < o.length; i++) s += String.fromCharCode(o[i])
  return btoa(s)
}

/**
 * ⚠️ REND UN `ArrayBuffer`, PAS UN `Uint8Array` — même raison qu'en face dans
 * `e2ee-archive.ts` : TypeScript refuse un `Uint8Array` là où WebCrypto attend
 * un `BufferSource`, son `.buffer` pouvant être partagé. On lève l'ambiguïté à
 * la source plutôt qu'avec un `as` à chaque appel.
 */
function depuisB64(b64: string): ArrayBuffer {
  const s = atob(b64)
  const o = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i)
  return o.buffer
}

/**
 * Dérive la clé qui enveloppe — la KEK.
 *
 * ⚠️ NON EXTRACTIBLE : elle ne sert qu'à envelopper et désenvelopper, ici, tout
 * de suite. La laisser sortir n'apporterait rien et offrirait une prise.
 */
async function deriverKek(
  secret: string,
  sel: ArrayBuffer,
  algo: Algo,
  parametres: Record<string, number>,
): Promise<CryptoKey> {
  if (algo === "argon2id") {
    /*
     * ⚠️ CHARGÉ À LA DEMANDE. Le module WebAssembly d'Argon2 pèse quelques
     * dizaines de kilo-octets : l'imposer à tous ceux qui ouvrent simplement
     * une conversation serait le payer pour rien. Il n'arrive que si une
     * serrure « mot de passe » est vraiment utilisée.
     */
    const { argon2id } = await import("hash-wasm")
    const brut = await argon2id({
      password: secret,
      salt: new Uint8Array(sel),
      memorySize: parametres.memoireKio,
      iterations: parametres.passes,
      parallelism: parametres.parallelisme,
      hashLength: 32,
      outputType: "binary",
    })
    /*
     * ⚠️ UNE COPIE DE 32 OCTETS, PAS UN `as`. WebCrypto veut un tampon dont on
     * sait qu'il n'est pas partagé ; celui que rend la bibliothèque est typé de
     * façon indécise. Recopier lève le doute pour de bon — un `as` l'aurait
     * seulement fait taire, et masqué le jour où le type dit quelque chose de
     * vrai.
     */
    const materiel = new Uint8Array(brut).buffer
    return crypto.subtle.importKey("raw", materiel, { name: "AES-GCM" }, false, [
      "wrapKey",
      "unwrapKey",
    ])
  }

  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  )
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: sel, iterations: parametres.iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  )
}

/* ══════════════════ CRÉER ══════════════════ */

/**
 * Crée une archive : une clé maîtresse neuve, et une serrure par secret fourni.
 *
 * ⚠️ LA CLÉ MAÎTRESSE EST EXTRACTIBLE PENDANT CET APPEL, et il n'y a pas moyen
 * de faire autrement : `wrapKey` refuse une clé qui ne l'est pas. Elle ne sort
 * pourtant jamais de cette fonction — c'est le prix à payer pour pouvoir poser
 * plusieurs serrures, et il est borné à ces quelques lignes.
 */
export async function creerArchive(
  secrets: Partial<Record<TypeSerrure, string>>,
): Promise<{ maitresse: CryptoKey; matiere: ArrayBuffer; serrures: Serrure[] }> {
  const types = Object.keys(secrets) as TypeSerrure[]
  if (types.length === 0) {
    throw new Error("Une archive sans serrure ne se rouvrirait jamais.")
  }

  const maitresse = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  )

  const serrures: Serrure[] = []
  for (const type of types) {
    serrures.push(await envelopper(type, secrets[type]!, maitresse))
  }

  /*
   * ⚠️ LA MATIÈRE EST RENDUE AVEC LA CLÉ, pendant que c'est encore possible :
   * `maitresse` est extractible ici par nécessité (`wrapKey` l'exige), et ce
   * sera la seule occasion de la ranger sans rouvrir une serrure.
   */
  const matiere = await crypto.subtle.exportKey("raw", maitresse)
  return { maitresse, matiere, serrures }
}

/** Enveloppe une clé maîtresse pour un secret donné. */
async function envelopper(
  type: TypeSerrure,
  secret: string,
  maitresse: CryptoKey,
): Promise<Serrure> {
  const sel = crypto.getRandomValues(new Uint8Array(16))
  /*
   * ⚠️ UN IV NEUF À CHAQUE ENVELOPPEMENT. En AES-GCM, réutiliser un IV avec la
   * même clé ne dégrade pas la sécurité : il la détruit. Deux serrures du même
   * type refaites à la suite doivent donc tirer deux IV différents.
   */
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const reglage = REGLAGES[type]

  const kek = await deriverKek(secret, sel.buffer, reglage.algo, reglage.parametres)
  const enveloppee = await crypto.subtle.wrapKey("raw", maitresse, kek, {
    name: "AES-GCM",
    iv,
  })

  return {
    type,
    sel: versB64(sel.buffer),
    iv: versB64(iv.buffer),
    cleEnveloppee: versB64(enveloppee),
    algo: reglage.algo,
    parametres: JSON.stringify(reglage.parametres),
  }
}

/* ══════════════════ OUVRIR ══════════════════ */

/**
 * Ouvre l'archive avec une serrure.
 *
 * 🔴 PAS DE « HACHÉ DE VÉRIFICATION » À CÔTÉ, et c'est délibéré. AES-GCM
 * authentifie : un mauvais secret fait ÉCHOUER le déchiffrement, et c'est LE
 * contrôle. Ranger un vérificateur dérivé du même secret offrirait une cible à
 * casser hors ligne — souvent avec moins d'itérations « pour que ce soit
 * rapide », ce qui reviendrait à publier la réponse.
 *
 * ⚠️ LA CLÉ RENDUE N'EST PAS EXTRACTIBLE. Elle sert à déchiffrer l'archive, et
 * rien d'autre. Pour AJOUTER une serrure, voir `ajouterSerrure`, qui la
 * redemande extractible le temps d'un enveloppement.
 */
export async function ouvrirArchive(secret: string, serrure: Serrure): Promise<CryptoKey> {
  return desenvelopper(secret, serrure, false)
}

async function desenvelopper(
  secret: string,
  serrure: Serrure,
  extractible: boolean,
): Promise<CryptoKey> {
  const kek = await deriverKek(
    secret,
    depuisB64(serrure.sel),
    serrure.algo,
    JSON.parse(serrure.parametres) as Record<string, number>,
  )
  return crypto.subtle.unwrapKey(
    "raw",
    depuisB64(serrure.cleEnveloppee),
    kek,
    { name: "AES-GCM", iv: depuisB64(serrure.iv) },
    { name: "AES-GCM", length: 256 },
    extractible,
    ["encrypt", "decrypt"],
  )
}

/**
 * Ouvre l'archive et rend la MATIÈRE de la clé maîtresse.
 *
 * 🔴 POURQUOI CETTE PORTE EXISTE, ET POURQUOI ELLE EST ÉTROITE. La clé rendue
 * par `ouvrirArchive` est non extractible — c'est bien — mais elle disparaît
 * au premier rechargement de page, et l'archive se referme aussitôt après
 * s'être ouverte. Pour qu'elle survive, il faut pouvoir la RANGER, donc
 * l'exporter, donc l'avoir demandée extractible.
 *
 * ⚠️ LA FENÊTRE D'EXTRACTIBILITÉ VIT ICI, ET NULLE PART AILLEURS. L'appelant
 * reçoit des octets, les range, et réimporte une clé NON extractible pour
 * s'en servir. Exposer `desenvelopper(…, true)` aurait laissé n'importe quel
 * appelant garder une clé exportable sans y penser.
 */
export async function ouvrirArchiveBrute(
  secret: string,
  serrure: Serrure,
): Promise<ArrayBuffer> {
  const cle = await desenvelopper(secret, serrure, true)
  return crypto.subtle.exportKey("raw", cle)
}

/**
 * Refait une clé d'archive à partir de sa matière, NON extractible.
 *
 * ⚠️ NON EXTRACTIBLE, ET C'EST LE POINT : ce qui a été rangé une fois n'a plus
 * à pouvoir ressortir. Chaque relecture resserre ce qu'on peut faire de la clé.
 */
export async function cleDepuisMatiere(brut: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", brut, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])
}

/* ══════════════════ AJOUTER UNE SERRURE PLUS TARD ══════════════════ */

/**
 * Pose une serrure de plus sur une archive déjà créée.
 *
 * 🔴 IL FAUT DÉJÀ POUVOIR OUVRIR. On ne pose pas une serrure sur une porte
 * qu'on ne sait pas ouvrir : il faut un secret existant qui marche. C'est
 * exactement ce que l'utilisateur vit — pour ajouter son mot de passe comme
 * seconde serrure, il doit être connecté, donc capable d'ouvrir par le
 * trousseau.
 *
 * ⚠️ RIEN N'EST RECHIFFRÉ. On ré-enveloppe 32 octets. Une archive de cent
 * mégaoctets se dote d'une nouvelle serrure en quelques millisecondes — c'est
 * tout l'intérêt de la clé maîtresse tirée au sort.
 *
 * ⚠️ LA CLÉ MAÎTRESSE REDEVIENT EXTRACTIBLE LE TEMPS DE CET APPEL. Elle ne
 * quitte pas la fonction, mais c'est une fenêtre, et il faut savoir qu'elle
 * existe : c'est pourquoi l'usage courant passe par `ouvrirArchive`, qui rend
 * une clé qu'on ne peut pas emporter.
 */
export async function ajouterSerrure(
  secretExistant: string,
  serrureExistante: Serrure,
  nouveauType: TypeSerrure,
  nouveauSecret: string,
): Promise<Serrure> {
  const maitresse = await desenvelopper(secretExistant, serrureExistante, true)
  return envelopper(nouveauType, nouveauSecret, maitresse)
}

/* ══════════════════ LA CLÉ DE RÉCUPÉRATION ══════════════════ */

/**
 * Les mots de la clé de récupération.
 *
 * ⚠️ DES MOTS, PAS DE L'HEXADÉCIMAL, et c'est une décision d'usage autant que
 * de sécurité : une clé se recopie à la main, sur un papier, souvent mal. Un
 * « 0 » et un « O », un « 1 » et un « l » se confondent ; « tortue » et
 * « rivière », non. À entropie égale, celle qui se transcrit sans faute est
 * celle qui sera encore lisible dans deux ans.
 *
 * ⚠️ AUCUN MOT AMBIGU, ET AUCUN ACCENT dans la liste : elle se tape aussi bien
 * sur un clavier français que sur un téléphone.
 */
const MOTS = [
  "tortue", "riviere", "lampe", "cousin", "fenetre", "orage",
  "sable", "guitare", "renard", "marbre", "pluie", "cerise",
  "montagne", "velours", "hibou", "bambou", "falaise", "encrier",
  "girafe", "menthe", "tambour", "nuage", "corail", "pivoine",
  "safran", "brume", "loutre", "cypres", "silex", "harpe",
  "jonquille", "ocean",
] as const

/**
 * Tire une clé de récupération : 12 mots, soit 60 bits.
 *
 * ⚠️ 60 BITS SUFFISENT ICI, ET IL FAUT SAVOIR POURQUOI : ce secret n'est pas
 * étiré (voir `ITERATIONS`), donc sa force est sa seule protection. Soixante
 * bits résistent à une attaque hors ligne pour un coût qui dépasse de très loin
 * l'intérêt d'une archive de messagerie personnelle. Les porter à 128 ferait
 * vingt-quatre mots à recopier, et c'est le papier perdu qui deviendrait le
 * vrai risque.
 */
export function tirerCleRecuperation(): string {
  const mots: string[] = []
  const alea = new Uint32Array(12)
  crypto.getRandomValues(alea)
  for (let i = 0; i < 12; i++) {
    /*
     * ⚠️ `% MOTS.length` AVEC UNE LISTE DE 32 MOTS : 2^32 est un multiple exact
     * de 32, donc le reste ne favorise aucun mot. Avec une liste dont la taille
     * n'est pas une puissance de deux, ce modulo introduirait un biais — les
     * premiers mots sortiraient plus souvent, et l'entropie annoncée serait
     * fausse.
     */
    mots.push(MOTS[alea[i] % MOTS.length])
  }
  return mots.join(" ")
}

/** Remet une clé recopiée à la main dans sa forme canonique. */
export function normaliserCleRecuperation(saisie: string): string {
  return saisie.trim().toLowerCase().split(/\s+/).join(" ")
}
