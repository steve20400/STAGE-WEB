/**
 * LE CACHE NE DOIT JAMAIS PERDRE UN TEXTE DECHIFFRE.
 *
 * On rejoue la sequence exacte du defaut du 23/09/2026 :
 *
 *   1. le clair est range apres dechiffrement ;
 *   2. la page est rafraichie → le fil relit le serveur ;
 *   3. le serveur rend `content: null` (il ne lit pas les messages chiffres) ;
 *   4. `cacheBackendMessages` ecrit cette reponse dans le cache.
 *
 * Avant correction, l'etape 4 detruisait le texte — DEFINITIVEMENT, l'enveloppe
 * ayant ete acquittee donc supprimee du serveur.
 *
 * ⚠️ ON TESTE LE VRAI MAGASIN, pas une imitation de la regle : `fake-indexeddb`
 * fournit un IndexedDB conforme a Node. Verifier la fonction de fusion toute
 * seule ne dirait rien de la transaction, qui est la partie fragile.
 *
 * ⚠️ CE FICHIER NE SE LANCE PAS DIRECTEMENT. Le dépôt importe sans extension
 * (`./schema`), ce que Vite résout et Node non. C'est le lanceur
 * `scripts/e2ee-cache.mjs` qui le compile, et qui pose `fake-indexeddb` AVANT —
 * le magasin doit exister avant le premier import.
 *
 * Usage : node scripts/e2ee-cache.mjs
 */

import {
  upsertMessage,
  saveBulkMessages,
  getMessagesByConversation,
} from "../src/indexedDB/messageRepository";

const CONV = "conv-de-test";
let echecs = 0;

function verifie(libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`);
  if (!condition) {
    echecs++;
    if (detail !== undefined) console.log(`      \x1b[31m${detail}\x1b[0m`);
  }
}

async function lis(id) {
  const tous = await getMessagesByConversation(CONV, 100);
  return tous.find((m) => m.id === id);
}

/** Ce que le serveur rend pour un message chiffre : la ligne, sans le texte. */
function ligneServeur(id, extra = {}) {
  return {
    id,
    conversationId: CONV,
    senderId: "alice",
    content: null,
    type: "TEXT",
    status: "SENT",
    createdAt: 1_700_000_000_000,
    ...extra,
  };
}

export async function scenario() {
console.log("\n\x1b[1m════ LE CACHE FACE AU RAFRAICHISSEMENT ════\x1b[0m");

/* ── ① Le cas du user ────────────────────────────────────────────────── */
console.log("\n\x1b[1m① Un texte dechiffre survit au rafraichissement\x1b[0m");

await upsertMessage({
  ...ligneServeur("m1"),
  content: "Bonjour Bob, ceci est chiffre",
});
verifie("le clair est bien range", (await lis("m1"))?.content === "Bonjour Bob, ceci est chiffre");

// Le rafraichissement : le serveur renvoie la meme ligne, sans texte.
await saveBulkMessages([ligneServeur("m1")]);
const apres = await lis("m1");
verifie(
  "il est TOUJOURS la apres relecture du serveur",
  apres?.content === "Bonjour Bob, ceci est chiffre",
  `content = ${JSON.stringify(apres?.content)}`,
);

// Et dix fois de suite, comme dix ouvertures de conversation.
for (let i = 0; i < 10; i++) await saveBulkMessages([ligneServeur("m1")]);
verifie(
  "et apres dix rafraichissements",
  (await lis("m1"))?.content === "Bonjour Bob, ceci est chiffre",
);

/* ── ② Ce que la regle ne doit PAS casser ───────────────────────────── */
console.log("\n\x1b[1m② Les mises a jour legitimes passent toujours\x1b[0m");

await upsertMessage({ ...ligneServeur("m2"), content: "premiere version" });
await saveBulkMessages([ligneServeur("m2", { content: "version modifiee", editedAt: 1 })]);
verifie(
  "un message EDITE prend bien son nouveau texte",
  (await lis("m2"))?.content === "version modifiee",
);

await upsertMessage({ ...ligneServeur("m3"), content: "a supprimer" });
await saveBulkMessages([ligneServeur("m3", { deletedAt: 1_700_000_100_000 })]);
const supprime = await lis("m3");
verifie(
  "un message SUPPRIME POUR TOUS perd bien son texte",
  !supprime?.content,
  `content = ${JSON.stringify(supprime?.content)} — le texte a ete ressuscite`,
);

await saveBulkMessages([ligneServeur("m4", { content: "message ordinaire" })]);
verifie(
  "un message ordinaire s'ecrit normalement",
  (await lis("m4"))?.content === "message ordinaire",
);

await upsertMessage({ ...ligneServeur("m5"), content: null });
await saveBulkMessages([ligneServeur("m5")]);
verifie("un message sans texte des le depart ne casse rien", (await lis("m5"))?.id === "m5");

/* ── ③ Les metadonnees restent fraiches ─────────────────────────────── */
console.log("\n\x1b[1m③ Seul le CONTENU est preserve, pas le reste\x1b[0m");

await upsertMessage({ ...ligneServeur("m6"), content: "texte chiffre", status: "SENT" });
await saveBulkMessages([ligneServeur("m6", { status: "READ" })]);
const m6 = await lis("m6");
verifie("le statut suit le serveur", m6?.status === "READ", `status = ${m6?.status}`);
verifie("le texte, lui, est garde", m6?.content === "texte chiffre");

console.log(
  `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ECHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
);
return echecs;
}
