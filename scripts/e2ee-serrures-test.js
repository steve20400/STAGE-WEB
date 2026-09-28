/**
 * LES TROIS SERRURES, ET LE FORMAT D'ARCHIVE.
 *
 * ⚠️ NE SE LANCE PAS DIRECTEMENT — voir `scripts/e2ee-serrures.mjs`.
 */

import {
  ajouterSerrure,
  creerArchive,
  normaliserCleRecuperation,
  ouvrirArchive,
  tirerCleRecuperation,
} from "../src/services/e2ee-serrures"
import { chiffrerBloc, dechiffrerBloc, restaurer } from "../src/services/e2ee-archive"
import { MOTS_RECUPERATION } from "../src/services/mots-recuperation"

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

async function leve(fn) {
  try {
    await fn()
    return false
  } catch {
    return true
  }
}

const MESSAGES = [
  { id: "m1", convId: "c1", expediteurId: "alice", texte: "Bonjour Bob", quand: 1_700_000_000_000 },
  { id: "m2", convId: "c1", expediteurId: "bob", texte: "Salut Alice", quand: 1_700_000_060_000 },
]

export async function scenario() {
  console.log("\n\x1b[1m════ LES SERRURES DE L'ARCHIVE ════\x1b[0m")

  /* ── ① TROIS SERRURES, UNE SEULE PORTE ───────────────────────────── */
  titre("① Trois serrures ouvrent la même archive")

  const MDP = "Un mot de passe d'utilisateur"
  const TROUSSEAU = "secret-de-256-bits-venu-du-systeme"
  const RECUP = tirerCleRecuperation()

  const { maitresse, serrures } = await creerArchive({
    motdepasse: MDP,
    trousseau: TROUSSEAU,
    recuperation: RECUP,
  })

  verifie("trois serrures posées", serrures.length === 3, `${serrures.length}`)

  const bloc = await chiffrerBloc(maitresse, MESSAGES)

  for (const type of ["motdepasse", "trousseau", "recuperation"]) {
    const serrure = serrures.find((s) => s.type === type)
    const secret = type === "motdepasse" ? MDP : type === "trousseau" ? TROUSSEAU : RECUP
    const cle = await ouvrirArchive(secret, serrure)
    const relus = await dechiffrerBloc(cle, bloc)
    verifie(
      `« ${type} » ouvre et rend le texte`,
      relus.length === 2 && relus[0].texte === "Bonjour Bob",
      JSON.stringify(relus),
    )
  }

  /* ── ② UN MAUVAIS SECRET NE PASSE PAS ────────────────────────────── */
  titre("② Un mauvais secret échoue — c'est AES-GCM qui le dit")

  const sMdp = serrures.find((s) => s.type === "motdepasse")
  verifie(
    "un mot de passe faux fait échouer l'ouverture",
    await leve(() => ouvrirArchive("mauvais mot de passe", sMdp)),
    "une archive s'est ouverte avec le mauvais secret",
  )

  /*
   * ⚠️ PAS DE VÉRIFICATEUR RANGÉ À CÔTÉ. On contrôle ici qu'AUCUN champ de la
   * serrure ne permet de tester un secret sans passer par le déchiffrement :
   * sel, iv et itérations sont publics par nature, la clé enveloppée est le
   * seul secret, et elle est authentifiée.
   */
  verifie(
    "la serrure ne porte aucun haché de vérification",
    Object.keys(sMdp).sort().join(",") === "algo,cleEnveloppee,iv,parametres,sel,type",
    `champs : ${Object.keys(sMdp).join(", ")}`,
  )

  /* ── ③ LE COÛT DÉPEND DE L'ENTROPIE DU SECRET ────────────────────── */
  titre("③ Le nombre d'itérations suit le SECRET, pas une constante")

  const parType = Object.fromEntries(serrures.map((s) => [s.type, s]))
  verifie(
    "mot de passe : Argon2id — mémoire-dur, résiste aux cartes graphiques",
    parType.motdepasse.algo === "argon2id",
    parType.motdepasse.algo,
  )
  verifie(
    "et 64 Mio par essai : c'est CE coût qui protège",
    JSON.parse(parType.motdepasse.parametres).memoireKio === 65536,
    parType.motdepasse.parametres,
  )
  verifie(
    "trousseau : une seule itération — 256 bits ne s'étirent pas",
    JSON.parse(parType.trousseau.parametres).iterations === 1,
  )
  verifie(
    "clé de récupération : idem",
    JSON.parse(parType.recuperation.parametres).iterations === 1,
  )
  verifie(
    "et chaque serrure PORTE ses paramètres",
    serrures.every((s) => typeof s.algo === "string" && typeof s.parametres === "string"),
    "sans eux, durcir les réglages un jour rendrait illisibles les serrures existantes",
  )

  /* ── ④ CHAQUE SERRURE A SON PROPRE IV ────────────────────────────── */
  titre("④ Aucun IV, aucun sel n'est réutilisé")

  verifie("trois IV distincts", new Set(serrures.map((s) => s.iv)).size === 3)
  verifie("trois sels distincts", new Set(serrures.map((s) => s.sel)).size === 3)

  const bloc2 = await chiffrerBloc(maitresse, MESSAGES)
  verifie("deux blocs du même contenu ont des IV différents", bloc.iv !== bloc2.iv)
  verifie(
    "et donc des chiffrés différents",
    bloc.contenu !== bloc2.contenu,
    "un IV réutilisé — AES-GCM s'effondre",
  )

  /* ── ⑤ AJOUTER UNE SERRURE PLUS TARD ─────────────────────────────── */
  titre("⑤ Poser une serrure des mois après, sans rien rechiffrer")

  const seul = await creerArchive({ trousseau: TROUSSEAU })
  const blocAvant = await chiffrerBloc(seul.maitresse, MESSAGES)

  const NOUVEAU_MDP = "le mot de passe ajouté plus tard"
  const ajoutee = await ajouterSerrure(
    TROUSSEAU,
    seul.serrures[0],
    "motdepasse",
    NOUVEAU_MDP,
  )

  const parNouvelle = await ouvrirArchive(NOUVEAU_MDP, ajoutee)
  const relus = await dechiffrerBloc(parNouvelle, blocAvant)
  verifie(
    "la nouvelle serrure ouvre les blocs écrits AVANT elle",
    relus.length === 2 && relus[1].texte === "Salut Alice",
    "c'est tout l'intérêt de la clé maîtresse tirée au sort",
  )

  verifie(
    "l'ancienne serrure marche toujours",
    (await dechiffrerBloc(await ouvrirArchive(TROUSSEAU, seul.serrures[0]), blocAvant)).length === 2,
  )

  verifie(
    "on ne peut PAS ajouter une serrure sans savoir ouvrir",
    await leve(() => ajouterSerrure("mauvais", seul.serrures[0], "recuperation", "x")),
    "n'importe qui pourrait se poser une serrure sur l'archive d'autrui",
  )

  /* ── ⑥ LA CLÉ DE RÉCUPÉRATION ────────────────────────────────────── */
  titre("⑥ La clé de récupération, telle qu'on la recopie")

  const mots = RECUP.split(" ")
  verifie("douze mots", mots.length === 12, RECUP)
  verifie("aucun accent ni caractère ambigu", /^[a-z ]+$/.test(RECUP), RECUP)
  console.log(`      ${RECUP}`)

  /*
   * ⚠️ RECOPIÉE À LA MAIN : majuscules involontaires, espaces en trop, retour
   * à la ligne collé depuis un carnet. Refuser pour cela reviendrait à perdre
   * l'archive pour une raison qui n'a rien à voir avec la sécurité.
   */
  const saisieSale = `  ${RECUP.toUpperCase().replace(/ /g, "   ")}\n`
  const serrureRecup = serrures.find((s) => s.type === "recuperation")
  const parRecup = await ouvrirArchive(normaliserCleRecuperation(saisieSale), serrureRecup)
  verifie(
    "une saisie en majuscules, mal espacée, ouvre quand même",
    (await dechiffrerBloc(parRecup, bloc)).length === 2,
  )

  /*
   * 🐛 12 MOTS PARMI 32 = 60 BITS, sans étirement. La liste passe à 2 048 mots
   * (BIP39 français sans accents) : 132 bits pour la même chose à recopier.
   */
  verifie(
    "la liste compte 2 048 mots distincts (11 bits chacun)",
    MOTS_RECUPERATION.length === 2048 && new Set(MOTS_RECUPERATION).size === 2048,
    `${MOTS_RECUPERATION.length} mots, ${new Set(MOTS_RECUPERATION).size} distincts`,
  )
  const liste = new Set(MOTS_RECUPERATION)
  const tirages = Array.from({ length: 200 }, () => tirerCleRecuperation().split(" "))
  verifie(
    "chaque mot tiré vient de la liste",
    tirages.every((t) => t.length === 12 && t.every((m) => liste.has(m))),
  )
  const distincts = new Set(tirages.flat()).size
  verifie(
    "et les tirages couvrent bien plus que 32 mots",
    distincts > 1000,
    `${distincts} mots distincts sur 2 400 tirés — la liste de 32 est-elle encore branchée ?`,
  )

  /*
   * ⚠️ UNE CLÉ À L'ANCIEN FORMAT S'OUVRE TOUJOURS : la serrure dérive sa clé du
   * TEXTE, pas d'une position dans une liste. Des clés de 32 mots ont été
   * distribuées ; changer de liste ne doit pas les rendre inutilisables.
   */
  const ANCIENNE = "tortue riviere lampe cousin fenetre orage sable guitare renard marbre pluie cerise"
  const { serrures: sAnc } = await creerArchive({ recuperation: ANCIENNE })
  verifie(
    "une clé de l'ancienne liste ouvre toujours sa serrure",
    (await ouvrirArchive(ANCIENNE, sAnc[0])) !== undefined,
  )
  verifie(
    "une saisie avec accents est ramenée à la forme de la liste",
    normaliserCleRecuperation("  Abîme  ÉLÈVE ") === "abime eleve",
    normaliserCleRecuperation("  Abîme  ÉLÈVE "),
  )

  /* ── ⑦ LE FORMAT SE DÉFEND DANS LE TEMPS ─────────────────────────── */
  titre("⑦ Le format porte sa version, et s'arrête s'il ne la comprend pas")

  const futur = await chiffrerBloc(maitresse, MESSAGES)
  // On fabrique un bloc « venu du futur » en réécrivant sa charge.
  const ivFutur = crypto.getRandomValues(new Uint8Array(12))
  const chiffreFutur = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivFutur },
    maitresse,
    new TextEncoder().encode(JSON.stringify({ v: 99, messages: MESSAGES })),
  )
  const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))

  verifie(
    "un bloc d'une version inconnue est REFUSÉ, pas deviné",
    await leve(() =>
      dechiffrerBloc(maitresse, { iv: b64(ivFutur.buffer), contenu: b64(chiffreFutur) }),
    ),
    "un client ancien rendrait des messages tronqués sans le dire",
  )
  verifie("et un bloc de la version courante passe", (await dechiffrerBloc(maitresse, futur)).length === 2)

  /* ── ⑧ CE QUI SORT DE L'APPAREIL ─────────────────────────────────── */
  titre("⑧ Ce que le serveur recevrait")

  const dehors = JSON.stringify({ serrures, bloc })
  verifie("aucun texte de message n'apparaît", !dehors.includes("Bonjour Bob"))
  verifie("ni le mot de passe", !dehors.includes(MDP))
  verifie("ni la clé de récupération", !dehors.includes(RECUP))
  verifie("ni le secret du trousseau", !dehors.includes(TROUSSEAU))

  /* ── ⑨ LE SERVEUR NE CHOISIT PAS LA DÉRIVATION ──────────────────── */
  titre("⑨ Le serveur ne choisit pas la fonction de dérivation")

  /*
   * 🔴 `algo` ET `parametres` ARRIVENT DU SERVEUR. Ils sont écrits par nous à
   * la pose, mais relus à l'ouverture — et une base modifiée peut donc dicter
   * au navigateur la fonction qu'il va exécuter.
   *
   * ⚠️ LE DANGER N'EST PAS LA DIVULGATION mais le déni de service (demander
   * quatre gigaoctets à Argon2id) et le déclassement à venir. On refuse tout
   * ce qui n'est pas exactement ce qu'on aurait écrit.
   */
  /*
   * ⚠️ UNE ARCHIVE NEUVE, ET NON `serrures` : à ce stade du banc, ce tableau a
   * déjà servi à des scénarios qui l'ont modifié. Repartir de lui faisait
   * échouer l'ouverture pour une raison SANS RAPPORT avec ce qu'on éprouve —
   * et les trois refus auraient été comptés justes pour une mauvaise raison.
   *
   * 🔴 UN BANC QUI PASSE POUR LA MAUVAISE RAISON EST PIRE QU'UN BANC QUI
   * ÉCHOUE : il donne de la confiance sans rien prouver.
   */
  const neuf = await creerArchive({ motdepasse: MDP })
  const serrureMdp = neuf.serrures.find((s) => s.type === "motdepasse")

  verifie(
    "la serrure témoin s'ouvre AVANT qu'on y touche",
    (await ouvrirArchive(MDP, serrureMdp)) !== undefined,
    "sans cela, les refus qui suivent ne prouveraient rien",
  )

  const affaiblie = {
    ...serrureMdp,
    parametres: JSON.stringify({ memoireKio: 8, passes: 1, parallelisme: 1 }),
  }
  verifie(
    "des paramètres affaiblis sont REFUSÉS",
    await leve(() => ouvrirArchive(MDP, affaiblie)),
    "sans ce contrôle, le serveur décidait du coût de la dérivation",
  )

  const enorme = {
    ...serrureMdp,
    parametres: JSON.stringify({ memoireKio: 4000000, passes: 3, parallelisme: 1 }),
  }
  verifie(
    "une demande de quatre gigaoctets est REFUSÉE avant d'être tentée",
    await leve(() => ouvrirArchive(MDP, enorme)),
    "l'onglet tombait au lieu de refuser",
  )

  const autreAlgo = { ...serrureMdp, algo: "pbkdf2-sha256" }
  verifie(
    "un algorithme substitué est REFUSÉ",
    await leve(() => ouvrirArchive(MDP, autreAlgo)),
    "c'est le déclassement : une serrure forte relue en faible",
  )

  verifie(
    "et la serrure intacte ouvre toujours",
    (await ouvrirArchive(MDP, serrureMdp)) !== undefined,
    "un contrôle qui refuse tout ne prouve rien",
  )

  titre("⑩ Une archive de plus de 2 000 blocs se restaure en entier")
  /*
   * Le serveur rend 2 000 blocs par page et donne `suivant` quand il en
   * reste. On ne lisait que la première page : les messages les plus RÉCENTS
   * manquaient. Ici, un faux serveur rend 2 100 blocs réellement chiffrés,
   * en deux pages — comme la route réelle, prouvée par le banc backend ⑧.
   */
  const { maitresse: cleGrande } = await creerArchive({ trousseau: "secret-grande-archive" })
  const grands = []
  for (let i = 0; i < 2100; i++) {
    grands.push(
      await chiffrerBloc(cleGrande, [
        { id: `m-${i}`, convId: "c", expediteurId: "e", texte: `t${i}`, quand: i },
      ]),
    )
  }
  const fetchReel = globalThis.fetch
  let appels = 0
  globalThis.fetch = async (url) => {
    appels++
    const apres = new URL(String(url), "http://x").searchParams.get("apres")
    const debut = apres === null ? 0 : Number(apres) + 1
    const page = grands.slice(debut, debut + 2000)
    const suivant = page.length === 2000 ? String(debut + 1999) : null
    return new Response(JSON.stringify({ blocs: page, total: page.length, suivant }), { status: 200 })
  }
  try {
    const r = await restaurer(cleGrande)
    verifie("les 2 100 messages sont restaurés", r.messages.length === 2100, `${r.messages.length}`)
    verifie("le plus récent compris", r.messages.at(-1)?.texte === "t2099", r.messages.at(-1)?.texte)
    verifie("en suivant les pages (2 appels)", appels === 2, `${appels} appel(s)`)
  } finally {
    globalThis.fetch = fetchReel
  }

  console.log(
    `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
  )
  return echecs
}
