/**
 * ENVOYER SANS ATTENDRE — le champ ne se bloque pas pendant un envoi.
 *
 * 🐛 Signalé par le user le 28/09/2026 : après « Envoyer », il faut attendre
 * que le message parte avant de pouvoir en envoyer un autre. Le champ se
 * vidait, mais le bouton restait désactivé et Entrée ne faisait rien tant que
 * le serveur n'avait pas répondu — deux secondes dans un fil chiffré, à la
 * latence qu'on a depuis Yaoundé.
 *
 * LE SCÉNARIO, dans le vrai Chrome, fil CHIFFRÉ (le cas le plus lent) :
 *   · chaque requête d'Alice est retardée de 300 ms — la latence réelle ;
 *   · Alice tape trois messages et appuie sur Entrée après chacun, SANS
 *     attendre ;
 *   · les trois doivent partir, et Bob doit les lire DANS L'ORDRE.
 *
 * Usage : node scripts/envoi-rapide.mjs   (backend :3000, WebSocket :3001, web :5173)
 */
import { chromium } from "playwright";
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js";
import bcrypt from "../../backend-alanya/node_modules/bcryptjs/index.js";

const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const prisma = new PrismaClient();
const MDP = "MotDePasseDeTest!2026";
const LATENCE_MS = 300;

let echecs = 0;
function verifie(libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`);
  if (!condition) {
    echecs++;
    if (detail !== undefined) console.log(`      \x1b[31m${detail}\x1b[0m`);
  }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function compte(prenom) {
  const email = `${prenom.toLowerCase()}.rapide@e2ee.test`;
  const hash = await bcrypt.hash(MDP, 12);
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `RP${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
    },
  });
  // Un navigateur neuf à chaque passage : on repart sans identité ni appareil,
  // sinon les anciens seraient servis et leurs noms refuseraient les nouveaux.
  await prisma.e2eeIdentite.deleteMany({ where: { userId: u.id } });
  await prisma.appareil.deleteMany({ where: { alanyaId: u.id } });
  return { id: u.id, email, prenom };
}

async function connecter(navigateur, qui) {
  const page = await (await navigateur.newContext()).newPage();
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="text"], input[type="email"]').first().fill(qui.email);
  await page.locator('input[type="password"]').first().fill(MDP);
  await page.getByRole("button", { name: /^Connexion$/i }).click();
  await page.waitForURL((x) => !x.pathname.includes("/login"), { timeout: 20000 }).catch(() => {});
  const portillon = page.locator(".pseudo-gate-champ");
  if (await portillon.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false)) {
    await portillon.fill(`Banc ${qui.prenom} ${Date.now().toString(36)}`);
    await page.locator(".pseudo-gate-valider").click();
    const ferme = await page
      .waitForSelector(".pseudo-gate-overlay", { state: "detached", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!ferme) throw new Error(`portillon resté ouvert pour ${qui.prenom}`);
  }
  for (let i = 0; i < 40 && (await prisma.e2eeIdentite.count({ where: { userId: qui.id } })) === 0; i++) {
    await pause(500);
  }
  return page;
}

async function main() {
  console.log("\n\x1b[1m════ ENVOYER SANS ATTENDRE ════\x1b[0m\n");
  const alice = await compte("Alice");
  const bob = await compte("Bob");

  const anciennes = await prisma.conversation.findMany({
    where: {
      isGroup: false,
      AND: [
        { participants: { some: { userId: alice.id } } },
        { participants: { some: { userId: bob.id } } },
      ],
    },
    select: { id: true },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: anciennes.map((c) => c.id) } } });
  const fil = (
    await prisma.conversation.create({
      data: { isGroup: false, participants: { create: [{ userId: alice.id }, { userId: bob.id }] } },
      select: { id: true },
    })
  ).id;

  const navigateur = await chromium.launch({ channel: "chrome" });
  const A = await connecter(navigateur, alice);
  const B = await connecter(navigateur, bob);
  await prisma.conversation.update({ where: { id: fil }, data: { e2eeActif: true } });

  await A.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  await A.waitForTimeout(2000);

  // ⚠️ LA LATENCE RÉELLE, sur chaque appel au serveur d'Alice.
  await A.route("**/api/**", async (route) => {
    await pause(LATENCE_MS);
    await route.continue();
  });

  const champ = A.locator("textarea").first();
  const textes = ["Premier", "Deuxième", "Troisième"].map((t) => `${t}-${Date.now().toString(36)}`);
  const vides = [];
  const debut = Date.now();
  for (const t of textes) {
    await champ.fill(t);
    await champ.press("Enter");
    await A.waitForTimeout(80);
    vides.push((await champ.inputValue()) === "");
  }
  const duree = Date.now() - debut;
  console.log(`  (trois messages tapés et envoyés en ${duree} ms, latence simulée ${LATENCE_MS} ms)`);

  verifie(
    "le champ se vide à CHAQUE envoi, sans attendre le serveur",
    vides.every(Boolean),
    `champ vidé : ${JSON.stringify(vides)} — un envoi en cours bloquait le suivant`,
  );

  // Les trois doivent arriver chez Bob.
  let lignes = 0;
  for (let i = 0; i < 60; i++) {
    lignes = await prisma.e2eeEnveloppe.count({
      where: { convId: fil, destinataireId: bob.id },
    });
    if (lignes >= 3) break;
    await pause(500);
  }
  verifie("les trois messages sont partis", lignes === 3, `${lignes} enveloppe(s) pour Bob`);

  await B.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  const positions = [];
  for (const t of textes) {
    const el = B.getByText(t, { exact: true }).first();
    const vu = await el.waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
    positions.push(vu ? (await el.boundingBox())?.y ?? null : null);
  }
  verifie("Bob lit les trois", positions.every((y) => y !== null), JSON.stringify(positions));
  verifie(
    "dans l'ordre où ils ont été tapés",
    positions.every((y, i) => i === 0 || (y !== null && positions[i - 1] !== null && y > positions[i - 1])),
    JSON.stringify(positions),
  );

  /* ── L'échec, et « Réessayer » ─────────────────────────────────────── */
  /*
   * On coupe la PREMIÈRE étape de l'envoi chiffré (la liste des appareils de
   * Bob) : rien n'est encore créé sur le serveur, l'échec est propre. La bulle
   * doit passer « non envoyé » — elle restait « en cours » pour toujours — et
   * « Réessayer » doit la faire partir.
   */
  await A.unroute("**/api/**");
  let coupe = true;
  await A.route("**/api/e2ee/cles/**", (route) => (coupe ? route.abort("failed") : route.continue()));
  const texteEchec = `Echec-${Date.now().toString(36)}`;
  await champ.fill(texteEchec);
  await champ.press("Enter");
  const icone = A.locator("svg title", { hasText: /non envoy/i }).first();
  const marque = await icone.waitFor({ state: "attached", timeout: 15000 }).then(() => true).catch(() => false);
  verifie("un envoi impossible marque la bulle « non envoyé »", marque);

  coupe = false;
  await A.getByText(texteEchec, { exact: true }).first().click({ button: "right" });
  const reessayer = A.getByRole("button", { name: /^Réessayer$/ }).first();
  const propose = await reessayer.isVisible({ timeout: 3000 }).catch(() => false);
  verifie("« Réessayer » est proposé dans son menu", propose);
  if (propose) await reessayer.click();
  let parti = 0;
  for (let i = 0; i < 30 && parti < 4; i++) {
    parti = await prisma.e2eeEnveloppe.count({ where: { convId: fil, destinataireId: bob.id } });
    await pause(500);
  }
  verifie("et le message part", parti === 4, `${parti} enveloppe(s) pour Bob (4 attendues)`);

  await navigateur.close();
  await prisma.$disconnect();
  console.log(`\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n💥", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
