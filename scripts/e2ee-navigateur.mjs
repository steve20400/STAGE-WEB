/**
 * LE CHIFFREMENT DANS UN VRAI NAVIGATEUR.
 *
 * 🔴 CE BANC PROUVE CE QU'AUCUN AUTRE NE PEUT PROUVER. Les bancs précédents
 * font tourner les vrais modules, mais sous Node, avec `fake-indexeddb` et le
 * WebCrypto de Node. Deux hypothèses y restaient non vérifiées, et ce sont
 * celles sur lesquelles repose tout le coffre :
 *
 *   ① un `CryptoKey` NON EXTRACTIBLE survit-il au rangement dans IndexedDB,
 *      et reste-t-il UTILISABLE après relecture ?
 *   ② le navigateur refuse-t-il VRAIMENT de l'exporter ?
 *
 * La spécification dit oui. Une spécification n'est pas une mesure.
 *
 * ⚠️ IL NE SE SUBSTITUE À AUCUN AUTRE BANC. Il n'éprouve ni le protocole Signal
 * ni les gardes du serveur — seulement ce que le NAVIGATEUR fait, et que Node
 * ne sait pas imiter.
 *
 * Usage : node scripts/e2ee-navigateur.mjs   (client web démarré sur :5173)
 *
 * Pilote le CHROME DU POSTE — aucun navigateur n'est téléchargé. Pour en
 * viser un autre : CHROME_PATH=/chemin/vers/chrome node scripts/e2ee-navigateur.mjs
 */

import { chromium } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:5173";

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

async function main() {
  console.log("\n\x1b[1m════ LE CHIFFREMENT DANS UN VRAI NAVIGATEUR ════\x1b[0m");

  /*
   * 🔴 LE CHROME DÉJÀ INSTALLÉ, PAS UN CHROMIUM TÉLÉCHARGÉ.
   *
   * `channel: "chrome"` pilote le navigateur du poste au lieu d'en installer
   * un de plus. Trois raisons, dans cet ordre :
   *
   *   · ON TESTE CE QUE LES GENS UTILISENT. Un Chromium de développement
   *     n'est pas le Chrome stable de nos utilisateurs — et ce banc existe
   *     précisément pour mesurer ce que le navigateur fait vraiment ;
   *   · un gigaoctet de moins à télécharger et à garder ;
   *   · rien à réinstaller quand Playwright change de version.
   *
   * ⚠️ SI CHROME MANQUE, ON LE DIT AU LIEU DE TOMBER. Le message de Playwright
   * parle d'« executable doesn't exist » et envoie télécharger un navigateur,
   * ce qui n'est pas ce qu'on veut ici.
   */
  const navigateur = await chromium
    .launch(
      process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : { channel: "chrome" },
    )
    .catch((e) => {
      const premiere = String(e && e.message ? e.message : e).split(String.fromCharCode(10))[0];
      console.error(
        String.fromCharCode(10) +
          "[31m💥 Chrome introuvable sur ce poste.[0m " +
          "Installez-le, ou posez CHROME_PATH sur son executable." +
          String.fromCharCode(10) + "   (" + premiere + ")" + String.fromCharCode(10),
      );
      process.exit(1);
    });
  const page = await navigateur.newPage();

  /*
   * ⚠️ IL FAUT CHARGER UNE PAGE DE NOTRE ORIGINE avant de toucher à IndexedDB
   * ou à WebCrypto : `about:blank` n'a pas d'origine, et le navigateur refuse
   * d'y ouvrir un magasin. L'erreur qu'on obtient alors parle de « storage »,
   * pas d'origine, et envoie chercher au mauvais endroit.
   */
  const reponse = await page.goto(WEB, { waitUntil: "domcontentloaded" }).catch(() => null);
  if (!reponse) {
    console.error(
      `\n\x1b[31m💥 ${WEB} ne répond pas.\x1b[0m ` +
        "Lancez le client web (`npm run dev`) avant ce banc.\n",
    );
    await navigateur.close();
    process.exit(1);
  }

  /* ── ① LA CLÉ NON EXTRACTIBLE, DANS INDEXEDDB ────────────────────── */
  titre("① Un CryptoKey non extractible survit à IndexedDB");

  const resultat = await page.evaluate(async () => {
    const ouvrir = () =>
      new Promise((ok, ko) => {
        const r = indexedDB.open("banc-navigateur", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("cle");
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
      });
    const attendre = (req) =>
      new Promise((ok, ko) => {
        req.onsuccess = () => ok(req.result);
        req.onerror = () => ko(req.error);
      });

    const db = await ouvrir();

    const cle = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);

    // On range la clé TELLE QUELLE — c'est la manœuvre à prouver.
    await attendre(
      db.transaction("cle", "readwrite").objectStore("cle").put(cle, "principale"),
    );

    // On la relit, dans une nouvelle transaction.
    const relue = await attendre(
      db.transaction("cle", "readonly").objectStore("cle").get("principale"),
    );

    const rapport = {
      relueEstCryptoKey: relue instanceof CryptoKey,
      extractable: relue?.extractable,
      exportRefuse: false,
      chiffreEtDechiffre: false,
      messageExport: "",
    };

    try {
      await crypto.subtle.exportKey("raw", relue);
    } catch (e) {
      rapport.exportRefuse = true;
      rapport.messageExport = String(e?.name ?? e);
    }

    // Et surtout : sert-elle encore ?
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const clair = new TextEncoder().encode("secret du coffre");
      const chiffre = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, relue, clair);
      const rendu = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, relue, chiffre);
      rapport.chiffreEtDechiffre = new TextDecoder().decode(rendu) === "secret du coffre";
    } catch (e) {
      rapport.erreurUsage = String(e);
    }

    db.close();
    indexedDB.deleteDatabase("banc-navigateur");
    return rapport;
  });

  verifie("elle revient bien en CryptoKey", resultat.relueEstCryptoKey, JSON.stringify(resultat));
  verifie(
    "elle se déclare toujours non extractible",
    resultat.extractable === false,
    `extractable = ${resultat.extractable}`,
  );
  verifie(
    "le navigateur REFUSE de l'exporter",
    resultat.exportRefuse,
    "la matière de la clé est sortie — tout le coffre repose sur ce refus",
  );
  console.log(`      (${resultat.messageExport})`);
  verifie(
    "et elle chiffre et déchiffre encore APRÈS relecture",
    resultat.chiffreEtDechiffre,
    resultat.erreurUsage ?? "la clé relue ne sert plus à rien",
  );

  /* ── ② ARGON2ID DANS LE NAVIGATEUR ───────────────────────────────── */
  titre("② Argon2id tourne dans le navigateur, au bon coût");

  const argon = await page.evaluate(async () => {
    /*
     * ⚠️ CHARGÉ DEPUIS LE MODULE DE L'APPLICATION, pas depuis un CDN : c'est le
     * chemin réel — WebAssembly derrière un `import()` dynamique, servi par
     * Vite. Un banc qui irait chercher ailleurs ne dirait rien du produit.
     */
    const { argon2id } = await import("/node_modules/hash-wasm/dist/index.esm.js");
    const t0 = performance.now();
    const brut = await argon2id({
      password: "un mot de passe",
      salt: new Uint8Array(16),
      memorySize: 65536,
      iterations: 3,
      parallelism: 1,
      hashLength: 32,
      outputType: "binary",
    });
    return { ms: Math.round(performance.now() - t0), octets: brut.length };
  }).catch((e) => ({ erreur: String(e) }));

  if (argon.erreur) {
    verifie("Argon2id se charge", false, argon.erreur);
  } else {
    verifie("Argon2id rend 32 octets", argon.octets === 32, `${argon.octets}`);
    /*
     * ⚠️ ON VÉRIFIE QUE C'EST LENT, ET C'EST VOLONTAIRE. Le coût EST la
     * protection : un Argon2id qui répondrait en dix millisecondes aurait des
     * paramètres trop faibles, et l'attaque hors ligne redeviendrait possible.
     */
    verifie(
      `le coût est bien là : ${argon.ms} ms (> 100 ms attendu)`,
      argon.ms > 100,
      `${argon.ms} ms — trop rapide, les paramètres ne protègent plus`,
    );
  }

  /* ── ③ L'EMPREINTE, AU VRAI COÛT DU NAVIGATEUR ───────────────────── */
  titre("③ Le code de sécurité se calcule en un temps acceptable");

  const empreinte = await page.evaluate(async () => {
    const t0 = performance.now();
    // 5 200 itérations de SHA-512, comme `e2ee-empreinte.ts`.
    let donnee = new Uint8Array(65).buffer;
    const cle = new Uint8Array(33).buffer;
    for (let i = 0; i < 5200; i++) {
      const joint = new Uint8Array(donnee.byteLength + cle.byteLength);
      joint.set(new Uint8Array(donnee), 0);
      joint.set(new Uint8Array(cle), donnee.byteLength);
      donnee = await crypto.subtle.digest("SHA-512", joint);
    }
    return Math.round(performance.now() - t0);
  });

  verifie(
    `5 200 itérations en ${empreinte} ms — l'écran reste ouvrable`,
    empreinte < 5000,
    `${empreinte} ms : trop long pour un écran ouvert à la demande`,
  );

  await navigateur.close();

  console.log(
    `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n\x1b[31m💥 Le banc s'est arrêté :\x1b[0m", e.message);
  process.exit(1);
});
