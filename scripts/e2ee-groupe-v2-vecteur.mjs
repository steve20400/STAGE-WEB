/**
 * BANC — CHIFFREMENT DES GROUPES V2, WEB ↔ MOBILE (lot 4, 11/11/2026).
 *
 * Charge le VRAI module `src/services/e2ee-groupe.ts` et rejoue les trois
 * vecteurs figés du mobile (`alanya/test/e2ee_groupe_v2_test.dart`) : mêmes
 * entrées, mêmes octets. Puis les allers-retours et les refus.
 *
 * Lancer :
 *   node --experimental-strip-types scripts/e2ee-groupe-v2-vecteur.mjs
 */
import obtenirSignal from "@privacyresearch/libsignal-protocol-typescript"
import {
  chiffrerMessageGroupe,
  chiffrerMessageGroupeV2,
  dechiffrerMessageGroupeSansSignature,
  dechiffrerMessageGroupeV2,
  deballerCle,
  emballerCle,
  formatDuCorps,
  FORMAT_GROUPE_V2,
} from "../src/services/e2ee-groupe.ts"

// Les vecteurs du mobile (test/e2ee_groupe_v2_test.dart).
const VECTEUR_MESSAGE_V2 = "AmRlZmdoaWprbG1ubyIwHSb+985ZlDKP/2pDjUyRc+YZz/lY1BCHK5Asa01r9g=="
const VECTEUR_COMPTE_PUB = "BeBbGuMiAkg4CV/979hlRo3bd7FLLdJ1F16gq0KU+m16"
const VECTEUR_EMBALLAGE =
  "AQUIJkrmkLQR2OPt5A+HGSWF6hFKCCdEp3YQWqwF6rEFLmRlZmdoaWprbG1ubxDT344+T9b0Bx8lD2B9BxgRb1EmaM9aJ9p9Jd1mjwWmO9bZdt1oih8EAOOO8XsW2Q=="

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
const octets = (depart, n) => new Uint8Array(Array.from({ length: n }, (_, i) => (depart + i) & 0xff))
const egaux = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

const fabrique = obtenirSignal.default ?? obtenirSignal
const { Curve } = await fabrique()
const paireDe = (priv) => {
  const k = Curve.createKeyPair(priv.slice().buffer)
  return { pub: new Uint8Array(k.pubKey), priv: new Uint8Array(k.privKey) }
}

const conv = "11111111-1111-4111-8111-111111111111"
const msg = "22222222-2222-4222-8222-222222222222"
const ana = "33333333-3333-4333-8333-333333333333"
const cleGroupe = octets(1, 32)
const nonce = octets(100, 12)
const contexte = { convId: conv, messageId: msg, version: 3, expediteurId: ana, deviceId: 7 }

console.log("Message, format 2")
const corps = await chiffrerMessageGroupeV2("Bonjour le groupe", cleGroupe, contexte, nonce)
verifie("même octets que le mobile", corps === VECTEUR_MESSAGE_V2)
verifie("format 2 reconnu", formatDuCorps(corps) === FORMAT_GROUPE_V2)
verifie("le web lit le vecteur du mobile", (await dechiffrerMessageGroupeV2(VECTEUR_MESSAGE_V2, cleGroupe, contexte)) === "Bonjour le groupe")
verifie(
  "l'appareil hors des données associées",
  (await dechiffrerMessageGroupeV2(corps, cleGroupe, { ...contexte, deviceId: 99 })) === "Bonjour le groupe",
)
await refuse("autre expéditeur refusé", dechiffrerMessageGroupeV2(corps, cleGroupe, { ...contexte, expediteurId: "bob" }))
await refuse("autre version refusée", dechiffrerMessageGroupeV2(corps, cleGroupe, { ...contexte, version: 4 }))

console.log("Format 1 sans signature")
const identite = Curve.generateKeyPair()
const ancien = await chiffrerMessageGroupe("ancien message", cleGroupe, contexte, new Uint8Array(identite.privKey))
verifie("lu sans la signature", (await dechiffrerMessageGroupeSansSignature(ancien, cleGroupe, contexte)) === "ancien message")
await refuse("autre appareil refusé", dechiffrerMessageGroupeSansSignature(ancien, cleGroupe, { ...contexte, deviceId: 8 }))

console.log("Emballage")
const compte = paireDe(octets(50, 32))
verifie("même clé publique de compte que le mobile", b64(compte.pub) === VECTEUR_COMPTE_PUB)
const ctx = { convId: conv, destinataireId: ana, version: 3, versionCompte: 1 }
const eph = paireDe(octets(150, 32))
const emb = await emballerCle(cleGroupe, compte.pub, ctx, { ephemere: eph, nonce })
verifie("même emballage que le mobile", emb === VECTEUR_EMBALLAGE)
verifie("le web ouvre l'emballage du mobile", egaux(await deballerCle(VECTEUR_EMBALLAGE, compte.priv, ctx), cleGroupe))
const aleatoire = await emballerCle(cleGroupe, compte.pub, ctx)
verifie("aller-retour", egaux(await deballerCle(aleatoire, compte.priv, ctx), cleGroupe))
await refuse("autre compte refusé", deballerCle(aleatoire, new Uint8Array(Curve.generateKeyPair().privKey), ctx))
await refuse("autre groupe refusé", deballerCle(aleatoire, compte.priv, { ...ctx, convId: "autre" }))
await refuse("autre destinataire refusé", deballerCle(aleatoire, compte.priv, { ...ctx, destinataireId: "bob" }))
await refuse("autre version refusée", deballerCle(aleatoire, compte.priv, { ...ctx, version: 2 }))
await refuse("autre version de compte refusée", deballerCle(aleatoire, compte.priv, { ...ctx, versionCompte: 2 }))

console.log(ko === 0 ? `\n${ok} vérifications, toutes vertes.` : `\n${ko} échec(s) sur ${ok + ko}.`)
process.exit(ko === 0 ? 0 : 1)
