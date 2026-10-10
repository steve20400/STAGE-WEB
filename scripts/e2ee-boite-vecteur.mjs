/**
 * BANC — LA BOÎTE PERMANENTE, WEB ↔ MOBILE (cours, chapitre 39).
 *
 * Charge le VRAI module `src/services/e2ee-groupe.ts` et vérifie :
 *
 *   ① l'aller-retour (sceller → ouvrir) ;
 *   ② les refus : autre appareil destinataire, autre signataire, boîte déplacée
 *     (autre groupe, autre destinataire), chiffré altéré, signature falsifiée ;
 *   ③ SI le vecteur du mobile existe : le web ouvre la boîte du mobile, et
 *     produit le MÊME scellé (même éphémère, même nonce) — la signature, elle,
 *     est aléatoire : on vérifie sa validité, pas son égalité.
 *
 * Lancer :
 *   node --experimental-strip-types scripts/e2ee-boite-vecteur.mjs            (contrôles)
 *   node --experimental-strip-types scripts/e2ee-boite-vecteur.mjs --ecrire   (+ vecteur du web)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import obtenirSignal from "@privacyresearch/libsignal-protocol-typescript"
import { scellerBoite, ouvrirBoite, signatureValide, donneesBoite } from "../src/services/e2ee-groupe.ts"

const VECTEUR_WEB = "../alanya/test/donnees/vecteur_boite_web.json"
const VECTEUR_MOBILE = "../alanya/test/donnees/vecteur_boite_mobile.json"

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
const paire = () => {
  const k = Curve.generateKeyPair()
  return { pub: new Uint8Array(k.pubKey), priv: new Uint8Array(k.privKey) }
}

const destinataire = paire()
const expediteur = paire()
const contexte = {
  convId: "11111111-aaaa-4bbb-8ccc-dddddddddddd",
  destinataireId: "44444444-1111-4222-8333-444444444444",
  destinataireDevice: 7,
  expediteurId: "33333333-2222-4333-8444-555555555555",
  expediteurDevice: 4,
}
const clair = '\u0000G1{"v":1,"type":"trousseau","convId":"11111111-aaaa-4bbb-8ccc-dddddddddddd","motif":"AJOUT","versions":[]}'

console.log("\n① Aller-retour")
const corps = await scellerBoite(clair, destinataire.pub, contexte, expediteur.priv)
verifie("la boîte s'ouvre", (await ouvrirBoite(corps, destinataire.priv, contexte, expediteur.pub)) === clair)
const corps2 = await scellerBoite(clair, destinataire.pub, contexte, expediteur.priv)
verifie("deux scellés du même clair diffèrent (éphémère et nonce tirés)", corps2 !== corps)

console.log("\n② Les refus")
const autre = paire()
await refuse("un autre appareil ne l'ouvre pas", ouvrirBoite(corps, autre.priv, contexte, expediteur.pub))
await refuse("signée par un autre : refusée", ouvrirBoite(corps, destinataire.priv, contexte, autre.pub))
await refuse("déplacée vers un autre groupe", ouvrirBoite(corps, destinataire.priv, { ...contexte, convId: "eeeeeeee-0000-4000-8000-000000000000" }, expediteur.pub))
await refuse("attribuée à un autre destinataire", ouvrirBoite(corps, destinataire.priv, { ...contexte, destinataireDevice: 8 }, expediteur.pub))
await refuse("attribuée à un autre expéditeur", ouvrirBoite(corps, destinataire.priv, { ...contexte, expediteurId: "ffffffff-0000-4000-8000-000000000000" }, expediteur.pub))
const altere = deB64(corps)
altere[60] ^= 0xff
await refuse("chiffré altéré : refusé", ouvrirBoite(b64(altere), destinataire.priv, contexte, expediteur.pub))
const falsifie = deB64(corps)
falsifie[falsifie.length - 1] ^= 0x01
await refuse("signature falsifiée : refusée", ouvrirBoite(b64(falsifie), destinataire.priv, contexte, expediteur.pub))

if (process.argv.includes("--ecrire")) {
  const ephemere = paire()
  const nonce = new Uint8Array(12).map((_, i) => 90 + i)
  const fixe = await scellerBoite(clair, destinataire.pub, contexte, expediteur.priv, { ephemere, nonce })
  writeFileSync(
    VECTEUR_WEB,
    JSON.stringify(
      {
        source: "web",
        contexte,
        clair,
        corps: fixe,
        destinataire: { pub: b64(destinataire.pub), priv: b64(destinataire.priv) },
        expediteur: { pub: b64(expediteur.pub), priv: b64(expediteur.priv) },
        ephemere: { pub: b64(ephemere.pub), priv: b64(ephemere.priv) },
        nonce: b64(nonce),
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`\n→ ${VECTEUR_WEB}`)
}

console.log("\n③ Le vecteur du mobile")
if (!existsSync(VECTEUR_MOBILE)) {
  console.log("  (absent : lancer d'abord `dart run tool/vecteur_boite_mobile.dart` dans alanya)")
} else {
  const m = JSON.parse(readFileSync(VECTEUR_MOBILE, "utf8"))
  const dest = { pub: deB64(m.destinataire.pub), priv: deB64(m.destinataire.priv) }
  const exp = { pub: deB64(m.expediteur.pub), priv: deB64(m.expediteur.priv) }
  verifie("le web ouvre la boîte du mobile", (await ouvrirBoite(m.corps, dest.priv, m.contexte, exp.pub)) === m.clair)
  const refait = await scellerBoite(m.clair, dest.pub, m.contexte, exp.priv, {
    ephemere: { pub: deB64(m.ephemere.pub), priv: deB64(m.ephemere.priv) },
    nonce: deB64(m.nonce),
  })
  const sansSignature = (s) => b64(deB64(s).slice(0, -64))
  verifie("même éphémère, même nonce : même scellé que le mobile", sansSignature(refait) === sansSignature(m.corps))
  const brut = deB64(refait)
  const message = new Uint8Array([
    ...donneesBoite(m.contexte),
    ...brut.slice(1, 34),
    ...brut.slice(34, 46),
    ...brut.slice(46, brut.length - 64),
  ])
  verifie("… et la signature du web est valide", await signatureValide(exp.pub, message, brut.slice(brut.length - 64)))
}

console.log(`\n${ko === 0 ? "Tous les contrôles passent" : `${ko} ÉCHEC(S)`} (${ok} ✓)`)
process.exit(ko === 0 ? 0 : 1)
