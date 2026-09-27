/**
 * L'AVERTISSEMENT DE CLÉ CHANGÉE SURVIT-IL À LA FERMETURE ?
 *
 * 🔴 CE BANC EXISTE PARCE QUE L'ALERTE SE PERDAIT. Elle vivait dans un `Set`
 * en mémoire ; un rechargement de page l'effaçait, et comme `saveIdentity`
 * avait déjà rangé la nouvelle clé, PLUS RIEN ne pouvait la redétecter.
 *
 * Une substitution de clé réussie pouvait donc passer totalement inaperçue.
 *
 * ⚠️ DEUX PROPRIÉTÉS, ET IL FAUT LES DEUX. Une alerte qui se répète cesse
 * d'être lue ; une alerte qui se perd ne protège de rien. Ce banc éprouve
 * qu'on tient les deux à la fois.
 *
 * 🔴 DEUX PHASES, DANS DEUX CHARGEMENTS DE MODULE DIFFÉRENTS. C'est le cœur du
 * banc : `ouvrirCoffre()` met son ouverture en cache, donc rouvrir dans le même
 * module ne relit RIEN. C'est exactement ce que faisait l'ancien `Set` — et il
 * aurait passé un banc écrit ainsi. Seul un second chargement, sur la même base
 * IndexedDB, reproduit un rechargement de page.
 *
 * ⚠️ NE SE LANCE PAS DIRECTEMENT — voir `scripts/e2ee-cle-changee.mjs`.
 */

import { ouvrirCoffre, coffreEcrit, viderCoffre } from "../src/services/coffre-chiffre";
import {
  CoffreE2ee,
  identitesChangees,
  oublierAvertissement,
} from "../src/services/e2ee-store";

/* Deux clés d'identité distinctes : le contenu importe peu, la DIFFÉRENCE si. */
const CLE_A = new Uint8Array(33).fill(1).buffer;
const CLE_B = new Uint8Array(33).fill(2).buffer;

const BOB = "bob-uuid";
const ADRESSE = `${BOB}.1`;

function verifie(etat, libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`);
  if (!condition) {
    etat.echecs++;
    if (detail) console.log(`      ${detail}`);
  }
}

/** Avant le rechargement : on pose l'alerte. */
export async function phaseUne() {
  const etat = { echecs: 0 };
  console.log("\n🔑 L'avertissement de clé changée — phase 1 (avant rechargement)\n");

  await ouvrirCoffre();
  const magasin = new CoffreE2ee();

  /* ── ① Première rencontre : aucune alerte ────────────────────────────── */
  await magasin.saveIdentity(ADRESSE, CLE_A);
  verifie(
    etat,
    "une première clé ne déclenche AUCUNE alerte",
    !identitesChangees().includes(BOB),
    `obtenu : ${JSON.stringify(identitesChangees())}`,
  );

  /* ── ② La clé change : alerte posée, sur le COMPTE ───────────────────── */
  const change = await magasin.saveIdentity(ADRESSE, CLE_B);
  verifie(etat, "`saveIdentity` signale le changement", change === true);
  verifie(
    etat,
    "l'alerte porte le COMPTE, pas l'adresse `compte.appareil`",
    identitesChangees().includes(BOB),
    `obtenu : ${JSON.stringify(identitesChangees())}`,
  );

  /* ── ③ Deux changements sans lecture = UNE seule alerte ──────────────── */
  await magasin.saveIdentity(ADRESSE, CLE_A);
  verifie(
    etat,
    "deux changements de suite ne posent qu'UNE alerte",
    identitesChangees().filter((x) => x === BOB).length === 1,
    `obtenu : ${JSON.stringify(identitesChangees())}`,
  );

  await coffreEcrit();
  return etat.echecs;
}

/** Après le rechargement : l'alerte est-elle toujours là ? */
export async function phaseDeux() {
  const etat = { echecs: 0 };
  console.log("\n🔑 phase 2 (module rechargé, même base)\n");

  await ouvrirCoffre();

  verifie(
    etat,
    "🔴 l'alerte SURVIT au rechargement",
    identitesChangees().includes(BOB),
    "c'est précisément le défaut corrigé : elle se perdait ici",
  );

  /* ── ④ Vue une fois, plus jamais ─────────────────────────────────────── */
  oublierAvertissement(BOB);
  verifie(
    etat,
    "l'accusé de lecture la retire",
    !identitesChangees().includes(BOB),
    `obtenu : ${JSON.stringify(identitesChangees())}`,
  );
  await coffreEcrit();

  return etat.echecs;
}

/** Après un second rechargement : elle ne revient pas. */
export async function phaseTrois() {
  const etat = { echecs: 0 };
  console.log("\n🔑 phase 3 (module rechargé après l'accusé de lecture)\n");

  await ouvrirCoffre();
  verifie(
    etat,
    "elle ne revient PAS au démarrage suivant",
    !identitesChangees().includes(BOB),
    "une alerte qui se répète cesse d'être lue",
  );

  await viderCoffre();
  return etat.echecs;
}
