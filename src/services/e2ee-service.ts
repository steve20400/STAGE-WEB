import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  type DeviceType,
  type MessageType,
} from "@privacyresearch/libsignal-protocol-typescript"
import { apiRequest } from "../lib/api-client"
import { getOrCreateWebDeviceId } from "./appareils-service"
import { CoffreE2ee } from "./e2ee-store"
import { ouvrirCoffre, viderCoffre, coffreEcrit } from "./coffre-chiffre"

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

/**
 * Combien de pré-clés signées on garde en arrière.
 *
 * ⚠️ PAS UNE SEULE : un message en vol désigne celle qui était publiée quand
 * son expéditeur a récupéré notre paquet. Trois générations couvrent le temps
 * de vol sans laisser le coffre grossir.
 */
const SIGNEES_GARDEES = 3

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

  /*
   * 🔴 DÉRIVÉ DE L'IDENTIFIANT D'APPAREIL DÉJÀ UTILISÉ PAR L'APPLICATION,
   * et non tiré au sort séparément.
   *
   * `getOrCreateWebDeviceId()` est celui que la connexion envoie au serveur
   * et qui rattache la session à ce navigateur. S'en servir met les deux
   * notions d'« appareil » d'accord : se déconnecter puis se reconnecter ne
   * crée plus une identité cryptographique de plus, là où un tirage
   * indépendant en fabriquait une à chaque fois qu'on vidait ce seul-là.
   *
   * ⚠️ CELA NE SURVIT PAS À UN VIDAGE DU STOCKAGE — et RIEN ne le pourrait.
   * Une identité EST sa clé privée : si la clé a disparu, aucune empreinte de
   * navigateur ne la ressuscite. Reconnaître l'appareil pour lui rendre son
   * ancienne identité PUBLIQUE sans la privée donnerait un appareil qui
   * paraîtrait vivant et ne déchiffrerait rien — pire que le défaut qu'on
   * corrige. La vraie parade est le ménage, côté serveur.
   */
  const base = getOrCreateWebDeviceId()

  /*
   * Un entier positif, dérivé de façon déterministe.
   *
   * ⚠️ CE N'EST PAS DE LA CRYPTOGRAPHIE : ce nombre n'est qu'une ÉTIQUETTE,
   * publique et sans secret. Une empreinte simple suffit, et personne ne doit
   * jamais la confondre avec une clé.
   *
   * ⚠️ BORNÉ À 2 000 000 000 : la colonne est un `INTEGER` PostgreSQL, qui
   * s'arrête à 2 147 483 647. Un nombre plus grand serait refusé à
   * l'écriture, et l'erreur ne parlerait que de dépassement.
   */
  let h = 2166136261
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const neuf = (Math.abs(h) % 2_000_000_000) + 1

  localStorage.setItem(CLE_DEVICE, String(neuf))
  return neuf
}

/**
 * Retire l'identité de cet appareil — à la déconnexion.
 *
 * 🔴 SANS CE GESTE, L'IDENTITÉ RESTE PUBLIÉE POUR TOUJOURS. Les correspondants
 * continuent de chiffrer pour un appareil qui ne lira plus rien : chaque
 * message part en un exemplaire de trop, consomme une pré-clé, et laisse des
 * enveloppes que personne ne relèvera.
 *
 * ⚠️ ON EFFACE AUSSI LE COFFRE LOCAL. Garder des clés privées après une
 * déconnexion reviendrait à laisser sur l'appareil de quoi lire ce qui a été
 * échangé — alors que se déconnecter veut précisément dire le contraire.
 *
 * ⚠️ NE LÈVE JAMAIS : une déconnexion ne doit pas échouer parce que le réseau
 * est coupé. L'identité restera alors publiée, et le balayage du serveur s'en
 * chargera au bout de trente jours de silence.
 */
export async function oublierCetAppareil(): Promise<void> {
  const deviceId = idAppareil()
  try {
    await apiRequest(`/api/e2ee/cles?deviceId=${deviceId}`, { method: "DELETE" })
  } catch {
    // Voir ci-dessus : le balayage rattrapera.
  }
  /*
   * ⚠️ LES DEUX MAGASINS SONT VIDÉS, ET IL FAUT LES DEUX.
   *
   * Le coffre chiffré porte désormais les secrets — sa clé part avec, sans
   * quoi ce qui resterait sur le disque serait encore lisible. `localStorage`
   * est nettoyé lui aussi : il garde le `deviceId`, et peut garder des restes
   * d'avant la reprise si celle-ci a été interrompue.
   */
  await coffreEcrit()
  await viderCoffre()
  try {
    const aRetirer: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const cle = localStorage.key(i)
      if (cle && (cle.startsWith("alanya.e2ee.") || cle === CLE_DEVICE)) {
        aRetirer.push(cle)
      }
    }
    // Retiré APRÈS le parcours : supprimer pendant décale les indices et fait
    // sauter une entrée sur deux.
    for (const cle of aRetirer) localStorage.removeItem(cle)
  } catch {
    /* stockage indisponible : rien de plus à faire */
  }
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

  /*
   * 🔴 LE COFFRE S'OUVRE ICI, ET AVANT TOUT LE RESTE.
   *
   * Le magasin est asynchrone depuis le 23/09/2026 : il charge ses secrets
   * d'IndexedDB, les déchiffre, et reprend au passage l'ancien coffre
   * `localStorage`. Lire avant que ce travail soit fini rendrait « vide ».
   *
   * ⚠️ ET UN COFFRE VIDE FAIT GÉNÉRER UNE IDENTITÉ NEUVE — trois lignes plus
   * bas. C'est la faute la plus coûteuse du chiffrement : l'ancienne identité
   * reste publiée et muette, chaque message part en double dont un exemplaire
   * que personne ne lira, et RIEN à l'écran ne le signale.
   *
   * ⚠️ C'EST LE SEUL ENDROIT À OUVRIR, parce que c'est le seul point d'entrée
   * du chiffrement : tout le reste suppose qu'un appareil est déjà préparé.
   */
  await ouvrirCoffre()

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

  /*
   * 🐛 LES PRÉ-CLÉS SIGNÉES S'ACCUMULAIENT SANS FIN.
   *
   * Une neuve est produite à CHAQUE appel — donc à chaque connexion — et
   * l'ancienne n'était jamais retirée. Le coffre étant désormais chargé en
   * mémoire au démarrage, la fuite se payait deux fois : sur le disque et à
   * l'ouverture.
   *
   * ⚠️ ON N'EN GARDE PAS QU'UNE, ET C'EST ESSENTIEL. Un correspondant a pu
   * récupérer notre paquet il y a dix minutes et ne nous écrire que
   * maintenant : son message désigne l'ANCIENNE pré-clé signée. La retirer
   * aussitôt rendrait ce message illisible — définitivement, personne d'autre
   * ne le détenant.
   *
   * Trois générations couvrent largement le temps de vol d'un message, et
   * bornent le coffre. C'est la fenêtre de grâce, pas de la prudence vague.
   */
  const generations = [...(coffre.lireGenerationsSignees() ?? []), idSignee]
  const aRetirer = generations.slice(0, Math.max(0, generations.length - SIGNEES_GARDEES))
  for (const vieille of aRetirer) await coffre.removeSignedPreKey(vieille)
  coffre.poseGenerationsSignees(generations.slice(-SIGNEES_GARDEES))

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

/* ══════════════════ RÉAPPROVISIONNEMENT ══════════════════ */

/**
 * Republie un lot de pré-clés si le serveur dit que le stock est bas.
 *
 * 🐛 LE SERVEUR RÉCLAMAIT DÉJÀ, ET PERSONNE N'ÉCOUTAIT. `GET /api/e2ee/cles`
 * rend `reapproNecessaire` depuis le premier jour, avec ce commentaire :
 * « C'EST LE SERVEUR QUI RÉCLAME, PAS LE CLIENT QUI DEVINE ». Le client, lui,
 * ne lisait ce champ nulle part.
 *
 * ⚠️ CE QUE ÇA DONNAIT : les 50 pré-clés à usage unique s'épuisent au fil des
 * nouveaux correspondants, et le jour où il n'en reste plus, PLUS PERSONNE ne
 * peut ouvrir de conversation avec cet appareil. Panne muette : rien ne casse
 * chez celui qui la subit, ce sont les AUTRES qui n'arrivent pas à lui écrire.
 *
 * ⚠️ RIEN NE SE VÉRIFIAIT AU FIL DE L'EAU. Le stock n'était republié qu'à la
 * connexion. Quelqu'un qui reste connecté des semaines — le cas normal sur le
 * web — pouvait le vider sans jamais repasser par là.
 *
 * ⚠️ NE LÈVE JAMAIS, ET NE BLOQUE RIEN. C'est un entretien de fond : l'échouer
 * ne doit pas empêcher d'envoyer le message qu'on est en train d'écrire.
 */
export async function reapprovisionnerSiNecessaire(): Promise<boolean> {
  try {
    const deviceId = idAppareil()
    const etat = await apiRequest<{
      appareils: { deviceId: number; reapproNecessaire: boolean }[]
    }>("/api/e2ee/cles")
    const moi = etat.appareils.find((a) => a.deviceId === deviceId)
    if (!moi?.reapproNecessaire) return false

    /*
     * ⚠️ ON REPASSE PAR `preparerCetAppareil`, ON NE DUPLIQUE PAS. Elle publie
     * un lot neuf ET fait tourner la pré-clé signée — la rotation que Signal
     * fait périodiquement. Écrire un second chemin « juste pour les pré-clés »
     * ferait diverger les deux le jour où l'un changerait.
     *
     * ⚠️ ELLE NE RÉGÉNÈRE PAS L'IDENTITÉ : c'est ce qui rend ce rappel sans
     * danger, et c'est écrit dans son en-tête.
     */
    await preparerCetAppareil()
    return true
  } catch {
    // Réseau coupé, serveur ancien : on réessaiera au prochain passage.
    return false
  }
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
/*
 * ══════════════ CHAQUE ENTRÉE OUVRE LE COFFRE ELLE-MÊME ══════════════
 *
 * 🐛 CONSTATÉ LE 23/09/2026 : « Missing Signed PreKey for PreKeyWhisperMessage ».
 * Un message parfaitement valide, refusé — parce que le coffre n'était pas
 * encore chargé et répondait « vide ».
 *
 * LA CAUSE N'ÉTAIT PAS LE CHIFFREMENT. Le magasin est asynchrone depuis
 * qu'il est chiffré ; il se charge dans `preparerCetAppareil()`. Mais rien
 * n'oblige à passer par là avant de déchiffrer : `releverEtDechiffrer()`
 * part du fil de discussion, qui peut s'ouvrir AVANT que la préparation
 * lancée à la connexion n'ait abouti.
 *
 * ⚠️ NE PAS COMPTER SUR L'ORDRE DES APPELS. « Il suffit d'appeler A avant B »
 * est une règle qu'aucun test ne vérifie et qu'un écran suffit à violer.
 * Chaque fonction qui touche au coffre l'ouvre donc elle-même.
 *
 * ⚠️ C'EST GRATUIT QUAND C'EST DÉJÀ FAIT : `ouvrirCoffre()` rend la MÊME
 * promesse à tous ses appelants. Le coût est un `await` déjà résolu.
 */
export async function ouvrirSessions(userId: string): Promise<number[]> {
  const devices = await ouvrirSessionsInterne(userId)
  /*
   * ⚠️ L'ENTRETIEN SE FAIT ICI, ET APRÈS COUP.
   *
   * Ouvrir une session consomme une pré-clé — celle du correspondant. C'est
   * donc le moment où le stock BOUGE dans le système, et le bon endroit pour
   * regarder le nôtre.
   *
   * ⚠️ `void`, PAS `await` : on ne retarde pas l'envoi d'un message pour un
   * entretien de fond. Un réapprovisionnement manqué se rattrape au passage
   * suivant ; un message retardé se voit.
   */
  void reapprovisionnerSiNecessaire()
  return devices
}

async function ouvrirSessionsInterne(userId: string): Promise<number[]> {
  await ouvrirCoffre()
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
  await ouvrirCoffre()
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
  await ouvrirCoffre()
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
