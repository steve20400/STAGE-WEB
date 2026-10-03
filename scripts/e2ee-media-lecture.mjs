/**
 * LOT A — UN MÉDIA CHIFFRÉ SE LIT SUR LE WEB (cours, chapitre 23).
 *
 *   ① Alice envoie une photo chiffrée (fonctions du lot A, sans interface),
 *     et une seconde dont le fichier ne correspond pas à l'empreinte ;
 *   ② Bob voit la première déchiffrée, à sa taille, avec sa légende ; la
 *     seconde est REFUSÉE et c'est dit ;
 *   ③ après rechargement — enveloppe consommée —, la photo se rouvre depuis
 *     le cache local ;
 *   ④ le cache porte la clé.
 *   Le serveur, lui, ne stocke qu'un fichier illisible, sans nom ni type.
 *
 * Usage : node --env-file=../backend-alanya/.env scripts/e2ee-media-lecture.mjs
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
  const email = `${prenom.toLowerCase()}.media@e2ee.test`;
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

/**
 * Envoie un média chiffré par le VRAI code du client (les fonctions du lot A),
 * dans l'instance déjà chargée de la page d'Alice. Le bouton d'envoi viendra au
 * lot B ; ici on fabrique exactement ce qu'il produira.
 *
 * `falsifier` : le descripteur annonce une empreinte qui n'est PAS celle du
 * fichier déposé — ce que verrait le destinataire si le serveur remplaçait le
 * fichier.
 */
async function envoyerPhoto(page, convId, destId, legende, falsifier = false) {
  return page.evaluate(
    async ([c, dest, leg, faux]) => {
      const media = await import("/src/services/e2ee-media.ts");
      const service = await import("/src/services/e2ee-service.ts");
      const { apiRequest } = await import("/src/lib/api-client.ts");

      // Une vraie image : 320 × 200, un dégradé.
      const toile = document.createElement("canvas");
      toile.width = 320;
      toile.height = 200;
      const g = toile.getContext("2d");
      const d = g.createLinearGradient(0, 0, 320, 200);
      d.addColorStop(0, "#c8895e");
      d.addColorStop(1, "#1e3a8a");
      g.fillStyle = d;
      g.fillRect(0, 0, 320, 200);
      const png = new Uint8Array(await (await new Promise((r) => toile.toBlob(r, "image/png"))).arrayBuffer());
      const petite = document.createElement("canvas");
      petite.width = 16;
      petite.height = 10;
      petite.getContext("2d").drawImage(toile, 0, 0, 16, 10);
      const apercu = petite.toDataURL("image/jpeg", 0.6).split(",")[1];

      const f = await media.chiffrerFichier(png);
      const form = new FormData();
      form.append("file", new Blob([f.chiffre], { type: "application/octet-stream" }), "chiffre.bin");
      form.append("chiffre", "1");
      const up = await apiRequest("/api/media", { method: "POST", body: form });
      const msg = await apiRequest(`/api/conversations/${c}/messages`, {
        method: "POST",
        body: { type: "IMAGE", chiffre: true, mediaIds: [up.id] },
      });
      const autre = faux ? (await media.chiffrerFichier(new Uint8Array([1, 2, 3]))).empreinte : null;
      const descr = {
        id: up.id,
        cle: f.cle,
        empreinte: autre ?? f.empreinte,
        taille: png.length,
        mime: "image/png",
        nom: "degrade.png",
        largeur: 320,
        hauteur: 200,
        apercu,
      };
      const devices = await service.ouvrirSessions(dest);
      const env = await service.chiffrerPour(dest, devices, media.ecrireCharge(msg.id, leg, descr));
      await service.deposer(c, env, msg.id);
      return { id: msg.id, mediaId: up.id, debut: Array.from(f.chiffre.slice(0, 8)) };
    },
    [convId, destId, legende, falsifier],
  );
}

async function main() {
  console.log("\n\x1b[1m════ LOT A — LIRE UN MÉDIA CHIFFRÉ ════\x1b[0m");

  const alice = await compte("Alice");
  const bob = await compte("Bob");
  const fil = await filEntre(alice, bob);

  const navigateur = await chromium.launch({ channel: "chrome" });
  const A = await connecter(navigateur, alice);
  const B = await connecter(navigateur, bob);
  verifie("Alice a publié une identité", await attendreCles(alice));
  verifie("Bob a publié une identité", await attendreCles(bob));
  await prisma.conversation.update({ where: { id: fil }, data: { e2eeActif: true } });

  titre("① Alice envoie une photo chiffrée, et une photo dont le fichier a été « remplacé »");
  const bonne = await envoyerPhoto(A.page, fil, bob.id, "Coucher de soleil");
  const fausse = await envoyerPhoto(A.page, fil, bob.id, "Photo trafiquée", true);

  const ligne = await prisma.mediaFile.findUnique({ where: { id: bonne.mediaId } });
  verifie("le serveur marque le fichier chiffré", ligne?.chiffre === true);
  verifie("… sans en connaître ni le nom ni le type", ligne?.filename === "chiffre.bin" && ligne?.mimeType === "application/octet-stream", `${ligne?.filename} ${ligne?.mimeType}`);
  const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
  verifie("ce qu'il stocke n'est PAS un PNG", !PNG.every((o, i) => o === bonne.debut[i]));
  const msg = await prisma.message.findUnique({ where: { id: bonne.id } });
  verifie("le message ne porte aucun texte en clair", msg?.content === null && msg?.type === "IMAGE");

  titre("② Bob ouvre le fil");
  await B.page.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  const nette = B.page.locator(".mc-net").first();
  const vue = await nette.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
  verifie("Bob voit la photo déchiffrée", vue);
  const largeur = vue ? await nette.evaluate((i) => i.naturalWidth) : 0;
  verifie("… à sa vraie taille (320 px)", largeur === 320, `largeur : ${largeur}`);
  verifie("Bob voit la légende", await B.page.getByText("Coucher de soleil").first().isVisible().catch(() => false));
  const altere = await B.page.locator(".mc-erreur").filter({ hasText: /altér/i }).first()
    .waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
  verifie("la photo au fichier remplacé est REFUSÉE, et c'est dit", altere);
  await B.page.screenshot({ path: process.env.CAPTURE ?? "media-chiffre.png" });

  titre("③ Bob recharge la page : l'enveloppe est consommée, le cache doit suffire");
  await B.page.reload({ waitUntil: "networkidle" });
  const encore = await B.page.locator(".mc-net").first().waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
  verifie("la photo se rouvre depuis le cache local (clé gardée)", encore);

  titre("④ l'archive de Bob a gardé la clé");
  const archive = await B.page.evaluate(async (id) => {
    const db = await (await import("/src/indexedDB/schema.js")).initIndexedDB();
    const l = await db.get("messages", id);
    return { cle: Boolean(l?.mediaChiffre?.cle), type: l?.type };
  }, bonne.id);
  verifie("le cache local porte le descripteur (clé comprise)", archive.cle && archive.type === "IMAGE", JSON.stringify(archive));

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
