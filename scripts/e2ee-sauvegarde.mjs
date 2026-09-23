/**
 * LANCEUR DU BANC DE SAUVEGARDE.
 *
 * ⚠️ CELUI-CI A BESOIN DU SERVEUR, contrairement aux bancs de serrures : il
 * dépose et relit de vrais blocs par les vraies routes. C'est ce qui le rend
 * utile — la cryptographie est déjà éprouvée ailleurs, ici on éprouve le
 * CHEMIN.
 *
 * Usage : node scripts/e2ee-sauvegarde.mjs   (backend local démarré)
 */

import "fake-indexeddb/auto";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js";
import bcrypt from "../../backend-alanya/node_modules/bcryptjs/index.js";

const API = "http://localhost:3000";
const SORTIE = "scripts/.banc-sauvegarde";

/* Le localStorage que le client attend, posé avant tout import. */
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

/*
 * ⚠️ `document` ABSENT SOUS NODE, et le service s'y attend : `surEffacement`
 * sort aussitôt si `document` n'existe pas. On ne le simule donc PAS — le
 * simuler ferait croire que le dépôt à la fermeture de page est éprouvé ici,
 * alors qu'il ne l'est que dans un vrai navigateur.
 */

const prisma = new PrismaClient();

async function compte() {
  const email = "sauvegarde@e2ee.test";
  const motDePasse = "MotDePasseDeTest!2026";
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(motDePasse, 12), emailVerified: true, typeCompte: 0 },
    create: {
      email,
      nom: "Sauvegarde",
      passwordHash: await bcrypt.hash(motDePasse, 12),
      publicNumber: `SV${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
    },
  });
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: email,
      password: motDePasse,
      deviceId: "sauvegarde-banc",
      typeDevice: 0,
    }),
  });
  if (!r.ok) throw new Error(`login → ${r.status} ${await r.text()}`);
  return (await r.json()).accessToken;
}

const jeton = await compte();
localStorage.setItem("alanya-session-token-v2", jeton);

if (existsSync(SORTIE)) rmSync(SORTIE, { recursive: true, force: true });
console.log("\n⚙  Compilation du scénario par Vite…");
execSync(
  `npx vite build --ssr scripts/e2ee-sauvegarde-test.js --outDir ${SORTIE} --logLevel error`,
  { stdio: "inherit", env: { ...process.env, VITE_API_BASE_URL: API } },
);

const module = await import(`../${SORTIE}/e2ee-sauvegarde-test.js`);
const echecs = await module.scenario();

rmSync(SORTIE, { recursive: true, force: true });
await prisma.$disconnect();
process.exit(echecs === 0 ? 0 : 1);
