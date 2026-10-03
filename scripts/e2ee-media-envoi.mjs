/**
 * LOT B — ENVOYER UN MÉDIA CHIFFRÉ DEPUIS LE WEB, PAR L'INTERFACE (chapitre 24).
 *
 *   ① Alice joint trois photos, un PDF et une vidéo par le trombone ;
 *     le serveur ne reçoit que des fichiers illisibles, sans nom ni type ;
 *   ② Alice voit ses envois sans les retélécharger ;
 *   ③ Bob voit les photos déchiffrées en grille, la carte du PDF (vrai nom,
 *     pages, première page) et la couverture de la vidéo, puis la lit ;
 *   ④ Alice recharge : ses envois se rouvrent depuis son cache.
 *
 * Usage : node --env-file=../backend-alanya/.env scripts/e2ee-media-envoi.mjs
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
function petitPdf() {
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const flux = "BT /F1 24 Tf 40 100 Td (Alanya chiffre) Tj ET";
  objets[3] = `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`;
  let corps = "%PDF-1.4\n";
  const positions = [];
  objets.forEach((o, i) => {
    positions.push(corps.length);
    corps += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = corps.length;
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const p of positions) corps += `${String(p).padStart(10, "0")} 00000 n \n`;
  corps += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(corps, "latin1");
}

/** Fabrique, dans la page, trois photos et une courte vidéo — en base64. */
async function fabriquerFichiers(page) {
  return page.evaluate(async () => {
    const enB64 = async (blob) => {
      const o = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const photos = [];
    for (const [i, c] of ["#c8895e", "#1e3a8a", "#2e7d32"].entries()) {
      const t = document.createElement("canvas");
      t.width = 400;
      t.height = 300;
      const g = t.getContext("2d");
      g.fillStyle = c;
      g.fillRect(0, 0, 400, 300);
      g.fillStyle = "#fff";
      g.font = "64px sans-serif";
      g.fillText(String(i + 1), 180, 170);
      photos.push(await enB64(await new Promise((r) => t.toBlob(r, "image/jpeg", 0.9))));
    }
    // Une vidéo d'une seconde, enregistrée depuis une toile animée.
    const t = document.createElement("canvas");
    t.width = 320;
    t.height = 240;
    const g = t.getContext("2d");
    const flux = t.captureStream(15);
    const rec = new MediaRecorder(flux, { mimeType: "video/webm" });
    const morceaux = [];
    rec.ondataavailable = (e) => morceaux.push(e.data);
    const fin = new Promise((r) => (rec.onstop = r));
    rec.start();
    let n = 0;
    const anim = setInterval(() => {
      g.fillStyle = `hsl(${(n += 20) % 360} 70% 50%)`;
      g.fillRect(0, 0, 320, 240);
    }, 60);
    await new Promise((r) => setTimeout(r, 1300));
    rec.stop();
    await fin;
    clearInterval(anim);
    return { photos, video: await enB64(new Blob(morceaux, { type: "video/webm" })) };
  });
}

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

async function main() {
  console.log("\n\x1b[1m════ LOT B — ENVOYER UN MÉDIA CHIFFRÉ DEPUIS LE WEB ════\x1b[0m");

  const alice = await compte("Alice");
  const bob = await compte("Bob");
  const fil = await filEntre(alice, bob);

  const navigateur = await chromium.launch({ channel: "chrome" });
  const A = await connecter(navigateur, alice);
  const B = await connecter(navigateur, bob);
  verifie("Alice a publié une identité", await attendreCles(alice));
  verifie("Bob a publié une identité", await attendreCles(bob));
  await prisma.conversation.update({ where: { id: fil }, data: { e2eeActif: true } });

  await A.page.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  await A.page.waitForTimeout(1500);
  const { photos, video } = await fabriquerFichiers(A.page);

  titre("① Alice envoie trois photos, un PDF et une vidéo, par l'interface");
  await envoyerParLInterface(
    A.page,
    photos.map((b, i) => ({ name: `photo${i + 1}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(b, "base64") })),
    "Trois photos",
  );
  await attendreMedias(fil, 3);
  await envoyerParLInterface(A.page, [{ name: "rapport.pdf", mimeType: "application/pdf", buffer: petitPdf() }]);
  await attendreMedias(fil, 4);
  await envoyerParLInterface(A.page, [{ name: "clip.webm", mimeType: "video/webm", buffer: Buffer.from(video, "base64") }]);
  const total = await attendreMedias(fil, 5);
  verifie("cinq fichiers téléversés, un par message", total === 5, `${total}`);

  const lignes = await prisma.mediaFile.findMany({ where: { message: { convId: fil } }, include: { message: true } });
  verifie("tous marqués chiffrés", lignes.every((l) => l.chiffre), JSON.stringify(lignes.map((l) => l.chiffre)));
  verifie(
    "aucun nom ni type réel côté serveur",
    lignes.every((l) => l.filename === "chiffre.bin" && l.mimeType === "application/octet-stream"),
  );
  verifie("aucun texte en clair dans les messages", lignes.every((l) => l.message?.content === null));
  verifie(
    "le type du message reste visible (décision : « 📷 Photo »)",
    lignes.filter((l) => l.message?.type === "IMAGE").length === 3 &&
      lignes.some((l) => l.message?.type === "FILE") &&
      lignes.some((l) => l.message?.type === "VIDEO"),
    JSON.stringify(lignes.map((l) => l.message?.type)),
  );

  titre("② Alice voit ses propres envois, sans les retélécharger");
  await A.page.waitForTimeout(1500);
  const blobsAlice = await A.page.locator('.room-body img[src^="blob:"]').count();
  verifie("ses trois photos s'affichent", blobsAlice >= 3, `${blobsAlice}`);

  titre("③ Bob ouvre le fil");
  await B.page.goto(`${WEB}/chats/${fil}`, { waitUntil: "networkidle" });
  await B.page.waitForTimeout(4000);
  const blobsBob = await B.page.locator('.room-body img[src^="blob:"]').count();
  verifie("les trois photos déchiffrées, regroupées en grille", blobsBob >= 3, `${blobsBob}`);
  verifie("la légende", await B.page.getByText("Trois photos").first().isVisible().catch(() => false));
  const doc = B.page.locator(".mc-document").first();
  verifie("le PDF : sa carte, avec son vrai nom", (await doc.innerText().catch(() => "")).includes("rapport.pdf"));
  verifie("… son nombre de pages", (await doc.innerText().catch(() => "")).includes("1 p."));
  verifie("… et sa première page en aperçu", (await B.page.locator(".mc-doc-apercu").count()) > 0);
  verifie("la vidéo : sa première image, sans téléchargement", (await B.page.locator(".mc-visuel img.mc-apercu").count()) > 0);
  verifie(
    "aucun « chiffre.bin » à l'écran (le nom neutre du serveur ne se montre pas)",
    (await B.page.getByText("chiffre.bin").count()) === 0,
  );
  const ordre = await B.page.evaluate(() => {
    const banniere = document.querySelector(".e2ee-banniere");
    const photo = document.querySelector('.room-body img[src^="blob:"]');
    if (!banniere || !photo) return "absent";
    return banniere.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING ? "avant" : "apres";
  });
  verifie("la bannière « chiffré à partir d'ici » est AVANT les photos chiffrées", ordre === "avant", ordre);
  await B.page.screenshot({ path: process.env.CAPTURE ?? "media-envoi.png" });

  await B.page.locator(".mc-visuel").filter({ has: B.page.locator(".mc-lecture") }).first().click();
  const lue = await B.page.locator("video.mc-video").first().waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
  verifie("la vidéo se déchiffre et se lit", lue);

  titre("④ Alice recharge : ses envois se rouvrent depuis son cache");
  await A.page.reload({ waitUntil: "networkidle" });
  await A.page.waitForTimeout(3000);
  verifie("toujours affichés", (await A.page.locator('.room-body img[src^="blob:"]').count()) >= 3);

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
