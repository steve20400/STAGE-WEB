/**
 * LE COFFRE LOCAL CHIFFRÉ.
 *
 * Trois questions, et ce sont les seules qui comptent :
 *
 *   ① le coffre rend-il ce qu'on lui a confié ?
 *   ② la clé peut-elle SORTIR ?  (elle ne doit pas)
 *   ③ ce qui est sur le disque est-il illisible sans elle ?
 *
 * Plus une quatrième, qui n'est pas de la cryptographie mais qui casserait tout
 * autant : la reprise de l'ancien coffre `localStorage` perd-elle l'identité ?
 *
 * ⚠️ NE SE LANCE PAS DIRECTEMENT — voir `scripts/e2ee-coffre.mjs`.
 */

import {
  clesSecrets,
  coffreEcrit,
  ecrireSecret,
  effacerSecret,
  lireSecret,
  ouvrirCoffre,
  viderCoffre,
} from "../src/services/coffre-chiffre";

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

/** Ouvre la base à la main, pour regarder ce qui est VRAIMENT sur le disque. */
function ouvrirBaseBrute() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open("alanya-coffre-e2ee", 1);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

function tout(magasin) {
  return new Promise((ok, ko) => {
    const r = magasin.getAll();
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

export async function scenario() {
  console.log("\n\x1b[1m════ LE COFFRE LOCAL CHIFFRÉ ════\x1b[0m");

  /* ── ① L'aller-retour ────────────────────────────────────────────── */
  titre("① Le coffre rend ce qu'on lui confie");

  await ouvrirCoffre();

  const IDENTITE = { pubKey: "cGV0aXRlLWNsZS1wdWJsaXF1ZQ==", privKey: "TE9OR1VFLUNMRS1QUklWRUU=" };
  ecrireSecret("identite", IDENTITE);
  ecrireSecret("registrationId", 4242);
  ecrireSecret("session.bob.1", "etat-du-ratchet-opaque");
  await coffreEcrit();

  verifie("l'identité revient identique", JSON.stringify(lireSecret("identite")) === JSON.stringify(IDENTITE));
  verifie("un nombre revient en nombre", lireSecret("registrationId") === 4242);
  verifie("une clé absente rend undefined", lireSecret("jamais-ecrit") === undefined);

  effacerSecret("registrationId");
  await coffreEcrit();
  verifie("l'effacement efface", lireSecret("registrationId") === undefined);

  /* ── ② La clé ne peut pas sortir ─────────────────────────────────── */
  titre("② La clé du coffre est NON EXTRACTIBLE");

  const db = await ouvrirBaseBrute();
  const cle = await new Promise((ok, ko) => {
    const r = db.transaction("cle", "readonly").objectStore("cle").get("principale");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });

  verifie("une clé est bien rangée", cle !== undefined && cle !== null);
  verifie("et elle se déclare non extractible", cle?.extractable === false, `extractable = ${cle?.extractable}`);

  /*
   * 🔴 LE CONTRÔLE QUI COMPTE VRAIMENT. `extractable: false` n'est pas une
   * convention qu'on se donne : c'est le navigateur qui REFUSE. On le lui
   * demande donc pour de bon, au lieu de croire un booléen.
   */
  let exportRefuse = false;
  try {
    await crypto.subtle.exportKey("raw", cle);
  } catch {
    exportRefuse = true;
  }
  verifie("exportKey LÈVE — la matière ne sort pas", exportRefuse, "la clé a pu être exportée");

  /* ── ③ Le disque ne porte que du chiffré ─────────────────────────── */
  titre("③ Sur le disque, rien n'est lisible");

  const enregistres = await tout(db.transaction("secrets", "readonly").objectStore("secrets"));
  const brut = JSON.stringify(enregistres, (_, v) =>
    v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? [...new Uint8Array(v.buffer ?? v)] : v,
  );

  verifie("les secrets sont bien là", enregistres.length >= 2, `${enregistres.length} entrée(s)`);
  verifie(
    "la clé privée n'apparaît NULLE PART en clair",
    !brut.includes("TE9OR1VFLUNMRS1QUklWRUU="),
    "la clé privée est lisible sur le disque",
  );
  verifie(
    "l'état du ratchet non plus",
    !brut.includes("etat-du-ratchet-opaque"),
    "l'état de session est lisible sur le disque",
  );
  verifie(
    "chaque entrée porte un IV distinct",
    new Set(enregistres.map((e) => String([...new Uint8Array(e.iv)]))).size === enregistres.length,
    "deux entrées partagent le même IV — AES-GCM s'effondre",
  );

  /*
   * ⚠️ LE NOM DE LA CLÉ, LUI, RESTE EN CLAIR — et c'est assumé : il sert
   * d'index. Qui lit le magasin apprend qu'une session existe avec `bob`, pas
   * ce qu'elle contient. Ce sont des métadonnées, comme les horodatages côté
   * serveur.
   */
  verifie("le NOM des entrées reste visible (métadonnée assumée)", brut.includes("session.bob.1"));

  db.close();

  /* ── ④ La reprise de l'ancien coffre ─────────────────────────────── */
  titre("④ La reprise de l'ancien coffre ne perd pas l'identité");

  await viderCoffre();
  localStorage.clear();

  const ANCIENNE = { pubKey: "QU5DSUVOTkUtUFVC", privKey: "QU5DSUVOTkUtUFJJVg==" };
  localStorage.setItem("alanya.e2ee.identite", JSON.stringify(ANCIENNE));
  localStorage.setItem("alanya.e2ee.registrationId", "777");
  localStorage.setItem("alanya.e2ee.deviceId", "123456789");

  await ouvrirCoffre();
  await coffreEcrit();

  verifie(
    "l'identité d'avant est reprise",
    JSON.stringify(lireSecret("identite")) === JSON.stringify(ANCIENNE),
    `reprise = ${JSON.stringify(lireSecret("identite"))}`,
  );
  verifie("le registrationId aussi", lireSecret("registrationId") === 777);
  verifie(
    "l'ancien coffre est vidé derrière",
    localStorage.getItem("alanya.e2ee.identite") === null,
    "les clés privées restent en clair dans localStorage",
  );
  verifie(
    "le deviceId RESTE en localStorage (ce n'est pas un secret)",
    localStorage.getItem("alanya.e2ee.deviceId") === "123456789",
  );
  verifie("et il n'est pas entré dans le coffre", lireSecret("deviceId") === undefined);

  /* ── ⑤ Le retrait par préfixe ────────────────────────────────────── */
  titre("⑤ Retirer toutes les sessions d'un correspondant");

  ecrireSecret("session.bob.1", "a");
  ecrireSecret("session.bob.2", "b");
  ecrireSecret("session.alice.1", "c");
  await coffreEcrit();

  for (const c of clesSecrets()) if (c.startsWith("session.bob")) effacerSecret(c);
  await coffreEcrit();

  verifie("les sessions de bob sont parties", lireSecret("session.bob.1") === undefined && lireSecret("session.bob.2") === undefined);
  verifie("celle d'alice est intacte", lireSecret("session.alice.1") === "c");

  /* ── ⑥ La déconnexion ────────────────────────────────────────────── */
  titre("⑥ Se déconnecter ne laisse rien");

  await viderCoffre();
  const db2 = await ouvrirBaseBrute();
  const restes = await tout(db2.transaction("secrets", "readonly").objectStore("secrets"));
  const cleRestante = await new Promise((ok) => {
    const r = db2.transaction("cle", "readonly").objectStore("cle").get("principale");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ok(undefined);
  });
  db2.close();

  verifie("plus aucun secret", restes.length === 0, `${restes.length} entrée(s) restante(s)`);
  verifie(
    "et la CLÉ est partie avec",
    cleRestante === undefined || cleRestante === null,
    "la clé survit à la déconnexion — ce qui traîne resterait déchiffrable",
  );

  console.log(
    `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
  );
  return echecs;
}
