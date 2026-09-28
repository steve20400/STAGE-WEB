/**
 * LA LISTE MONTRE LE DERNIER MESSAGE D'UN FIL CHIFFRÉ — déchiffré sur l'appareil.
 *
 * Demande du user, 28/09/2026. Le serveur n'a pas le texte d'un fil chiffré et
 * rend `lastMessage: null` ; un message chiffré n'émet pas non plus l'événement
 * `message`, si bien que la liste ne bougeait qu'au prochain tour de son
 * interrogation (20 s), et sans texte.
 *
 * SCÉNARIO : Bob est sur la LISTE ; Alice lui écrit dans un fil chiffré. Le
 * texte doit apparaître dans la liste en quelques secondes, et y rester après
 * un rechargement de la page.
 *
 * Usage : node scripts/liste-apercu.mjs   (backend :3000, WebSocket :3001, web :5173)
 */
import { chromium } from "playwright";
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js";
import bcrypt from "../../backend-alanya/node_modules/bcryptjs/index.js";

const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const prisma = new PrismaClient();
const MDP = "MotDePasseDeTest!2026";

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
  const email = `${prenom.toLowerCase()}.apercu@e2ee.test`;
  const hash = await bcrypt.hash(MDP, 12);
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `AP${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
    },
  });
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
  console.log("\n\x1b[1m════ LE DERNIER MESSAGE D'UN FIL CHIFFRÉ, DANS LA LISTE ════\x1b[0m\n");
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

  await B.goto(`${WEB}/chats`, { waitUntil: "networkidle" });
  await B.waitForTimeout(2000);

  const texte = `Apercu-${Date.now().toString(36)}`;
  await A.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  await A.waitForTimeout(1500);
  await A.evaluate(
    async ([c, t]) => {
      const f = await import("/src/services/e2ee-fil.ts");
      await f.envoyerChiffre(c, t);
    },
    [fil, texte],
  );
  const t0 = Date.now();

  const vu = await B.getByText(texte, { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const delai = Date.now() - t0;
  verifie(
    `le texte apparaît dans la liste de Bob (${vu ? `${delai} ms` : "jamais en 10 s"})`,
    vu,
    "le serveur n'a pas ce texte, et rien ne le cherchait en local",
  );

  const participant = await prisma.participant.findFirst({
    where: { convId: fil, userId: bob.id },
    select: { unreadCount: true },
  });
  verifie("le compteur de non-lus du serveur vaut 1", participant?.unreadCount === 1, `${participant?.unreadCount}`);

  await B.reload({ waitUntil: "networkidle" });
  const apresRechargement = await B.getByText(texte, { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  verifie("et il y reste après un rechargement", apresRechargement);

  await navigateur.close();
  await prisma.$disconnect();
  console.log(
    `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n💥", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
