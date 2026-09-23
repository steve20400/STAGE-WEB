/**
 * LA SAUVEGARDE, DE BOUT EN BOUT.
 *
 * 🔴 CE QUE CE BANC ÉPROUVE, ET QU'AUCUN AUTRE NE FAIT : le CHEMIN COMPLET.
 * Activer, écrire, fermer l'appareil, en reprendre un neuf, et retrouver ses
 * messages. C'est la promesse faite à l'utilisateur ; tout le reste n'en est
 * qu'une pièce.
 *
 * ⚠️ NE SE LANCE PAS DIRECTEMENT — voir `scripts/e2ee-sauvegarde.mjs`.
 */

import {
  activerSauvegarde,
  ajouterUneSerrure,
  archiver,
  estOuverte,
  lireSerrures,
  ouvrir,
  refermer,
  restaurerTout,
  suivreChangementMotDePasse,
  toutEffacer,
  vider,
} from "../src/services/e2ee-sauvegarde"

let echecs = 0

function verifie(libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`)
  if (!condition) {
    echecs++
    if (detail !== undefined) console.log(`      \x1b[31m${detail}\x1b[0m`)
  }
}

function titre(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`)
}

const MDP = "Le mot de passe du compte"

function message(n) {
  return {
    id: `msg-${n}`,
    convId: "conv-alice-bob",
    expediteurId: "alice",
    texte: `Message numéro ${n}`,
    quand: 1_700_000_000_000 + n * 1000,
  }
}

export async function scenario() {
  console.log("\n\x1b[1m════ LA SAUVEGARDE, DE BOUT EN BOUT ════\x1b[0m")

  // On repart d'une archive vide sur ce compte.
  await toutEffacer().catch(() => undefined)

  /* ── ① ACTIVER ───────────────────────────────────────────────────── */
  titre("① Activer la sauvegarde")

  const { cleRecuperation } = await activerSauvegarde({
    motDePasse: MDP,
    avecCleRecuperation: true,
  })

  verifie("l'archive est ouverte", await estOuverte())
  verifie("une clé de récupération est rendue", typeof cleRecuperation === "string")
  verifie("douze mots", cleRecuperation?.split(" ").length === 12, cleRecuperation)
  console.log(`      ${cleRecuperation}`)

  const serrures = await lireSerrures()
  verifie("deux serrures posées", serrures.length === 2, JSON.stringify(serrures.map((s) => s.type)))

  /* ── ② ÉCRIRE ────────────────────────────────────────────────────── */
  titre("② Écrire des messages, au fil de l'eau")

  for (let n = 1; n <= 7; n++) archiver(message(n))

  /*
   * ⚠️ SEPT MESSAGES : SOUS LE SEUIL DE DIX. Rien n'est encore parti — c'est
   * exactement la situation de quelqu'un qui ferme son onglet, et c'est ce que
   * `vider()` doit rattraper.
   */
  const avantVidage = await restaurerTout()
  verifie(
    "sous le seuil, rien n'est encore déposé",
    avantVidage.messages.length === 0,
    `${avantVidage.messages.length} message(s) — le tampon fuit`,
  )

  await vider()
  const apresVidage = await restaurerTout()
  verifie(
    "après `vider()`, les sept sont là",
    apresVidage.messages.length === 7,
    `${apresVidage.messages.length}`,
  )

  // Puis on dépasse le seuil : le dépôt doit partir tout seul.
  for (let n = 8; n <= 20; n++) archiver(message(n))
  await new Promise((r) => setTimeout(r, 300))
  await vider()

  const tout = await restaurerTout()
  verifie("les vingt y sont", tout.messages.length === 20, `${tout.messages.length}`)
  verifie("aucun bloc illisible", tout.blocsIllisibles === 0, `${tout.blocsIllisibles}`)
  verifie(
    "dans l'ordre chronologique",
    tout.messages.every((m, i) => i === 0 || m.quand >= tout.messages[i - 1].quand),
    "la restauration rendrait un fil dans le désordre",
  )
  verifie("et le texte est intact", tout.messages[0].texte === "Message numéro 1")

  /* ── ③ LE NOUVEL APPAREIL ────────────────────────────────────────── */
  titre("③ Un appareil NEUF, qui n'a jamais rien vu")

  /*
   * 🔴 C'EST TOUTE LA PROMESSE. On referme — plus de clé maîtresse, plus de
   * tampon, rien en mémoire. C'est l'état exact d'un navigateur qui découvre ce
   * compte : il ne connaît que le mot de passe.
   */
  refermer()
  verifie("l'archive est refermée", !(await estOuverte()))

  let perdu = null
  try {
    await restaurerTout()
  } catch (e) {
    perdu = e
  }
  verifie(
    "sans l'ouvrir, on ne restaure rien",
    perdu !== null,
    "l'archive se lit sans secret — la serrure ne sert à rien",
  )

  const mauvais = await ouvrir("motdepasse", "ce n'est pas le bon")
  verifie("un mauvais mot de passe est refusé", mauvais === false)
  verifie("et l'archive reste fermée", !(await estOuverte()))

  const bon = await ouvrir("motdepasse", MDP)
  verifie("le bon mot de passe ouvre", bon === true)

  const retrouves = await restaurerTout()
  verifie(
    "les vingt messages sont retrouvés",
    retrouves.messages.length === 20,
    `${retrouves.messages.length}`,
  )
  verifie(
    "avec leur texte",
    retrouves.messages[19].texte === "Message numéro 20",
    retrouves.messages[19]?.texte,
  )

  /* ── ④ L'AUTRE SERRURE ───────────────────────────────────────────── */
  titre("④ La clé de récupération ouvre la même archive")

  refermer()
  /*
   * ⚠️ RECOPIÉE À LA MAIN : majuscules, espaces multiples. C'est ainsi qu'elle
   * arrivera vraiment — d'un carnet, d'une photo, d'un gestionnaire de mots de
   * passe. Refuser pour cela ferait perdre l'archive sans raison de sécurité.
   */
  const sale = `  ${cleRecuperation.toUpperCase().replace(/ /g, "  ")}  `
  const parRecup = await ouvrir("recuperation", sale)
  verifie("une saisie mal recopiée ouvre quand même", parRecup === true)
  verifie(
    "et rend les mêmes vingt messages",
    (await restaurerTout()).messages.length === 20,
  )

  /* ── ⑤ AJOUTER UNE SERRURE PLUS TARD ─────────────────────────────── */
  titre("⑤ Poser une serrure des mois après")

  const NOUVEAU = "un tout nouveau secret de trousseau"
  await ajouterUneSerrure(MDP, "motdepasse", "trousseau", NOUVEAU)

  verifie("trois serrures maintenant", (await lireSerrures()).length === 3)

  refermer()
  verifie("la nouvelle ouvre l'archive", await ouvrir("trousseau", NOUVEAU))
  verifie(
    "et rend les messages écrits AVANT elle",
    (await restaurerTout()).messages.length === 20,
    "c'est tout l'intérêt de la clé maîtresse tirée au sort",
  )

  /* ── ⑥ LE CHANGEMENT DE MOT DE PASSE ─────────────────────────────── */
  titre("⑥ Changer de mot de passe n'enferme pas dehors")

  const NOUVEAU_MDP = "Le nouveau mot de passe du compte"
  const suivi = await suivreChangementMotDePasse(MDP, NOUVEAU_MDP)
  verifie("la serrure a suivi", suivi === true)

  refermer()
  verifie(
    "le NOUVEAU mot de passe ouvre",
    await ouvrir("motdepasse", NOUVEAU_MDP),
    "la sauvegarde serait devenue inaccessible en silence",
  )
  verifie(
    "et rend bien les messages",
    (await restaurerTout()).messages.length === 20,
  )

  /*
   * 🔴 LE CONTRÔLE QUI DONNE SON SENS AU PRÉCÉDENT. Si l'ANCIEN mot de passe
   * ouvrait encore, changer de mot de passe n'aurait rien changé — quelqu'un
   * qui le connaissait garderait accès à toute l'archive.
   */
  refermer()
  verifie(
    "et l'ANCIEN n'ouvre PLUS",
    (await ouvrir("motdepasse", MDP)) === false,
    "l'ancien mot de passe ouvre encore — le changement n'a rien changé",
  )

  /* ── ⑦ TOUT EFFACER ──────────────────────────────────────────────── */
  titre("⑦ Tout effacer")

  await toutEffacer()
  verifie("plus aucune serrure", (await lireSerrures()).length === 0)
  verifie("et l'archive est refermée", !(await estOuverte()))

  console.log(
    `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
  )
  return echecs
}
