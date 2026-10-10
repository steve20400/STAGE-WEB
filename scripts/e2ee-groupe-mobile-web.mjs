/**
 * BANC DE BOUT EN BOUT — un groupe chiffré entre le MOBILE et le WEB, par le
 * vrai serveur (lot 8, cours chapitre 36).
 *
 * Mia est sur le « téléphone » : le vrai code Dart de l'application
 * (`alanya/test/interop_groupe_reel_test.dart`), lancé par ce script, qui parle
 * au backend local en vraies requêtes. Wes est dans le vrai Chrome, sur le
 * vrai client web. Ils sont dans le même groupe.
 *
 *   ① Mia ACTIVE depuis le mobile : la clé arrive dans le navigateur ;
 *   ② Mia écrit : le WEB LIT LE MOBILE (et l'écran du fil l'affiche) ;
 *   ③ Wes répond : le MOBILE LIT LE WEB ;
 *   ④ Mia CHANGE LA CLÉ : la version 2 arrive dans le navigateur, et le
 *     message suivant, en version 2, s'y lit.
 *
 * Usage : node scripts/e2ee-groupe-mobile-web.mjs
 *         (backend :3000, WebSocket :3001 et web :5173 démarrés ; Flutter
 *         dans C:/flutter)
 */
import { spawn } from "node:child_process"
import { chromium } from "playwright"
import { PrismaClient } from "../../backend-alanya/node_modules/@prisma/client/default.js"
import bcrypt from "../../backend-alanya/node_modules/bcryptjs/index.js"

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const API = process.env.API_URL ?? "http://localhost:3000"
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
  const email = `${prenom.toLowerCase()}.groupe-mobile-web@e2ee.test`
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12)
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0, appareilTotal: 3 },
    create: {
      email,
      nom: prenom,
      passwordHash: hash,
      publicNumber: `GMW${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
      appareilTotal: 3,
    },
  })
  await prisma.e2eeIdentite.deleteMany({ where: { userId: u.id } })
  await prisma.e2eeEnveloppe.deleteMany({ where: { OR: [{ destinataireId: u.id }, { expediteurId: u.id }] } })
  await prisma.e2eeTrousseau.deleteMany({ where: { userId: u.id } })
  return { id: u.id, email, prenom }
}

async function connecter(navigateur, qui) {
  const contexte = await navigateur.newContext()
  // Les polices Google ne servent pas au banc (et peuvent bloquer « networkidle »).
  await contexte.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort())
  const page = await contexte.newPage()
  const erreurs = []
  page.on("pageerror", (e) => erreurs.push(String(e.message)))
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" })
  await page.locator('input[type="text"], input[type="email"]').first().fill(qui.email)
  await page.locator('input[type="password"]').first().fill(MOT_DE_PASSE)
  await page.getByRole("button", { name: /^Connexion$/i }).click()
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await fermerPortillon(page, qui.prenom)
  return { contexte, page, erreurs }
}

async function fermerPortillon(page, prenom) {
  const portillon = page.locator(".pseudo-gate-champ")
  if (await portillon.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false)) {
    await portillon.fill(`Banc ${prenom} ${Date.now().toString(36)}`)
    await page.locator(".pseudo-gate-valider").click()
    await page.waitForSelector(".pseudo-gate-overlay", { state: "detached", timeout: 15000 }).catch(() => {})
  }
}

async function attendreCles(qui) {
  for (let i = 0; i < 40; i++) {
    if ((await prisma.e2eeIdentite.count({ where: { userId: qui.id } })) > 0) return true
    await pause(500)
  }
  return false
}

/** Connexion « comme le téléphone » : par l'API, avec un identifiant mobile. */
async function connexionMobile(qui) {
  await prisma.user.update({ where: { id: qui.id }, data: { dissocier: true, deviceId: null } }).catch(() => undefined)
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.97.0.1" },
    body: JSON.stringify({ identifier: qui.email, password: MOT_DE_PASSE, deviceId: "mob-banc-groupe", typeDevice: 1 }),
  })
  if (!r.ok) throw new Error(`connexion mobile → ${r.status} ${await r.text()}`)
  return (await r.json()).accessToken
}

const versionsLocales = (page, convId) =>
  page.evaluate(async (c) => (await (await import("/src/services/e2ee-groupe-fil.ts")).trousseauLocal(c)).map((v) => v.n), convId)

async function attendreVersions(page, convId, voulu) {
  let v = []
  for (let i = 0; i < 30; i++) {
    await page.evaluate(async () => (await import("/src/services/e2ee-releve.ts")).releverEtRanger())
    v = await versionsLocales(page, convId)
    if (JSON.stringify(v) === JSON.stringify(voulu)) return v
    await pause(500)
  }
  return v
}

const charger = (page, convId) =>
  page.evaluate(async (c) => {
    const ms = await import("/src/services/messages-service.ts")
    return (await ms.fetchMessages(c)).map((m) => ({ id: m.id, content: m.content }))
  }, convId)

/** Le test Dart, lancé en fond : ses lignes « BANC: … » arrivent une à une. */
function lancerMobile(env) {
  const lignes = []
  const attentes = []
  const proc = spawn(
    "C:/flutter/bin/flutter.bat",
    ["test", "--no-pub", "test/interop_groupe_reel_test.dart", "--reporter", "expanded"],
    { cwd: "../alanya", shell: true, env: { ...process.env, ...env } },
  )
  let reste = ""
  let journal = ""
  const lire = (morceau) => {
    journal += morceau
    reste += morceau
    const parties = reste.split(/\r?\n/)
    reste = parties.pop() ?? ""
    for (const l of parties) {
      const m = l.match(/BANC: (.*)$/)
      if (!m) continue
      lignes.push(m[1])
      console.log(`      \x1b[2m[mobile] ${m[1]}\x1b[0m`)
      for (const a of attentes.splice(0)) a()
    }
  }
  proc.stdout.on("data", (d) => lire(String(d)))
  proc.stderr.on("data", (d) => lire(String(d)))
  const fin = new Promise((r) => proc.on("close", (code) => r(code)))
  return {
    fin,
    journal: () => journal,
    /** Attend une ligne qui commence par [prefixe] ; rend son reste. */
    async attendre(prefixe, delaiMs = 180_000) {
      const limite = Date.now() + delaiMs
      for (;;) {
        const l = lignes.find((x) => x.startsWith(prefixe))
        if (l !== undefined) return l.slice(prefixe.length).trim()
        if (Date.now() > limite) return null
        await new Promise((r) => {
          attentes.push(r)
          setTimeout(r, 1000)
        })
      }
    },
  }
}

async function main() {
  console.log("\n\x1b[1m════ UN GROUPE CHIFFRÉ ENTRE LE MOBILE ET LE WEB ════\x1b[0m")
  const mia = await compte("Mia")
  const wes = await compte("Wes")

  const navigateur = await chromium
    .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
    .catch(() => null)
  if (!navigateur) {
    console.error("\n\x1b[31m💥 Chrome introuvable.\x1b[0m\n")
    process.exit(1)
  }

  let G = null
  try {
    titre("⓪ Wes dans Chrome, Mia par l'API du téléphone")
    const W = await connecter(navigateur, wes)
    verifie("Wes a publié ses clés", await attendreCles(wes))
    const jeton = await connexionMobile(mia)
    verifie("jeton du téléphone obtenu", typeof jeton === "string")

    G = (
      await prisma.conversation.create({
        data: {
          isGroup: true,
          name: "Banc mobile-web",
          participants: { create: [{ userId: mia.id, role: "ADMIN" }, { userId: wes.id, role: "MEMBER" }] },
        },
        select: { id: true },
      })
    ).id

    const t1 = `DuMobile-${Date.now().toString(36)}`
    const t2 = `DuMobileV2-${Date.now().toString(36)}`
    const mobile = lancerMobile({
      E2EE_API: API,
      E2EE_JETON: jeton,
      E2EE_MOI: mia.id,
      E2EE_CONV: G,
      E2EE_WEB: wes.id,
      E2EE_T1: t1,
      E2EE_T2: t2,
    })

    titre("① Mia active depuis le mobile")
    const active = await mobile.attendre("ACTIVE")
    verifie("le mobile a activé le groupe", active !== null && active.includes("deja=false"), String(active))
    const conv = await prisma.conversation.findUnique({ where: { id: G } })
    verifie("le serveur : chiffré, version 1", conv?.e2eeActif === true && conv.cleVersion === 1)
    /*
     * 🔴 LA BOÎTE DU MOBILE, OUVERTE PAR LE WEB (chapitre 39). On supprime
     * l'enveloppe à usage unique de Wes : il ne lui reste que la boîte
     * permanente déposée par le téléphone de Mia.
     */
    verifie("le mobile a déposé une boîte permanente pour le navigateur",
      (await prisma.e2eeBoite.count({ where: { convId: G, userId: wes.id } })) >= 1)
    await prisma.e2eeEnveloppe.deleteMany({ where: { convId: G, destinataireId: wes.id } })
    // Le navigateur, en ligne, a pu relever l'enveloppe avant sa suppression :
    // on lui retire aussi la clé, pour que la boîte soit SA SEULE source.
    await W.page.evaluate(async (c) => (await import("/src/services/e2ee-groupe-fil.ts")).oublierTrousseau(c), G)
    await prisma.e2eeTrousseau.deleteMany({ where: { convId: G, userId: wes.id } })
    verifie("… enveloppe, clé locale et copie supprimées : seule la boîte reste",
      (await prisma.e2eeEnveloppe.count({ where: { convId: G, destinataireId: wes.id } })) === 0 &&
        (await versionsLocales(W.page, G)).length === 0)

    titre("② Le web lit le mobile")
    const idT1 = await mobile.attendre("ENVOYE_T1")
    verifie("le mobile a écrit T1", idT1 !== null)
    const ligne = idT1 ? await prisma.message.findUnique({ where: { id: idT1 }, include: { groupe: true } }) : null
    verifie("le serveur n'a qu'un chiffré, aucun texte", ligne?.content === null && ligne?.groupe?.version === 1)
    let fil = await charger(W.page, G)
    verifie("Wes lit T1, grâce à la boîte du mobile", fil.find((m) => m.id === idT1)?.content === t1,
      JSON.stringify(fil.find((m) => m.id === idT1)))
    verifie("la clé venue de la boîte est rangée", JSON.stringify(await versionsLocales(W.page, G)) === "[1]")
    await W.page.goto(`${WEB}/chats/${G}`, { waitUntil: "networkidle" })
    await fermerPortillon(W.page, "Wes")
    verifie("… et l'écran du fil l'affiche",
      await W.page.getByText(t1, { exact: true }).first().waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false))
    verifie("… avec l'avis « a activé le chiffrement »",
      await W.page.getByText(/a activé le chiffrement de bout en bout/).first().isVisible().catch(() => false))

    titre("③ Le mobile lit le web")
    const t3 = `DuWeb-${Date.now().toString(36)}`
    await W.page.evaluate(async ([c, t]) => (await import("/src/services/e2ee-fil.ts")).envoyerChiffre(c, t), [G, t3])
    const lu = await mobile.attendre("LU")
    verifie("Mia lit la réponse de Wes", lu === t3, String(lu))

    titre("④ Mia change la clé depuis le mobile")
    const cle = await mobile.attendre("CLE_CHANGEE")
    verifie("version 2 réservée par le mobile", cle === "2", String(cle))
    verifie("la version 2 arrive dans le navigateur", JSON.stringify(await attendreVersions(W.page, G, [1, 2])) === "[1,2]")
    const idT2 = await mobile.attendre("ENVOYE_T2")
    verifie("T2 est en version 2", idT2 !== null &&
      (await prisma.e2eeMessageGroupe.findUnique({ where: { messageId: idT2 } }))?.version === 2)
    fil = await charger(W.page, G)
    verifie("Wes lit T2", fil.find((m) => m.id === idT2)?.content === t2)

    const code = await mobile.fin
    verifie("le test mobile se termine sans erreur", code === 0, mobile.journal().split("\n").filter((l) => /Error|Exception|failed/.test(l)).slice(0, 5).join(" | "))
    verifie("aucune erreur de page", W.erreurs.length === 0, W.erreurs.join(" | "))
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
