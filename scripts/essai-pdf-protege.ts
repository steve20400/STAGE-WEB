/**
 * Essai : la copie PROTÉGÉE d'un PDF sensible, côté web (26/10/2026).
 * Produit deux PDF dans le dossier donné, à vérifier avec un autre lecteur.
 *
 *   npx tsx scripts/essai-pdf-protege.ts <dossier>
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { signerPdf } from "../src/services/signature-pdf"

const dossier = process.argv[2] ?? "."
const doc = await PDFDocument.create()
const police = await doc.embedFont(StandardFonts.Helvetica)
for (const t of ["Contrat confidentiel", "Page deux"]) doc.addPage([595, 842]).drawText(t, { x: 40, y: 760, size: 18, font: police })
const source = (await doc.save()).buffer as ArrayBuffer
const meta = { Application: "Alanya Work", "Alanya ID": "83 79 23 76", "Empreinte numerique": "0123456789abcdef0123456789abcdef" }
const empreinte = "0123 4567 89AB CDEF 0123 4567 89AB CDEF"

const avec = await signerPdf(source.slice(0), "Alanya Work · " + empreinte, meta, { imprimer: false, ouverture: "ouvre-moi", proprietaire: "proprio-42" }, empreinte)
writeFileSync(join(dossier, "web-protege-mdp.pdf"), avec)
const sans = await signerPdf(source.slice(0), "Alanya Work · " + empreinte, meta, { imprimer: false, proprietaire: "hasard-XYZ" }, empreinte)
writeFileSync(join(dossier, "web-protege-sans-mdp.pdf"), sans)
console.log("ok", avec.length, sans.length)
