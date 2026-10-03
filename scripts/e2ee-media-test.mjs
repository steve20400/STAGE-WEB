/**
 * TESTS DU FORMAT DES MÉDIAS CHIFFRÉS — ce qui doit passer, et surtout ce qui
 * doit ÉCHOUER. Un chiffrement qui accepte un fichier trafiqué « marche » à
 * l'écran ; seul un test d'attaque montre qu'il protège.
 *
 * Usage : node scripts/e2ee-media-test.mjs
 */
import {
  chiffrerFichier,
  dechiffrerFichier,
  ecrireCharge,
  lireCharge,
  ChargeInvalide,
  FichierInvalide,
  TAILLE_BLOC,
  octetsEnBase64,
} from "../src/services/e2ee-media.ts"

let echecs = 0
const verifie = (libelle, ok, detail) => {
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`)
  if (!ok) {
    echecs++
    if (detail !== undefined) console.log(`      ${detail}`)
  }
}
const echoue = async (f, Classe) => {
  try {
    await f()
    return false
  } catch (e) {
    return e instanceof Classe
  }
}
const egaux = (a, b) => a.length === b.length && a.every((o, i) => o === b[i])

console.log("\n\x1b[1m① aller-retour\x1b[0m")
const clair = Uint8Array.from({ length: TAILLE_BLOC * 2 + 500 }, () => (Math.random() * 256) | 0)
const f = await chiffrerFichier(clair)
const d = { cle: f.cle, empreinte: f.empreinte, taille: clair.length }
verifie("le fichier se relit à l'identique", egaux(await dechiffrerFichier(f.chiffre, d), clair))
verifie("le chiffré n'a rien du clair", !egaux(f.chiffre.subarray(0, 64), clair.subarray(0, 64)))
const f2 = await chiffrerFichier(clair)
verifie("deux envois du même fichier ont deux clés", f2.cle !== f.cle)

console.log("\n\x1b[1m② attaques sur le fichier\x1b[0m")
// On recalcule l'empreinte pour chaque fichier trafiqué : on teste ainsi le
// CHIFFREMENT lui-même, comme si l'attaquant avait aussi falsifié l'empreinte.
const sha = async (o) => octetsEnBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", o)))
const B = TAILLE_BLOC + 16

const inverse = new Uint8Array(f.chiffre)
inverse.set(f.chiffre.subarray(B, 2 * B), 0)
inverse.set(f.chiffre.subarray(0, B), B)
verifie("deux blocs inversés : refusé", await echoue(() => dechiffrerFichier(inverse, { ...d, empreinte: "" }), FichierInvalide))
verifie(
  "… même avec une empreinte recalculée",
  await echoue(async () => dechiffrerFichier(inverse, { ...d, empreinte: await sha(inverse) }), FichierInvalide),
)

const coupe = f.chiffre.subarray(0, 2 * B)
verifie(
  "dernier bloc retiré (coupure nette) : refusé",
  await echoue(async () => dechiffrerFichier(coupe, { ...d, empreinte: await sha(coupe), taille: 2 * TAILLE_BLOC }), FichierInvalide),
)

const touche = new Uint8Array(f.chiffre)
touche[100] ^= 1
verifie(
  "un bit changé : refusé",
  await echoue(async () => dechiffrerFichier(touche, { ...d, empreinte: await sha(touche) }), FichierInvalide),
)
verifie("empreinte différente : refusé avant tout essai", await echoue(() => dechiffrerFichier(f.chiffre, { ...d, empreinte: f2.empreinte }), FichierInvalide))
verifie("mauvaise clé : refusé", await echoue(() => dechiffrerFichier(f.chiffre, { ...d, cle: f2.cle }), FichierInvalide))
verifie("taille annoncée fausse : refusé", await echoue(() => dechiffrerFichier(f.chiffre, { ...d, taille: 3 }), FichierInvalide))

console.log("\n\x1b[1m③ la charge de l'enveloppe\x1b[0m")
const ID = "11111111-2222-3333-4444-555555555555"
verifie("un texte v1 passe tel quel", lireCharge("bonjour", ID).texte === "bonjour")
verifie(
  "un texte qui IMITE une charge reste un texte",
  lireCharge('{"v":2,"id":"x","texte":"piège"}', ID).texte === '{"v":2,"id":"x","texte":"piège"}',
)
const media = { id: "m1", cle: f.cle, empreinte: f.empreinte, taille: clair.length, mime: "image/jpeg", largeur: 10, hauteur: 20 }
const c = lireCharge(ecrireCharge(ID, "légende", media), ID)
verifie("une charge v2 se relit : texte, média, identifiant", c.texte === "légende" && c.media?.id === "m1" && c.idAnnonce === ID)
verifie(
  "rattachée par le serveur à un AUTRE message : refusée",
  await echoue(() => lireCharge(ecrireCharge(ID, "x"), "99999999-0000-0000-0000-000000000000"), ChargeInvalide),
)
verifie("sans message connu : refusée", await echoue(() => lireCharge(ecrireCharge(ID, "x"), null), ChargeInvalide))
verifie(
  "descripteur avec une clé tronquée : refusé",
  await echoue(() => lireCharge(ecrireCharge(ID, "x", { ...media, cle: "AAAA" }), ID), ChargeInvalide),
)

console.log(echecs === 0 ? "\n\x1b[32mTout est vert.\x1b[0m" : `\n\x1b[31m${echecs} échec(s).\x1b[0m`)
process.exit(echecs ? 1 : 0)
