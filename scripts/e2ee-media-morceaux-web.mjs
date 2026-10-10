/**
 * LOT 5 — LE WEB ENVOIE EN MORCEAUX (cours, chapitre 46).
 *
 * Alice, dans un vrai navigateur, envoie par l'interface un fichier de 2,6 Mo
 * dans un fil CHIFFRÉ puis dans un fil EN CLAIR. Le banc vérifie en base qu'il
 * est passé par les envois en morceaux (trois, assemblés), que le pourcentage
 * s'est affiché dans la bulle, et que Bob voit le fichier.
 *
 * Usage : node --env-file=../backend-alanya/.env scripts/e2ee-media-morceaux-web.mjs
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
  const email = `${prenom.toLowerCase()}.envoi@e2ee.test`;
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12);
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0, appareilTotal: 3 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `5${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
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


/** Un PDF d'une page, écrit à la main : le plus petit document valide utile. */

async function envoyerParLInterface(page, fichiers, legende) {
  await page.locator('input[type="file"]').first().setInputFiles(fichiers);
  const champ = page.locator('textarea[placeholder="Ajouter une legende..."]');
  await champ.waitFor({ state: "visible", timeout: 10000 });
  if (legende) await champ.fill(legende);
  await champ.press("Enter");
}

async function attendreMedias(convId, n) {
  for (let i = 0; i < 60; i++) {
    const c = await prisma.mediaFile.count({ where: { message: { convId } } });
    if (c >= n) return c;
    await new Promise((r) => setTimeout(r, 500));
  }
  return prisma.mediaFile.count({ where: { message: { convId } } });
}


/** Observe, dans la page, chaque « N % » affiché pendant l'envoi. */
async function guetterPourcents(page) {
  await page.evaluate(() => {
    window.__pourcents = new Set();
    const regarder = () => {
      for (const el of document.querySelectorAll("span")) {
        const m = /^(\d{1,2}) %$/.exec(el.textContent?.trim() ?? "");
        if (m) window.__pourcents.add(Number(m[1]));
      }
    };
    new MutationObserver(regarder).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}
const pourcentsVus = (page) => page.evaluate(() => [...(window.__pourcents ?? [])].sort((a, b) => a - b));

async function main() {
  console.log("\n\x1b[1m════ LOT 5 — LE WEB ENVOIE EN MORCEAUX ════\x1b[0m");
  const { randomBytes } = await import("node:crypto");

  const alice = await compte("Alice");
  const bob = await compte("Bob");
  const filChiffre = await filEntre(alice, bob);

  const navigateur = await chromium.launch({ channel: "chrome" });
  const A = await connecter(navigateur, alice);
  const B = await connecter(navigateur, bob);
  verifie("Alice a publié une identité", await attendreCles(alice));
  verifie("Bob a publié une identité", await attendreCles(bob));
  await prisma.conversation.update({ where: { id: filChiffre }, data: { e2eeActif: true } });

  titre("① Fil chiffré : Alice envoie 2,6 Mo par l'interface");
  await A.page.goto(`${WEB}/chats/${filChiffre}`, { waitUntil: "networkidle" });
  await A.page.waitForTimeout(1500);
  await guetterPourcents(A.page);
  const gros = randomBytes(2.6 * 1024 * 1024);
  await envoyerParLInterface(A.page, [{ name: "archive-chiffree.zip", mimeType: "application/zip", buffer: gros }], "Un gros fichier");
  verifie("le fichier est arrivé", (await attendreMedias(filChiffre, 1)) === 1);
  const media = await prisma.mediaFile.findFirst({ where: { message: { convId: filChiffre } }, include: { message: true } });
  const envoi = media ? await prisma.envoiMorceaux.findUnique({ where: { id: media.id } }) : null;
  verifie("… PAR MORCEAUX (le média porte l'identifiant d'un envoi en morceaux)", Boolean(envoi), media?.id);
  verifie("… trois morceaux, assemblés", envoi?.nbMorceaux === 3 && envoi?.statut === "termine", `${envoi?.nbMorceaux} / ${envoi?.statut}`);
  verifie("… chiffré, sans nom ni type réels", media?.chiffre === true && media?.filename === "chiffre.bin");
  verifie("… l'empreinte a été vérifiée à l'assemblage", Boolean(envoi?.empreinte));
  verifie("le message est posté par le navigateur, sans texte en clair", media?.message?.senderId === alice.id && !media?.message?.content);
  const vus = await pourcentsVus(A.page);
  verifie("un pourcentage a été affiché pendant l'envoi", vus.length > 0, JSON.stringify(vus));
  console.log(`    pourcentages vus : ${vus.join(", ") || "aucun"}`);

  titre("② Bob ouvre le fil chiffré");
  await B.page.goto(`${WEB}/chats/${filChiffre}`, { waitUntil: "networkidle" });
  const carte = B.page.getByText("archive-chiffree.zip").first();
  verifie("Bob voit le fichier sous son vrai nom (déchiffré)", await carte.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false));
  verifie("… avec sa légende", await B.page.getByText("Un gros fichier").first().isVisible().catch(() => false));

  titre("③ Fil en clair : le même chemin, sous le vrai nom");
  const filClair = await filEntre(alice, bob);
  await A.page.goto(`${WEB}/chats/${filClair}`, { waitUntil: "networkidle" });
  await A.page.waitForTimeout(1500);
  await envoyerParLInterface(A.page, [{ name: "rapport-clair.zip", mimeType: "application/zip", buffer: randomBytes(2.6 * 1024 * 1024) }]);
  verifie("le fichier est arrivé", (await attendreMedias(filClair, 1)) === 1);
  const clair = await prisma.mediaFile.findFirst({ where: { message: { convId: filClair } } });
  const envoiClair = clair ? await prisma.envoiMorceaux.findUnique({ where: { id: clair.id } }) : null;
  verifie("… par morceaux, assemblé", envoiClair?.statut === "termine" && envoiClair?.nbMorceaux === 3, `${envoiClair?.statut}`);
  verifie("… sous son vrai nom et son vrai type", clair?.filename === "rapport-clair.zip" && clair?.mimeType === "application/zip" && clair?.chiffre === false, `${clair?.filename} ${clair?.mimeType}`);
  await B.page.goto(`${WEB}/chats/${filClair}`, { waitUntil: "networkidle" });
  verifie("Bob le voit", await B.page.getByText("rapport-clair.zip").first().waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false));

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
