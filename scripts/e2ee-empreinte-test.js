/**
 * LES CODES DE SÉCURITÉ.
 *
 * La seule propriété qui compte vraiment : **Alice et Bob voient le MÊME code**.
 * Si elle tombe, la fonctionnalité fait l'inverse de ce qu'on attend d'elle —
 * elle annonce une attaque à deux personnes qui n'en subissent aucune.
 *
 * ⚠️ NE SE LANCE PAS DIRECTEMENT — voir `scripts/e2ee-empreinte.mjs`.
 */

import { FingerprintGenerator } from "@privacyresearch/libsignal-protocol-typescript"
import {
  empreintesPour,
  enGroupes,
  estVerifie,
  marquerVerifie,
  retirerVerification,
} from "../src/services/e2ee-empreinte"
import { ecrireSecret, ouvrirCoffre, coffreEcrit } from "../src/services/coffre-chiffre"

let echecs = 0

function verifie(libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`)
  if (!condition) {
    echecs++
    if (detail !== undefined) console.log(`      \x1b[31m${detail}\x1b[0m`)
  }
}

function titre(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`)
}

/** Une clé publique factice, déterministe. */
function cle(graine) {
  const o = new Uint8Array(33)
  for (let i = 0; i < 33; i++) o[i] = (i * 31 + graine * 17) % 256
  return o.buffer
}

function versB64(buf) {
  const o = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < o.length; i++) s += String.fromCharCode(o[i])
  return btoa(s)
}

const ALICE = "11111111-1111-1111-1111-111111111111"
const BOB = "22222222-2222-2222-2222-222222222222"

/**
 * Un jeton de session factice, pour que `getMyUserId()` réponde.
 *
 * ⚠️ ON NE SIMULE PAS LE SERVICE, ON LUI DONNE SON CONTEXTE. Remplacer
 * `getMyUserId` par un bouchon ferait passer le banc même si le service lisait
 * la mauvaise valeur — c'est justement l'identifiant qui rend le code
 * symétrique, et il doit être éprouvé tel qu'il est lu en vrai.
 *
 * Ce n'est pas un JWT valide : personne ne le vérifie ici, seule sa CHARGE est
 * décodée. C'est suffisant, et ça évite de faire dépendre ce banc d'un
 * serveur.
 */
function poseSession(userId) {
  const b64 = (o) =>
    btoa(JSON.stringify(o))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  localStorage.setItem(
    "alanya-session-token-v2",
    `${b64({ alg: "none" })}.${b64({ sub: userId, scope: "access" })}.signature`,
  )
}

export async function scenario() {
  poseSession(ALICE)
  console.log("\n\x1b[1m════ LES CODES DE SÉCURITÉ ════\x1b[0m")

  /* ── ① LA SYMÉTRIE ───────────────────────────────────────────────── */
  titre("① Les deux personnes voient le même code")

  const g = new FingerprintGenerator(1024)
  const cotéAlice = await g.createFor(ALICE, cle(1), BOB, cle(2))
  const cotéBob = await g.createFor(BOB, cle(2), ALICE, cle(1))

  verifie("le code est identique des deux côtés", cotéAlice === cotéBob, `${cotéAlice}\n      ${cotéBob}`)
  verifie("il fait 60 chiffres", cotéAlice.length === 60, `${cotéAlice.length} caractères`)
  verifie("et rien que des chiffres", /^[0-9]{60}$/.test(cotéAlice))

  /*
   * ⚠️ LE CONTRÔLE QUI DONNE SON SENS AU PRÉCÉDENT. Un générateur qui rendrait
   * une constante passerait tout ce qui précède. Il faut donc vérifier qu'une
   * clé DIFFÉRENTE produit un code DIFFÉRENT — c'est la détection elle-même.
   */
  const imposteur = await g.createFor(ALICE, cle(1), BOB, cle(99))
  verifie(
    "une clé différente donne un code différent",
    imposteur !== cotéAlice,
    "le code ne dépend pas de la clé — il ne détecterait AUCUNE interposition",
  )

  /* ── ② LA MISE EN FORME ──────────────────────────────────────────── */
  titre("② La mise en forme, pour qui lit à haute voix")

  const groupes = enGroupes(cotéAlice)
  verifie("12 groupes", groupes.length === 12, `${groupes.length} groupes`)
  verifie("de 5 chiffres", groupes.every((x) => x.length === 5))
  verifie("et rien n'est perdu au découpage", groupes.join("") === cotéAlice)
  console.log(`      ${groupes.slice(0, 6).join(" ")}`)
  console.log(`      ${groupes.slice(6).join(" ")}`)

  /* ── ③ LA VÉRIFICATION SUIT LA CLÉ ───────────────────────────────── */
  titre("③ Une vérification est liée à la CLÉ, pas à la personne")

  await ouvrirCoffre()
  // On se donne une identité, et un correspondant connu sur un appareil.
  ecrireSecret("identite", { pubKey: versB64(cle(1)), privKey: versB64(cle(7)) })
  ecrireSecret(`identite.${BOB}.4242`, versB64(cle(2)))
  await coffreEcrit()

  verifie("un correspondant non comparé n'est pas vérifié", estVerifie(BOB) === false)

  await marquerVerifie(BOB, 4242)
  await coffreEcrit()
  verifie("après comparaison, il l'est", estVerifie(BOB) === true)

  /*
   * 🔴 LE CONTRÔLE CENTRAL DE TOUT CE FICHIER.
   *
   * Bob réinstalle — ou quelqu'un prend sa place. Sa clé change. La
   * vérification doit tomber TOUTE SEULE, sans que personne n'ait pensé à la
   * retirer. Un booléen « vérifié » aurait continué d'affirmer le contraire de
   * la vérité au moment exact où ça compte.
   */
  ecrireSecret(`identite.${BOB}.4242`, versB64(cle(3)))
  await coffreEcrit()
  verifie(
    "la clé change → la vérification TOMBE d'elle-même",
    estVerifie(BOB) === false,
    "« vérifié » survit à un changement de clé — c'est exactement le défaut à empêcher",
  )

  /* ── ④ TOUS LES APPAREILS, PAS AU MOINS UN ───────────────────────── */
  titre("④ Un correspondant à deux appareils")

  ecrireSecret(`identite.${BOB}.4242`, versB64(cle(2)))
  ecrireSecret(`identite.${BOB}.777`, versB64(cle(5)))
  await coffreEcrit()
  await marquerVerifie(BOB, 4242)
  await coffreEcrit()

  verifie(
    "un seul appareil vérifié ne suffit PAS",
    estVerifie(BOB) === false,
    "annoncer « vérifié » alors qu'un appareil inconnu peut lire dit le contraire de la vérité",
  )

  await marquerVerifie(BOB, 777)
  await coffreEcrit()
  verifie("les deux vérifiés, alors oui", estVerifie(BOB) === true)

  await retirerVerification(BOB, 777)
  await coffreEcrit()
  verifie("et l'on peut revenir sur sa déclaration", estVerifie(BOB) === false)

  /* ── ⑤ LE SERVICE COMPLET ────────────────────────────────────────── */
  titre("⑤ empreintesPour() — ce que l'écran affichera")

  const liste = await empreintesPour(BOB)
  verifie("un code par appareil connu", liste.length === 2, `${liste.length} code(s)`)
  verifie("chacun sur son appareil", liste.map((e) => e.deviceId).join(",") === "777,4242")
  verifie("les deux codes diffèrent", liste[0]?.code !== liste[1]?.code)
  verifie(
    "l'état de vérification est rendu",
    liste.find((e) => e.deviceId === 4242)?.verifie === true &&
      liste.find((e) => e.deviceId === 777)?.verifie === false,
  )

  const inconnu = await empreintesPour("33333333-3333-3333-3333-333333333333")
  verifie(
    "un inconnu ne produit AUCUN code",
    inconnu.length === 0,
    "il n'y a rien à vérifier avec quelqu'un à qui l'on n'a jamais parlé",
  )

  console.log(
    `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
  )
  return echecs
}
