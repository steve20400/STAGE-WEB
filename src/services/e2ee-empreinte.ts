import { FingerprintGenerator } from "@privacyresearch/libsignal-protocol-typescript"
import { getMyUserId } from "../data/session-user"
import { idAppareil } from "./e2ee-service"
import { CoffreE2ee } from "./e2ee-store"
import {
  clesSecrets,
  ecrireSecret,
  effacerSecret,
  lireSecret,
  ouvrirCoffre,
} from "./coffre-chiffre"

/**
 * LES CODES DE SÉCURITÉ — comparer, hors de ce canal, les clés qu'on utilise.
 *
 * 🔴 CE FICHIER RÉPOND À LA SEULE QUESTION QUE LE CHIFFREMENT NE PEUT PAS
 * RÉSOUDRE SEUL : « la clé que j'utilise est-elle bien celle de mon
 * correspondant, ou le serveur m'a-t-il donné la sienne ? »
 *
 * Tout le reste — X3DH, le Double Ratchet, le coffre — suppose que les clés
 * publiques échangées sont les bonnes. C'est le SERVEUR qui les distribue. Un
 * serveur malveillant peut donc donner à Alice sa propre clé en prétendant que
 * c'est celle de Bob, lire, rechiffrer, et transmettre. Rien dans le protocole
 * ne le détecte : les deux côtés voient une conversation qui marche.
 *
 * ⚠️ SEULE UNE COMPARAISON HORS DU CANAL TRANCHE. De vive voix, en face à face,
 * par un autre moyen. C'est pour cela que ce code s'affiche : il n'a de valeur
 * que LU À HAUTE VOIX ou scanné, jamais envoyé par la conversation qu'il doit
 * vérifier.
 */

/*
 * 🔴 ON LIT LA CLÉ DU COFFRE LOCAL, PAS CELLE DU SERVEUR. C'est le point qui
 * fait toute la valeur de cet écran, et il est facile de se tromper.
 *
 * Demander au serveur « quelle est la clé de Bob ? » pour l'afficher laisserait
 * un serveur malveillant montrer la VRAIE clé de Bob pendant qu'il fait parler
 * Alice à un imposteur. Le code afficherait alors la bonne valeur, les deux
 * personnes le compareraient avec succès, et la vérification prouverait
 * exactement rien.
 *
 * On affiche donc la clé AVEC LAQUELLE ON PARLE — celle que la bibliothèque a
 * rangée dans le coffre à l'ouverture de la session.
 */
const coffre = new CoffreE2ee()

/**
 * Le nombre d'itérations de hachage.
 *
 * ⚠️ C'EST CELUI DE SIGNAL, ET IL NE SE CHOISIT PAS AU HASARD : deux clients
 * qui n'itèrent pas le même nombre de fois produisent des codes DIFFÉRENTS pour
 * les mêmes clés. Les deux personnes concluraient à une interposition.
 *
 * Mesuré sur ce poste : ~450 ms pour un couple. C'est acceptable pour un écran
 * ouvert à la demande, et ce coût EST la protection — il rend le calcul d'une
 * collision hors de portée.
 */
const ITERATIONS = 5200

/** La clé du coffre où se range une vérification. */
function cleVerification(peerUserId: string, deviceId: number): string {
  return `verifie.${peerUserId}.${deviceId}`
}

/** Un code de sécurité, pour UN appareil du correspondant. */
export interface Empreinte {
  deviceId: number
  /** 60 chiffres. À afficher en 12 groupes de 5. */
  code: string
  /**
   * L'utilisateur a-t-il déjà comparé CETTE clé ?
   *
   * ⚠️ LIÉ À LA CLÉ, PAS À LA PERSONNE. Une vérification enregistrée sous le
   * seul nom du correspondant survivrait à un changement de clé — c'est-à-dire
   * qu'elle continuerait d'affirmer « vérifié » au moment précis où elle ne
   * l'est plus. C'est le défaut que cet écran existe pour empêcher.
   */
  verifie: boolean
}

/**
 * Les codes de sécurité pour tous les appareils connus d'un correspondant.
 *
 * ⚠️ UN CODE PAR APPAREIL, ET CE N'EST PAS UN DÉTAIL D'IMPLÉMENTATION. Chez
 * Signal, une identité vaut pour un compte entier ; chez nous, elle vaut pour un
 * APPAREIL — c'est ce qui permet à quelqu'un d'utiliser le web et le téléphone
 * sans casser le ratchet. La contrepartie est ici : vérifier un correspondant
 * qui a deux appareils, c'est vérifier deux codes.
 *
 * ⚠️ RIEN N'EST DEMANDÉ AU SERVEUR. Si aucune session n'a jamais été ouverte
 * avec cette personne, la liste est vide — il n'y a rien à vérifier, et c'est la
 * réponse honnête.
 */
export async function empreintesPour(peerUserId: string): Promise<Empreinte[]> {
  await ouvrirCoffre()

  const moi = getMyUserId()
  if (!moi) return []

  const maCle = await coffre.getIdentityKeyPair()
  if (!maCle) return []

  /*
   * Les appareils connus se lisent dans le coffre : la bibliothèque y range la
   * clé d'identité de chaque correspondant sous `identite.<userId>.<deviceId>`.
   */
  const prefixe = `identite.${peerUserId}.`
  const appareils = clesSecrets()
    .filter((c) => c.startsWith(prefixe))
    .map((c) => Number(c.slice(prefixe.length)))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)

  const generateur = new FingerprintGenerator(ITERATIONS)
  const empreintes: Empreinte[] = []

  for (const deviceId of appareils) {
    const saCleB64 = lireSecret<string>(`identite.${peerUserId}.${deviceId}`)
    if (!saCleB64) continue

    /*
     * ⚠️ L'IDENTIFIANT DOIT ÊTRE LE MÊME DES DEUX CÔTÉS, sans quoi les deux
     * personnes verraient des codes différents et concluraient à une attaque là
     * où il n'y a qu'un désaccord de nommage. L'identifiant de compte est la
     * seule valeur que les deux connaissent et qui ne change jamais.
     *
     * ⚠️ PAS L'ADRESSE `userId.deviceId` : mon appareil et le sien n'ont pas le
     * même numéro, et le code cesserait d'être symétrique.
     */
    const code = await generateur.createFor(
      moi,
      maCle.pubKey,
      peerUserId,
      depuisB64(saCleB64),
    )

    empreintes.push({
      deviceId,
      code,
      verifie: lireSecret<string>(cleVerification(peerUserId, deviceId)) === saCleB64,
    })
  }

  return empreintes
}

/**
 * L'utilisateur déclare avoir comparé ce code, et qu'il correspond.
 *
 * 🔴 ON ENREGISTRE LA CLÉ, PAS UN BOOLÉEN. C'est ce qui fait qu'un changement de
 * clé RETIRE automatiquement la vérification : la valeur rangée ne correspond
 * plus, et `verifie` retombe à faux sans que personne n'ait à y penser.
 *
 * Un booléen aurait affirmé « vérifié » au moment précis où ça cesse d'être
 * vrai — exactement ce contre quoi cet écran existe.
 */
export async function marquerVerifie(peerUserId: string, deviceId: number): Promise<void> {
  await ouvrirCoffre()
  const cle = lireSecret<string>(`identite.${peerUserId}.${deviceId}`)
  if (!cle) return
  ecrireSecret(cleVerification(peerUserId, deviceId), cle)
}

/** L'utilisateur revient sur sa déclaration. */
export async function retirerVerification(
  peerUserId: string,
  deviceId: number,
): Promise<void> {
  await ouvrirCoffre()
  effacerSecret(cleVerification(peerUserId, deviceId))
}

/**
 * Ce correspondant est-il vérifié sur TOUS ses appareils connus ?
 *
 * ⚠️ TOUS, ET PAS « AU MOINS UN ». Un appareil non vérifié est un appareil qui
 * peut lire la conversation : annoncer « vérifié » alors qu'il en reste un
 * inconnu dirait le contraire de la vérité.
 *
 * ⚠️ UN CORRESPONDANT SANS AUCUN APPAREIL CONNU N'EST PAS VÉRIFIÉ. Sans cette
 * ligne, `every` sur une liste vide rendrait `true` — le badge « vérifié »
 * s'afficherait pour quelqu'un à qui l'on n'a jamais parlé.
 */
export function estVerifie(peerUserId: string): boolean {
  const prefixe = `identite.${peerUserId}.`
  const appareils = clesSecrets().filter((c) => c.startsWith(prefixe))
  if (appareils.length === 0) return false

  return appareils.every((cleIdentite) => {
    const deviceId = cleIdentite.slice(prefixe.length)
    return (
      lireSecret<string>(`verifie.${peerUserId}.${deviceId}`) ===
      lireSecret<string>(cleIdentite)
    )
  })
}

/**
 * Mon propre code, pour cet appareil — celui que le correspondant compare.
 *
 * Sert à l'affichage : les deux moitiés du code viennent des deux identités, et
 * l'écran montre laquelle est la sienne.
 */
export function monAppareil(): number {
  return idAppareil()
}

function depuisB64(b64: string): ArrayBuffer {
  const s = atob(b64)
  const octets = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) octets[i] = s.charCodeAt(i)
  return octets.buffer
}

/**
 * Découpe un code de 60 chiffres en 12 groupes de 5.
 *
 * ⚠️ LA MISE EN FORME N'EST PAS DE LA DÉCORATION : ce code se lit À HAUTE VOIX,
 * souvent au téléphone. Soixante chiffres d'affilée ne se lisent pas ; douze
 * groupes de cinq, si.
 */
export function enGroupes(code: string): string[] {
  const groupes: string[] = []
  for (let i = 0; i < code.length; i += 5) groupes.push(code.slice(i, i + 5))
  return groupes
}
