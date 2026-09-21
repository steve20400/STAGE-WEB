import type {
  Direction,
  KeyPairType,
  PreKeyType,
  SessionRecordType,
  SignedPublicPreKeyType,
  StorageType,
} from "@privacyresearch/libsignal-protocol-typescript"

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
 * ⚠️ `localStorage` POUR CE PREMIER JET, ET C'EST INSUFFISANT POUR LA
 * PRODUCTION. Il est synchrone, plafonné à quelques mégaoctets, et lisible par
 * tout script de la même origine. La cible est IndexedDB, chiffré par une clé
 * non extractible de WebCrypto ; ce choix-ci ne tient que pour développer et
 * tester en local, et il est marqué comme tel.
 */

const PREFIXE = "alanya.e2ee."

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

function lire<T>(cle: string): T | undefined {
  try {
    const brut = localStorage.getItem(PREFIXE + cle)
    return brut === null ? undefined : (JSON.parse(brut) as T)
  } catch {
    // Stockage indisponible (navigation privée, quota) : on se comporte comme
    // un coffre vide plutôt que de lever au milieu d'un déchiffrement.
    return undefined
  }
}

function ecrire(cle: string, valeur: unknown): void {
  try {
    localStorage.setItem(PREFIXE + cle, JSON.stringify(valeur))
  } catch {
    /*
     * ⚠️ UNE ÉCRITURE PERDUE ICI PERD UNE SESSION. On ne peut pas faire mieux
     * que le signaler : lever remonterait au milieu d'un envoi, et avaler en
     * silence laisserait croire que tout va bien. La console est le moindre
     * mal tant que le coffre n'est pas passé à IndexedDB.
     */
    console.error("[e2ee] écriture impossible dans le coffre :", cle)
  }
}

function effacer(cle: string): void {
  try {
    localStorage.removeItem(PREFIXE + cle)
  } catch {
    /* rien à faire de plus */
  }
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
    const changee = connue !== versB64(cle)
    if (changee) {
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
    const aRetirer: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const cle = localStorage.key(i)
      if (cle && cle.startsWith(`${PREFIXE}session.${prefixe}`)) aRetirer.push(cle)
    }
    // Retiré APRÈS le parcours : supprimer pendant décale les indices et fait
    // sauter une entrée sur deux.
    for (const cle of aRetirer) localStorage.removeItem(cle)
  }
}

/** Les types de la bibliothèque, réexportés pour que l'appelant n'ait qu'un import. */
export type { PreKeyType, SignedPublicPreKeyType }
