/**
 * UN COMPTE CRÉÉ SUR LE WEB A UNE ARCHIVE CHIFFRÉE DÈS SON INSCRIPTION.
 *
 * 🔴 LE DÉFAUT QUE CE BANC ATTRAPE. L'archive chiffrée (ce qui permet de
 * changer d'appareil et de retrouver ses messages) ne s'ouvrait qu'à la
 * CONNEXION. Un compte créé par l'inscription n'en avait jamais : rien n'était
 * sauvegardé, et un autre appareil du compte affichait « indisponible sur cet
 * appareil » (signalé par le user le 29/09/2026 ; même défaut sur le mobile).
 *
 *   ① inscription SANS adresse, par l'interface, jusqu'au bout ;
 *   ② le compte doit avoir une serrure d'archive et une identité publiée.
 *
 * Usage : node --env-file=../backend-alanya/.env scripts/inscription-archive.mjs
 *         (WEB_URL pour viser une autre version du web ; défaut :5173)
 */
import { chromium } from "playwright";
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js";

const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const prisma = new PrismaClient();
let echecs = 0;

function verifie(libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`);
  if (!condition) {
    echecs++;
    if (detail !== undefined) console.log(`      \x1b[31m${detail}\x1b[0m`);
  }
}

async function main() {
  console.log(`\n\x1b[1m════ L'ARCHIVE D'UN COMPTE NEUF (${WEB}) ════\x1b[0m`);
  const nom = `Banc Inscription ${Date.now().toString(36)}`;
  const motDePasse = "Chiffre-Inscription!2026#Long";

  const navigateur = await chromium.launch({ channel: "chrome" });
  const page = await (await navigateur.newContext()).newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(String(e.message)));

  await page.goto(`${WEB}/signup`, { waitUntil: "networkidle" });
  await page.locator("#name").fill(nom);
  await page.getByRole("button", { name: "Continuer sans adresse e-mail" }).click();
  await page.locator("#pwd").fill(motDePasse);
  await page.locator("#confirm").fill(motDePasse);
  await page.locator("button.btn-submit:not(.btn-back)").click();

  /*
   * ⚠️ L'ÉCRAN DU CODE DE RÉCUPÉRATION PEUT NE PAS APPARAÎTRE : le garde des
   * pages publiques renvoie l'utilisateur connecté dès le rendu suivant (défaut
   * connu, signalé au user le 29/09/2026). On le traverse s'il est là.
   */
  const code = page.getByText("J'ai noté mon code de récupération");
  if (await code.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)) {
    await code.click();
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
  }
  await page.waitForURL((u) => u.pathname.startsWith("/chats"), { timeout: 60000 }).catch(() => {});
  // La page de restauration crée l'archive (Argon2id) avant de laisser entrer.
  await page.waitForTimeout(6000);

  const compte = await prisma.user.findFirst({ where: { nom }, select: { id: true } });
  verifie("le compte est créé", !!compte);
  if (compte) {
    const serrures = await prisma.e2eeSerrure.count({ where: { userId: compte.id } });
    verifie(
      "il a une archive (serrure « mot de passe »)",
      serrures > 0,
      "aucune archive : rien de ce qu'il écrira ne pourra être restauré ailleurs",
    );
    const identites = await prisma.e2eeIdentite.count({ where: { userId: compte.id } });
    verifie("il a publié une identité de chiffrement", identites > 0);
  }
  verifie("aucune erreur JavaScript", erreurs.length === 0, erreurs.slice(0, 3).join(" | "));

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
