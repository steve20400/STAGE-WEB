/**
 * LANCEUR DU BANC DES MODULES WEB.
 *
 * Il prépare l'environnement qu'un navigateur fournirait — `localStorage`, un
 * jeton d'authentification — puis fait tourner `e2ee-web-test.ts`, compilé par
 * Vite, sur DEUX coffres successifs : Alice écrit, Bob lit.
 *
 * ⚠️ DEUX COFFRES, UN SEUL PROCESSUS. Chaque « client » a son propre
 * `localStorage`, remis à neuf entre les deux : sans cela, le second reprendrait
 * l'identité du premier et l'on croirait se parler à soi-même — le piège que la
 * page `/e2ee-test` signale à qui l'ouvre dans deux onglets.
 *
 * Usage : node scripts/e2ee-web.mjs   (backend local démarré)
 */

/*
 * ⚠️ UN INDEXEDDB AVANT TOUT LE RESTE. Le coffre y vit depuis le 23/09/2026,
 * et il l'ouvre au démarrage : sans magasin, le banc ne trouverait aucune
 * identité et en génèrerait une neuve à chaque étape.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js";
// ⚠️ PRIS DANS LE BACKEND, comme Prisma juste au-dessus : ces deux-la sont des
// outils de PREPARATION du test, pas des dependances du client web. Les ajouter
// au package.json du web ferait entrer du code serveur dans le navigateur.
import bcrypt from "../../backend-alanya/node_modules/bcryptjs/index.js";

const API = "http://localhost:3000";
const SORTIE = "scripts/.banc";

/* ══════════════════ L'ENVIRONNEMENT DU NAVIGATEUR ══════════════════ */

/**
 * Un `localStorage` en mémoire.
 *
 * ⚠️ IL DOIT EXISTER AVANT LE PREMIER IMPORT du module testé : celui-ci crée son
 * coffre au chargement. Poser le mannequin après ne servirait à rien.
 */
/**
 * Le magasin IndexedDB d'un « client ».
 *
 * 🔴 SWAPPER `localStorage` NE SUFFIT PLUS. Les secrets vivent maintenant dans
 * IndexedDB, et le coffre garde une copie en mémoire dans des variables de
 * MODULE. Changer d'identité demande donc trois gestes, pas un :
 *
 *   · un `localStorage` neuf      (le deviceId, qui n'est pas un secret) ;
 *   · une `IDBFactory` neuve       (les secrets chiffrés) ;
 *   · `refermerCoffre()`           (l'état en mémoire du module).
 *
 * ⚠️ `refermerCoffre` ET NON `viderCoffre` : le second EFFACE. Bob doit
 * retrouver son coffre intact quand il revient lire, plus tard dans le banc.
 */
function poseIndexedDb(existante) {
  const fabrique = existante ?? new IDBFactory();
  globalThis.indexedDB = fabrique;
  return fabrique;
}

function poseCoffre(existant) {
  /*
   * ⚠️ `existant` PERMET DE REPRENDRE UN COFFRE DÉJÀ REMPLI, et c'est ce qui
   * rend la RÉCEPTION testable dans un seul processus : Bob publie ses clés,
   * Alice prend la main pour écrire, puis Bob récupère SON coffre pour lire.
   *
   * Sans cela, Bob reviendrait les mains vides — sans sa clé privée, sans sa
   * pré-clé — et ne déchiffrerait rien.
   */
  const d = existant ?? new Map();
  globalThis.localStorage = {
    getItem: (k) => (d.has(k) ? d.get(k) : null),
    setItem: (k, v) => d.set(k, String(v)),
    removeItem: (k) => d.delete(k),
    key: (i) => [...d.keys()][i] ?? null,
    get length() {
      return d.size;
    },
    clear: () => d.clear(),
  };
  /*
   * ⚠️ `window.localStorage` ET NON SEULEMENT LE GLOBAL NU : le client teste
   * `typeof window !== "undefined"` avant de toucher au stockage. Sans cette
   * ligne il se croit hors navigateur et n en lit jamais rien.
   */
  globalThis.window = { localStorage: globalThis.localStorage };
  return d;
}

/**
 * Le jeton que `apiRequest` ira chercher, comme dans le navigateur.
 *
 * 🐛 J AI D ABORD DEVINE TROIS NOMS DE CLE PLAUSIBLES — `sessionToken`,
 * `accessToken`, `alanya.session.token`. Aucun n etait le bon, et le banc
 * repondait « Token manquant » : un message qui parle d AUTHENTIFICATION et
 * envoie verifier la connexion, alors que le defaut etait un nom mal devine.
 *
 * La vraie cle est dans `src/data/session-auth.ts`, et il suffisait de la lire.
 */
const CLE_JETON = "alanya-session-token-v2";

function poseJeton(jeton) {
  localStorage.setItem(CLE_JETON, jeton);
}

/* ══════════════════ LES COMPTES ══════════════════ */

const prisma = new PrismaClient();

async function compte(marque) {
  const email = `web-${marque}@e2ee.test`;
  const motDePasse = "MotDePasseDeTest!2026";
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: await bcrypt.hash(motDePasse, 12), emailVerified: true },
    create: {
      email,
      nom: `Web ${marque}`,
      passwordHash: await bcrypt.hash(motDePasse, 12),
      publicNumber: `WEB${marque}${Math.floor(Math.random() * 100000)}`,
      emailVerified: true,
    },
  });
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: email,
      password: motDePasse,
      deviceId: `web-${marque}-${Date.now()}`,
      typeDevice: 0,
    }),
  });
  if (!r.ok) throw new Error(`login ${marque} → ${r.status} ${await r.text()}`);
  const { accessToken } = await r.json();
  return { user, jeton: accessToken };
}

/* ══════════════════ LE SCÉNARIO ══════════════════ */

/** Posé après le premier import : voir plus bas. */
let refermerCoffre = async () => {};

async function main() {
  console.log("\n════ BANC DES MODULES WEB RÉELS ════");

  /*
   * ⚠️ VITE COMPILE, NODE EXÉCUTE. Les modules du client lisent
   * `import.meta.env`, que Node ne connaît pas : les lancer directement
   * échouerait sur une erreur sans rapport avec le chiffrement.
   *
   * `VITE_API_BASE_URL` vise le backend LOCAL — sans elle, le client parlerait à
   * la PRODUCTION, ce qui est son défaut par défaut (`https://alanyavox.com`).
   */
  if (existsSync(SORTIE)) rmSync(SORTIE, { recursive: true, force: true });
  console.log("\n⚙  Compilation des modules web par Vite…");
  execSync(
    `npx vite build --ssr scripts/e2ee-web-test.ts --outDir ${SORTIE} --logLevel error`,
    { stdio: "inherit", env: { ...process.env, VITE_API_BASE_URL: API } },
  );

  const a = await compte("alice");
  const b = await compte("bob");

  // Une conversation commune, et un état chiffré propre.
  await prisma.e2eeEnveloppe.deleteMany({
    where: {
      OR: [
        { expediteurId: { in: [a.user.id, b.user.id] } },
        { destinataireId: { in: [a.user.id, b.user.id] } },
      ],
    },
  });
  await prisma.e2eeIdentite.deleteMany({
    where: { userId: { in: [a.user.id, b.user.id] } },
  });
  /*
   * 🐛 CE BANC CRÉAIT UNE CONVERSATION NEUVE À CHAQUE EXÉCUTION.
   *
   * Après huit essais, les comptes de test se retrouvaient avec huit fils
   * distincts vers la MÊME personne — ce que le user a vu en ouvrant
   * l'application, et qui ressemblait à un défaut du produit alors que
   * c'était le banc qui salissait sa propre base.
   *
   * ⚠️ UN BANC NE DOIT PAS LAISSER DE TRACES QUI RESSEMBLENT À DES BOGUES.
   * On réutilise donc le fil existant, et on n'en crée un que la première
   * fois.
   */
  let conv = await prisma.conversation.findFirst({
    where: {
      isGroup: false,
      AND: [
        { participants: { some: { userId: a.user.id } } },
        { participants: { some: { userId: b.user.id } } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        isGroup: false,
        participants: { create: [{ userId: a.user.id }, { userId: b.user.id }] },
      },
    });
  }

  const SECRET = "Message écrit par le VRAI module du navigateur";
  let echecs = 0;

  /* ── BOB d'abord : il doit avoir publié ses clés pour qu'Alice lui écrive ── */
  const coffreBob = poseCoffre();
  const idbBob = poseIndexedDb();
  await refermerCoffre();
  poseJeton(b.jeton);
  const modBob = await import(`../${SORTIE}/e2ee-web-test.js`);
  // ⚠️ PRIS DANS LE BUNDLE, pas dans les sources : c'est CETTE copie du
  // module qui porte l'état que le banc doit détacher.
  refermerCoffre = modBob.refermerCoffre;
  console.log("\n▸ BOB publie ses clés");
  await modBob.scenario({
    moi: b.user.id,
    autre: a.user.id,
    convId: conv.id,
    attendPrekeys: 50,
  }).catch((e) => {
    // Alice n'a pas encore de clés : l'ouverture de session vers elle échoue,
    // et c'est normal à ce stade. On ne retient que la publication.
    console.log(`  (ouverture vers Alice impossible pour l'instant : ${e.message})`);
  });

  /* ── ALICE : publie, ouvre vers Bob, chiffre, dépose ── */
  poseCoffre();
  poseIndexedDb();
  await refermerCoffre();
  poseJeton(a.jeton);
  /*
   * ⚠️ `import` REND LE MÊME MODULE la seconde fois — Node met en cache. Le
   * coffre, lui, est neuf : c'est donc bien une seconde IDENTITÉ qui travaille,
   * exactement comme un autre navigateur.
   */
  const modAlice = await import(`../${SORTIE}/e2ee-web-test.js`);
  console.log("\n▸ ALICE écrit à Bob");
  echecs += await modAlice.scenario({
    moi: a.user.id,
    autre: b.user.id,
    convId: conv.id,
    attendPrekeys: 50,
  });

  /* ── LA COUTURE DU FIL, une fois les deux cotes prets ── */
  await fetch(API + "/api/conversations/" + conv.id + "/e2ee", {
    method: "POST",
    headers: { Authorization: "Bearer " + a.jeton },
  });
  const TEXTE_FIL = "Message parti par la couture du fil";
  console.log("\n▸ ALICE envoie par la couture");
  echecs += await modAlice.scenarioFil(conv.id);

  /* ── BOB reprend SON coffre et lit ── */
  poseCoffre(coffreBob);
  poseIndexedDb(idbBob);
  await refermerCoffre();
  poseJeton(b.jeton);
  console.log("\n▸ BOB relève et déchiffre");
  echecs += await modBob.scenarioReception(SECRET);
  echecs += await modBob.scenarioFilReception(conv.id, TEXTE_FIL);

  /*
   * 🐛 LE BANC LAISSAIT SES IDENTITÉS DERRIÈRE LUI.
   *
   * Il nettoyait au DÉBUT, jamais à la fin. Les identités qu'il venait de
   * publier restaient donc en base, muettes à jamais — un vrai navigateur qui
   * se connectait ensuite sur le même compte se retrouvait avec DEUX
   * identités, et chaque message partait en deux exemplaires dont un que
   * personne ne lirait.
   *
   * ⚠️ C'EST LE PROBLÈME DES IDENTITÉS MORTES, provoqué par l'outil censé le
   * tester. Le balayage des trente jours ne les écarte pas : elles sont trop
   * récentes.
   *
   * ⚠️ ON RETIRE AUSSI LEURS ENVELOPPES EN ATTENTE : elles ne pointent vers
   * aucun appareil vivant, et resteraient à compter dans les relevés sans que
   * personne ne puisse jamais les lire.
   */
  const identites = await prisma.e2eeIdentite.findMany({
    where: { userId: { in: [a.user.id, b.user.id] } },
    select: { deviceId: true },
  });
  await prisma.e2eeEnveloppe.deleteMany({
    where: {
      remisLe: null,
      destinataireDevice: { in: identites.map((i) => i.deviceId) },
    },
  });
  await prisma.e2eeIdentite.deleteMany({
    where: { userId: { in: [a.user.id, b.user.id] } },
  });
  console.log(`\n🧹 ${identites.length} identité(s) de banc retirée(s) — rien ne traîne.`);

  console.log(
    `\n════ ${echecs === 0 ? "MODULES WEB : TOUT EST VERT" : `${echecs} ÉCHEC(S)`} ════\n`,
  );
  await prisma.$disconnect();
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n💥 Le banc web s'est arrêté :", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
