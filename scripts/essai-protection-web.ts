/**
 * Essai : le PDF sensible protégé côté web (26/10/2026), sans navigateur.
 *
 *   npx tsx scripts/essai-protection-web.ts
 */
import { PDFDocument } from "pdf-lib"
import { ecrireCharge, lireCharge, ChargeInvalide, type DescripteurMedia } from "../src/services/e2ee-media"
import { signerCopie, type SignatureSortie } from "../src/services/signature-document"

let ok = 0
let ko = 0
const verifier = (nom: string, c: boolean, d = "") => (c ? (ok++, console.log(`✓ ${nom}`)) : (ko++, console.log(`✗ ${nom} ${d}`)))

const cle = Buffer.alloc(32, 1).toString("base64")
const base: DescripteurMedia = { id: "m1", cle, empreinte: cle, taille: 10, mime: "application/pdf", nom: "contrat.pdf", sensible: true }

// 1. Le descripteur garde la protection, dans le même JSON que le mobile.
const protection = { imprimer: false, ouverture: "ouvre-moi", proprietaire: "proprio-42" }
const relu = lireCharge(ecrireCharge("msg-1", "", { ...base, protection }), "msg-1")
const p = relu.media?.protection
verifier(
  "la protection survit à la charge chiffrée",
  p?.imprimer === false && p.ouverture === "ouvre-moi" && p.proprietaire === "proprio-42",
  JSON.stringify(relu.media),
)
const sans = lireCharge(ecrireCharge("msg-2", "", base), "msg-2")
verifier("sans protection : rien d'ajouté", sans.media?.protection === undefined)
for (const [nom, p] of [
  ["imprimer non booléen", { imprimer: "non", proprietaire: "x" }],
  ["propriétaire vide", { imprimer: true, proprietaire: "" }],
  ["ouverture vide", { imprimer: true, proprietaire: "x", ouverture: "" }],
] as const) {
  let refuse = false
  try {
    lireCharge(ecrireCharge("msg-3", "", { ...base, protection: p as never }), "msg-3")
  } catch (e) {
    refuse = e instanceof ChargeInvalide
  }
  verifier(`protection mal formée refusée (${nom})`, refuse)
}

// 2. La copie téléchargée sort protégée — ou ne sort pas.
const doc = await PDFDocument.create()
doc.addPage([595, 842])
const pdf = new Blob([await doc.save()], { type: "application/pdf" })
const s: SignatureSortie = {
  geste: "TELECHARGEMENT",
  alanyaId: "83 79 23 76",
  appareil: "Chrome sur Windows",
  quand: new Date(),
  code: "0123456789abcdef0123456789abcdef",
}
const copie = await signerCopie(pdf, "contrat.pdf", "application/pdf", s, undefined, protection)
const octets = new Uint8Array(await copie.fichier.arrayBuffer())
const texte = Buffer.from(octets).toString("latin1")
verifier("copie signée et chiffrée", copie.signee && texte.includes("/Encrypt"))
verifier("l'empreinte reste détectable", texte.includes("Empreinte#20numerique"))
let refusee = false
try {
  await signerCopie(new Blob([new Uint8Array([1, 2, 3])]), "abime.pdf", "application/pdf", s, undefined, protection)
} catch {
  refusee = true
}
verifier("un PDF illisible protégé : rien ne sort", refusee)

console.log(`\n${ok} ✓, ${ko} ✗`)
process.exit(ko ? 1 : 0)
