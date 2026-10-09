/**
 * BANC — un GROUPE chiffré, dans le vrai Chrome (lot 4, cours chapitre 34).
 *
 * Trois comptes dans un groupe : Alice (administratrice), Bob, Carole. Tout
 * passe par le VRAI code du client, importé dans la page (même instance que
 * l'application, coffre ouvert).
 *
 *   ① Alice distribue le trousseau (hors fil, enveloppes Signal) — le geste
 *     du lot 5, joué ici à la main ; Bob et Carole le reçoivent à la relève ;
 *   ② Alice écrit : UN chiffré sur le serveur, AUCUN texte en clair ; Bob le
 *     voit dans l'écran du fil ;
 *   ③ Bob répond, Carole lit les deux ;
 *   ④ Alice modifie : le nouveau texte remplace l'ancien chez Bob ;
 *   ⑤ un média chiffré : le descripteur arrive chez Bob ;
 *   ⑥ refus : trousseau envoyé par un non-administrateur, version déjà connue
 *     avec une autre clé ;
 *   ⑦ la clé a changé et le nouveau trousseau n'est pas là : l'envoi est
 *     refusé, rien ne part ;
 *   ⑧ Carole quitte le groupe : son appareil oublie le trousseau.
 *
 * Usage : node scripts/e2ee-groupe-web.mjs
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

async function compte(prenom) {
  const email = `${prenom.toLowerCase()}.groupe@e2ee.test`
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12)
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0, appareilTotal: 3 },
    create: {
      email,
      nom: `${prenom} Groupe`,
      passwordHash: hash,
      publicNumber: `GR${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
      appareilTotal: 3,
    },
  })
  // Un navigateur neuf tire une identité neuve : on repart de zéro.
  await prisma.e2eeIdentite.deleteMany({ where: { userId: u.id } })
  await prisma.e2eeEnveloppe.deleteMany({ where: { OR: [{ destinataireId: u.id }, { expediteurId: u.id }] } })
  return { id: u.id, email, prenom }
}

async function connecter(navigateur, qui) {
  const contexte = await navigateur.newContext()
  const page = await contexte.newPage()
  const erreurs = []
  page.on("pageerror", (e) => erreurs.push(String(e.message)))
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" })
  await page.locator('input[type="text"], input[type="email"]').first().fill(qui.email)
  await page.locator('input[type="password"]').first().fill(MOT_DE_PASSE)
  await page.getByRole("button", { name: /^Connexion$/i }).click()
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const portillon = page.locator(".pseudo-gate-champ")
  if (await portillon.isVisible().catch(() => false)) {
    await portillon.fill(`Banc ${qui.prenom} ${Date.now().toString(36)}`)
    await page.locator(".pseudo-gate-valider").click()
    const ferme = await page
      .waitForSelector(".pseudo-gate-overlay", { state: "detached", timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    if (!ferme) throw new Error(`portillon resté ouvert pour ${qui.prenom}`)
  }
  return { contexte, page, erreurs }
}

async function attendreCles(qui) {
  for (let i = 0; i < 40; i++) {
    const id = await prisma.e2eeIdentite.findFirst({ where: { userId: qui.id }, select: { deviceId: true } })
    if (id) return id.deviceId
    await pause(500)
  }
  return null
}

/** Le trousseau local d'une page : les numéros de version connus. */
const versionsLocales = (page, convId) =>
  page.evaluate(async (c) => {
    const gf = await import("/src/services/e2ee-groupe-fil.ts")
    return (await gf.trousseauLocal(c)).map((v) => v.n)
  }, convId)

/** Relève les enveloppes de la page (reçoit les trousseaux). */
const relever = (page) =>
  page.evaluate(async () => {
    const r = await import("/src/services/e2ee-releve.ts")
    await r.releverEtRanger()
  })

/** Le fil tel que le client le charge : identifiants et textes déchiffrés. */
const charger = (page, convId) =>
  page.evaluate(async (c) => {
    const ms = await import("/src/services/messages-service.ts")
    const l = await ms.fetchMessages(c)
    return l.map((m) => ({ id: m.id, content: m.content, media: m.mediaChiffre?.id ?? null }))
  }, convId)

/** Envoie un trousseau hors fil, depuis cette page, aux comptes donnés. */
const distribuer = (page, convId, destinataires, versions) =>
  page.evaluate(
    async ([c, dest, vers]) => {
      const g = await import("/src/services/e2ee-groupe.ts")
      const svc = await import("/src/services/e2ee-service.ts")
      const versionsCle = vers.map((v) => ({ n: v.n, cle: Uint8Array.from(atob(v.cle), (x) => x.charCodeAt(0)), creeLe: v.creeLe }))
      const charge = g.ecrireChargeTrousseau({ convId: c, motif: "ACTIVATION", versions: versionsCle })
      const env = []
      for (const uid of dest) {
        const d = await svc.ouvrirSessions(uid)
        env.push(...(await svc.chiffrerPour(uid, d, charge)))
      }
      await svc.deposer(c, env)
      return env.length
    },
    [convId, destinataires, versions],
  )

const cleAleatoire = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")

async function main() {
  console.log("\n\x1b[1m════ UN GROUPE CHIFFRÉ, DANS LE NAVIGATEUR ════\x1b[0m")
  const alice = await compte("Alice")
  const bob = await compte("Bob")
  const carole = await compte("Carole")

  const navigateur = await chromium
    .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
    .catch(() => null)
  if (!navigateur) {
    console.error("\n\x1b[31m💥 Chrome introuvable.\x1b[0m\n")
    process.exit(1)
  }

  let G = null
  try {
    titre("⓪ Connexion des trois comptes")
    const A = await connecter(navigateur, alice)
    const B = await connecter(navigateur, bob)
    const C = await connecter(navigateur, carole)
    const appareilA = await attendreCles(alice)
    verifie("les trois ont publié leurs clés",
      appareilA !== null && (await attendreCles(bob)) !== null && (await attendreCles(carole)) !== null)

    // Le groupe, déjà activé par Alice (le lot 5 fera ce geste par l'écran).
    const g = await prisma.conversation.create({
      data: {
        isGroup: true,
        name: "Banc groupe web",
        e2eeActif: true,
        cleVersion: 1,
        participants: {
          create: [
            { userId: alice.id, role: "ADMIN" },
            { userId: bob.id, role: "MEMBER" },
            { userId: carole.id, role: "MEMBER" },
          ],
        },
      },
      select: { id: true },
    })
    G = g.id
    await prisma.e2eeCleVersion.create({
      data: { convId: G, version: 1, creePar: alice.id, creeParAppareil: appareilA, motif: "ACTIVATION" },
    })

    titre("① Alice distribue le trousseau")
    const v1 = { n: 1, cle: cleAleatoire(), creeLe: Date.now() }
    await A.page.evaluate(
      async ([c, v]) => {
        const gf = await import("/src/services/e2ee-groupe-fil.ts")
        await gf.rangerTrousseau(c, [{ n: v.n, cle: Uint8Array.from(atob(v.cle), (x) => x.charCodeAt(0)), creeLe: v.creeLe }])
      },
      [G, v1],
    )
    const n = await distribuer(A.page, G, [bob.id, carole.id], [v1])
    verifie("enveloppes déposées hors fil", n >= 2, String(n))
    await relever(B.page)
    await relever(C.page)
    verifie("Bob a la version 1", JSON.stringify(await versionsLocales(B.page, G)) === "[1]")
    verifie("Carole a la version 1", JSON.stringify(await versionsLocales(C.page, G)) === "[1]")

    titre("② Alice écrit")
    const texteA = `Bonjour le groupe ${Date.now().toString(36)}`
    const idA = await A.page.evaluate(
      async ([c, t]) => (await (await import("/src/services/e2ee-fil.ts")).envoyerChiffre(c, t)).id,
      [G, texteA],
    )
    const ligne = await prisma.message.findUnique({ where: { id: idA }, include: { groupe: true } })
    verifie("le serveur n'a AUCUN texte en clair", ligne?.content === null)
    verifie("UN chiffré, version 1, appareil d'Alice", ligne?.groupe?.version === 1 && ligne.groupe.expediteurAppareil === appareilA)
    verifie("aucune enveloppe pour ce message", (await prisma.e2eeEnveloppe.count({ where: { messageId: idA } })) === 0)
    await B.page.goto(`${WEB}/chats/${G}`, { waitUntil: "networkidle" })
    const visible = await B.page
      .getByText(texteA, { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    verifie("Bob le lit dans l'écran du fil", visible)

    titre("③ Bob répond, Carole lit tout")
    const texteB = `Réponse de Bob ${Date.now().toString(36)}`
    const idB = await B.page.evaluate(
      async ([c, t]) => (await (await import("/src/services/e2ee-fil.ts")).envoyerChiffre(c, t)).id,
      [G, texteB],
    )
    let fil = await charger(C.page, G)
    verifie("Carole lit Alice", fil.find((m) => m.id === idA)?.content === texteA, JSON.stringify(fil))
    verifie("Carole lit Bob", fil.find((m) => m.id === idB)?.content === texteB)
    fil = await charger(A.page, G)
    verifie("Alice lit Bob (et son propre message)", fil.find((m) => m.id === idB)?.content === texteB &&
      fil.find((m) => m.id === idA)?.content === texteA)

    titre("④ Alice modifie")
    const modifie = `${texteA} (modifié)`
    await A.page.evaluate(
      async ([c, id, t]) => (await import("/src/services/e2ee-fil.ts")).modifierChiffre(c, id, t),
      [G, idA, modifie],
    )
    fil = await charger(C.page, G)
    verifie("Carole lit le texte modifié", fil.find((m) => m.id === idA)?.content === modifie, JSON.stringify(fil.find((m) => m.id === idA)))

    titre("⑤ Un média chiffré")
    const media = await A.page.evaluate(async (c) => {
      const env = await import("/src/services/e2ee-media-envoi.ts")
      const blob = new Blob(["contenu du fichier du banc"], { type: "text/plain" })
      const r = await env.envoyerMediaChiffre(c, blob, { nom: "banc.txt", mime: "text/plain", legende: "une pièce jointe" })
      return { id: r.id, media: r.descripteur.id }
    }, G)
    fil = await charger(B.page, G)
    const recu = fil.find((m) => m.id === media.id)
    verifie("Bob reçoit le descripteur et la légende", recu?.media === media.media && recu?.content === "une pièce jointe",
      JSON.stringify(recu))
    verifie("le fichier est marqué chiffré sur le serveur",
      (await prisma.mediaFile.findUnique({ where: { id: media.media } }))?.chiffre === true)

    titre("⑥ Les trousseaux refusés")
    await distribuer(C.page, G, [bob.id], [{ n: 2, cle: cleAleatoire(), creeLe: Date.now() }])
    await relever(B.page)
    verifie("envoyé par Carole (pas administratrice) : ignoré", JSON.stringify(await versionsLocales(B.page, G)) === "[1]")
    await distribuer(A.page, G, [bob.id], [{ n: 1, cle: cleAleatoire(), creeLe: Date.now() }])
    await relever(B.page)
    fil = await charger(B.page, G)
    verifie("version 1 avec une autre clé : refusée, l'historique reste lisible",
      fil.find((m) => m.id === idB)?.content === texteB)

    titre("⑦ La clé a changé, le trousseau n'est pas arrivé")
    await prisma.e2eeCleVersion.create({
      data: { convId: G, version: 2, creePar: alice.id, creeParAppareil: appareilA, motif: "MANUEL" },
    })
    await prisma.conversation.update({ where: { id: G }, data: { cleVersion: 2 } })
    const avant = await prisma.message.count({ where: { convId: G } })
    const refus = await B.page.evaluate(async (c) => {
      try {
        await (await import("/src/services/e2ee-fil.ts")).envoyerChiffre(c, "ne doit pas partir")
        return null
      } catch (e) {
        return String(e?.message ?? e)
      }
    }, G)
    verifie("l'envoi est refusé, et le dit", refus !== null && /clé du groupe/i.test(refus), String(refus))
    verifie("rien n'est parti", (await prisma.message.count({ where: { convId: G } })) === avant)

    titre("⑧ Carole quitte le groupe")
    await C.page.evaluate(async (c) => {
      const { apiRequest } = await import("/src/lib/api-client.ts")
      await apiRequest(`/api/conversations/${c}/leave`, { method: "POST" })
    }, G)
    let oublie = false
    for (let i = 0; i < 20 && !oublie; i++) {
      await pause(300)
      oublie = (await versionsLocales(C.page, G)).length === 0
    }
    verifie("son appareil a oublié le trousseau", oublie)

    const erreurs = [...A.erreurs, ...B.erreurs, ...C.erreurs]
    verifie("aucune erreur de page", erreurs.length === 0, erreurs.join(" | "))
  } finally {
    if (G) await prisma.conversation.delete({ where: { id: G } }).catch(() => undefined)
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
