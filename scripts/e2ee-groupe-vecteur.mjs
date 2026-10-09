/**
 * BANC — LE CHIFFREMENT DE GROUPE, WEB ↔ MOBILE (lot 1, cours ch. 32).
 *
 * Charge le VRAI module `src/services/e2ee-groupe.ts` et vérifie :
 *
 *   ① l'aller-retour (chiffrer → déchiffrer) ;
 *   ② les refus : signature falsifiée, message déplacé (autre messageId, autre
 *     groupe, autre expéditeur), mauvaise version, mauvaise clé ;
 *   ③ la charge trousseau : aller-retour, groupe usurpé, clé remplacée ;
 *   ④ SI le vecteur du mobile existe : le web lit le message du mobile, refuse
 *     sa version falsifiée, produit le MÊME chiffré avec le même nonce, et la
 *     même charge trousseau octet pour octet.
 *
 * Lancer :
 *   node scripts/e2ee-groupe-vecteur.mjs            (contrôles)
 *   node scripts/e2ee-groupe-vecteur.mjs --ecrire   (+ réécrit le vecteur du web)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import obtenirSignal from "@privacyresearch/libsignal-protocol-typescript"
import {
  chiffrerMessageGroupe,
  dechiffrerMessageGroupe,
  ecrireChargeTrousseau,
  lireChargeTrousseau,
  fusionnerTrousseau,
  signatureValide,
} from "../src/services/e2ee-groupe.ts"
import { ecrireCharge } from "../src/services/e2ee-media.ts"

const VECTEUR_WEB = "../alanya/test/donnees/vecteur_groupe_web.json"
const VECTEUR_MOBILE = "../alanya/test/donnees/vecteur_groupe_mobile.json"

let ok = 0
let ko = 0
function verifie(nom, condition) {
  if (condition) {
    ok++
    console.log(`  ✓ ${nom}`)
  } else {
    ko++
    console.log(`  ✗ ${nom}`)
  }
}
async function refuse(nom, promesse) {
  try {
    await promesse
    verifie(nom, false)
  } catch {
    verifie(nom, true)
  }
}

const b64 = (o) => Buffer.from(o).toString("base64")
const deB64 = (s) => new Uint8Array(Buffer.from(s, "base64"))

const fabrique = obtenirSignal.default ?? obtenirSignal
const { Curve } = await fabrique()
const paire = Curve.generateKeyPair()
const clePrivee = new Uint8Array(paire.privKey)
const clePublique = new Uint8Array(paire.pubKey)
const autre = Curve.generateKeyPair()

const cle = Uint8Array.from({ length: 32 }, (_, i) => i)
const nonce = Uint8Array.from({ length: 12 }, (_, i) => 100 + i)
const contexte = {
  convId: "aaaaaaaa-1111-4222-8333-444444444444",
  messageId: "bbbbbbbb-5555-4666-8777-888888888888",
  version: 3,
  expediteurId: "cccccccc-9999-4aaa-8bbb-cccccccccccc",
  deviceId: 7,
}
const clair = ecrireCharge(contexte.messageId, "Bonjour le groupe — éàü 👋")

console.log("① aller-retour")
const corps = await chiffrerMessageGroupe(clair, cle, contexte, clePrivee, nonce)
verifie("le message se relit", (await dechiffrerMessageGroupe(corps, cle, contexte, clePublique)) === clair)
const corpsAleatoire = await chiffrerMessageGroupe(clair, cle, contexte, clePrivee)
verifie("nonce tiré au hasard : se relit aussi", (await dechiffrerMessageGroupe(corpsAleatoire, cle, contexte, clePublique)) === clair)

console.log("② refus")
const brut = deB64(corps)
const falsifie = brut.slice()
falsifie[falsifie.length - 1] ^= 1
verifie("PIÈGE DU WEB : signatureValide refuse une signature falsifiée",
  !(await signatureValide(clePublique, brut.subarray(0, 10), falsifie.subarray(falsifie.length - 64))))
await refuse("signature falsifiée : refusée", dechiffrerMessageGroupe(b64(falsifie), cle, contexte, clePublique))
await refuse("signé par un autre appareil : refusé", dechiffrerMessageGroupe(corps, cle, contexte, new Uint8Array(autre.pubKey)))
await refuse("déplacé vers un autre message", dechiffrerMessageGroupe(corps, cle, { ...contexte, messageId: "dddddddd-0000-4000-8000-000000000000" }, clePublique))
await refuse("déplacé vers un autre groupe", dechiffrerMessageGroupe(corps, cle, { ...contexte, convId: "eeeeeeee-0000-4000-8000-000000000000" }, clePublique))
await refuse("attribué à un autre expéditeur", dechiffrerMessageGroupe(corps, cle, { ...contexte, expediteurId: "ffffffff-0000-4000-8000-000000000000" }, clePublique))
await refuse("servi sous une autre version", dechiffrerMessageGroupe(corps, cle, { ...contexte, version: 2 }, clePublique))
await refuse("mauvaise clé de groupe", dechiffrerMessageGroupe(corps, cle.map((x) => x ^ 0xff), contexte, clePublique))
const chiffreAltere = brut.slice()
chiffreAltere[20] ^= 1
await refuse("chiffré altéré (signature et GCM)", dechiffrerMessageGroupe(b64(chiffreAltere), cle, contexte, clePublique))

console.log("③ trousseau")
const trousseau = {
  convId: contexte.convId,
  motif: "AJOUT",
  versions: [
    { n: 2, cle: Uint8Array.from({ length: 32 }, (_, i) => 200 - i), creeLe: 1760000000000 },
    { n: 1, cle: Uint8Array.from({ length: 32 }, (_, i) => i * 3), creeLe: 1759000000000 },
  ],
}
const chargeTrousseau = ecrireChargeTrousseau(trousseau)
const relu = lireChargeTrousseau(chargeTrousseau, contexte.convId)
verifie("aller-retour, versions triées", relu.versions.map((v) => v.n).join() === "1,2")
verifie("clés intactes", b64(relu.versions[1].cle) === b64(trousseau.versions[0].cle))
try {
  lireChargeTrousseau(chargeTrousseau, "autre-groupe")
  verifie("rattaché à un autre groupe : refusé", false)
} catch {
  verifie("rattaché à un autre groupe : refusé", true)
}
try {
  fusionnerTrousseau(relu.versions, [{ n: 1, cle: new Uint8Array(32), creeLe: 1 }])
  verifie("remplacer une clé existante : refusé", false)
} catch {
  verifie("remplacer une clé existante : refusé", true)
}
verifie("ajouter une version : accepté",
  fusionnerTrousseau(relu.versions, [{ n: 3, cle: new Uint8Array(32), creeLe: 1 }]).length === 3)

if (process.argv.includes("--ecrire")) {
  writeFileSync(
    VECTEUR_WEB,
    JSON.stringify(
      {
        source: "web",
        cle: b64(cle),
        nonce: b64(nonce),
        contexte,
        clair,
        corps,
        clePublique: b64(clePublique),
        chargeTrousseau,
        trousseau: {
          convId: trousseau.convId,
          motif: trousseau.motif,
          versions: trousseau.versions.map((v) => ({ n: v.n, cle: b64(v.cle), creeLe: v.creeLe })),
        },
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`\n  → vecteur écrit : ${VECTEUR_WEB}`)
}

console.log("④ le vecteur du mobile")
if (!existsSync(VECTEUR_MOBILE)) {
  console.log("  (absent : lancer d'abord `dart run tool/vecteur_groupe_mobile.dart` dans alanya)")
} else {
  const m = JSON.parse(readFileSync(VECTEUR_MOBILE, "utf8"))
  const mCle = deB64(m.cle)
  const mPub = deB64(m.clePublique)
  verifie("le web lit le message du mobile", (await dechiffrerMessageGroupe(m.corps, mCle, m.contexte, mPub)) === m.clair)
  const mBrut = deB64(m.corps)
  const mFaux = mBrut.slice()
  mFaux[mFaux.length - 1] ^= 1
  await refuse("sa version falsifiée : refusée par le web", dechiffrerMessageGroupe(b64(mFaux), mCle, m.contexte, mPub))
  const refait = deB64(await chiffrerMessageGroupe(m.clair, mCle, m.contexte, clePrivee, deB64(m.nonce)))
  verifie("même nonce : le web produit le MÊME chiffré que le mobile",
    b64(refait.subarray(0, refait.length - 64)) === b64(mBrut.subarray(0, mBrut.length - 64)))
  const tm = {
    convId: m.trousseau.convId,
    motif: m.trousseau.motif,
    versions: m.trousseau.versions.map((v) => ({ n: v.n, cle: deB64(v.cle), creeLe: v.creeLe })),
  }
  verifie("charge trousseau : identique octet pour octet", ecrireChargeTrousseau(tm) === m.chargeTrousseau)
}

console.log(`\n${ok} ✓, ${ko} ✗`)
process.exit(ko === 0 ? 0 : 1)
