/**
 * L'ÉCRAN DE SAUVEGARDE, DANS LE VRAI CHROME.
 *
 * 🔴 CE QU'AUCUN AUTRE BANC NE VOIT : ce que l'utilisateur a SOUS LES YEUX.
 * `tsc` et le build passent sur un composant qui plante au premier rendu — on
 * l'a déjà vécu sur ce projet avec un `useEffect` imbriqué, invisible aux deux.
 *
 * Il éprouve aussi la chose la plus facile à casser sans s'en rendre compte :
 * la clé de récupération s'affiche-t-elle VRAIMENT, une fois, en entier ?
 *
 * Usage : node scripts/e2ee-ecran.mjs   (backend :3000 et web :5173 démarrés)
 */

import { chromium } from "playwright";
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js";
import bcrypt from "../../backend-alanya/node_modules/bcryptjs/index.js";

const API = process.env.API_URL ?? "http://localhost:3000";
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

function titre(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

async function compte() {
  const email = "ecran@e2ee.test";
  const motDePasse = "MotDePasseDeTest!2026";
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(motDePasse, 12), emailVerified: true, typeCompte: 0 },
    create: {
      email,
      nom: "Ecran",
      passwordHash: await bcrypt.hash(motDePasse, 12),
      publicNumber: `EC${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
    },
  });
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: email,
      password: motDePasse,
      deviceId: "ecran-banc",
      typeDevice: 0,
    }),
  });
  if (!r.ok) throw new Error(`login → ${r.status} ${await r.text()}`);
  return { jeton: (await r.json()).accessToken, motDePasse };
}

async function main() {
  console.log("\n\x1b[1m════ L'ÉCRAN DE SAUVEGARDE, DANS CHROME ════\x1b[0m");

  const { motDePasse } = await compte();

  // On repart d'une archive vide.
  const u = await prisma.user.findUnique({ where: { email: "ecran@e2ee.test" } });
  await prisma.e2eeArchiveBloc.deleteMany({ where: { userId: u.id } });
  await prisma.e2eeSerrure.deleteMany({ where: { userId: u.id } });

  const navigateur = await chromium
    .launch(
      process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : { channel: "chrome" },
    )
    .catch(() => null);
  if (!navigateur) {
    console.error("\n\x1b[31m💥 Chrome introuvable.\x1b[0m\n");
    process.exit(1);
  }

  const page = await navigateur.newPage();

  /*
   * ⚠️ ON RAMASSE LES ERREURS DE LA PAGE. Un composant qui plante au rendu ne
   * fait PAS échouer la navigation : React affiche sa frontière d'erreur, et le
   * banc verrait une page « qui charge ». Sans cette écoute, le défaut le plus
   * courant passerait inaperçu.
   */
  const erreursPage = [];
  page.on("pageerror", (e) => erreursPage.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error") erreursPage.push(m.text());
  });

  /*
   * 🔴 ON SE CONNECTE PAR LE VRAI FORMULAIRE, pas en posant un jeton.
   *
   * 🐛 J'AI D'ABORD ÉCRIT LE JETON DANS `localStorage` — et l'application m'a
   * renvoyé sur `/login` sans une seule erreur. La session ne tient pas qu'à
   * ce jeton : il y a le rafraîchissement, le profil, l'état du fournisseur
   * d'authentification. Reconstituer tout cela de l'extérieur, c'est réécrire
   * la connexion — et se tromper en silence.
   *
   * ⚠️ PASSER PAR L'ÉCRAN EST AUSSI PLUS FIDÈLE : c'est le chemin que prennent
   * les gens, et il éprouve au passage que la connexion marche.
   */
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="text"], input[type="email"]').first().fill("ecran@e2ee.test");
  await page.locator('input[type="password"]').first().fill(motDePasse);
  await page.getByRole("button", { name: /^Connexion$/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  /*
   * ⚠️ LE PORTILLON DU NOM D'APPAREIL, À LA PREMIÈRE CONNEXION D'UN NAVIGATEUR.
   *
   * Ce n'est pas un défaut : l'application demande de nommer l'appareil, et
   * son voile bloque tout le reste. Un banc qui l'ignorerait échouerait sur
   * « le bouton n'est pas cliquable », ce qui envoie chercher un problème de
   * mise en page là où il n'y a qu'une étape d'accueil.
   *
   * ⚠️ ON LE FRANCHIT COMME UN UTILISATEUR — on le remplit. Le contourner en
   * base ferait diverger le banc du chemin réel.
   */
  const portillon = page.locator(".pseudo-gate-champ");
  if (await portillon.isVisible().catch(() => false)) {
    /*
     * 🐛 UN NOM UNIQUE À CHAQUE FOIS, ET C'EST UNE CORRECTION.
     *
     * Le serveur refuse deux appareils du même nom sur un compte : « Un
     * appareil de ce compte porte déjà ce nom ». Le banc passait donc la
     * PREMIÈRE fois et échouait toutes les suivantes — sur un délai d'attente
     * au clic, ce qui envoie chercher un défaut de mise en page là où il n'y
     * a qu'un nom déjà pris.
     *
     * ⚠️ UN BANC QUI NE SE REJOUE PAS EST UN BANC QU'ON CESSE DE LANCER.
     */
    await portillon.fill(`Banc ${Date.now().toString(36)}`);
    await page.locator(".pseudo-gate-valider").click();
    await page.waitForSelector(".pseudo-gate-overlay", { state: "detached", timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(1000);
  }

  /* ── ① L'ÉCRAN S'AFFICHE ─────────────────────────────────────────── */
  titre("① Le panneau se rend sans planter");

  await page.goto(`${WEB}/settings?section=security`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const titrePanneau = await page.getByText("Sauvegarde chiffrée").first().isVisible().catch(() => false);
  verifie("le panneau est visible", titrePanneau, "le composant ne se rend pas");

  const fatales = erreursPage.filter(
    (e) => !/favicon|manifest|net::ERR|Failed to load resource/i.test(e),
  );
  verifie(
    "aucune erreur JavaScript au rendu",
    fatales.length === 0,
    fatales.slice(0, 3).join(" | "),
  );

  /* ── ② ACTIVER, ET VOIR LA CLÉ ───────────────────────────────────── */
  titre("② Activer la sauvegarde, et la clé s'affiche UNE fois");

  const champ = page.locator('input[placeholder*="connectez"]').first();
  const champVisible = await champ.isVisible().catch(() => false);
  verifie("le champ de mot de passe est là", champVisible);

  if (champVisible) {
    await champ.fill(motDePasse);
    await page.getByRole("button", { name: /Activer la sauvegarde/i }).click();

    /*
     * ⚠️ ARGON2ID PREND ~750 ms DANS CHROME, plus l'aller-retour réseau. Un
     * délai d'attente trop court ferait échouer le banc pour une raison qui
     * n'est pas un défaut — et on chercherait le problème au mauvais endroit.
     */
    await page.waitForTimeout(6000);

    const cleVisible = await page
      .getByText("Votre clé de récupération")
      .first()
      .isVisible()
      .catch(() => false);
    verifie("la clé de récupération s'affiche", cleVisible, "l'utilisateur ne la verra jamais");

    if (cleVisible) {
      const mots = await page.locator(".sauv-cle-mots span").count();
      verifie("douze mots, tous affichés", mots === 12, `${mots} mot(s) à l'écran`);

      /*
       * 🔴 LE CONTRÔLE QUI COMPTE VRAIMENT : l'avertissement est-il AU-DESSUS
       * des mots ? Placé en dessous, il se lit une fois la clé recopiée —
       * c'est-à-dire trop tard pour changer le soin qu'on y a mis.
       */
      const ordre = await page.evaluate(() => {
        const avert = document.querySelector(".sauv-cle-avert");
        const mots = document.querySelector(".sauv-cle-mots");
        if (!avert || !mots) return null;
        return avert.getBoundingClientRect().top < mots.getBoundingClientRect().top;
      });
      verifie(
        "l'avertissement est AU-DESSUS des mots",
        ordre === true,
        "placé après, il se lit une fois la clé déjà recopiée",
      );
    }

    /* ── ③ L'ÉTAT APRÈS ─────────────────────────────────────────────── */
    titre("③ Une fois notée, l'écran montre les serrures posées");

    await page.getByRole("button", { name: /Je l'ai notée/i }).click();
    await page.waitForTimeout(800);

    const posees = await page.locator(".sauv-serrure.on").count();
    verifie("deux serrures marquées en place", posees === 2, `${posees}`);

    const manquante = await page.locator(".sauv-serrure:not(.on)").count();
    verifie("et celle du trousseau est annoncée absente", manquante === 1, `${manquante}`);

    /*
     * ⚠️ LA CLÉ NE DOIT PLUS ÊTRE NULLE PART. Un composant qui la garderait en
     * mémoire pour « au cas où » la rendrait récupérable par un script sur la
     * page — ce qui reviendrait à poser une serrure que personne n'a choisie.
     */
    const resteClePart = await page.evaluate(() => document.body.innerText.includes("tortue") ||
      document.body.innerText.includes("riviere"));
    verifie(
      "elle a bien disparu de l'écran",
      !resteClePart || (await page.locator(".sauv-cle").count()) === 0,
      "la clé reste affichée après avoir été notée",
    );
  }

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
