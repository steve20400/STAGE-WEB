/**
 * LANCEUR DU BANC DU CACHE.
 *
 * Il pose un IndexedDB utilisable sous Node, compile le scénario par Vite, puis
 * l'exécute.
 *
 * ⚠️ `fake-indexeddb` D'ABORD, LE MODULE ENSUITE. Le dépôt ouvre sa base au
 * chargement : poser le magasin après ne servirait à rien.
 *
 * ⚠️ VITE COMPILE, NODE EXÉCUTE. `messageRepository.js` importe `./schema` sans
 * extension — Vite le résout, Node non. Le lancer directement échoue sur un
 * `ERR_MODULE_NOT_FOUND` qui ne parle pas du tout du défaut testé.
 *
 * Usage : node scripts/e2ee-cache.mjs   (aucun serveur requis)
 */

import "fake-indexeddb/auto";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const SORTIE = "scripts/.banc-cache";

if (existsSync(SORTIE)) rmSync(SORTIE, { recursive: true, force: true });
console.log("\n⚙  Compilation du scénario par Vite…");
execSync(
  `npx vite build --ssr scripts/e2ee-cache-test.js --outDir ${SORTIE} --logLevel error`,
  { stdio: "inherit" },
);

const module = await import(`../${SORTIE}/e2ee-cache-test.js`);
const echecs = await module.scenario();

rmSync(SORTIE, { recursive: true, force: true });
process.exit(echecs === 0 ? 0 : 1);
