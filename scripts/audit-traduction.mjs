/**
 * Audit des chaînes non traduites.
 *
 * Cherche le texte français encore figé dans les écrans : ce qui est écrit en
 * dur ne suit pas le choix de langue, et se voit tout de suite — c'est
 * exactement ainsi que « Navigation » et « Compte » sont restés en français
 * dans une barre latérale dont tous les liens étaient traduits.
 *
 * L'outil signale, il ne corrige pas. Il sert à mesurer ce qui reste et à
 * vérifier qu'un écran est réellement fini, plutôt que de s'en remettre à
 * l'œil.
 *
 * Usage :
 *   node scripts/audit-traduction.mjs           # tableau par fichier
 *   node scripts/audit-traduction.mjs <chemin>  # détail d'un fichier
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const RACINE = process.cwd()
const DOSSIERS = ["app", "src"]

/** Fichiers hors interface : aucun texte affiché à l'utilisateur. */
const IGNORE = ["src/i18n/", "src/mocks/", "src/indexedDB/", "node_modules", ".test.", "scripts/"]

/**
 * Un texte est suspect s'il ressemble à une phrase française destinée à
 * l'écran. On exige un mot d'au moins trois lettres pour écarter le bruit —
 * classes CSS, clés, unités — et un accent ou un mot courant pour écarter
 * l'anglais technique.
 */
const MOTS_FR =
  /\b(le|la|les|un|une|des|du|de|au|aux|et|ou|est|sont|vous|votre|vos|ce|cette|ces|pour|dans|avec|sans|par|sur|plus|pas|aucun|aucune|nouveau|nouvelle|tous|toutes)\b/i
const ACCENTS = /[àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]/

/** Contextes où une chaîne n'est jamais affichée telle quelle. */
const CONTEXTE_TECHNIQUE =
  /(className|import |from ["']|require\(|href=|to=["']|\.css|\.png|\.svg|d=["']M|path |viewBox|localStorage|sessionStorage|console\.|process\.env|`\$\{)/

function estSuspecte(texte) {
  if (texte.length < 4 || texte.length > 200) return false
  if (!/[a-zà-ÿ]{3}/i.test(texte)) return false
  return ACCENTS.test(texte) || MOTS_FR.test(texte)
}

function parcourir(dossier, acc = []) {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom)
    const rel = relative(RACINE, chemin)
    if (IGNORE.some((motif) => rel.includes(motif))) continue
    const info = statSync(chemin)
    if (info.isDirectory()) parcourir(chemin, acc)
    else if (/\.tsx?$/.test(nom)) acc.push(chemin)
  }
  return acc
}

/** Numero de ligne d'une position dans le fichier entier. */
function ligneDe(source, position) {
  return source.slice(0, position).split("\n").length
}

function analyser(chemin) {
  const brut = readFileSync(chemin, "utf8")

  // Les commentaires parlent aux developpeurs. On les blanchit en gardant les
  // sauts de ligne, pour que les numeros restent justes.
  const source = brut
    .replace(/\/\*[\s\S]*?\*\//g, (bloc) => bloc.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (bloc) => bloc.replace(/[^\n]/g, " "))

  const trouvailles = []
  const vues = new Set()

  const retenir = (texte, position) => {
    const propre = texte.replace(/\s+/g, " ").trim()
    if (!estSuspecte(propre)) return
    const cle = `${propre}@${ligneDe(source, position)}`
    if (vues.has(cle)) return
    vues.add(cle)
    trouvailles.push({ ligne: ligneDe(source, position), texte: propre })
  }

  // 1. Chaines entre guillemets, hors contexte technique.
  for (const m of source.matchAll(/"([^"\\\n]{4,})"/g)) {
    const debutLigne = source.lastIndexOf("\n", m.index) + 1
    const finLigne = source.indexOf("\n", m.index)
    const ligne = source.slice(debutLigne, finLigne === -1 ? undefined : finLigne)
    if (CONTEXTE_TECHNIQUE.test(ligne)) continue
    retenir(m[1], m.index)
  }

  // 2. Texte nu entre balises JSX. Le drapeau `s` fait la difference : un
  //    paragraphe repli sur plusieurs lignes est UNE chaine affichee, et
  //    l'ancienne version, qui lisait ligne par ligne, ne le voyait pas.
  for (const m of source.matchAll(/>([^<>{}]{4,})</gs)) {
    retenir(m[1], m.index)
  }

  return trouvailles
}

const cible = process.argv[2]
const fichiers = cible ? [join(RACINE, cible)] : DOSSIERS.flatMap((d) => parcourir(join(RACINE, d)))

let total = 0
const parFichier = []

for (const fichier of fichiers) {
  const trouvailles = analyser(fichier)
  if (trouvailles.length === 0) continue
  total += trouvailles.length
  parFichier.push({ fichier: relative(RACINE, fichier), trouvailles })
}

parFichier.sort((a, b) => b.trouvailles.length - a.trouvailles.length)

if (cible) {
  for (const { fichier, trouvailles } of parFichier) {
    console.log(`\n${fichier}`)
    for (const t of trouvailles) console.log(`  ${t.ligne}: ${t.texte}`)
  }
} else {
  for (const { fichier, trouvailles } of parFichier) {
    console.log(`${String(trouvailles.length).padStart(4)}  ${fichier}`)
  }
}
console.log(`\n${total} chaine(s) suspecte(s) dans ${parFichier.length} fichier(s).`)
