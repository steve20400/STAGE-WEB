import type {
  Direction,
  KeyPairType,
  PreKeyType,
  SessionRecordType,
  SignedPublicPreKeyType,
  StorageType,
} from "@privacyresearch/libsignal-protocol-typescript"
import {
  clesSecrets,
  effacerSecret,
  ecrireSecret,
  lireSecret,
} from "./coffre-chiffre"

/**
 * LE COFFRE DU CLIENT — tout ce que le serveur ne doit jamais voir.
 *
 * 🔴 C'EST ICI, ET NULLE PART AILLEURS, QUE VIVENT LES SECRETS : clés privées
 * d'identité, pré-clés privées, et l'état des sessions du Double Ratchet — clé
 * racine, clés de chaîne, numéros de message, clés sautées. Le spec du Double
 * Ratchet n'a aucun composant serveur, et c'est exactement ce que ce fichier
 * concrétise.
 *
 * ⚠️ RIEN DE CE QUI EST RANGÉ ICI NE DOIT PARTIR SUR LE RÉSEAU. Une seule ligne
 * qui enverrait le contenu de ce coffre au serveur annulerait le chiffrement de
 * bout en bout, sans qu'aucun test ne le remarque : les messages continueraient
 * de s'afficher normalement.
 *
 * ⚠️ LE MAGASIN EST DANS `coffre-chiffre.ts`, ET IL EST CHIFFRÉ — depuis le
 * 23/09/2026. Ce fichier ne sait plus OÙ ni COMMENT les secrets sont rangés :
 * il passe par trois fonctions, et c'est tout. C'est ce découplage qui a permis
 * de remplacer `localStorage` par IndexedDB chiffré sans rien changer ici.
 *
 * ⚠️ CE QUE LE CHIFFREMENT LOCAL FAIT ET NE FAIT PAS est écrit en tête de
 * `coffre-chiffre.ts`. En deux mots : il empêche d'EMPORTER les clés, il
 * n'empêche pas un script hostile de s'en servir sur place.
 */


/**
 * LES CLÉS D'IDENTITÉ QUI ONT CHANGÉ DEPUIS L'OUVERTURE DE L'APPLICATION.
 *
 * 🔴 C'EST LE SEUL SIGNAL QUI PUISSE RÉVÉLER UNE INTERPOSITION. Quand la clé
 * d'identité d'un correspondant change, deux lectures sont possibles : il a
 * réinstallé, ou quelqu'un a pris sa place entre vous. Les deux se
 * ressemblent trait pour trait, et SEUL L'UTILISATEUR peut trancher — en
 * comparant un code de sécurité hors de ce canal.
 *
 * ⚠️ LA CONSOLE NE SUFFIT PAS, et c'est pour cela que cette liste existe.
 * Un avertissement que personne ne lit ne protège de rien : c'est l'écran qui
 * doit le dire, à l'endroit où la conversation se tient.
 *
 * ⚠️ EN MÉMOIRE, PAS DANS LE COFFRE : l'avertissement porte sur CETTE session.
 * Le ranger ferait réapparaître à chaque ouverture une alerte déjà vue et déjà
 * jugée — et une alerte qui se répète cesse d'être lue.
 */
const clesChangees = new Set<string>()

/** Les correspondants dont la clé a changé pendant cette session. */
export function identitesChangees(): string[] {
  return [...clesChangees]
}

/**
 * L'utilisateur a pris acte : on cesse de l'avertir pour ce correspondant.
 *
 * ⚠️ CELA NE VALIDE RIEN. Rien ici ne dit que la nouvelle clé est la bonne :
 * seul un code de sécurité comparé de vive voix le dirait. On note seulement
 * que l'avertissement a été vu.
 */
export function oublierAvertissement(identifiant: string): void {
  clesChangees.delete(identifiant)
}

/* ══════════════════ SÉRIALISATION ══════════════════
 *
 * La bibliothèque manipule des `ArrayBuffer`. `localStorage` ne stocke que des
 * chaînes — d'où ce passage par base64, à un seul endroit pour qu'il ne puisse
 * pas diverger.
 *
 * ⚠️ NE PAS PASSER PAR `JSON.stringify` D'UN `ArrayBuffer` : il rend `{}`, en
 * silence. Le coffre paraîtrait rempli et ne contiendrait rien.
 */
function versB64(buf: ArrayBuffer): string {
  const octets = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < octets.length; i++) s += String.fromCharCode(octets[i])
  return btoa(s)
}

function depuisB64(b64: string): ArrayBuffer {
  const s = atob(b64)
  const octets = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) octets[i] = s.charCodeAt(i)
  return octets.buffer
}

/** Un couple de clés, tel qu'il se range. */
interface CoupleRange {
  pubKey: string
  privKey: string
}

/*
 * ⚠️ `KeyPairType` PARTOUT, Y COMPRIS POUR LES PRÉ-CLÉS. `PreKeyPairType`
 * existe dans la bibliothèque mais désigne autre chose — un couple ACCOMPAGNÉ
 * de son identifiant (`{ keyId, keyPair }`) — et `StorageType` n'en veut pas :
 * ses méthodes de rangement reçoivent le couple seul.
 */
function rangeCouple(k: KeyPairType): CoupleRange {
  return { pubKey: versB64(k.pubKey), privKey: versB64(k.privKey) }
}

function lisCouple(c: CoupleRange): KeyPairType {
  return { pubKey: depuisB64(c.pubKey), privKey: depuisB64(c.privKey) }
}

/*
 * ══════════════ LE MAGASIN EST DÉSORMAIS CHIFFRÉ ══════════════
 *
 * 🔴 CES TROIS FONCTIONS SONT LA SEULE PORTE. Tout ce que la bibliothèque
 * Signal range passe par elles, et c'est ce qui a permis de changer de magasin
 * sans toucher au reste du fichier : `coffre-chiffre.ts` sert désormais depuis
 * IndexedDB, chiffré par une clé NON EXTRACTIBLE.
 *
 * ⚠️ ELLES RESTENT SYNCHRONES, ET C'EST OBLIGATOIRE. `StorageType` les appelle
 * au milieu d'un déchiffrement ; les rendre asynchrones remonterait jusque dans
 * le protocole. Le coffre tient donc une copie en mémoire, chargée une fois par
 * `ouvrirCoffre()`, et persiste derrière.
 *
 * ⚠️ D'OÙ UNE RÈGLE À NE JAMAIS OUBLIER : `ouvrirCoffre()` DOIT avoir été
 * attendu avant le premier appel. Un coffre non ouvert répond « vide », et un
 * coffre vide fait générer une identité NEUVE. Le coffre le signale bruyamment
 * plutôt que de laisser cette faute passer inaperçue.
 */
function lire<T>(cle: string): T | undefined {
  return lireSecret<T>(cle)
}

function ecrire(cle: string, valeur: unknown): void {
  ecrireSecret(cle, valeur)
}

function effacer(cle: string): void {
  effacerSecret(cle)
}

/**
 * L'implémentation que la bibliothèque attend.
 *
 * ⚠️ LES NOMS DE MÉTHODES SONT IMPOSÉS par `StorageType` : ils sont en anglais
 * et ne se traduisent pas, la bibliothèque les appelant par leur nom. Les
 * commentaires, eux, disent ce que chacune garde.
 */
export class CoffreE2ee implements StorageType {
  /* ── L'identité : ce qui fait « moi » pour mes correspondants ── */

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    const c = lire<CoupleRange>("identite")
    return c ? lisCouple(c) : undefined
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    return lire<number>("registrationId")
  }

  poseIdentite(couple: KeyPairType, registrationId: number): void {
    ecrire("identite", rangeCouple(couple))
    ecrire("registrationId", registrationId)
  }

  /**
   * La clé d'identité d'un correspondant est-elle celle qu'on connaissait ?
   *
   * 🔴 C'EST LE POINT OÙ SE DÉTECTE UN SERVEUR QUI S'INTERPOSE. Si la clé
   * change, deux lectures sont possibles : le correspondant a réinstallé, ou
   * quelqu'un a pris sa place. Les deux se ressemblent, et seul l'utilisateur
   * peut trancher — en comparant le code de sécurité hors du canal.
   *
   * ⚠️ ON ACCEPTE POUR L'INSTANT, ET C'EST UNE DETTE ASSUMÉE : sans écran qui
   * prévienne, refuser bloquerait la conversation sans rien expliquer.
   * Accepter en silence est le choix des messageries grand public — mais il
   * DOIT s'accompagner d'un avertissement visible avant toute production.
   */
  async isTrustedIdentity(
    identifiant: string,
    cle: ArrayBuffer,
    _direction: Direction,
  ): Promise<boolean> {
    const connue = lire<string>(`identite.${identifiant}`)
    if (connue === undefined) return true
    if (connue !== versB64(cle)) {
      /*
       * ⚠️ ON CONSIGNE, ON NE BLOQUE PAS — décision du user, 21/09/2026.
       *
       * Refuser figerait la conversation sans rien expliquer, et le cas le
       * plus fréquent est parfaitement innocent : le correspondant a changé
       * de téléphone. Prévenir laisse la décision à qui peut la prendre.
       *
       * ⚠️ L'ADRESSE PORTE L'APPAREIL (`user.device`). On ne garde que le
       * compte : c'est de la personne qu'on veut parler à l'écran, pas de
       * l'un de ses appareils, dont le numéro ne signifie rien pour elle.
       */
      clesChangees.add(identifiant.split(".")[0])
      console.warn(
        `[e2ee] ⚠️ la clé d'identité de ${identifiant} a CHANGÉ. ` +
          "Réinstallation du correspondant, ou interception : seul un code de " +
          "sécurité vérifié hors ligne permet de trancher.",
      )
    }
    return true
  }

  async saveIdentity(identifiant: string, cle: ArrayBuffer): Promise<boolean> {
    const avant = lire<string>(`identite.${identifiant}`)
    ecrire(`identite.${identifiant}`, versB64(cle))
    // `true` = l'identité a changé ; la bibliothèque s'en sert pour signaler.
    return avant !== undefined && avant !== versB64(cle)
  }

  async loadIdentityKey(identifiant: string): Promise<ArrayBuffer | undefined> {
    const b64 = lire<string>(`identite.${identifiant}`)
    return b64 ? depuisB64(b64) : undefined
  }

  /* ── Les pré-clés : consommées à la première réception ── */

  async loadPreKey(id: string | number): Promise<KeyPairType | undefined> {
    const c = lire<CoupleRange>(`prekey.${id}`)
    return c ? lisCouple(c) : undefined
  }

  async storePreKey(id: number | string, couple: KeyPairType): Promise<void> {
    ecrire(`prekey.${id}`, rangeCouple(couple))
  }

  /**
   * ⚠️ APPELÉE PAR LA BIBLIOTHÈQUE QUAND LA PRÉ-CLÉ A SERVI, et il faut la
   * laisser faire : garder une pré-clé privée après usage, c'est garder de quoi
   * rejouer l'ouverture de session. C'est le pendant, côté client, de la
   * consommation atomique côté serveur.
   */
  async removePreKey(id: number | string): Promise<void> {
    effacer(`prekey.${id}`)
  }

  /* ── La pré-clé signée ── */

  async loadSignedPreKey(id: number | string): Promise<KeyPairType | undefined> {
    const c = lire<CoupleRange>(`prekeySignee.${id}`)
    return c ? lisCouple(c) : undefined
  }

  async storeSignedPreKey(id: number | string, couple: KeyPairType): Promise<void> {
    ecrire(`prekeySignee.${id}`, rangeCouple(couple))
  }

  async removeSignedPreKey(id: number | string): Promise<void> {
    effacer(`prekeySignee.${id}`)
  }

  /* ── Les sessions : l'état du Double Ratchet ── */

  /**
   * 🔴 CE QU'IL Y A DE PLUS PRÉCIEUX DANS CE FICHIER. Perdre une session, c'est
   * perdre la capacité de lire ce que le correspondant envoie déjà — il faut
   * alors en rouvrir une, et les messages en vol sont perdus.
   *
   * ⚠️ LA BIBLIOTHÈQUE RANGE ICI UNE CHAÎNE, pas un objet : on la reconduit
   * telle quelle, sans la relire ni la transformer. La « comprendre » serait
   * réimplémenter le protocole.
   */
  async loadSession(identifiant: string): Promise<SessionRecordType | undefined> {
    return lire<SessionRecordType>(`session.${identifiant}`)
  }

  async storeSession(identifiant: string, session: SessionRecordType): Promise<void> {
    ecrire(`session.${identifiant}`, session)
  }

  async removeSession(identifiant: string): Promise<void> {
    effacer(`session.${identifiant}`)
  }

  async removeAllSessions(prefixe: string): Promise<void> {
    /*
     * ⚠️ ON COPIE LA LISTE AVANT DE SUPPRIMER. `clesSecrets()` rend un
     * instantané, mais la règle vaut d'être écrite : parcourir et supprimer en
     * même temps faisait sauter une entrée sur deux du temps de `localStorage`,
     * dont les indices se décalaient à chaque retrait.
     */
    for (const cle of clesSecrets()) {
      if (cle.startsWith(`session.${prefixe}`)) effacer(cle)
    }
  }
}

/** Les types de la bibliothèque, réexportés pour que l'appelant n'ait qu'un import. */
export type { PreKeyType, SignedPublicPreKeyType }
