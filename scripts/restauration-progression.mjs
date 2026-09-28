/**
 * LA BARRE DE LA PAGE DE RESTAURATION — `src/lib/restauration-progression.ts`.
 *
 * Usage : node scripts/restauration-progression.mjs   (Node 24 lit le TypeScript)
 */
import { compteur, fractionGlobale } from "../src/lib/restauration-progression.ts"

let echecs = 0
function verifie(libelle, ok, detail) {
  if (!ok) echecs++
  console.log(`  ${ok ? "✓" : "✗"} ${libelle}${ok ? "" : ` (${detail})`}`)
}

verifie("l'ouverture : barre animée", fractionGlobale({ etape: "ouverture", fait: 0 }) === null)
verifie(
  "sans total (serveur ancien) : barre animée, pas de compteur",
  fractionGlobale({ etape: "telechargement", fait: 2000 }) === null &&
    compteur({ etape: "telechargement", fait: 2000 }) === null,
)
const finT = fractionGlobale({ etape: "telechargement", fait: 100, total: 100 })
const debutD = fractionGlobale({ etape: "dechiffrement", fait: 0, total: 100 })
const finD = fractionGlobale({ etape: "dechiffrement", fait: 100, total: 100 })
const debutR = fractionGlobale({ etape: "rangement", fait: 0, total: 50 })
verifie("la barre ne recule jamais d'une étape à l'autre", debutD >= finT && debutR >= finD, `${finT} ${debutD} ${finD} ${debutR}`)
verifie("le rangement terminé remplit la barre", fractionGlobale({ etape: "rangement", fait: 50, total: 50 }) === 1)
verifie("une archive vide ne divise pas par zéro", fractionGlobale({ etape: "rangement", fait: 0, total: 0 }) === 1)
const c = compteur({ etape: "dechiffrement", fait: 1250, total: 2100 })
verifie("le compteur sépare les milliers", c === "1 250 / 2 100 blocs", c)

console.log(echecs === 0 ? "Tout passe." : `${echecs} échec(s).`)
process.exit(echecs === 0 ? 0 : 1)
