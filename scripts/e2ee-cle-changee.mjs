/**
 * LANCEUR DU BANC « CLÉ CHANGÉE ».
 *
 * 🔴 CE LANCEUR CHARGE LE MODULE TROIS FOIS, et c'est tout l'intérêt du banc.
 * Un `?v=n` différent donne à Node un module NEUF, avec son état remis à zéro,
 * pendant que la base `fake-indexeddb` reste la même. C'est la seule façon de
 * reproduire un rechargement de page dans un seul processus.
 *
 * ⚠️ SANS CELA, LE BANC AURAIT PASSÉ SUR LE CODE FAUTIF. L'ancien `Set` en
 * mémoire répond correctement tant qu'on ne recharge pas — un banc qui relit
 * dans le même module ne prouve donc rien du tout.
 *
 * Usage : node scripts/e2ee-cle-changee.mjs   (aucun serveur requis)
 */

import "fake-indexeddb/auto";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

/* Un `localStorage` en mémoire : le coffre y cherche l'ancien magasin. */
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

const SORTIE = "scripts/.banc-cle-changee";

if (existsSync(SORTIE)) rmSync(SORTIE, { recursive: true, force: true });
console.log("\n⚙  Compilation du scénario par Vite…");
execSync(
  `npx vite build --ssr scripts/e2ee-cle-changee-test.js --outDir ${SORTIE} --logLevel error`,
  { stdio: "inherit" },
);

const chemin = `../${SORTIE}/e2ee-cle-changee-test.js`;

const un = await import(`${chemin}?v=1`);
let echecs = await un.phaseUne();

const deux = await import(`${chemin}?v=2`);
echecs += await deux.phaseDeux();

const trois = await import(`${chemin}?v=3`);
echecs += await trois.phaseTrois();

rmSync(SORTIE, { recursive: true, force: true });

console.log(
  echecs === 0
    ? "\n\x1b[32m✓ L'alerte ne se perd plus, et ne se répète pas.\x1b[0m\n"
    : `\n\x1b[31m✗ ${echecs} échec(s).\x1b[0m\n`,
);
process.exit(echecs === 0 ? 0 : 1);
