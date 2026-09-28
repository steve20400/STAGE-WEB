/**
 * DEUX ONGLETS DU MÊME COMPTE NE DOIVENT PAS SE CORROMPRE LE COFFRE.
 *
 * 🔴 LE DÉFAUT QUE CE BANC ATTRAPE. Chaque onglet charge le coffre en mémoire
 * à l'ouverture, puis sert TOUTES ses lectures depuis cette copie. Deux onglets
 * du même navigateur partagent le disque, mais chacun ignore ce que l'autre y
 * écrit. Le second chiffre donc sur un état de cliquet PÉRIMÉ : même compteur,
 * même clé de message que l'envoi du premier. Le destinataire lit le premier,
 * et refuse le second comme un doublon — message perdu, et une clé de message
 * servie deux fois.
 *
 * LE SCÉNARIO, dans le vrai Chrome :
 *
 *   ① Alice et Bob échangent un message chacun : la session est établie ;
 *   ② Alice ouvre un SECOND onglet — qui charge le coffre à cet instant ;
 *   ③ l'onglet 1 écrit à Bob, puis l'onglet 2 (copie d'avant ③) écrit à Bob ;
 *   ④ Bob doit lire LES DEUX.
 *   ⑤ Et un troisième message, depuis l'onglet 1, se lit encore.
 *   ⑥ La relève range chaque message dès qu'il est déchiffré, pas le lot entier.
 *
 * Usage : node scripts/e2ee-onglets.mjs
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
  const email = `${prenom.toLowerCase()}.onglets@e2ee.test`;
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12);
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0, appareilTotal: 3 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `ON${Math.floor(Math.random() * 1000000)}`,
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
  console.log("\n\x1b[1m════ DEUX ONGLETS, UN SEUL COFFRE ════\x1b[0m");

  const alice = await compte("Alice");
  const bob = await compte("Bob");
  const fil = await filEntre(alice, bob);

  const navigateur = await chromium
    .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
    .catch(() => null);
  if (!navigateur) {
    console.error("\n\x1b[31m💥 Chrome introuvable.\x1b[0m\n");
    process.exit(1);
  }

  titre("⓪ Les deux comptes se connectent");
  const A = await connecter(navigateur, alice);
  const B = await connecter(navigateur, bob);
  verifie("Alice a publié une identité", await attendreCles(alice));
  verifie("Bob a publié une identité", await attendreCles(bob));
  await prisma.conversation.update({ where: { id: fil }, data: { e2eeActif: true } });

  titre("① Un message dans chaque sens : la session est établie");
  const t1 = `Premier-${Date.now().toString(36)}`;
  await envoyer(A.page, fil, t1);
  await B.page.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  verifie("Bob lit le premier message", await afficheLeTexte(B.page, t1));
  const t2 = `Reponse-${Date.now().toString(36)}`;
  await envoyer(B.page, fil, t2);
  await A.page.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  verifie("Alice lit la réponse", await afficheLeTexte(A.page, t2));

  titre("② Alice ouvre un second onglet");
  /*
   * ⚠️ LE MÊME CONTEXTE, donc le même IndexedDB : c'est exactement deux onglets
   * d'un même navigateur. L'onglet charge le coffre MAINTENANT, et sa copie en
   * mémoire vieillira dès que l'onglet 1 écrira.
   */
  const A2 = await A.contexte.newPage();
  A2.on("pageerror", (e) => A.erreurs.push(String(e.message)));
  await A2.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  verifie("le second onglet affiche le fil", await afficheLeTexte(A2, t2));

  titre("③ L'onglet 1 écrit, puis l'onglet 2");
  const t3 = `Onglet1-${Date.now().toString(36)}`;
  const t4 = `Onglet2-${Date.now().toString(36)}`;
  await envoyer(A.page, fil, t3);
  await envoyer(A2, fil, t4);

  titre("④ Bob lit les deux");
  await B.page.reload({ waitUntil: "networkidle" });
  verifie("le message de l'onglet 1", await afficheLeTexte(B.page, t3));
  verifie(
    "le message de l'onglet 2",
    await afficheLeTexte(B.page, t4),
    "chiffré sur une copie périmée du cliquet : même clé de message, refusé comme doublon",
  );

  titre("⑤ Et l'onglet 1 écrit encore");
  const t5 = `Encore-${Date.now().toString(36)}`;
  await envoyer(A.page, fil, t5);
  await B.page.reload({ waitUntil: "networkidle" });
  verifie(
    "Bob le lit",
    await afficheLeTexte(B.page, t5),
    "l'onglet 1 repart de SA copie, que l'onglet 2 a écrasée sur le disque",
  );

  titre("⑥ La relève range chaque message dès qu'il est déchiffré");
  /*
   * 🐛 TOUT LE LOT ÉTAIT DÉCHIFFRÉ, PUIS RANGÉ D'UN COUP. Un message déchiffré ne
   * se déchiffre pas deux fois (le cliquet a avancé) : si l'onglet se fermait
   * entre les deux, tous les textes déjà ouverts étaient perdus, sans retour.
   *
   * ⚠️ ON NE PEUT PAS TUER UN ONGLET AU MILIEU D'UNE BOUCLE à coup sûr. Le banc
   * éprouve donc la PROPRIÉTÉ qui ferme la fenêtre : le rangement est appelé
   * une fois par message, jamais sur un lot de plusieurs.
   *
   * ⚠️ BOB QUITTE L'APPLICATION PENDANT QU'ALICE ÉCRIT : son écran relèverait
   * sinon les enveloppes à leur arrivée, et le banc n'aurait rien à relever.
   * La page d'attente est un fichier statique de la même origine — même
   * stockage, mais aucune application qui tourne.
   */
  await B.page.goto(`${WEB}/manifest.json`);
  const lot = [0, 1, 2].map((i) => `Lot-${i}-${Date.now().toString(36)}`);
  for (const t of lot) await envoyer(A.page, fil, t);
  const tailles = await B.page.evaluate(async () => {
    // Hors de index.html, le préambule du greffon React manque : on le pose.
    const rafraichir = await import("/@react-refresh");
    rafraichir.default.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const f = await import("/src/services/e2ee-fil.ts");
    const vus = [];
    await f.releverEtDechiffrer(async (recus) => {
      vus.push(recus.length);
    });
    return vus;
  });
  verifie(
    "trois messages relevés, trois rangements d'un seul message",
    tailles.length === 3 && tailles.every((n) => n === 1),
    `rangements : ${JSON.stringify(tailles)}`,
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
