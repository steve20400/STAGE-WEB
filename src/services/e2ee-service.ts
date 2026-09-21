import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  type DeviceType,
  type MessageType,
} from "@privacyresearch/libsignal-protocol-typescript"
import { apiRequest } from "../lib/api-client"
import { CoffreE2ee } from "./e2ee-store"

/**
 * LE CHIFFREMENT DE BOUT EN BOUT — protocole Signal, côté navigateur.
 *
 * 🔴 CE FICHIER EST LA FRONTIÈRE. Tout ce qui en sort vers le réseau est chiffré
 * ou public ; tout ce qui reste est secret. Une fonction ajoutée ici qui
 * enverrait au serveur autre chose qu'un chiffré ou une clé PUBLIQUE annulerait
 * la propriété entière — et rien ne le signalerait, les messages continuant de
 * s'afficher.
 *
 * ⚠️ BIBLIOTHÈQUE NON MAINTENUE, ET C'EST LE RISQUE PRINCIPAL DE CE CHOIX.
 * Signal ne publie AUCUN portage navigateur de `libsignal` : le paquet officiel
 * est un module natif Node, et `libsignal-protocol-javascript` est abandonné
 * depuis des années. `@privacyresearch/libsignal-protocol-typescript` en est un
 * portage TypeScript, sans publication depuis trois ans. Il donne la vraie
 * sémantique du protocole pour développer et tester, mais il ne peut pas partir
 * en production sans une décision explicite : audit, portage WebAssembly
 * maintenu, ou chiffrement réservé aux clients natifs.
 */

/* ══════════════════ L'IDENTITÉ DE CET APPAREIL ══════════════════ */

/**
 * Les deux types de message du protocole, tels que CETTE bibliothèque les
 * numérote.
 *
 * ⚠️ CONTRE-INTUITIF, ET VÉRIFIÉ PAR LE BANC D'ESSAI : c'est **3** qui ouvre
 * une session, pas 1. Les noms le suggèrent dans l'autre sens, les valeurs
 * viennent de `libsignal-protocol-javascript` (`WHISPER = 1`,
 * `PREKEY_BUNDLE = 3`). Nommer ces deux nombres évite d'avoir à s'en
 * souvenir à chaque relecture.
 */
const TYPE_PREKEY = 3

const CLE_DEVICE = "alanya.e2ee.deviceId"

/** Combien de pré-clés à usage unique on publie d'un coup. */
const LOT_PREKEYS = 50

const coffre = new CoffreE2ee()

/**
 * L'identifiant d'appareil, au sens du protocole.
 *
 * ⚠️ IL EST TIRÉ UNE FOIS ET GARDÉ. Le régénérer ferait perdre toutes les
 * sessions — le correspondant continuerait d'écrire à un appareil qui n'existe
 * plus, et ses messages seraient illisibles sans que rien ne l'explique.
 *
 * ⚠️ PAS 1 PAR DÉFAUT : deux navigateurs du même compte se retrouveraient avec
 * le même identifiant et se voleraient leurs enveloppes. Un tirage large rend
 * la collision négligeable.
 */
export function idAppareil(): number {
  const garde = localStorage.getItem(CLE_DEVICE)
  if (garde !== null) {
    const n = Number(garde)
    if (Number.isInteger(n) && n > 0) return n
  }
  const neuf = Math.floor(Math.random() * 2_000_000_000) + 1
  localStorage.setItem(CLE_DEVICE, String(neuf))
  return neuf
}

/* ══════════════════ SÉRIALISATION RÉSEAU ══════════════════ */

function versB64(buf: ArrayBuffer): string {
  const o = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < o.length; i++) s += String.fromCharCode(o[i])
  return btoa(s)
}

function depuisB64(b64: string): ArrayBuffer {
  const s = atob(b64)
  const o = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i)
  return o.buffer
}

/* ══════════════════ PUBLICATION DES CLÉS ══════════════════ */

/**
 * Crée l'identité de cet appareil si elle n'existe pas, et publie ses clés
 * PUBLIQUES.
 *
 * ⚠️ IDEMPOTENTE : rappelée, elle ne régénère pas l'identité. C'est ce qui
 * permet de l'appeler au démarrage sans réfléchir — et ce qui évite la faute la
 * plus coûteuse, une identité neuve à chaque rechargement de page.
 */
export async function preparerCetAppareil(): Promise<{
  deviceId: number
  prekeysRestantes: number
}> {
  const deviceId = idAppareil()

  let identite = await coffre.getIdentityKeyPair()
  let registrationId = await coffre.getLocalRegistrationId()

  if (!identite || registrationId === undefined) {
    identite = await KeyHelper.generateIdentityKeyPair()
    registrationId = KeyHelper.generateRegistrationId()
    coffre.poseIdentite(identite, registrationId)
  }

  /*
   * ⚠️ LA PRÉ-CLÉ SIGNÉE EST SIGNÉE PAR L'IDENTITÉ, et c'est ce qui empêche le
   * serveur de fabriquer la sienne pour s'interposer. Le correspondant vérifie
   * cette signature avant d'ouvrir la session ; sans elle, il ferait confiance
   * à ce que le serveur veut bien lui servir.
   */
  const idSignee = Math.floor(Math.random() * 100_000) + 1
  const signee = await KeyHelper.generateSignedPreKey(identite, idSignee)
  await coffre.storeSignedPreKey(idSignee, signee.keyPair)

  // Les pré-clés à usage unique : chacune ne sert qu'une fois, d'où le lot.
  const prekeys: { id: number; clePublique: string }[] = []
  const base = Math.floor(Math.random() * 100_000) + 1
  for (let i = 0; i < LOT_PREKEYS; i++) {
    const id = base + i
    const pk = await KeyHelper.generatePreKey(id)
    await coffre.storePreKey(id, pk.keyPair)
    prekeys.push({ id, clePublique: versB64(pk.keyPair.pubKey) })
  }

  const r = await apiRequest<{ deviceId: number; prekeysRestantes: number }>(
    "/api/e2ee/cles",
    {
      method: "PUT",
      body: {
        deviceId,
        registrationId,
        // ⚠️ `pubKey` UNIQUEMENT. Envoyer `privKey` ici annulerait tout, et rien
        // ne le signalerait : le chiffrement continuerait de « marcher ».
        cleIdentite: versB64(identite.pubKey),
        prekeySignee: {
          id: idSignee,
          clePublique: versB64(signee.keyPair.pubKey),
          signature: versB64(signee.signature),
        },
        prekeys,
      },
    },
  )
  return r
}

/* ══════════════════ OUVERTURE DE SESSION ══════════════════ */

interface PaquetRecu {
  deviceId: number
  registrationId: number
  cleIdentite: string
  prekeySignee: { prekeyId: number; clePublique: string; signature: string }
  prekeyUnique: { prekeyId: number; clePublique: string } | null
}

/**
 * Ouvre une session vers chaque appareil d'un correspondant.
 *
 * 🔴 C'EST X3DH. On récupère un paquet de pré-clés — ce que le serveur sait du
 * correspondant, tout public — et on en dérive un secret partagé SANS que
 * l'autre soit connecté. C'est ce qui rend une messagerie asynchrone
 * chiffrable ; sans cela, il faudrait que les deux soient en ligne en même
 * temps.
 *
 * ⚠️ LA ROUTE CONSOMME UNE PRÉ-CLÉ UNIQUE PAR APPAREIL. On ne l'appelle donc
 * QUE pour ouvrir réellement une session, jamais pour « voir ».
 */
export async function ouvrirSessions(userId: string): Promise<number[]> {
  const r = await apiRequest<{ paquets: PaquetRecu[] }>(
    `/api/e2ee/cles/${encodeURIComponent(userId)}`,
  )

  const ouverts: number[] = []
  for (const p of r.paquets) {
    const adresse = new SignalProtocolAddress(userId, p.deviceId)
    const batisseur = new SessionBuilder(coffre, adresse)

    const paquet: DeviceType = {
      identityKey: depuisB64(p.cleIdentite),
      registrationId: p.registrationId,
      signedPreKey: {
        keyId: p.prekeySignee.prekeyId,
        publicKey: depuisB64(p.prekeySignee.clePublique),
        signature: depuisB64(p.prekeySignee.signature),
      },
      // `undefined` quand le stock est épuisé : X3DH saute alors le quatrième
      // calcul Diffie-Hellman, ce qui reste valide mais affaiblit la session.
      preKey: p.prekeyUnique
        ? {
            keyId: p.prekeyUnique.prekeyId,
            publicKey: depuisB64(p.prekeyUnique.clePublique),
          }
        : undefined,
    }

    /*
     * ⚠️ `processPreKey` VÉRIFIE LA SIGNATURE et lève si elle ne correspond
     * pas à la clé d'identité. C'est LE contrôle qui écarte un serveur qui
     * servirait une pré-clé fabriquée — on laisse donc l'exception remonter
     * plutôt que de l'avaler : une session qu'on n'a pas pu vérifier ne doit
     * pas s'ouvrir.
     */
    await batisseur.processPreKey(paquet)
    ouverts.push(p.deviceId)
  }
  return ouverts
}

/* ══════════════════ CHIFFRER / DÉCHIFFRER ══════════════════ */

export interface EnveloppeSortante {
  destinataireId: string
  destinataireDevice: number
  type: number
  corps: string
}

/**
 * Chiffre un texte pour chaque appareil du destinataire.
 *
 * ⚠️ UNE ENVELOPPE PAR APPAREIL, et c'est la conséquence directe du chiffrement
 * par appareil. Trois appareils = trois chiffrés distincts, chacun illisible
 * par les deux autres.
 */
export async function chiffrerPour(
  userId: string,
  devices: number[],
  texte: string,
): Promise<EnveloppeSortante[]> {
  const octets = new TextEncoder().encode(texte)
  const enveloppes: EnveloppeSortante[] = []

  for (const deviceId of devices) {
    const adresse = new SignalProtocolAddress(userId, deviceId)
    const chiffreur = new SessionCipher(coffre, adresse)
    const chiffre: MessageType = await chiffreur.encrypt(octets.buffer as ArrayBuffer)
    enveloppes.push({
      destinataireId: userId,
      destinataireDevice: deviceId,
      // 3 = PreKeyWhisperMessage (ouvre la session), 1 = WhisperMessage.
      type: chiffre.type,
      // ⚠️ `body` EST UNE CHAÎNE BINAIRE, pas de l'UTF-8 : la passer par
      // `TextEncoder` la corromprait. On la met en base64 telle quelle.
      corps: btoa(chiffre.body ?? ""),
    })
  }
  return enveloppes
}

export interface EnveloppeRecue {
  id: string
  /** La ligne du fil que ce contenu complète, quand il y en a une. */
  messageId: string | null
  convId: string
  expediteurId: string
  expediteurDevice: number
  type: number
  corps: string
  createdAt: string
}

/**
 * Déchiffre une enveloppe reçue.
 *
 * 🔴 3 = PRÉ-CLÉ (ouvre la session), 1 = COURANT. C'EST BIEN DANS CE SENS,
 * et l'inverse est l'erreur qu'on fait spontanément.
 *
 * 🐛 Ce fichier a d'abord été écrit avec la convention inverse — « 1 ouvre,
 * 3 continue » — reprise des noms `PreKeyWhisperMessage` / `WhisperMessage`
 * sans vérifier les valeurs. Le banc d'essai a tranché : la bibliothèque
 * renvoie **3** pour le tout premier message d'une session. Elle hérite de
 * `libsignal-protocol-javascript`, où `Type.WHISPER = 1` et
 * `Type.PREKEY_BUNDLE = 3`.
 *
 * ⚠️ SE TROMPER NE DONNE AUCUNE ERREUR PARLANTE : on appelle la mauvaise
 * méthode, qui cherche une session qui n'existe pas encore, et l'on obtient
 * « No record for device » — un message qui désigne l'appareil, donc qui
 * envoie chercher le défaut du côté des identités. Le vrai coupable est ce
 * nombre.
 */
export async function dechiffrer(e: EnveloppeRecue): Promise<string> {
  const adresse = new SignalProtocolAddress(e.expediteurId, e.expediteurDevice)
  const chiffreur = new SessionCipher(coffre, adresse)
  const clair =
    e.type === TYPE_PREKEY
      ? await chiffreur.decryptPreKeyWhisperMessage(atob(e.corps), "binary")
      : await chiffreur.decryptWhisperMessage(atob(e.corps), "binary")
  return new TextDecoder().decode(new Uint8Array(clair))
}

/* ══════════════════ TRANSPORT ══════════════════ */

/**
 * Dépose les enveloppes d un message.
 *
 * @param messageId la ligne du fil à laquelle ce contenu appartient.
 *
 * ⚠️ FACULTATIF, ET C EST VOULU : le banc d essai dépose des enveloppes sans
 * message, et un futur échange de clés hors fil en fera autant. L exiger
 * interdirait ces usages sans rien protéger de plus.
 */
export async function deposer(
  convId: string,
  enveloppes: EnveloppeSortante[],
  messageId?: string,
): Promise<number> {
  const r = await apiRequest<{ deposees: number }>("/api/e2ee/enveloppes", {
    method: "POST",
    body: { convId, deviceId: idAppareil(), enveloppes, messageId },
  })
  return r.deposees
}

export async function relever(): Promise<EnveloppeRecue[]> {
  const r = await apiRequest<{ enveloppes: EnveloppeRecue[] }>(
    `/api/e2ee/enveloppes?deviceId=${idAppareil()}`,
    { cache: "no-store" },
  )
  return r.enveloppes ?? []
}

/**
 * Accuse réception.
 *
 * ⚠️ APRÈS DÉCHIFFREMENT RÉUSSI, JAMAIS AVANT. Acquitter puis échouer perdrait
 * le message définitivement : personne d'autre ne l'a, et le serveur ne peut
 * pas le reconstituer.
 */
export async function acquitter(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await apiRequest(`/api/e2ee/enveloppes?ids=${ids.map(encodeURIComponent).join(",")}`, {
    method: "DELETE",
  })
}
