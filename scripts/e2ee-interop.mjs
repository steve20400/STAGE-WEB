/**
 * LE BANC D'INTEROPÉRABILITÉ — TICKET 4.0.
 *
 * 🔴 CELUI-CI PASSE AVANT TOUT LE RESTE DU LOT 4, et la raison tient en une
 * phrase : si les deux bibliothèques ne produisent pas le même format sur le
 * fil, ce n'est pas un défaut à corriger — c'est le choix de bibliothèque qui
 * tombe, et avec lui le calendrier du mobile.
 *
 * On le découvre en deux jours sur un fil de test, ou en trois semaines une fois
 * l'interface écrite.
 *
 * ── CE QU'IL FAIT ───────────────────────────────────────────────────
 *
 *   ① le MOBILE publie son paquet de pré-clés        (Dart)
 *   ② le WEB ouvre une session dessus et chiffre      (TypeScript)
 *   ③ le MOBILE déchiffre, et répond                  (Dart)
 *   ④ le WEB déchiffre la réponse                     (TypeScript)
 *   ⑤ les deux calculent le code de sécurité          (les deux)
 *
 * ⚠️ AUCUN APK N'EST CONSTRUIT. Le côté mobile est du Dart PUR, exécuté par la
 * machine de développement. Ce qui est prouvé, c'est le protocole ; ce qui ne
 * l'est pas, c'est l'application Flutter — interface, coffre matériel, réseau.
 *
 * Usage : node scripts/e2ee-interop.mjs
 */

import "fake-indexeddb/auto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RACINE_MOBILE = "../alanya/interop";
const DART = "C:/flutter/bin/dart.bat";
const TRAVAIL = "scripts/.interop";
const SORTIE = "scripts/.banc-interop";

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

/**
 * Appelle le côté mobile.
 *
 * ⚠️ ON PASSE PAR DES FICHIERS, pas par la sortie standard : le Dart y écrit
 * aussi ses avertissements, et mélanger les deux ferait échouer l'analyse JSON
 * pour une raison qui n'a rien à voir avec le protocole.
 */
function mobile(etape, entree) {
  const fEntree = join(TRAVAIL, `${etape}-in.json`);
  const fSortie = join(TRAVAIL, `${etape}-out.json`);
  writeFileSync(fEntree, JSON.stringify(entree ?? {}));
  /*
   * ⚠️ `shell: true` EST OBLIGATOIRE ICI. `dart` est un `.bat` sous Windows, et
   * Node refuse de lancer un script de commandes sans shell — l'erreur est un
   * `EINVAL` nu, qui ne dit pas pourquoi.
   */
  execFileSync(
    `"${DART}"`,
    ["run", "bin/mobile.dart", etape, `../../STAGE-WEB/${fEntree}`, `../../STAGE-WEB/${fSortie}`],
    { cwd: RACINE_MOBILE, stdio: ["ignore", "ignore", "inherit"], shell: true },
  );
  return JSON.parse(readFileSync(fSortie, "utf8"));
}

async function main() {
  console.log("\n\x1b[1m════ INTEROPÉRABILITÉ WEB ↔ MOBILE ════\x1b[0m");

  if (!existsSync(DART)) {
    console.error(`\n\x1b[31m💥 Dart introuvable à ${DART}\x1b[0m\n`);
    process.exit(1);
  }
  rmSync(TRAVAIL, { recursive: true, force: true });
  mkdirSync(TRAVAIL, { recursive: true });

  /* Le côté web est compilé par Vite : il importe la vraie bibliothèque. */
  rmSync(SORTIE, { recursive: true, force: true });
  console.log("\n⚙  Compilation du côté web…");
  execFileSync(
    "npx",
    ["vite", "build", "--ssr", "scripts/e2ee-interop-web.js", "--outDir", SORTIE, "--logLevel", "error"],
    { stdio: "inherit", shell: true },
  );
  const web = await import(`../${SORTIE}/e2ee-interop-web.js`);

  /* ── ① LE MOBILE PUBLIE ──────────────────────────────────────────── */
  titre("① Le MOBILE publie son paquet de pré-clés");

  const publication = mobile("publier", {});
  const bundle = publication.bundle;

  verifie("le paquet est produit", typeof bundle?.identityKey === "string");
  /*
   * 🔴 33 OCTETS, PRÉFIXÉS PAR 0x05. C'est l'encodage Curve25519 de Signal. Si
   * les deux bibliothèques divergeaient là-dessus, tout le reste échouerait —
   * mais avec un message parlant de « signature invalide », qui envoie chercher
   * au mauvais endroit.
   */
  const cleIdentite = Buffer.from(bundle.identityKey, "base64");
  verifie(
    "la clé d'identité fait 33 octets et commence par 0x05",
    cleIdentite.length === 33 && cleIdentite[0] === 0x05,
    `${cleIdentite.length} octets, premier = 0x${cleIdentite[0]?.toString(16)}`,
  );

  /* ── ② LE WEB CHIFFRE ────────────────────────────────────────────── */
  titre("② Le WEB ouvre une session sur ce paquet et chiffre");

  const MESSAGE = "Bonjour Bob, message du web vers le mobile.";
  let alice;
  try {
    alice = await web.alicePrepareEtChiffre(bundle, MESSAGE);
    verifie("le web accepte le paquet du mobile", true);
  } catch (e) {
    verifie(
      "le web accepte le paquet du mobile",
      false,
      `${String(e).slice(0, 200)} — les deux bibliothèques n'encodent pas pareil`,
    );
    throw e;
  }

  /*
   * ⚠️ TYPE 3 = `PreKeySignalMessage`. C'est le premier message d'une session,
   * celui qui porte le matériel X3DH. S'il passe, l'accord de clés est prouvé ;
   * un type 1 signifierait qu'aucune session n'a été établie.
   */
  verifie("c'est bien un message d'établissement (type 3)", alice.type === 3, `type ${alice.type}`);

  /* ── ③ LE MOBILE DÉCHIFFRE, ET RÉPOND ────────────────────────────── */
  titre("③ Le MOBILE déchiffre, et répond");

  const REPONSE = "Bien reçu Alice. Réponse du mobile vers le web.";
  let retour;
  try {
    retour = mobile("dechiffrer", {
      secret: publication.secret,
      corps: alice.corps,
      reponse: REPONSE,
    });
  } catch (e) {
    verifie("le mobile déchiffre ce que le web a produit", false, String(e).slice(0, 200));
    throw e;
  }

  /* 🔴 LA MOITIÉ DE LA PREUVE. */
  verifie(
    "le mobile lit le texte du web, à la lettre près",
    retour.clair === MESSAGE,
    JSON.stringify(retour.clair),
  );

  /* ── ④ LE WEB DÉCHIFFRE LA RÉPONSE ───────────────────────────────── */
  titre("④ Le WEB déchiffre la réponse du mobile");

  const lu = await web.aliceDechiffre(alice.chiffreur, retour.reponseCorps);

  /* 🔴 L'AUTRE MOITIÉ — et elle compte autant : un protocole qui ne marche que
     dans un sens ne marche pas. */
  verifie("le web lit la réponse du mobile", lu === REPONSE, JSON.stringify(lu));

  /* ── ⑤ LE CODE DE SÉCURITÉ ───────────────────────────────────────── */
  titre("⑤ Les deux clients affichent LE MÊME code de sécurité");

  const ID_ALICE = "alice@alanya";
  const ID_BOB = "bob@alanya";

  const cotéWeb = await web.empreinteWeb(
    alice.identiteAlice,
    ID_ALICE,
    bundle.identityKey,
    ID_BOB,
  );
  const cotéMobile = mobile("empreinte", {
    cleLocale: bundle.identityKey,
    idLocal: ID_BOB,
    cleDistante: alice.identiteAlice,
    idDistant: ID_ALICE,
  }).empreinte;

  /*
   * 🔴 LE CONTRÔLE QUI ÉVITE UN DÉFAUT DÉVASTATEUR SANS FUITE DE CLÉ.
   *
   * La bibliothèque Dart n'a pas de classe `Fingerprint` : l'algorithme est
   * réécrit à la main des deux côtés. S'ils divergent, les utilisateurs
   * comparent des codes différents pour les MÊMES clés et concluent à une
   * interposition qui n'existe pas. La confiance se perd sans qu'un seul octet
   * n'ait fuité.
   */
  verifie(
    "les deux codes sont identiques",
    cotéWeb === cotéMobile && cotéWeb.length === 60,
    `web    : ${cotéWeb}\n      mobile : ${cotéMobile}`,
  );
  console.log(`      ${cotéWeb.match(/.{5}/g)?.join(" ")}`);

  /*
   * ⚠️ ET IL NE DOIT PAS DÉPENDRE DE QUI REGARDE. Les deux moitiés sont triées :
   * Alice et Bob doivent lire la même chaîne, sinon la comparaison de vive voix
   * échoue alors que tout va bien.
   */
  const inverse = await web.empreinteWeb(bundle.identityKey, ID_BOB, alice.identiteAlice, ID_ALICE);
  verifie("et ne dépendent pas de qui regarde", inverse === cotéWeb);

  rmSync(TRAVAIL, { recursive: true, force: true });
  rmSync(SORTIE, { recursive: true, force: true });

  console.log(
    `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mLES DEUX BIBLIOTHÈQUES SE COMPRENNENT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n\x1b[31m💥 Le banc s'est arrêté :\x1b[0m", e.message);
  process.exit(1);
});
