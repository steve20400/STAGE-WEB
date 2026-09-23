/**
 * LANCEUR DU BANC DU COFFRE.
 *
 * ⚠️ IL FAUT UN `localStorage` EN PLUS D'INDEXEDDB : le coffre reprend l'ancien
 * magasin au démarrage, et c'est justement ce qu'on veut éprouver.
 *
 * ⚠️ VITE COMPILE, NODE EXÉCUTE — comme les autres bancs web : le module lit
 * `import.meta.env` par ses dépendances, que Node ne connaît pas.
 *
 * Usage : node scripts/e2ee-coffre.mjs   (aucun serveur requis)
 */

import "fake-indexeddb/auto";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

/* Un `localStorage` en mémoire, posé AVANT le premier import du module testé. */
const donnees = new Map();
globalThis.localStorage = {
  getItem: (k) => (donnees.has(k) ? donnees.get(k) : null),
  setItem: (k, v) => donnees.set(k, String(v)),
  removeItem: (k) => donnees.delete(k),
  key: (i) => [...donnees.keys()][i] ?? null,
  get length() {
    return donnees.size;
  },
  clear: () => donnees.clear(),
};
globalThis.window = { localStorage: globalThis.localStorage };

const SORTIE = "scripts/.banc-coffre";

if (existsSync(SORTIE)) rmSync(SORTIE, { recursive: true, force: true });
console.log("\n⚙  Compilation du scénario par Vite…");
execSync(
  `npx vite build --ssr scripts/e2ee-coffre-test.js --outDir ${SORTIE} --logLevel error`,
  { stdio: "inherit" },
);

const module = await import(`../${SORTIE}/e2ee-coffre-test.js`);
const echecs = await module.scenario();

rmSync(SORTIE, { recursive: true, force: true });
process.exit(echecs === 0 ? 0 : 1);
