/**
 * MÉDIAS CHIFFRÉS DE BOUT EN BOUT — le format, et le chiffrement des fichiers.
 *
 * Plan du 03/10/2026 (cours, chapitre 23). Deux pièces, et ce module porte les
 * deux, parce qu'elles n'ont de sens qu'ensemble :
 *
 *   1. LA CHARGE (version 2) — ce qui voyage DANS l'enveloppe Signal. Jusqu'ici
 *      l'enveloppe portait un texte nu ; elle porte désormais, au besoin, un
 *      objet : l'identifiant du message, le texte, et le DESCRIPTEUR du média
 *      (sa clé, son empreinte, son aperçu).
 *
 *   2. LE FICHIER CHIFFRÉ (format « AGB1 ») — ce qui part sur Backblaze. Le
 *      serveur n'en voit que des octets illisibles.
 *
 * ⚠️ CE MODULE EST LE JUMEAU EXACT DE `alanya/lib/services/e2ee/e2ee_media.dart`.
 * Un octet de différence, et un média envoyé du web ne s'ouvre plus sur le
 * téléphone. Les deux sont tenus par le même vecteur de test
 * (`scripts/e2ee-media-vecteur.mjs` → `alanya/test/donnees/vecteur_media.json`).
 */

// ════════════════════════════════════════════════════════════════════════════
// 1. LA CHARGE DE L'ENVELOPPE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Le préfixe qui distingue une charge v2 d'un texte nu (v1).
 *
 * 🔴 UN CARACTÈRE NUL EN TÊTE : impossible à taper dans un champ de saisie.
 * Un utilisateur qui écrirait littéralement `{"v":2,…}` envoie donc toujours
 * un texte, jamais une charge — la reconnaissance ne peut pas être trompée par
 * ce qu'on écrit.
 */
export const PREFIXE_CHARGE_V2 = "\u0000A2"

/** Ce qu'il faut savoir d'un média pour l'afficher, l'ouvrir et le vérifier. */
export interface DescripteurMedia {
  /** Identifiant du média sur le serveur (`media_files.id`). */
  id: string
  /** Clé AES-256 du fichier, en base64 (32 octets). */
  cle: string
  /** SHA-256 du fichier CHIFFRÉ, en base64 : vérifié avant déchiffrement. */
  empreinte: string
  /** Taille du fichier EN CLAIR, en octets. */
  taille: number
  /** Type réel du fichier — le serveur, lui, ne voit que `application/octet-stream`. */
  mime: string
  /** Nom réel du fichier (documents). */
  nom?: string
  largeur?: number
  hauteur?: number
  dureeMs?: number
  /** Nombre de pages (PDF). */
  pages?: number
  /** Aperçu JPEG en base64 : photo floutée, première image, première page. */
  apercu?: string
}

/** Ce que porte une enveloppe une fois ouverte. */
export interface Charge {
  /** Le texte du message, ou la légende du média. */
  texte: string
  /** Le média, s'il y en a un. */
  media?: DescripteurMedia
  /**
   * L'identifiant du message que l'EXPÉDITEUR a chiffré (v2), `null` en v1.
   *
   * Protocole v2 : il est DANS le chiffré, donc hors de portée du serveur. Un
   * serveur qui rattacherait cette enveloppe à un autre message serait
   * démasqué — voir `lireCharge`.
   */
  idAnnonce: string | null
}

/** Construit la charge v2 à chiffrer pour le message `id`. */
export function ecrireCharge(id: string, texte: string, media?: DescripteurMedia): string {
  return PREFIXE_CHARGE_V2 + JSON.stringify({ v: 2, id, texte, ...(media ? { media } : {}) })
}

/** Une charge reçue n'est pas recevable : on le dit, on ne devine pas. */
export class ChargeInvalide extends Error {}

/**
 * Lit ce qu'une enveloppe déchiffrée contient.
 *
 * - texte nu (v1, tous les messages existants) : rendu tel quel ;
 * - charge v2 : décodée et VÉRIFIÉE — l'identifiant annoncé doit être celui du
 *   message auquel le serveur a rattaché l'enveloppe.
 *
 * ⚠️ `messageId` peut manquer (dépôt hors fil, bancs) : la vérification est
 * alors impossible, et la charge est refusée plutôt que crue sur parole.
 */
export function lireCharge(clair: string, messageId: string | null): Charge {
  if (!clair.startsWith(PREFIXE_CHARGE_V2)) {
    return { texte: clair, idAnnonce: null }
  }
  let brut: unknown
  try {
    brut = JSON.parse(clair.slice(PREFIXE_CHARGE_V2.length))
  } catch {
    throw new ChargeInvalide("charge v2 illisible")
  }
  const c = brut as { v?: unknown; id?: unknown; texte?: unknown; media?: unknown }
  if (c.v !== 2 || typeof c.id !== "string") throw new ChargeInvalide("charge v2 mal formée")
  if (messageId === null || c.id !== messageId) {
    throw new ChargeInvalide("charge rattachée à un autre message que le sien")
  }
  const media = c.media === undefined ? undefined : descripteurValide(c.media)
  return { texte: typeof c.texte === "string" ? c.texte : "", media, idAnnonce: c.id }
}

/**
 * UN TEXTE RANGÉ EN CHARGE BRUTE, réparé à la lecture.
 *
 * 🐛 « A2{"v":2,"id":…,"media":{…}} » S'AFFICHAIT EN TEXTE DANS LA BULLE
 * (signalé par le user le 06/10/2026, captures à l'appui), la photo marquée
 * « indisponible sur cet appareil ». Ces messages avaient été relevés par une
 * version du web antérieure au lot A (03/10/2026), qui ne connaissait pas la
 * charge v2 : elle l'a prise pour un texte nu et l'a RANGÉE TELLE QUELLE. Un
 * message chiffré ne se déchiffre qu'une fois — l'enveloppe est acquittée — et
 * ce rangement était donc tout ce qui restait.
 *
 * La charge brute contient tout : la légende ET le média, avec sa clé. On la
 * relit ici, à chaque lecture du cache, et le message redevient ce qu'il était.
 *
 * ⚠️ UNE CHARGE QUI NE SE RELIT PAS NE S'AFFICHE JAMAIS EN CLAIR : elle porte la
 * clé du média. Elle devient un texte vide, et la bulle dit « indisponible ».
 */
export function chargeRangee(
  id: string,
  texte: string | null | undefined,
  media?: DescripteurMedia
): { texte: string | null | undefined; media?: DescripteurMedia } {
  if (!texte || !texte.startsWith(PREFIXE_CHARGE_V2)) return { texte, media }
  try {
    const charge = lireCharge(texte, id)
    return { texte: charge.texte, media: media ?? charge.media }
  } catch {
    return { texte: "", media }
  }
}

function descripteurValide(m: unknown): DescripteurMedia {
  const d = m as Record<string, unknown>
  const chaine = (v: unknown) => typeof v === "string" && v.length > 0
  const entier = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0)
  if (
    !d ||
    !chaine(d.id) ||
    !chaine(d.cle) ||
    !chaine(d.empreinte) ||
    !chaine(d.mime) ||
    !Number.isInteger(d.taille) ||
    !entier(d.largeur) ||
    !entier(d.hauteur) ||
    !entier(d.dureeMs) ||
    !entier(d.pages) ||
    (d.nom !== undefined && typeof d.nom !== "string") ||
    (d.apercu !== undefined && typeof d.apercu !== "string")
  ) {
    throw new ChargeInvalide("descripteur de média mal formé")
  }
  if (base64EnOctets(d.cle as string).length !== 32) throw new ChargeInvalide("clé de média invalide")
  if (base64EnOctets(d.empreinte as string).length !== 32) {
    throw new ChargeInvalide("empreinte de média invalide")
  }
  return d as unknown as DescripteurMedia
}

// ════════════════════════════════════════════════════════════════════════════
// 2. LE FICHIER CHIFFRÉ — format AGB1
// ════════════════════════════════════════════════════════════════════════════
//
// Le clair est découpé en blocs de 64 Kio ; le dernier peut être plus court,
// voire vide (fichier de taille nulle). Chaque bloc est chiffré en AES-256-GCM
// avec la même clé et un nonce de 12 octets :
//
//     octets 0-6  : zéro
//     octets 7-10 : numéro du bloc, entier non signé gros-boutiste
//     octet  11   : 1 pour le DERNIER bloc, 0 sinon
//
// Le chiffré est la suite des blocs chiffrés, chacun suivi de son tag de 16
// octets. Rien d'autre : ni en-tête, ni longueur.
//
// 🔴 POURQUOI LE NUMÉRO ET LE « DERNIER » SONT DANS LE NONCE. Chiffrer chaque
// bloc séparément ouvre trois attaques : intervertir deux blocs, en retirer un,
// couper la fin. Le numéro dans le nonce fait échouer un bloc déplacé ; le
// drapeau « dernier » fait échouer un fichier tronqué — l'avant-dernier bloc
// n'a pas été chiffré comme dernier, son tag ne passe pas. C'est la
// construction STREAM (Hoang, Reyhanitabar, Rogaway, Vizár, 2015).
//
// ⚠️ UN NONCE DÉTERMINISTE N'EST SÛR QUE PARCE QUE LA CLÉ EST NEUVE. Chaque
// fichier a sa propre clé, tirée au hasard ; deux fichiers ne partagent donc
// jamais une paire (clé, nonce). Réutiliser une clé pour un AUTRE contenu
// casserait tout — c'est pourquoi `chiffrerFichier` la tire lui-même et
// n'en accepte aucune de l'appelant (sauf pour le vecteur de test).

export const TAILLE_BLOC = 64 * 1024
const TAILLE_TAG = 16

function nonceDuBloc(index: number, dernier: boolean): Uint8Array<ArrayBuffer> {
  const n = new Uint8Array(12)
  new DataView(n.buffer).setUint32(7, index, false)
  n[11] = dernier ? 1 : 0
  return n
}

/** Un fichier chiffré, prêt à téléverser, et ce qu'il faut pour le relire. */
export interface FichierChiffre {
  chiffre: Uint8Array
  /** Clé en base64. */
  cle: string
  /** SHA-256 du chiffré, en base64. */
  empreinte: string
}

/**
 * Chiffre `clair` avec une clé neuve.
 *
 * `cleImposee` n'existe QUE pour le vecteur de test, qui doit produire le même
 * chiffré des deux côtés. Ne jamais la passer ailleurs.
 */
export async function chiffrerFichier(
  clair: Uint8Array,
  cleImposee?: Uint8Array,
): Promise<FichierChiffre> {
  const cleBrute = new Uint8Array(cleImposee ?? crypto.getRandomValues(new Uint8Array(32)))
  const cle = await crypto.subtle.importKey("raw", cleBrute, "AES-GCM", false, ["encrypt"])
  const nbBlocs = Math.max(1, Math.ceil(clair.length / TAILLE_BLOC))
  const sortie = new Uint8Array(clair.length + nbBlocs * TAILLE_TAG)
  let ecrit = 0
  for (let i = 0; i < nbBlocs; i++) {
    const bloc = clair.subarray(i * TAILLE_BLOC, Math.min((i + 1) * TAILLE_BLOC, clair.length))
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonceDuBloc(i, i === nbBlocs - 1), tagLength: 128 },
        cle,
        tampon(bloc),
      ),
    )
    sortie.set(ct, ecrit)
    ecrit += ct.length
  }
  return {
    chiffre: sortie,
    cle: octetsEnBase64(cleBrute),
    empreinte: octetsEnBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", sortie))),
  }
}

/** Le fichier reçu n'est pas celui annoncé, ou ne se déchiffre pas. */
export class FichierInvalide extends Error {}

/**
 * Vérifie puis déchiffre un fichier AGB1.
 *
 * L'ORDRE COMPTE : l'empreinte d'abord. Un fichier remplacé ou abîmé est
 * reconnu comme tel — « ce n'est pas le bon fichier » — avant d'essayer une
 * clé dessus, ce qui donnerait une erreur moins parlante.
 */
export async function dechiffrerFichier(
  chiffre: Uint8Array,
  d: Pick<DescripteurMedia, "cle" | "empreinte" | "taille">,
): Promise<Uint8Array> {
  const empreinte = octetsEnBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", tampon(chiffre))))
  if (empreinte !== d.empreinte) throw new FichierInvalide("empreinte différente : fichier remplacé ou abîmé")

  const cle = await crypto.subtle.importKey("raw", base64EnOctets(d.cle), "AES-GCM", false, ["decrypt"])
  const tailleBlocChiffre = TAILLE_BLOC + TAILLE_TAG
  const nbBlocs = Math.ceil(chiffre.length / tailleBlocChiffre)
  if (nbBlocs === 0) throw new FichierInvalide("fichier vide")
  const sortie = new Uint8Array(chiffre.length - nbBlocs * TAILLE_TAG)
  let ecrit = 0
  for (let i = 0; i < nbBlocs; i++) {
    const bloc = chiffre.subarray(i * tailleBlocChiffre, Math.min((i + 1) * tailleBlocChiffre, chiffre.length))
    if (bloc.length < TAILLE_TAG) throw new FichierInvalide("bloc tronqué")
    let pt: Uint8Array
    try {
      pt = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonceDuBloc(i, i === nbBlocs - 1), tagLength: 128 },
          cle,
          tampon(bloc),
        ),
      )
    } catch {
      throw new FichierInvalide(`bloc ${i} refusé : clé fausse, ordre changé ou fichier coupé`)
    }
    sortie.set(pt, ecrit)
    ecrit += pt.length
  }
  if (ecrit !== d.taille) throw new FichierInvalide("taille différente de celle annoncée")
  return sortie
}

/**
 * Un `Uint8Array` vu comme adossé à un `ArrayBuffer` ordinaire, ce qu'exige
 * le typage de WebCrypto. Une vue sur un tampon partagé n'existe pas ici.
 */
function tampon(o: Uint8Array): Uint8Array<ArrayBuffer> {
  return o as Uint8Array<ArrayBuffer>
}

/**
 * L'adresse affichable d'un aperçu. Le web l'écrit en JPEG, le téléphone en
 * PNG (Flutter n'encode pas le JPEG sans dépendance de plus) : on reconnaît le
 * format à ses premiers octets plutôt que de le supposer.
 */
export function urlApercu(b64: string): string {
  return `data:image/${b64.startsWith("iVBOR") ? "png" : "jpeg"};base64,${b64}`
}

// ════════════════════════════════════════════════════════════════════════════
// Base64
// ════════════════════════════════════════════════════════════════════════════

export function octetsEnBase64(o: Uint8Array): string {
  let s = ""
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000))
  return btoa(s)
}

export function base64EnOctets(b: string): Uint8Array<ArrayBuffer> {
  try {
    const s = atob(b)
    const o = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i)
    return o
  } catch {
    return new Uint8Array(0)
  }
}
