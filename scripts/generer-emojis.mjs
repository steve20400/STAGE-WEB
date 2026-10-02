/**
 * GÉNÈRE LE CATALOGUE D'EMOJIS, IDENTIQUE SUR LE WEB ET LE MOBILE.
 *
 * Une seule source — les données Unicode d'emojibase — écrite deux fois :
 *   - `src/data/emojis-catalogue.ts`            (web)
 *   - `../alanya/lib/core/emojis_catalogue.dart` (mobile)
 *
 * 🔴 ON NE TAPE PAS LA LISTE À LA MAIN. Deux listes recopiées divergent au
 * premier ajout : le mobile en avait 24, le web aucune (constaté le
 * 02/10/2026). Un générateur commun garantit les mêmes emojis, dans le même
 * ordre, rangés dans les mêmes catégories.
 *
 * ⚠️ UNICODE 13.1 AU PLUS. Un emoji plus récent s'affiche en carré vide sur
 * les téléphones qui n'ont pas la police à jour — le destinataire recevrait
 * un message illisible. 13.1 est ce qu'Android 11 sait dessiner.
 *
 * ⚠️ SANS LES VARIANTES DE TEINTE. Elles multiplient par six la partie
 * « personnes » sans rien apprendre de plus à qui cherche un emoji.
 *
 * Les MOTS-CLÉS (français + anglais, sans accents, en minuscules) servent à
 * la recherche : « coeur », « heart », « rire », « laugh »…
 *
 * Usage :
 *   npm pack emojibase-data@17 && tar xzf emojibase-data-17.0.0.tgz
 *   node scripts/generer-emojis.mjs <dossier « package » extrait>
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const source = process.argv[2]
if (!source) {
  console.error("Usage : node scripts/generer-emojis.mjs <dossier emojibase-data>")
  process.exit(1)
}

const VERSION_MAX = 13.1

const lire = (langue) => JSON.parse(readFileSync(join(source, langue, "data.json"), "utf8"))
const fr = lire("fr")
const en = new Map(lire("en").map((e) => [e.hexcode, e]))

/** Les 8 catégories, dans l'ordre de WhatsApp. Groupes emojibase entre crochets. */
const CATEGORIES = [
  { id: "smileys", groupes: [0, 1] },
  { id: "nature", groupes: [3] },
  { id: "nourriture", groupes: [4] },
  { id: "activites", groupes: [6] },
  { id: "voyages", groupes: [5] },
  { id: "objets", groupes: [7] },
  { id: "symboles", groupes: [8] },
  { id: "drapeaux", groupes: [9] },
]

// ⚠️ « œ » et « æ » ne se décomposent pas en NFD : sans ce remplacement,
// « cœur » devenait « c ur » et la recherche « coeur » ne trouvait rien.
const nu = (t) =>
  t
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

function motsCles(e) {
  const anglais = en.get(e.hexcode)
  const mots = new Set(
    nu([e.label, ...(e.tags ?? []), anglais?.label ?? "", ...(anglais?.tags ?? [])].join(" "))
      .split(" ")
      .filter((m) => m.length > 1),
  )
  return [...mots].join(" ")
}

const catalogue = CATEGORIES.map((c) => ({
  id: c.id,
  emojis: fr
    .filter((e) => c.groupes.includes(e.group) && e.version <= VERSION_MAX)
    .sort((a, b) => a.order - b.order)
    .map((e) => [e.emoji, motsCles(e)]),
}))

const total = catalogue.reduce((n, c) => n + c.emojis.length, 0)
const entete = (commentaire) =>
  [
    `${commentaire} FICHIER GÉNÉRÉ — ne pas modifier à la main.`,
    `${commentaire} Source : emojibase-data, Unicode ≤ ${VERSION_MAX}, ${total} emojis.`,
    `${commentaire} Régénérer : STAGE-WEB/scripts/generer-emojis.mjs (même fichier côté web et mobile).`,
  ].join("\n")

// ── Web ────────────────────────────────────────────────────────────────────
const web = `${entete("//")}

export type CategorieEmoji =
${CATEGORIES.map((c) => `  | "${c.id}"`).join("\n")}

/** [emoji, mots-clés français + anglais sans accents] */
export type EntreeEmoji = readonly [string, string]

export const CATALOGUE_EMOJIS: ReadonlyArray<{ id: CategorieEmoji; emojis: ReadonlyArray<EntreeEmoji> }> = ${JSON.stringify(
  catalogue,
  null,
  0,
)
  .replace(/\],\[/g, "],\n    [")
  .replace(/\},\{/g, "},\n  {")}
`
writeFileSync(resolve("src/data/emojis-catalogue.ts"), web)

// ── Mobile ─────────────────────────────────────────────────────────────────
const dart = (s) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$")}'`
const mobile = `${entete("//")}

/// Une catégorie du sélecteur : identifiant, puis paires (emoji, mots-clés).
class CategorieEmoji {
  const CategorieEmoji(this.id, this.emojis);
  final String id;
  final List<(String, String)> emojis;
}

const List<CategorieEmoji> catalogueEmojis = [
${catalogue
  .map(
    (c) =>
      `  CategorieEmoji(${dart(c.id)}, [\n${c.emojis
        .map(([e, m]) => `    (${dart(e)}, ${dart(m)}),`)
        .join("\n")}\n  ]),`,
  )
  .join("\n")}
];
`
writeFileSync(resolve("../alanya/lib/core/emojis_catalogue.dart"), mobile)

console.log(
  `${total} emojis :`,
  catalogue.map((c) => `${c.id} ${c.emojis.length}`).join(", "),
)
