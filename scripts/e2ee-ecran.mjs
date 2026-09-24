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
  /*
   * ⚠️ ON LÈVE AUSSI LE REFUS. Depuis que la sauvegarde s'active d'elle-même,
   * effacer les serrures ne suffit plus à repartir de zéro : un refus resté
   * en base empêcherait l'activation, et le banc croirait à un défaut.
   */
  await prisma.user.update({
    where: { id: u.id },
    data: { e2eeSauvegardeRefusee: false },
  });

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

  /*
   * 🐛 ON ATTEND L'ÉTAT, PAS UNE DURÉE. Avec un simple `waitForTimeout(1500)`,
   * ce banc échouait au PREMIER lancement suivant un redémarrage du serveur de
   * développement, puis passait au second : Vite compile les modules à la
   * demande, et l'activation automatique enchaîne Argon2id (~750 ms) et un
   * aller-retour réseau. Le délai suffisait à chaud, pas à froid.
   *
   * ⚠️ UN BANC QUI ÉCHOUE UNE FOIS SUR DEUX EST UN BANC QU'ON CESSE DE CROIRE,
   * et le jour où il a raison on ne le regarde plus. On attend donc que la
   * première serrure apparaisse — l'état que le reste du banc suppose.
   */
  await page
    .locator(".sauv-serrure.on")
    .first()
    .waitFor({ state: "visible", timeout: 45_000 })
    .catch(() => {});

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

  /* ── ② ELLE EST DÉJÀ ACTIVE ──────────────────────────────────────── */
  titre("② La sauvegarde s'est installée toute seule");

  /*
   * 🔴 C'EST LE DÉFAUT DEPUIS LE 23/09/2026. L'utilisateur n'a rien fait : sa
   * sauvegarde existe déjà quand il ouvre l'écran pour la première fois. Un
   * bouton « Activer » ici serait un piège — il ferait appuyer sur quelque
   * chose qui est fait.
   */
  const posees = await page.locator(".sauv-serrure.on").count();
  verifie("une serrure est déjà en place", posees === 1, `${posees}`);

  const absentes = await page.locator(".sauv-serrure:not(.on)").count();
  verifie("et deux sont annoncées absentes", absentes === 2, `${absentes}`);

  /*
   * 🐛 `/Activer la sauvegarde/` CORRESPOND AUSSI À « DÉSACTIVER LA
   * SAUVEGARDE » — le second contient le premier. Le banc se piégeait
   * lui-même et accusait le produit.
   *
   * ⚠️ UN MOTIF DE TEST QUI N'EST PAS ANCRÉ FINIT PAR ATTRAPER AUTRE CHOSE,
   * surtout dans une langue où l'on préfixe pour nier. On ancre au début.
   */
  const boutonActiver = await page
    .getByRole("button", { name: /^Activer la sauvegarde$/i })
    .isVisible()
    .catch(() => false);
  verifie("aucun bouton « Activer » — il n'y a rien à activer", !boutonActiver);

  /* ── ③ LA CLÉ DE RÉCUPÉRATION, À LA DEMANDE ──────────────────────── */
  titre("③ Créer une clé de récupération");

  const champ = page.locator('input[placeholder*="ouvrir"]').first();
  const champVisible = await champ.isVisible().catch(() => false);
  verifie("le champ du secret est là", champVisible);

  if (champVisible) {
    await champ.fill(motDePasse);
    await page.getByRole("button", { name: /Créer une clé de récupération/i }).click();

    /*
     * ⚠️ ARGON2ID PREND ~750 ms DANS CHROME, deux fois — une pour ouvrir, une
     * pour ré-envelopper — plus les allers-retours. Un délai trop court ferait
     * échouer le banc pour une raison qui n'est pas un défaut.
     */
    await page.waitForTimeout(9000);

    const cleVisible = await page
      .getByText("Votre clé de récupération")
      .first()
      .isVisible()
      .catch(() => false);
    verifie("la clé s'affiche", cleVisible, "l'utilisateur ne la verra jamais");

    if (cleVisible) {
      const mots = await page.locator(".sauv-cle-mots span").count();
      verifie("douze mots, tous affichés", mots === 12, `${mots} mot(s)`);

      /*
       * 🔴 LE CONTRÔLE QUI COMPTE VRAIMENT : l'avertissement est-il AU-DESSUS
       * des mots ? Placé en dessous, il se lit une fois la clé recopiée —
       * c'est-à-dire trop tard pour changer le soin qu'on y a mis.
       */
      const ordre = await page.evaluate(() => {
        const a = document.querySelector(".sauv-cle-avert");
        const m = document.querySelector(".sauv-cle-mots");
        if (!a || !m) return null;
        return a.getBoundingClientRect().top < m.getBoundingClientRect().top;
      });
      verifie(
        "l'avertissement est AU-DESSUS des mots",
        ordre === true,
        "placé après, il se lit une fois la clé déjà recopiée",
      );

      await page.getByRole("button", { name: /Je l'ai notée/i }).click();
      await page.waitForTimeout(1500);

      const deux = await page.locator(".sauv-serrure.on").count();
      verifie("deux serrures maintenant", deux === 2, `${deux}`);
      verifie(
        "et la clé a disparu de l'écran",
        (await page.locator(".sauv-cle").count()) === 0,
        "la clé reste affichée après avoir été notée",
      );
    }
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
