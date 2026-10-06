/**
 * BANC — LA RÉPONSE ET LE CONTACT DANS UN FIL CHIFFRÉ (06/10/2026).
 *
 * La charge v2 porte désormais deux champs facultatifs : `reponseA` (le message
 * auquel on répond) et `genre` (CONTACT ou LOCATION : `texte` porte alors la
 * fiche JSON). Ce banc charge les VRAIS modules et vérifie :
 *
 *   ① une charge sans extras reste octet pour octet celle d'avant ;
 *   ② l'aller-retour garde la citation et le genre ;
 *   ③ un genre inconnu est ignoré, une citation vide aussi ;
 *   ④ le rangement en cache donne le bon type et la citation ;
 *   ⑤ la charge produite ici, que le test mobile relit (parité).
 *
 * Lancer : node scripts/e2ee-charge-reponse-genre.mjs
 */
import { ecrireCharge, lireCharge } from "../src/services/e2ee-media.ts"
import { entreeCacheDechiffree } from "../src/services/e2ee-entree-cache.ts"

let ok = 0
let ko = 0
function verifie(nom, condition, detail = "") {
  if (condition) {
    ok++
    console.log(`  ✓ ${nom}`)
  } else {
    ko++
    console.log(`  ✗ ${nom} ${detail}`)
  }
}

const ID = "11111111-2222-4333-8444-555555555555"
const CITE = "99999999-8888-4777-8666-555555555555"
const FICHE = JSON.stringify({ v: 1, contacts: [{ name: "Jean", phones: ["82312187"] }] })

console.log("① sans extras : la charge d'avant")
const avant = "\u0000A2" + JSON.stringify({ v: 2, id: ID, texte: "Salut" })
verifie("identique à l'ancien format", ecrireCharge(ID, "Salut") === avant)
verifie("extras vides : identique aussi", ecrireCharge(ID, "Salut", undefined, {}) === avant)

console.log("② aller-retour")
const c1 = lireCharge(ecrireCharge(ID, "Oui", undefined, { reponseA: CITE }), ID)
verifie("citation relue", c1.reponseA === CITE)
verifie("pas de genre pour un texte", c1.genre === undefined)
const c2 = lireCharge(ecrireCharge(ID, FICHE, undefined, { genre: "CONTACT", reponseA: CITE }), ID)
verifie("genre CONTACT relu", c2.genre === "CONTACT")
verifie("fiche intacte", c2.texte === FICHE)
verifie("citation avec le contact", c2.reponseA === CITE)

console.log("③ valeurs écartées")
const bizarre = "\u0000A2" + JSON.stringify({ v: 2, id: ID, texte: "x", genre: "SONDAGE", reponseA: "" })
const c3 = lireCharge(bizarre, ID)
verifie("genre inconnu ignoré", c3.genre === undefined)
verifie("citation vide ignorée", c3.reponseA === undefined)
let refusee = false
try {
  lireCharge(ecrireCharge(ID, "x", undefined, { reponseA: CITE }), CITE)
} catch {
  refusee = true
}
verifie("rattachée à un autre message : toujours refusée", refusee)

console.log("④ rangement en cache")
const e1 = entreeCacheDechiffree({ id: ID, convId: "c", expediteurId: "u", texte: FICHE, quand: 1, genre: "CONTACT", reponseA: CITE })
verifie("type CONTACT", e1.type === "CONTACT")
verifie("replyToId rangé", e1.replyToId === CITE)
const e2 = entreeCacheDechiffree({ id: ID, convId: "c", expediteurId: "u", texte: "Salut", quand: 1 })
verifie("texte simple : TEXT, sans replyToId", e2.type === "TEXT" && !("replyToId" in e2))

console.log("⑤ parité : charge relue par test/e2ee_charge_extras_test.dart")
console.log("  " + JSON.stringify(ecrireCharge(ID, FICHE, undefined, { genre: "CONTACT", reponseA: CITE })))

console.log(`\n${ok} ✓, ${ko} ✗`)
process.exit(ko === 0 ? 0 : 1)
