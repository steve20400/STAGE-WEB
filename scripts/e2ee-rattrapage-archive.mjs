/**
 * LE RATTRAPAGE PAR L'ARCHIVE — un navigateur ouvert APRÈS l'envoi finit par
 * lire le message, dès qu'un autre appareil du compte l'a relevé.
 *
 * 🐛 LE CAS RÉEL (user, 10/10/2026, fil Toti → steve) : cinq messages, dont
 * une vidéo, envoyés pendant que le seul navigateur de steve dormait. Il ouvre
 * un NOUVEAU navigateur (son téléphone) : aucune enveloppe pour lui, et
 * l'archive ne se lisait qu'à la connexion → « indisponible » pour toujours.
 *
 * LE SCÉNARIO, dans le vrai Chrome :
 *   ⓪ Ana et le premier navigateur de Ben (B1) se connectent ;
 *   ① B1 s'endort (page fermée, session gardée) ; Ana écrit un texte et
 *     envoie un fichier — chiffrés pour B1 SEUL ;
 *   ② Ben ouvre un navigateur NEUF (B2) : les deux sont « indisponibles » ;
 *   ③ B1 se réveille par son JETON (pas de mot de passe), relève, archive ;
 *   ④ B2 recharge le fil : texte et fichier y sont, le fichier s'ouvre, et
 *     tout survit à un rechargement de la page ;
 *   ⑤ le curseur : le rattrapage suivant ne relit que les blocs nouveaux.
 *
 * Usage : node scripts/e2ee-rattrapage-archive.mjs
 *         (backend :3000, WebSocket :3001 et web :5173 démarrés)
 */
import { chromium } from "playwright"
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js"
import bcrypt from "../../backend-alanya/node_modules/bcryptjs/index.js"

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const prisma = new PrismaClient()
const MOT_DE_PASSE = "MotDePasseDeTest!2026"

let echecs = 0
function verifie(libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`)
  if (!condition) {
    echecs++
    if (detail !== undefined) console.log(`      \x1b[31m${detail}\x1b[0m`)
  }
}
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`)
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/** Un compte personnel neuf : ni identité, ni enveloppes, ni archive. */
async function compte(prenom) {
  const email = `${prenom.toLowerCase()}.rattrapage@e2ee.test`
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12)
  const u = await prisma.user.upsert({
    where: { email },
    // Deux navigateurs pour Ben : sans `appareilTotal: 3`, B2 évincerait B1.
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0, appareilTotal: 3 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `RA${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
      appareilTotal: 3,
    },
  })
  await prisma.e2eeIdentite.deleteMany({ where: { userId: u.id } })
  await prisma.e2eeEnveloppe.deleteMany({ where: { OR: [{ destinataireId: u.id }, { expediteurId: u.id }] } })
  await prisma.e2eeArchiveBloc.deleteMany({ where: { userId: u.id } })
  await prisma.e2eeSerrure.deleteMany({ where: { userId: u.id } })
  return { id: u.id, email, prenom }
}

async function filEntre(a, b) {
  const anciennes = await prisma.conversation.findMany({
    where: {
      isGroup: false,
      AND: [{ participants: { some: { userId: a.id } } }, { participants: { some: { userId: b.id } } }],
    },
    select: { id: true },
  })
  await prisma.conversation.deleteMany({ where: { id: { in: anciennes.map((c) => c.id) } } })
  return (
    await prisma.conversation.create({
      data: { isGroup: false, participants: { create: [{ userId: a.id }, { userId: b.id }] } },
      select: { id: true },
    })
  ).id
}

async function fermerPortillon(page, prenom) {
  const portillon = page.locator(".pseudo-gate-champ")
  if (await portillon.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false)) {
    await portillon.fill(`Banc ${prenom} ${Date.now().toString(36)}`)
    await page.locator(".pseudo-gate-valider").click()
    await page.waitForSelector(".pseudo-gate-overlay", { state: "detached", timeout: 15000 }).catch(() => {})
  }
}

/** Connexion par l'écran : elle publie les clés et passe par /restauration. */
async function connecter(navigateur, qui) {
  const contexte = await navigateur.newContext()
  await contexte.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
  const page = await contexte.newPage()
  const erreurs = []
  page.on("pageerror", (e) => erreurs.push(String(e.message)))
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" })
  await page.locator('input[type="text"], input[type="email"]').first().fill(qui.email)
  await page.locator('input[type="password"]').first().fill(MOT_DE_PASSE)
  await page.getByRole("button", { name: /^Connexion$/i }).click()
  await page.waitForURL((u) => u.pathname.startsWith("/chats"), { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await fermerPortillon(page, qui.prenom)
  return { contexte, page, erreurs }
}

async function identites(qui) {
  return prisma.e2eeIdentite.findMany({ where: { userId: qui.id }, select: { deviceId: true } })
}

async function attendreIdentites(qui, n) {
  for (let i = 0; i < 40; i++) {
    if ((await identites(qui)).length >= n) return true
    await pause(500)
  }
  return false
}

/** Le fil tel que le client le charge : texte, média chiffré. */
const charger = (page, convId) =>
  page.evaluate(async (c) => {
    const ms = await import("/src/services/messages-service.ts")
    return (await ms.fetchMessages(c)).map((m) => ({
      id: m.id,
      content: m.content,
      media: m.mediaChiffre ? { id: m.mediaChiffre.id, nom: m.mediaChiffre.nom } : null,
    }))
  }, convId)

async function main() {
  console.log("\n\x1b[1m════ LE RATTRAPAGE PAR L'ARCHIVE ════\x1b[0m")
  const ana = await compte("Ana")
  const ben = await compte("Ben")
  const G = await filEntre(ana, ben)

  const navigateur = await chromium
    .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
    .catch(() => null)
  if (!navigateur) {
    console.error("\n\x1b[31m💥 Chrome introuvable.\x1b[0m\n")
    process.exit(1)
  }

  try {
    titre("⓪ Ana et le premier navigateur de Ben")
    const A = await connecter(navigateur, ana)
    const B1 = await connecter(navigateur, ben)
    verifie("Ana a publié son identité", await attendreIdentites(ana, 1))
    verifie("B1 a publié son identité", await attendreIdentites(ben, 1))
    const appareilB1 = (await identites(ben))[0]?.deviceId
    await prisma.conversation.update({ where: { id: G }, data: { e2eeActif: true } })
    verifie("Ben a une archive (serrure posée à la connexion)",
      (await prisma.e2eeSerrure.count({ where: { userId: ben.id } })) > 0)

    titre("① B1 s'endort ; Ana écrit un texte et envoie un fichier")
    await B1.page.close() // la session reste dans le profil : c'est le portable fermé
    const texte = `Pendant ton absence ${Date.now().toString(36)}`
    const contenuFichier = `La vidéo de Toti ${Date.now().toString(36)} — accents éàù`
    const idTexte = await A.page.evaluate(
      async ([c, t]) => (await (await import("/src/services/e2ee-fil.ts")).envoyerChiffre(c, t)).id,
      [G, texte],
    )
    const idFichier = await A.page.evaluate(
      async ([c, t]) => {
        const env = await import("/src/services/e2ee-media-envoi.ts")
        const r = await env.envoyerMediaChiffre(c, new Blob([t], { type: "text/plain" }), {
          nom: "absence.txt",
          mime: "text/plain",
          legende: "",
        })
        return r.id
      },
      [G, contenuFichier],
    )
    const enveloppes = await prisma.e2eeEnveloppe.findMany({
      where: { messageId: { in: [idTexte, idFichier] }, destinataireId: ben.id },
      select: { destinataireDevice: true, remisLe: true },
    })
    verifie("deux enveloppes, pour B1 seul, non relevées",
      enveloppes.length === 2 && enveloppes.every((e) => e.destinataireDevice === appareilB1 && !e.remisLe),
      JSON.stringify(enveloppes))

    titre("② Ben ouvre un navigateur NEUF (B2)")
    const B2 = await connecter(navigateur, ben)
    verifie("B2 a sa propre identité", await attendreIdentites(ben, 2))
    let fil = await charger(B2.page, G)
    const avantTexte = fil.find((m) => m.id === idTexte)
    const avantFichier = fil.find((m) => m.id === idFichier)
    verifie("B2 : le texte est indisponible (aucune enveloppe pour lui)", avantTexte && !avantTexte.content,
      JSON.stringify(avantTexte))
    verifie("B2 : le fichier aussi", avantFichier && !avantFichier.media, JSON.stringify(avantFichier))
    const debutRepos = Date.now()

    titre("③ B1 se réveille par son jeton, relève et archive")
    const blocsAvant = await prisma.e2eeArchiveBloc.count({ where: { userId: ben.id } })
    B1.page = await B1.contexte.newPage()
    B1.page.on("pageerror", (e) => B1.erreurs.push(String(e.message)))
    await B1.page.goto(`${WEB}/chats/${G}`, { waitUntil: "networkidle" })
    verifie("B1 est resté connecté (reprise par jeton, sans mot de passe)",
      !new URL(B1.page.url()).pathname.includes("/login"), B1.page.url())
    fil = await charger(B1.page, G)
    verifie("B1 lit le texte", fil.find((m) => m.id === idTexte)?.content === texte)
    verifie("B1 a le fichier", fil.find((m) => m.id === idFichier)?.media?.nom === "absence.txt")
    // Le dépôt est différé (tampon) : on le pousse, puis on attend le bloc.
    let blocsApres = blocsAvant
    for (let i = 0; i < 30 && blocsApres <= blocsAvant; i++) {
      await B1.page.evaluate(async () => (await import("/src/services/e2ee-sauvegarde.ts")).vider())
      await pause(500)
      blocsApres = await prisma.e2eeArchiveBloc.count({ where: { userId: ben.id } })
    }
    verifie("B1 a archivé ce qu'il a relevé", blocsApres > blocsAvant, `${blocsAvant} → ${blocsApres}`)

    titre("④ B2 rattrape par l'archive")
    const reste = 21_000 - (Date.now() - debutRepos)
    if (reste > 0) await pause(reste) // le repos de 20 s entre deux rattrapages
    fil = await charger(B2.page, G)
    verifie("B2 lit maintenant le texte", fil.find((m) => m.id === idTexte)?.content === texte,
      JSON.stringify(fil.find((m) => m.id === idTexte)))
    verifie("B2 a maintenant le fichier", fil.find((m) => m.id === idFichier)?.media?.nom === "absence.txt",
      JSON.stringify(fil.find((m) => m.id === idFichier)))
    const ouvert = await B2.page.evaluate(
      async ([c, id]) => {
        const ms = await import("/src/services/messages-service.ts")
        const o = await import("/src/services/e2ee-media-ouverture.ts")
        const m = (await ms.fetchMessages(c)).find((x) => x.id === id)
        if (!m?.mediaChiffre) return null
        return (await o.ouvrirMediaChiffre(m.mediaChiffre)).text()
      },
      [G, idFichier],
    )
    verifie("… et l'ouvre, octet pour octet", ouvert === contenuFichier, String(ouvert))
    await B2.page.goto(`${WEB}/chats/${G}`, { waitUntil: "networkidle" })
    verifie("après rechargement, l'écran du fil affiche le texte (rangé en cache)",
      await B2.page.getByText(texte, { exact: true }).first().waitFor({ state: "visible", timeout: 15000 })
        .then(() => true).catch(() => false))

    titre("⑤ Le curseur")
    const dernierBloc = await prisma.e2eeArchiveBloc.findFirst({
      where: { userId: ben.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    })
    const curseur = await B2.page.evaluate(() => localStorage.getItem("alanya.e2ee.archive.curseur"))
    verifie("B2 retient le dernier bloc lu", curseur === dernierBloc?.id, `${curseur} ≠ ${dernierBloc?.id}`)
    const requetes = []
    B2.page.on("request", (r) => {
      if (r.url().includes("/api/e2ee/archive")) requetes.push(r.url())
    })
    await pause(21_000) // le repos entre deux rattrapages
    await B2.page.evaluate(async () =>
      (await import("/src/services/e2ee-sauvegarde.ts")).rattraperDepuisArchive(async () => {}))
    verifie("le rattrapage suivant part du curseur (?apres=…)",
      requetes.length > 0 && requetes.every((u) => u.includes(`apres=${curseur}`)), requetes.join(" | "))

    const erreurs = [...A.erreurs, ...B1.erreurs, ...B2.erreurs]
    verifie("aucune erreur de page", erreurs.length === 0, erreurs.join(" | "))
  } finally {
    await prisma.conversation.delete({ where: { id: G } }).catch(() => undefined)
    await navigateur.close()
    await prisma.$disconnect()
  }

  console.log(`\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`)
  process.exit(echecs === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error("\n\x1b[31m💥 Le banc s'est arrêté :\x1b[0m", e?.message ?? e)
  await prisma.$disconnect()
  process.exit(1)
})
