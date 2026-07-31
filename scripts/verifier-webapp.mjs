/**
 * Controle qu'un paquet construit est servable depuis un sous-repertoire.
 *
 * La production est montee sur https://alanyavox.com/webapp/. Un seul chemin
 * absolu oublie suffit a casser une fonction entiere, en silence : c'est arrive
 * aux trois sons de l'application, qui repondaient 404 pendant des semaines, et
 * au service worker, dont l'enregistrement echouait faute d'une portee valide.
 *
 * Vite reecrit ce qu'il voit — les `href` et `src` du HTML, les `url()` du CSS,
 * les actifs importes. Il ne peut rien pour un chemin assemble a l'execution :
 * c'est exactement ce que ce controle traque.
 *
 * Lance par `npm run verify:webapp`, et par le CI a chaque push.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, extname } from "node:path"

const BASE_ATTENDUE = "/webapp/"
const echecs = []

function lire(chemin) {
  try {
    return readFileSync(chemin, "utf8")
  } catch {
    return null
  }
}

function fichiers(racine, extensions) {
  const trouves = []
  const parcourir = (dossier) => {
    for (const entree of readdirSync(dossier)) {
      if (entree === "node_modules" || entree === "dist" || entree.startsWith(".")) continue
      const chemin = join(dossier, entree)
      if (statSync(chemin).isDirectory()) parcourir(chemin)
      else if (extensions.includes(extname(chemin))) trouves.push(chemin)
    }
  }
  parcourir(racine)
  return trouves
}

/* 1. Le paquet construit doit viser le sous-repertoire. */
const html = lire("dist/index.html")
if (!html) {
  echecs.push("dist/index.html absent : lancer `npm run build` avant ce controle.")
} else {
  const controles = [
    ["script principal", /src="([^"]+\.js)"/],
    ["manifeste", /href="([^"]*manifest\.json)"/],
  ]
  for (const [libelle, motif] of controles) {
    const trouve = html.match(motif)
    if (!trouve) {
      echecs.push(`${libelle} introuvable dans dist/index.html`)
    } else if (!trouve[1].startsWith(BASE_ATTENDUE)) {
      echecs.push(
        `${libelle} vise ${trouve[1]} au lieu de ${BASE_ATTENDUE} — le chemin de base n'a pas ete applique`
      )
    }
  }
}

/* 2. Aucun chemin absolu assemble a l'execution. */
const SUSPECTS = [
  { motif: /new Audio\(\s*["'`]\//g, quoi: "new Audio() sur un chemin absolu" },
  {
    motif: /serviceWorker\.register\(\s*["'`]\//g,
    quoi: "service worker enregistre sur un chemin absolu",
  },
  { motif: /scope:\s*["'`]\/["'`]/g, quoi: 'portee de service worker figee a "/"' },
  {
    motif: /getRegistration\(\s*["'`]\/["'`]\s*\)/g,
    quoi: 'getRegistration("/") au lieu du chemin de base',
  },
]

for (const chemin of [...fichiers("src", [".ts", ".tsx"]), ...fichiers("app", [".ts", ".tsx"])]) {
  const contenu = lire(chemin)
  if (!contenu) continue
  for (const { motif, quoi } of SUSPECTS) {
    for (const occurrence of contenu.matchAll(motif)) {
      const ligne = contenu.slice(0, occurrence.index).split("\n").length
      echecs.push(
        `${chemin}:${ligne} — ${quoi}. Utiliser publicAsset() ou import.meta.env.BASE_URL.`
      )
    }
  }
}

if (echecs.length > 0) {
  console.error(`\nHebergement sous ${BASE_ATTENDUE} : ${echecs.length} probleme(s)\n`)
  for (const echec of echecs) console.error(`  - ${echec}`)
  console.error("")
  process.exit(1)
}

console.log(`Hebergement sous ${BASE_ATTENDUE} : rien a signaler.`)
