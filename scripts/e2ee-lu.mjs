/**
 * UN MESSAGE CHIFFRÉ LU DANS UN FIL OUVERT PASSE À « LU ».
 *
 * 🔴 LE DÉFAUT QUE CE BANC ATTRAPE (signalé par le user le 29/09/2026 : « l'état
 * du message chiffré lu n'est pas affiché par le mobile »). Un message chiffré
 * n'arrive pas par l'événement temps réel ordinaire (sa route REST ne diffuse
 * rien) mais par la « sonnette » `e2ee_arrivee`. Le web, fil ouvert, relevait le
 * message et l'affichait… sans jamais envoyer « j'ai lu » : l'expéditeur restait
 * sur une coche grise jusqu'à ce que le lecteur rouvre la conversation.
 *
 *   ① Bob ouvre le fil sur le web et le laisse ouvert ;
 *   ② Alice lui envoie un message chiffré ;
 *   ③ Bob le voit, et le message doit passer à READ en base (c'est ce que
 *     l'expéditeur reçoit en temps réel).
 *
 * Usage : node --env-file=../backend-alanya/.env scripts/e2ee-lu.mjs
 *         (backend :3000, WebSocket :3001 et web :5173 démarrés)
 */
import { chromium } from "playwright";
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js";
import bcrypt from "../../backend-alanya/node_modules/bcryptjs/index.js";

const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const prisma = new PrismaClient();
const MOT_DE_PASSE = "MotDePasseDeTest!2026";

let echecs = 0;

function verifie(libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`);
  if (!condition) {
    echecs++;
    if (detail !== undefined) console.log(`      \x1b[31m${detail}\x1b[0m`);
  }
}

function titre(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

/** Un compte personnel, mot de passe connu, identité E2EE effacée. */
async function compte(prenom) {
  const email = `${prenom.toLowerCase()}.lu@e2ee.test`;
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12);
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0, appareilTotal: 3 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `LU${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
      appareilTotal: 3,
    },
  });
  await prisma.e2eeIdentite.deleteMany({ where: { userId: u.id } });
  await prisma.e2eeEnveloppe.deleteMany({
    where: { OR: [{ destinataireId: u.id }, { expediteurId: u.id }] },
  });
  return { id: u.id, email, prenom };
}

async function filEntre(a, b) {
  const anciennes = await prisma.conversation.findMany({
    where: {
      isGroup: false,
      AND: [
        { participants: { some: { userId: a.id } } },
        { participants: { some: { userId: b.id } } },
      ],
    },
    select: { id: true },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: anciennes.map((c) => c.id) } } });
  const c = await prisma.conversation.create({
    data: { isGroup: false, participants: { create: [{ userId: a.id }, { userId: b.id }] } },
    select: { id: true },
  });
  return c.id;
}

async function connecter(navigateur, qui) {
  const contexte = await navigateur.newContext();
  const page = await contexte.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e.message)));

  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="text"], input[type="email"]').first().fill(qui.email);
  await page.locator('input[type="password"]').first().fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: /^Connexion$/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const portillon = page.locator(".pseudo-gate-champ");
  if (await portillon.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false)) {
    await portillon.fill(`Banc ${qui.prenom} ${Date.now().toString(36)}`);
    await page.locator(".pseudo-gate-valider").click();
    await page.waitForSelector(".pseudo-gate-overlay", { state: "detached", timeout: 15000 });
  }
  return { contexte, page, erreurs };
}

async function attendreCles(qui) {
  for (let i = 0; i < 40; i++) {
    if ((await prisma.e2eeIdentite.count({ where: { userId: qui.id } })) > 0) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Envoie par le VRAI code du client, dans l'instance déjà chargée de la page. */
async function envoyer(page, convId, texte) {
  return page.evaluate(
    async ([c, t]) => {
      const fil = await import("/src/services/e2ee-fil.ts");
      const m = await fil.envoyerChiffre(c, t);
      return m.id;
    },
    [convId, texte],
  );
}

async function afficheLeTexte(page, texte, delaiMs = 15000) {
  return page
    .locator(".room-body")
    .getByText(texte, { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: delaiMs })
    .then(() => true)
    .catch(() => false);
}

async function main() {
  console.log("\n\x1b[1m════ « LU » SUR UN MESSAGE CHIFFRÉ ════\x1b[0m");

  const alice = await compte("Alice");
  const bob = await compte("Bob");
  const fil = await filEntre(alice, bob);

  const navigateur = await chromium.launch({ channel: "chrome" });
  const A = await connecter(navigateur, alice);
  const B = await connecter(navigateur, bob);
  verifie("Alice a publié une identité", await attendreCles(alice));
  verifie("Bob a publié une identité", await attendreCles(bob));
  await prisma.conversation.update({ where: { id: fil }, data: { e2eeActif: true } });

  titre("① Bob ouvre le fil et le laisse ouvert");
  await B.page.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  await B.page.waitForTimeout(2000);

  titre("② Alice lui écrit, chiffré");
  const texte = `ALire-${Date.now().toString(36)}`;
  const id = await envoyer(A.page, fil, texte);

  titre("③ Bob le voit — et le message passe à « lu »");
  verifie("Bob voit le texte", await afficheLeTexte(B.page, texte));
  let statut = null;
  for (let i = 0; i < 16; i++) {
    statut = (await prisma.message.findUnique({ where: { id }, select: { status: true } }))?.status;
    if (statut === "READ") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  verifie(
    "statut READ en base",
    statut === "READ",
    `statut : ${statut} — le web, fil ouvert, n'a pas envoyé « j'ai lu »`,
  );

  const fatales = [...A.erreurs, ...B.erreurs];
  verifie("aucune erreur JavaScript", fatales.length === 0, fatales.slice(0, 3).join(" | "));
  await navigateur.close();
  await prisma.$disconnect();
  console.log(
    `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n\x1b[31m💥 Le banc s'est arrêté :\x1b[0m", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
