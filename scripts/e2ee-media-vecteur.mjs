/**
 * VECTEUR DE TEST DU FORMAT AGB1 — le même fichier chiffré des deux côtés.
 *
 * Chiffre des contenus connus avec une clé FIXE, à l'aide du module web
 * (`src/services/e2ee-media.ts`), et écrit le résultat dans le dépôt mobile.
 * Le test Dart (`test/e2ee_media_test.dart`) doit retrouver EXACTEMENT les
 * mêmes octets, et savoir les déchiffrer.
 *
 * Les tailles sont choisies aux frontières : vide, moins d'un bloc, pile deux
 * blocs, et deux blocs et demi.
 *
 * Usage : node scripts/e2ee-media-vecteur.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { chiffrerFichier, dechiffrerFichier, ecrireCharge, octetsEnBase64 } from "../src/services/e2ee-media.ts"

const cle = Uint8Array.from({ length: 32 }, (_, i) => i)
const motif = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255)

const cas = []
for (const taille of [0, 1000, 131072, 150000]) {
  const clair = motif(taille)
  const f = await chiffrerFichier(clair, cle)
  // Contrôle sur place : ce qu'on écrit doit se relire.
  const relu = await dechiffrerFichier(f.chiffre, { cle: f.cle, empreinte: f.empreinte, taille })
  if (relu.length !== taille || relu.some((o, i) => o !== clair[i])) throw new Error(`aller-retour ${taille}`)
  cas.push({ taille, cle: f.cle, empreinte: f.empreinte, chiffre: octetsEnBase64(f.chiffre) })
}

const charge = ecrireCharge("11111111-2222-3333-4444-555555555555", "légende 😀", {
  id: "66666666-7777-8888-9999-000000000000",
  cle: cas[1].cle,
  empreinte: cas[1].empreinte,
  taille: 1000,
  mime: "image/jpeg",
  largeur: 640,
  hauteur: 480,
})

const sortie = "../alanya/test/donnees"
mkdirSync(sortie, { recursive: true })
writeFileSync(`${sortie}/vecteur_media.json`, JSON.stringify({ cas, charge }, null, 1))
console.log(`vecteur écrit : ${cas.length} cas, charge de ${charge.length} caractères`)
