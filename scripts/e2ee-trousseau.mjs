/**
 * LA SERRURE « TROUSSEAU », DANS UN VRAI NAVIGATEUR.
 *
 * 🔴 CE BANC NE PEUT PAS TOURNER SOUS NODE, et c'est structurel : WebAuthn
 * n'existe que dans un navigateur, derrière une vérification d'utilisateur. Il
 * n'y a pas de bibliothèque à simuler — il y a un appareil, ou il n'y en a pas.
 *
 * ⚠️ ON UTILISE UN AUTHENTIFICATEUR VIRTUEL (protocole DevTools de Chrome). Il
 * se comporte comme un vrai : il crée une clé d'accès découvrable, il dérive un
 * secret PRF, et il rend TOUJOURS LE MÊME pour le même sel. C'est exactement la
 * propriété dont dépend la serrure, et c'est elle qu'on éprouve.
 *
 * ⚠️ CE QU'IL NE PROUVE PAS : que Face ID marche. Aucun banc automatique ne peut
 * le prouver — il faudrait un visage. Ce qu'il prouve, c'est que NOTRE code
 * demande la bonne chose et en fait le bon usage.
 *
 * Usage : node scripts/e2ee-trousseau.mjs   (backend :3000 et web :5173)
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

const EMAIL = "trousseau@e2ee.test";
const MDP = "MotDePasseDeTest!2026";

async function compte() {
  const u = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {
      passwordHash: await bcrypt.hash(MDP, 12),
      emailVerified: true,
      typeCompte: 0,
      e2eeSauvegardeRefusee: false,
    },
    create: {
      email: EMAIL,
      nom: "Trousseau",
      passwordHash: await bcrypt.hash(MDP, 12),
      publicNumber: `TR${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
    },
  });
  await prisma.e2eeArchiveBloc.deleteMany({ where: { userId: u.id } });
  await prisma.e2eeSerrure.deleteMany({ where: { userId: u.id } });
  return u;
}

async function main() {
  console.log("\n\x1b[1m════ LA SERRURE « TROUSSEAU » ════\x1b[0m");

  await compte();

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
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[e2ee]")) console.log(`      \x1b[2m${t.slice(0, 110)}\x1b[0m`);
  });

  /* ── L'AUTHENTIFICATEUR VIRTUEL ──────────────────────────────────── */
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });

  const connecter = async () => {
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
    await page.locator("input").first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(MDP);
    await page.getByRole("button", { name: /^Connexion$/i }).click();
    await page.waitForTimeout(9000);
    const g = page.locator(".pseudo-gate-champ");
    if (await g.isVisible().catch(() => false)) {
      await g.fill(`Tr ${Date.now().toString(36)}`);
      await page.locator(".pseudo-gate-valider").click();
      await page.waitForTimeout(3000);
    }
  };

  await connecter();

  /* ── ① LE NAVIGATEUR SAIT-IL FAIRE ? ─────────────────────────────── */
  titre("① Le navigateur annonce ce qu'il sait faire");

  const dispo = await page.evaluate(async () => {
    const m = await import("/src/services/e2ee-trousseau.ts");
    return m.capacites();
  });
  verifie(
    "l'extension PRF est disponible",
    dispo.disponible === true,
    `refus : ${dispo.raison}`,
  );

  /* ── ② POSER LA SERRURE ──────────────────────────────────────────── */
  titre("② Poser la serrure du trousseau");

  const pose = await page.evaluate(async (mdp) => {
    const m = await import("/src/services/e2ee-sauvegarde.ts");
    try {
      await m.ajouterTrousseau(mdp, "motdepasse");
      return { ok: true, serrures: (await m.lireCoffre()).serrures.map((s) => s.type) };
    } catch (e) {
      return { ok: false, erreur: String(e).slice(0, 160) };
    }
  }, MDP);

  verifie("la serrure est posée", pose.ok === true, pose.erreur);
  verifie(
    "elle s'ajoute aux autres",
    pose.serrures?.includes("trousseau") && pose.serrures?.includes("motdepasse"),
    JSON.stringify(pose.serrures),
  );

  /*
   * 🔴 LE CONTRÔLE QUI PORTE TOUTE LA SERRURE : le secret n'est rangé NULLE
   * PART. Il est recalculé par la clé d'accès à chaque fois. S'il apparaissait
   * dans la serrure, n'importe qui lisant la base ouvrirait l'archive.
   */
  const serrure = await prisma.e2eeSerrure.findFirst({
    where: { type: "trousseau", user: { email: EMAIL } },
  });
  verifie(
    "le serveur ne garde AUCUN secret du trousseau",
    serrure !== null &&
      !JSON.stringify(serrure).toLowerCase().includes("prf") &&
      serrure.algo === "pbkdf2-sha256",
    JSON.stringify(serrure),
  );
  verifie(
    "et une seule itération — 256 bits ne s'étirent pas",
    JSON.parse(serrure?.parametres ?? "{}").iterations === 1,
    serrure?.parametres,
  );

  /* ── ③ DÉPOSER, PUIS TOUT PERDRE ─────────────────────────────────── */
  titre("③ Écrire, puis effacer tout le local");

  /*
   * 🐛 C'EST CE VIDAGE QUI A RÉVÉLÉ LE DÉFAUT. La serrure était liée à
   * `idAppareil()`, un numéro rangé dans `localStorage` — que la déconnexion
   * purge. Au retour, le navigateur s'en attribuait un nouveau et la serrure
   * devenait introuvable, alors que la clé d'accès marchait toujours.
   *
   * ⚠️ LE BANC NE L'AVAIT PAS VU AU PREMIER JET parce qu'il vidait le local
   * APRÈS avoir ouvert l'archive. C'est en l'exécutant après le changement de
   * schéma que l'ordre réel — vider PUIS rouvrir — a fait apparaître le cas.
   */

  const depose = await page.evaluate(async () => {
    const m = await import("/src/services/e2ee-sauvegarde.ts");
    for (let i = 1; i <= 4; i++) {
      m.archiver({
        id: `tr-${i}`,
        convId: "c1",
        expediteurId: "a",
        texte: `Message ${i}`,
        quand: Date.now() + i,
      });
    }
    await m.vider();
    return (await m.restaurerTout()).messages.length;
  });
  verifie("quatre messages dans l'archive", depose === 4, `${depose}`);

  await page.evaluate(async () => {
    const m = await import("/src/services/e2ee-sauvegarde.ts");
    m.refermer();
    localStorage.clear();
    for (const n of ["alanya-coffre-e2ee", "alanya-cache"]) {
      await new Promise((ok) => {
        const r = indexedDB.deleteDatabase(n);
        r.onsuccess = r.onerror = r.onblocked = () => ok();
      });
    }
  });

  /* ── ④ ROUVRIR PAR LE SEUL TROUSSEAU ─────────────────────────────── */
  titre("④ Rouvrir SANS mot de passe ni clé de récupération");

  await connecter();

  const parTrousseau = await page.evaluate(async () => {
    const m = await import("/src/services/e2ee-sauvegarde.ts");
    m.refermer();
    const ok = await m.ouvrirParTrousseau();
    if (!ok) return { ok: false };
    return { ok: true, n: (await m.restaurerTout()).messages.length };
  });

  /*
   * 🔴 C'EST TOUTE LA PROMESSE DE CETTE SERRURE. Aucun secret tapé, aucun mot
   * noté sur un carnet : l'appareil a recalculé le secret et l'archive s'est
   * ouverte.
   */
  verifie("le trousseau seul ouvre l'archive", parTrousseau.ok === true);

  /*
   * 🔴 ET LA SERRURE SURVIT AU VIDAGE DU NAVIGATEUR. C'est la propriété qui
   * manquait : elle est liée à la clé d'accès, pas au stockage local.
   */
  const liee = await prisma.e2eeSerrure.findFirst({
    where: { type: "trousseau", user: { email: EMAIL } },
    select: { appareil: true },
  });
  verifie(
    "elle désigne la clé d'accès, pas le stockage local",
    typeof liee?.appareil === "string" && liee.appareil.length > 20,
    `appareil = ${JSON.stringify(liee?.appareil)} — un numéro court trahirait idAppareil()`,
  );
  verifie("et rend les quatre messages", parTrousseau.n === 4, `${parTrousseau.n}`);

  /* ── ⑤ SANS L'APPAREIL, RIEN ─────────────────────────────────────── */
  titre("⑤ Sans la clé d'accès, la serrure ne sert à rien");

  /*
   * ⚠️ ON RETIRE L'AUTHENTIFICATEUR — c'est l'appareil perdu, volé, ou
   * simplement un autre navigateur. La serrure « trousseau » doit alors
   * échouer, et c'est le comportement correct : c'est pour cela que la clé de
   * récupération existe.
   */
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });

  const sansAppareil = await page.evaluate(async () => {
    const m = await import("/src/services/e2ee-sauvegarde.ts");
    m.refermer();
    try {
      return { ouvert: await m.ouvrirParTrousseau() };
    } catch (e) {
      return { ouvert: false, leve: String(e).slice(0, 80) };
    }
  });
  verifie(
    "sans l'appareil, le trousseau n'ouvre PAS",
    sansAppareil.ouvert === false,
    "l'archive s'ouvre sans la clé d'accès — la serrure ne protège rien",
  );

  const autresSerrures = await page.evaluate(async () => {
    const m = await import("/src/services/e2ee-sauvegarde.ts");
    return (await m.lireCoffre()).serrures.map((s) => s.type);
  });
  verifie(
    "mais les autres serrures restent",
    autresSerrures.includes("motdepasse"),
    JSON.stringify(autresSerrures),
  );

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
