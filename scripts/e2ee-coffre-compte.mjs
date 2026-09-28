/**
 * LE COFFRE DE CLÉS APPARTIENT À UN COMPTE, ET PART AVEC LUI.
 *
 * 🔴 LE DÉFAUT QUE CE BANC ATTRAPE. Le coffre du navigateur (identité privée,
 * sessions, clé de l'archive) n'était rattaché à aucun compte, et seule la
 * déconnexion simple le vidait. Après une session expirée, un « déconnecter
 * partout » ou une suppression de compte, le compte SUIVANT qui se connectait
 * dans ce navigateur reprenait l'identité privée du précédent — et la publiait
 * comme la sienne.
 *
 *   ① Alice se connecte : son identité est publiée ;
 *   ② sa session expire (jetons effacés, coffre intact) ;
 *   ③ Bob se connecte dans le MÊME navigateur : son identité doit être NEUVE ;
 *   ④ la purge des sorties de session (« déconnecter partout », suppression de
 *     compte) vide le coffre.
 *
 * Usage : node --env-file=../backend-alanya/.env scripts/e2ee-coffre-compte.mjs
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
  const email = `${prenom.toLowerCase()}.coffrecompte@e2ee.test`;
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12);
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0, appareilTotal: 3 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `CC${Math.floor(Math.random() * 1000000)}`,
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

/** Le nombre de secrets dans le coffre chiffré de ce navigateur. */
async function secretsDuCoffre(page) {
  return page.evaluate(
    () =>
      new Promise((ok) => {
        const r = indexedDB.open("alanya-coffre-e2ee");
        r.onsuccess = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains("secrets")) return ok(0);
          const c = db.transaction("secrets", "readonly").objectStore("secrets").count();
          c.onsuccess = () => ok(c.result);
          c.onerror = () => ok(-1);
        };
        r.onerror = () => ok(-1);
      }),
  );
}

async function main() {
  console.log("\n\x1b[1m════ LE COFFRE, RATTACHÉ À SON COMPTE ════\x1b[0m");

  const alice = await compte("Alice");
  const bob = await compte("Bob");

  const navigateur = await chromium
    .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
    .catch(() => null);
  if (!navigateur) {
    console.error("\n\x1b[31m💥 Chrome introuvable.\x1b[0m\n");
    process.exit(1);
  }

  titre("① Alice se connecte");
  const A = await connecter(navigateur, alice);
  verifie("Alice a publié une identité", await attendreCles(alice));
  const cleAlice = (await prisma.e2eeIdentite.findFirst({ where: { userId: alice.id } }))?.cleIdentite;

  titre("② Sa session expire — le coffre, lui, reste");
  await A.page.evaluate(async () => {
    (await import("/src/data/session-auth.ts")).clearSessionToken();
    (await import("/src/data/session-user.ts")).clearSessionUser();
  });
  verifie("témoin : le coffre d'Alice est toujours là", (await secretsDuCoffre(A.page)) > 0);

  titre("③ Bob se connecte dans le même navigateur");
  const page = A.page;
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="text"], input[type="email"]').first().fill(bob.email);
  await page.locator('input[type="password"]').first().fill(MOT_DE_PASSE);
  await page.getByRole("button", { name: /^Connexion$/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => {});
  const portillon = page.locator(".pseudo-gate-champ");
  if (await portillon.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false)) {
    await portillon.fill(`Banc Bob ${Date.now().toString(36)}`);
    await page.locator(".pseudo-gate-valider").click();
    await page.waitForSelector(".pseudo-gate-overlay", { state: "detached", timeout: 15000 });
  }
  verifie("Bob a publié une identité", await attendreCles(bob));
  const cleBob = (await prisma.e2eeIdentite.findFirst({ where: { userId: bob.id } }))?.cleIdentite;
  verifie(
    "l'identité de Bob est NEUVE, pas celle d'Alice",
    !!cleBob && cleBob !== cleAlice,
    "Bob a publié la clé d'identité privée d'Alice comme la sienne",
  );

  titre("④ La purge d'une sortie de session vide le coffre");
  await page.evaluate(async () => {
    await (await import("/src/services/session-reset.ts")).purgeLocalAccountData();
  });
  const reste = await secretsDuCoffre(page);
  verifie("plus aucun secret dans le coffre", reste === 0, `${reste} secret(s) restant(s)`);

  const fatales = [...A.erreurs];
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
