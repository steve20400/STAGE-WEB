/**
 * ENVOI EN MORCEAUX — UN MÉDIA CHIFFRÉ PAR LE VRAI CODE DU MOBILE, PUBLIÉ PAR
 * LE SERVEUR, OUVERT PAR LE WEB (cours, chapitre 44).
 *
 * Orchestre `alanya/test/interop_media_morceaux_reel_test.dart` : le mobile
 * chiffre une photo de fichier à fichier, réserve l'envoi, prépare et
 * PROGRAMME le message, puis pousse les morceaux — et ne poste JAMAIS le
 * message lui-même. Le serveur le publie au dernier morceau ; Bob, dans un
 * vrai navigateur, doit voir la photo déchiffrée.
 *
 * La photo est suivie de 2,5 Mo d'octets quelconques (les décodeurs PNG
 * s'arrêtent à IEND) : trois morceaux au moins.
 *
 * Usage : node --env-file=../backend-alanya/.env scripts/e2ee-media-morceaux-mobile.mjs
 *         (backend :3000, WebSocket :3001 et web :5173 démarrés)
 */
import { chromium } from "playwright";
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js";
import bcrypt from "../../backend-alanya/node_modules/bcryptjs/index.js";

const API = process.env.API_URL ?? "http://localhost:3000";
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


/** Un PNG 40 × 30 d'un dégradé, encodé à la main (zlib). */
async function petitPng(chemin) {
  const { deflateSync } = await import("node:zlib");
  const { writeFileSync } = await import("node:fs");
  const L = 40, H = 30;
  const brut = Buffer.alloc((L * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    brut[y * (L * 3 + 1)] = 0;
    for (let x = 0; x < L; x++) {
      const o = y * (L * 3 + 1) + 1 + x * 3;
      brut[o] = 200; brut[o + 1] = Math.round((x / L) * 255); brut[o + 2] = Math.round((y / H) * 255);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => { let c = 0xffffffff; for (const o of b) c = crcTable[(c ^ o) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const bloc = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(L, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(chemin, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloc("IHDR", ihdr), bloc("IDAT", deflateSync(brut)), bloc("IEND", Buffer.alloc(0)),
  ]));
}

async function main() {
  console.log("\n\x1b[1m════ ENVOI EN MORCEAUX — LE MOBILE ENVOIE, LE SERVEUR PUBLIE, LE WEB OUVRE ════\x1b[0m");
  const { spawn } = await import("node:child_process");
  const { rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const alice = await compte("Alice"); // le téléphone
  const bob = await compte("Bob"); // le navigateur
  const fil = await filEntre(alice, bob);
  await prisma.conversation.update({ where: { id: fil }, data: { e2eeActif: true } });
  await prisma.e2eeIdentite.deleteMany({ where: { userId: alice.id } });

  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: alice.email, password: MOT_DE_PASSE, deviceId: "banc-media-mobile-alice", typeDevice: 1 }),
  });
  const jeton = (await r.json()).accessToken;
  verifie("Alice (mobile) est connectée", Boolean(jeton));

  const navigateur = await chromium.launch({ channel: "chrome" });
  const B = await connecter(navigateur, bob);
  verifie("Bob (web) a publié une identité", await attendreCles(bob));

  const png = join(tmpdir(), `alanya-banc-${Date.now()}.png`);
  await petitPng(png);
  {
    const { appendFileSync } = await import("node:fs");
    const { randomBytes } = await import("node:crypto");
    appendFileSync(png, randomBytes(2.5 * 1024 * 1024));
  }

  titre("① le vrai code du mobile chiffre, réserve, programme et pousse les morceaux");
  let sortie = "";
  const flutter = spawn("flutter", ["test", "test/interop_media_morceaux_reel_test.dart", "--reporter", "expanded"], {
    cwd: "../alanya",
    shell: true,
    env: {
      ...process.env,
      E2EE_API: API,
      E2EE_JETON: jeton,
      E2EE_MOI: alice.id,
      E2EE_PAIR: bob.id,
      E2EE_CONV: fil,
      E2EE_PNG: png,
      E2EE_LEGENDE: "Du téléphone",
    },
  });
  flutter.stdout.on("data", (b) => (sortie += b));
  flutter.stderr.on("data", (b) => (sortie += b));
  const code = await new Promise((ok) => flutter.on("close", ok));
  for (const l of sortie.split("\n")) if (/\[mobile\]|Expected|Actual|passed|failed|Exception/.test(l)) console.log("    " + l.trim());
  verifie("le test du mobile passe", code === 0, `code ${code}`);
  // En cas d'échec, la fin de la sortie du test : sans elle, on ne sait pas où chercher.
  if (code !== 0) for (const l of sortie.split("\n").slice(-40)) console.log("      | " + l.trimEnd());
  rmSync(png, { force: true });

  const media = await prisma.mediaFile.findFirst({ where: { message: { convId: fil } } });
  verifie("le serveur ne garde qu'un fichier chiffré, sans nom ni type", media?.chiffre === true && media?.filename === "chiffre.bin");
  const envoi = media ? await prisma.envoiMorceaux.findUnique({ where: { id: media.id } }) : null;
  verifie("le média porte l'identifiant de l'envoi en morceaux", Boolean(envoi), media?.id);
  const recus = envoi ? await prisma.envoiMorceauRecu.count({ where: { envoiId: envoi.id } }) : 0;
  verifie("… en plusieurs morceaux, tous reçus", envoi?.nbMorceaux >= 3 && recus === envoi?.nbMorceaux, `${recus} / ${envoi?.nbMorceaux}`);
  verifie("… et c'est le SERVEUR qui a publié le message", envoi?.statut === "termine" && envoi?.publicationEtat === "publie" && Boolean(envoi?.messageId), `${envoi?.statut} / ${envoi?.publicationEtat}`);
  const message = envoi?.messageId ? await prisma.message.findUnique({ where: { id: envoi.messageId } }) : null;
  verifie("le message est d'Alice, dans le bon fil, sans texte en clair", message?.senderId === alice.id && message?.convId === fil && !message?.content);
  verifie("l'enveloppe de Bob est rattachée au message", (await prisma.e2eeEnveloppe.count({ where: { messageId: envoi?.messageId ?? "00000000-0000-0000-0000-000000000000", destinataireId: bob.id } })) >= 1);

  titre("② Bob, sur le web, l'ouvre");
  await B.page.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  const nette = B.page.locator(".mc-net").first();
  const vue = await nette.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
  verifie("Bob voit la photo déchiffrée", vue);
  verifie("… à sa vraie taille (40 px)", vue && (await nette.evaluate((i) => i.naturalWidth)) === 40);
  verifie("… avec sa légende", await B.page.getByText("Du téléphone").first().isVisible().catch(() => false));

  verifie("aucune erreur JavaScript", B.erreurs.length === 0, B.erreurs.slice(0, 3).join(" | "));
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
