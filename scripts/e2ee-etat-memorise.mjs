/**
 * UN FIL CHIFFRÉ LE RESTE, MÊME SI LE SERVEUR DIT LE CONTRAIRE.
 *
 * 🔴 LE DÉFAUT QUE CE BANC ATTRAPE. Le client apprenait du serveur, et de lui
 * seul, qu'un fil était chiffré — dans une table EN MÉMOIRE, vide à chaque
 * rechargement. Un serveur compromis qui répond `e2eeActif: false` faisait
 * donc repartir les messages EN CLAIR, sans rien à l'écran. Et un message en
 * clair qu'il injectait dans un fil chiffré s'affichait comme les autres.
 *
 *   ① Alice ouvre un fil chiffré : son client l'apprend ;
 *   ② le serveur « oublie » le chiffrement (`e2eeActif` remis à faux) ;
 *   ③ Alice recharge, puis écrit : le serveur ne doit JAMAIS recevoir le texte ;
 *   ④ un message en clair injecté dans le fil chiffré ne s'affiche pas ;
 *   ⑤ le serveur rattache le texte de Bob à un message d'ALICE : il ne doit
 *     ni s'afficher comme le sien, ni écraser son texte.
 *
 * Usage : node --env-file=../backend-alanya/.env scripts/e2ee-etat-memorise.mjs
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
  const email = `${prenom.toLowerCase()}.etat@e2ee.test`;
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12);
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0, appareilTotal: 3 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `ET${Math.floor(Math.random() * 1000000)}`,
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
  console.log("\n\x1b[1m════ L'ÉTAT CHIFFRÉ, MÉMORISÉ PAR LE CLIENT ════\x1b[0m");

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

  titre("① Alice ouvre un fil chiffré");
  const A = await connecter(navigateur, alice);
  const B = await connecter(navigateur, bob);
  verifie("Alice a publié une identité", await attendreCles(alice));
  verifie("Bob a publié une identité", await attendreCles(bob));
  await prisma.conversation.update({ where: { id: fil }, data: { e2eeActif: true } });
  await A.page.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  await A.page.waitForTimeout(1500);

  titre("② Le serveur « oublie » le chiffrement, Alice recharge");
  await prisma.conversation.update({ where: { id: fil }, data: { e2eeActif: false } });
  await A.page.reload({ waitUntil: "networkidle" });
  await A.page.waitForTimeout(1500);

  titre("③ Alice écrit");
  const secret = `Secret-${Date.now().toString(36)}`;
  const issue = await A.page.evaluate(async ([c, t]) => {
    const s = await import("/src/services/messages-service.ts");
    try {
      await s.sendChatMessage(c, t);
      return "envoyé";
    } catch (e) {
      return `refusé : ${e?.message ?? e}`;
    }
  }, [fil, secret]);
  await A.page.waitForTimeout(2000);
  const enClair = await prisma.message.count({ where: { convId: fil, content: secret } });
  verifie(
    "le serveur n'a reçu aucun texte en clair",
    enClair === 0,
    `${enClair} ligne(s) en clair — issue côté client : ${issue}`,
  );
  console.log(`      (issue côté client : ${issue})`);

  titre("④ Un message en clair injecté dans le fil ne s'affiche pas");
  const injecte = `Injecte-${Date.now().toString(36)}`;
  /*
   * Le serveur (qui ment toujours : e2eeActif à faux) accepte un clair « de
   * Bob » et le diffuse en temps réel à Alice. Bob n'a jamais ouvert ce fil :
   * son client apprend l'état du serveur, et le croit.
   */
  await B.page.evaluate(async ([c, t]) => {
    const s = await import("/src/services/messages-service.ts");
    await s.sendChatMessage(c, t).catch(() => undefined);
  }, [fil, injecte]);
  await A.page.waitForTimeout(1500);
  verifie(
    "témoin : le serveur a bien accepté et diffusé le clair",
    (await prisma.message.count({ where: { convId: fil, content: injecte } })) === 1,
    "sans lui, l'étape passerait sans rien prouver",
  );
  const vu = await afficheLeTexte(A.page, injecte, 5000);
  verifie(
    "Alice ne voit pas le texte injecté",
    !vu,
    "un clair injecté par le serveur s'affiche sous la bannière du chiffrement",
  );

  titre("⑤ Le serveur rattache le texte de Bob à un message d'Alice");
  /*
   * 🐛 L'IDENTIFIANT DU MESSAGE VIENT DU SERVEUR, HORS DU CHIFFRÉ. Le client
   * appliquait le texte déchiffré à n'importe quelle ligne portant cet
   * identifiant : un serveur malveillant faisait parler Alice avec les mots de
   * Bob, et écrasait au passage son vrai texte en cache.
   *
   * ⚠️ L'EXPÉDITEUR, LUI, EST AUTHENTIFIÉ : c'est sa session qui déchiffre. Il
   * suffit donc d'exiger que la ligne visée soit de lui.
   */
  // Le serveur redevient honnête sur l'état : seul le rattachement ment.
  await prisma.conversation.update({ where: { id: fil }, data: { e2eeActif: true } });
  const texteAlice = `Alice-${Date.now().toString(36)}`;
  // ⚠️ PAR `sendChatMessage`, le vrai chemin de l'écran : c'est lui qui range
  // le texte d'Alice dans SON cache — `envoyerChiffre` seul ne le fait pas, et
  // le texte n'aurait alors rien eu à protéger.
  const idAlice = await A.page.evaluate(async ([c, t]) => {
    const s = await import("/src/services/messages-service.ts");
    return (await s.sendChatMessage(c, t)).id;
  }, [fil, texteAlice]);
  await A.page.goto(`${WEB}/manifest.json`);
  const texteBob = `Bob-${Date.now().toString(36)}`;
  const idBob = await envoyer(B.page, fil, texteBob);
  const deplacees = await prisma.e2eeEnveloppe.updateMany({
    where: { messageId: idBob, destinataireId: alice.id },
    data: { messageId: idAlice },
  });
  verifie("témoin : l'enveloppe de Bob est rattachée au message d'Alice", deplacees.count >= 1, `${deplacees.count}`);
  await A.page.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  await A.page.waitForTimeout(2500);
  verifie("le vrai texte d'Alice reste affiché", await afficheLeTexte(A.page, texteAlice, 5000), "écrasé par le texte de Bob");
  verifie(
    "le texte de Bob n'apparaît pas sous le nom d'Alice",
    !(await afficheLeTexte(A.page, texteBob, 3000)),
    "le serveur a fait parler Alice avec les mots de Bob",
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
