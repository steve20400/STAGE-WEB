/**
 * LE PORTILLON « NOMMEZ CET APPAREIL » NE DOIT PAS REVENIR AU RECHARGEMENT.
 *
 * 🐛 Constaté le 28/09/2026 pendant les bancs E2EE : un navigateur déjà nommé
 * se voyait redemander son nom après un simple rechargement — et refuser le
 * même nom, « déjà porté par un autre appareil de ce compte ».
 *
 * Ce banc relève, à chaque étape, ce qui décide de l'affichage : le portillon
 * est-il là, quel identifiant d'appareil le navigateur a-t-il rangé, et
 * quelles lignes `appareils` la base connaît pour ce compte.
 *
 * Usage : node scripts/pseudo-portillon.mjs   (backend :3000 et web :5173)
 */
import { chromium } from "playwright";
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js";
import bcrypt from "../../backend-alanya/node_modules/bcryptjs/index.js";

const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const prisma = new PrismaClient();
const MDP = "MotDePasseDeTest!2026";
const EMAIL = "portillon@e2ee.test";

let echecs = 0;
function verifie(libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`);
  if (!condition) {
    echecs++;
    if (detail !== undefined) console.log(`      \x1b[31m${detail}\x1b[0m`);
  }
}

async function main() {
  console.log("\n\x1b[1m════ LE PORTILLON DU NOM D'APPAREIL ════\x1b[0m\n");
  const hash = await bcrypt.hash(MDP, 12);
  const u = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0 },
    create: {
      email: EMAIL,
      nom: "Portillon",
      passwordHash: hash,
      publicNumber: `PT${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
    },
    select: { id: true, mobile: true },
  });
  // On repart sans appareil connu : le premier chargement DOIT demander un nom.
  await prisma.appareil.deleteMany({ where: { alanyaId: u.id } });

  const navigateur = await chromium.launch({ channel: "chrome" });
  const page = await (await navigateur.newContext()).newPage();

  const etat = async (moment) => {
    const portillon = await page
      .locator(".pseudo-gate-champ")
      .waitFor({ state: "visible", timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    const cles = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => /device|appareil|pseudo/i.test(k)),
    );
    const ids = await page.evaluate((c) => c.map((k) => [k, localStorage.getItem(k)]), cles);
    const lignes = await prisma.appareil.findMany({
      where: { alanyaId: u.id },
      select: { appareilId: true, cookiesWebId: true, agent: true },
    });
    console.log(`\n  [${moment}] portillon affiché : ${portillon}`);
    console.log(`    navigateur : ${JSON.stringify(ids)}`);
    console.log(`    base       : ${JSON.stringify(lignes)}`);
    return { portillon, lignes };
  };

  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="text"], input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(MDP);
  await page.getByRole("button", { name: /^Connexion$/i }).click();
  await page.waitForURL((x) => !x.pathname.includes("/login"), { timeout: 20000 }).catch(() => {});

  const e1 = await etat("après connexion");
  verifie("le premier chargement demande un nom", e1.portillon);
  if (e1.portillon) {
    await page.locator(".pseudo-gate-champ").fill("Portable du banc");
    await page.locator(".pseudo-gate-valider").click();
    await page.waitForSelector(".pseudo-gate-overlay", { state: "detached", timeout: 15000 }).catch(() => {});
  }
  const e2 = await etat("après avoir nommé");
  verifie("le portillon se ferme une fois le nom donné", !e2.portillon);

  await page.reload({ waitUntil: "networkidle" });
  const e3 = await etat("après rechargement");
  verifie("🔴 il NE revient PAS au rechargement", !e3.portillon, "le nom vient d'être donné");
  verifie(
    "et aucune ligne d'appareil de plus n'a été créée",
    e3.lignes.length === e2.lignes.length,
    `${e2.lignes.length} ligne(s) avant, ${e3.lignes.length} après`,
  );

  /*
   * ⚠️ LE VRAI DÉFAUT : UNE PANNE RÉSEAU PRISE POUR UN NOM MANQUANT.
   *
   * Sans le nom en cache (autre navigateur, cache effacé), la page le demande
   * au serveur. `lirePseudoServeur` rendait `null` sur TOUTE erreur, et
   * `null` voulait dire « pas de nom » : un appareil nommé se voyait
   * redemander son nom à la première requête perdue — fréquent sur une liaison
   * qui perd des paquets.
   */
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("alanya-pseudo-appareil-")) localStorage.removeItem(k);
    }
  });
  await page.route("**/api/appareils/nom-agent*", (route) =>
    route.request().method() === "GET" ? route.abort("failed") : route.continue(),
  );
  await page.reload({ waitUntil: "networkidle" });
  const e4 = await etat("cache effacé, lecture du nom EN PANNE");
  verifie(
    "une panne réseau ne fait PAS redemander le nom",
    !e4.portillon,
    "l'appareil est nommé ; on ne sait simplement pas le relire",
  );
  await page.unroute("**/api/appareils/nom-agent*");

  // Témoin : sans panne et sans cache, le nom est relu du serveur, pas redemandé.
  await page.reload({ waitUntil: "networkidle" });
  const e5 = await etat("cache effacé, réseau rétabli");
  verifie("témoin : le nom est relu du serveur, sans redemander", !e5.portillon);

  await navigateur.close();
  await prisma.$disconnect();
  console.log(`\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n💥", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
