/**
 * DU MOBILE AU WEB, AVEC LE VRAI CODE DES DEUX CÔTÉS ET LE VRAI SERVEUR.
 *
 * 🔴 POURQUOI CE BANC. Le 29/09/2026, le user signale : un message chiffré
 * envoyé depuis le mobile s'affiche « indisponible sur cet appareil » sur le
 * web — chez le destinataire comme sur le web du même compte. Les tests du
 * mobile parlent à un faux serveur, les bancs du web n'ont que des navigateurs :
 * rien ne faisait jamais passer un message du VRAI code mobile au VRAI web.
 *
 *   ① le compte « Web » se connecte dans Chrome (il publie ses clés) ;
 *   ② le compte « Mobile » se connecte par l'API, comme le téléphone ;
 *   ③ le code de chiffrement du mobile (Dart, `test/interop_reel_test.dart`)
 *     publie ses clés et envoie un message chiffré dans leur fil ;
 *   ④ le web ouvre le fil : le texte doit s'afficher.
 *
 * Usage : node --env-file=../backend-alanya/.env scripts/e2ee-mobile-web.mjs
 *         (backend :3000, WebSocket :3001 et web :5173 démarrés)
 */
import { execFileSync } from "node:child_process";
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
  const email = `${prenom.toLowerCase()}.mobileweb@e2ee.test`;
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12);
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0, appareilTotal: 3 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `MW${Math.floor(Math.random() * 1000000)}`,
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

const API = process.env.API_URL ?? "http://localhost:3000";

/** Connexion « comme le téléphone » : par l'API, avec un identifiant mobile. */
async function connexionMobile(qui) {
  await prisma.user.update({ where: { id: qui.id }, data: { dissocier: true, deviceId: null } }).catch(() => undefined);
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: qui.email, password: MOT_DE_PASSE, deviceId: "mob-banc-interop", typeDevice: 1 }),
  });
  if (!r.ok) throw new Error(`connexion mobile → ${r.status} ${await r.text()}`);
  return (await r.json()).accessToken;
}

async function main() {
  console.log("\n\x1b[1m════ DU MOBILE AU WEB, PAR LE VRAI SERVEUR ════\x1b[0m");

  const web = await compte("Web");
  const mobile = await compte("Mobile");
  const fil = await filEntre(web, mobile);
  await prisma.conversation.update({ where: { id: fil }, data: { e2eeActif: true } });

  const navigateur = await chromium
    .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
    .catch(() => null);
  if (!navigateur) {
    console.error("\n\x1b[31m💥 Chrome introuvable.\x1b[0m\n");
    process.exit(1);
  }

  titre("① Le compte Web se connecte dans Chrome");
  const W = await connecter(navigateur, web);
  verifie("le web a publié une identité", await attendreCles(web));

  titre("② Le compte Mobile se connecte par l'API");
  const jeton = await connexionMobile(mobile);
  verifie("jeton obtenu", typeof jeton === "string");

  titre("③ Le code mobile chiffre et envoie");
  const texte = `DuMobile-${Date.now().toString(36)}`;
  let sortie = "";
  try {
    sortie = execFileSync(
      "C:/flutter/bin/flutter.bat",
      ["test", "test/interop_reel_test.dart", "--reporter", "expanded"],
      {
        cwd: "../alanya",
        encoding: "utf8",
        shell: true,
        env: {
          ...process.env,
          E2EE_API: API,
          E2EE_JETON: jeton,
          E2EE_MOI: mobile.id,
          E2EE_PAIR: web.id,
          E2EE_CONV: fil,
          E2EE_TEXTE: texte,
        },
      },
    );
  } catch (e) {
    sortie = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  for (const l of sortie.split("\n").filter((x) => /\[http\]|ENVOYE|Error|Exception|failed|passed/.test(x))) {
    console.log(`      ${l.trim().slice(0, 200)}`);
  }
  const envoye = /ENVOYE (\S+)/.exec(sortie)?.[1];
  verifie("le mobile a envoyé", !!envoye, "voir la sortie du test Dart ci-dessus");

  if (envoye) {
    const env = await prisma.e2eeEnveloppe.findMany({
      where: { messageId: envoye },
      select: { destinataireId: true, destinataireDevice: true, type: true },
    });
    const identitesWeb = await prisma.e2eeIdentite.findMany({ where: { userId: web.id }, select: { deviceId: true } });
    console.log(`      enveloppes : ${JSON.stringify(env.map((e) => `${e.destinataireId === web.id ? "web" : "mobile"}/${e.destinataireDevice}/t${e.type}`))}`);
    console.log(`      identités du web : ${JSON.stringify(identitesWeb.map((i) => i.deviceId))}`);
  }

  titre("④ Le web ouvre le fil");
  const journal = [];
  W.page.on("console", (m) => {
    if (/e2ee|illisible|decrypt|déchiff/i.test(m.text())) journal.push(m.text());
  });
  await W.page.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  const lu = await afficheLeTexte(W.page, texte, 15000);
  verifie("le web affiche le texte du mobile", lu, "« indisponible sur cet appareil »");
  for (const l of journal.slice(0, 6)) console.log(`      [console web] ${l.slice(0, 200)}`);

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
