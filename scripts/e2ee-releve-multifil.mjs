/**
 * LA RELÈVE NE DOIT RIEN PERDRE QUAND IL Y A PLUSIEURS FILS CHIFFRÉS.
 *
 * 🔴 LE DÉFAUT QUE CE BANC ATTRAPE. La relève (`GET /api/e2ee/enveloppes`)
 * rend les enveloppes de TOUTES les conversations, et le client les acquitte
 * TOUTES. Mais il ne rangeait que le texte du fil OUVERT. Le reste était jeté :
 * le serveur ne l'a plus (acquitté), la clé du message est consommée (cliquet),
 * et l'écran affichait ensuite « indisponible sur cet appareil ».
 *
 * LE SCÉNARIO, dans le vrai Chrome, avec trois comptes :
 *
 *   ① Bob a ouvert son fil avec Carole ;
 *   ② Alice écrit à Bob, dans LEUR fil — que Bob n'a pas ouvert ;
 *   ③ Carole écrit à Bob : son fil ouvert relève… les deux enveloppes ;
 *   ④ Bob ouvre le fil d'Alice → le texte d'Alice DOIT y être.
 *
 * ⚠️ ③ EST LE DÉCLENCHEUR, pas un détail. Sans lui, l'enveloppe d'Alice attend
 * sagement sur le serveur, Bob la relève en ouvrant le fil, et tout passe. Le
 * défaut ne se montre qu'avec un SECOND fil actif — ce que les autres bancs
 * n'ont jamais eu.
 *
 * ⚠️ ET UN RECHARGEMENT À LA FIN : un texte gardé seulement en mémoire
 * d'écran s'affiche une fois, puis disparaît. On veut le voir survivre.
 *
 * Usage : node scripts/e2ee-releve-multifil.mjs
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

/** Un compte personnel (type 0), mot de passe connu, identité E2EE effacée. */
async function compte(prenom) {
  const email = `${prenom.toLowerCase()}.multifil@e2ee.test`;
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12);
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `MF${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
    },
  });
  /*
   * ⚠️ ON REPART DE ZÉRO À CHAQUE PASSAGE. Chaque navigateur du banc est neuf,
   * donc tire une identité neuve : les anciennes resteraient servies (elles
   * ont relevé récemment) et chaque message partirait aussi vers des appareils
   * morts, dont les enveloppes ne seraient jamais acquittées.
   */
  await prisma.e2eeIdentite.deleteMany({ where: { userId: u.id } });
  await prisma.e2eeEnveloppe.deleteMany({
    where: { OR: [{ destinataireId: u.id }, { expediteurId: u.id }] },
  });
  return { id: u.id, email, prenom };
}

/** Une conversation directe neuve entre deux comptes. */
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
    data: {
      isGroup: false,
      participants: { create: [{ userId: a.id }, { userId: b.id }] },
    },
    select: { id: true },
  });
  return c.id;
}

/** Connexion par l'interface, comme un utilisateur — c'est elle qui publie les clés. */
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

  // Le portillon du nom d'appareil, à la première connexion d'un navigateur.
  const portillon = page.locator(".pseudo-gate-champ");
  if (await portillon.isVisible().catch(() => false)) {
    await portillon.fill(`Banc ${qui.prenom}`);
    await page.locator(".pseudo-gate-valider").click();
    await page.waitForSelector(".pseudo-gate-overlay", { state: "detached", timeout: 15000 })
      .catch(() => {});
  }
  return { contexte, page, erreurs };
}

/** Attend que le compte ait publié une identité — sans elle, pas de chiffrement. */
async function attendreCles(qui) {
  for (let i = 0; i < 40; i++) {
    const n = await prisma.e2eeIdentite.count({ where: { userId: qui.id } });
    if (n > 0) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Envoie un message chiffré PAR LE VRAI CODE du client.
 *
 * ⚠️ `import()` DU MÊME CHEMIN que l'application : Vite sert chaque module une
 * seule fois par page, on obtient donc l'instance déjà chargée — avec son coffre
 * ouvert — et non une copie neuve qui n'aurait aucune identité.
 */
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

/** Le texte est-il affiché dans le fil ? */
async function afficheLeTexte(page, texte, delaiMs = 15000) {
  return page
    .getByText(texte, { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: delaiMs })
    .then(() => true)
    .catch(() => false);
}

async function main() {
  console.log("\n\x1b[1m════ LA RELÈVE, AVEC DEUX FILS CHIFFRÉS ════\x1b[0m");

  const bob = await compte("Bob");
  const alice = await compte("Alice");
  const carole = await compte("Carole");
  const filAlice = await filEntre(alice, bob);
  const filCarole = await filEntre(carole, bob);

  const navigateur = await chromium
    .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
    .catch(() => null);
  if (!navigateur) {
    console.error("\n\x1b[31m💥 Chrome introuvable.\x1b[0m\n");
    process.exit(1);
  }

  titre("⓪ Les trois comptes se connectent et publient leurs clés");
  const B = await connecter(navigateur, bob);
  const A = await connecter(navigateur, alice);
  const C = await connecter(navigateur, carole);
  for (const qui of [bob, alice, carole]) {
    verifie(`${qui.prenom} a publié une identité`, await attendreCles(qui));
  }

  // Le chiffrement s'active après les clés : le serveur le refuserait sinon.
  await prisma.conversation.updateMany({
    where: { id: { in: [filAlice, filCarole] } },
    data: { e2eeActif: true },
  });

  titre("① Bob ouvre son fil avec Carole");
  await B.page.goto(`${WEB}/chats/${filCarole}`, { waitUntil: "networkidle" });
  await B.page.waitForTimeout(2500);

  titre("② Alice écrit à Bob, dans un fil qu'il n'a PAS ouvert");
  const texteAlice = `Alice-${Date.now().toString(36)}`;
  const idAlice = await envoyer(A.page, filAlice, texteAlice);
  verifie("le message d'Alice est déposé", typeof idAlice === "string");
  await B.page.waitForTimeout(1500);

  titre("③ Carole écrit à Bob, dans le fil ouvert");
  const texteCarole = `Carole-${Date.now().toString(36)}`;
  await envoyer(C.page, filCarole, texteCarole);
  verifie("Bob lit Carole dans le fil ouvert", await afficheLeTexte(B.page, texteCarole));
  await B.page.waitForTimeout(3000);

  const enveloppeAlice = await prisma.e2eeEnveloppe.findFirst({
    where: { messageId: idAlice, destinataireId: bob.id },
    select: { remisLe: true },
  });
  console.log(
    `      (l'enveloppe d'Alice est ${enveloppeAlice?.remisLe ? "ACQUITTÉE" : "encore en attente"} sur le serveur)`,
  );

  titre("④ Bob ouvre le fil d'Alice");
  await B.page.goto(`${WEB}/chats/${filAlice}`, { waitUntil: "networkidle" });
  verifie(
    "le texte d'Alice est affiché",
    await afficheLeTexte(B.page, texteAlice),
    "acquitté par la relève du fil de Carole, puis jeté",
  );

  titre("⑤ Et il survit à un rechargement");
  await B.page.reload({ waitUntil: "networkidle" });
  verifie(
    "toujours là après rechargement",
    await afficheLeTexte(B.page, texteAlice),
    "le texte ne vivait qu'en mémoire d'écran",
  );
  await B.page.goto(`${WEB}/chats/${filCarole}`, { waitUntil: "networkidle" });
  verifie(
    "celui de Carole aussi",
    await afficheLeTexte(B.page, texteCarole),
    "le texte ne vivait qu'en mémoire d'écran",
  );

  const fatales = [...B.erreurs, ...A.erreurs, ...C.erreurs];
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
