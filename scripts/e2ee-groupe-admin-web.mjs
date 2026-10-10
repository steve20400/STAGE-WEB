/**
 * BANC — administrer un groupe chiffré, et retrouver ses clés sur un nouvel
 * appareil (lots 5 et 6, cours chapitre 35). Dans le vrai Chrome.
 *
 * Quatre comptes : Alice (administratrice), Bob, Carole, puis Dave (ajouté).
 *
 *   ① Alice ACTIVE depuis l'écran du fil : la version 1 est réservée, sa clé
 *     tirée et distribuée ; Bob et Carole la reçoivent ;
 *   ② un membre ne peut pas activer (bouton inerte) ;
 *   ③ AJOUT de Dave : il reçoit tout le trousseau et lit l'HISTORIQUE ;
 *   ④ EXCLUSION de Carole : version 2, distribuée aux restants seulement ;
 *     Carole oublie la clé ; le message suivant est en version 2 ;
 *   ⑤ CHANGEMENT MANUEL : refusé à un membre, accepté pour Alice (version 3) ;
 *   ⑥bis LOT 7 : les avis s'affichent ; une bulle « en attente de la clé du
 *     groupe » se remplit seule quand la clé arrive (sonnette e2ee_trousseau) ;
 *   ⑥ LOT 6 : chacun a déposé sa copie chiffrée ; le serveur ne lit rien ;
 *     Bob se connecte sur un NOUVEAU navigateur, sans aucune clé locale, et
 *     relit tout l'historique grâce à sa copie ;
 *   ⑦ REPLI APPAREIL : sans aucune copie, un TROISIÈME navigateur de Bob
 *     demande la clé à ses autres navigateurs, qui la lui renvoient ;
 *   ⑧ PAS DE LIMITE DE CLÉS : 1 000 versions passent le vrai serveur (plafond
 *     de 64 Ko par enveloppe), découpées, et la copie personnelle les garde ;
 *   ⑨ CLÉ PERDUE : Dave n'a plus ni clé ni copie, et un seul appareil ; il
 *     redemande, l'ADMINISTRATRICE la lui renvoie (défaut constaté le 10/10 :
 *     un téléphone resté sur l'ancienne application avait perdu sa clé) ;
 *   ⑩ AUCUN ADMINISTRATEUR EN LIGNE (chapitre 39) : la page d'Alice est
 *     FERMÉE ; Dave perd encore sa clé, et la retrouve dans sa BOÎTE
 *     permanente, sans personne pour la lui renvoyer.
 *
 * Usage : node scripts/e2ee-groupe-admin-web.mjs
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
  const email = `${prenom.toLowerCase()}.admin-groupe@e2ee.test`
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12)
  const u = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, emailVerified: true, typeCompte: 0, appareilTotal: 4 },
    create: {
      email,
      nom: `${prenom} Admin`,
      passwordHash: hash,
      publicNumber: `AG${Math.floor(Math.random() * 1000000)}`,
      emailVerified: true,
      typeCompte: 0,
      appareilTotal: 4,
    },
  })
  // Repartir de zéro : identités, enveloppes, archive et copies de trousseau.
  await prisma.e2eeIdentite.deleteMany({ where: { userId: u.id } })
  await prisma.e2eeEnveloppe.deleteMany({ where: { OR: [{ destinataireId: u.id }, { expediteurId: u.id }] } })
  await prisma.e2eeTrousseau.deleteMany({ where: { userId: u.id } })
  await prisma.e2eeSerrure.deleteMany({ where: { userId: u.id } })
  await prisma.e2eeArchiveBloc.deleteMany({ where: { userId: u.id } })
  return { id: u.id, email, prenom, publicNumber: u.publicNumber }
}

async function connecter(navigateur, qui) {
  const contexte = await navigateur.newContext()
  // Les polices Google ne servent pas au banc, et un réseau qui les bloque
  // empêche « networkidle » d'arriver (constaté le 10/10/2026) : on les coupe.
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

/**
 * Le portillon du nom d'appareil : il peut s'ouvrir une à deux secondes APRÈS
 * une navigation, et intercepte alors les clics (piège connu des bancs).
 */
async function fermerPortillon(page, prenom) {
  const portillon = page.locator(".pseudo-gate-champ")
  if (await portillon.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false)) {
    await portillon.fill(`Banc ${prenom} ${Date.now().toString(36)}`)
    await page.locator(".pseudo-gate-valider").click()
    await page.waitForSelector(".pseudo-gate-overlay", { state: "detached", timeout: 15000 }).catch(() => {})
  }
}

/** L'archive ouverte (créée à la première connexion, avec le mot de passe). */
async function attendreArchive(page) {
  for (let i = 0; i < 60; i++) {
    const ok = await page
      .evaluate(async () => (await import("/src/services/e2ee-sauvegarde.ts")).estOuverte())
      .catch(() => false)
    if (ok) return true
    await pause(500)
  }
  return false
}

async function attendreCles(qui, n = 1) {
  for (let i = 0; i < 40; i++) {
    const c = await prisma.e2eeIdentite.count({ where: { userId: qui.id } })
    if (c >= n) return true
    await pause(500)
  }
  return false
}

const versionsLocales = (page, convId) =>
  page.evaluate(async (c) => {
    const gf = await import("/src/services/e2ee-groupe-fil.ts")
    return (await gf.trousseauLocal(c)).map((v) => v.n)
  }, convId)

const relever = (page) =>
  page.evaluate(async () => {
    await (await import("/src/services/e2ee-releve.ts")).releverEtRanger()
  })

const charger = (page, convId) =>
  page.evaluate(async (c) => {
    const ms = await import("/src/services/messages-service.ts")
    return (await ms.fetchMessages(c)).map((m) => ({ id: m.id, content: m.content }))
  }, convId)

const envoyer = (page, convId, texte) =>
  page.evaluate(
    async ([c, t]) => (await (await import("/src/services/e2ee-fil.ts")).envoyerChiffre(c, t)).id,
    [convId, texte],
  )

/** Attend qu'une page ait les versions voulues (relève répétée). */
async function attendreVersions(page, convId, voulu) {
  let v = []
  for (let i = 0; i < 20; i++) {
    await relever(page)
    v = await versionsLocales(page, convId)
    if (JSON.stringify(v) === JSON.stringify(voulu)) return v
    await pause(400)
  }
  return v
}

async function main() {
  console.log("\n\x1b[1m════ ADMINISTRER UN GROUPE CHIFFRÉ, ET RETROUVER SES CLÉS ════\x1b[0m")
  const alice = await compte("Alice")
  const bob = await compte("Bob")
  const carole = await compte("Carole")
  const dave = await compte("Dave")

  const navigateur = await chromium
    .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
    .catch(() => null)
  if (!navigateur) {
    console.error("\n\x1b[31m💥 Chrome introuvable.\x1b[0m\n")
    process.exit(1)
  }

  let G = null
  try {
    titre("⓪ Connexion, clés publiées, archive ouverte")
    const A = await connecter(navigateur, alice)
    const B = await connecter(navigateur, bob)
    const C = await connecter(navigateur, carole)
    const D = await connecter(navigateur, dave)
    verifie("les quatre ont publié leurs clés",
      (await attendreCles(alice)) && (await attendreCles(bob)) && (await attendreCles(carole)) && (await attendreCles(dave)))
    verifie("archives ouvertes (Alice, Bob, Carole)",
      (await attendreArchive(A.page)) && (await attendreArchive(B.page)) && (await attendreArchive(C.page)))

    const g = await prisma.conversation.create({
      data: {
        isGroup: true,
        name: "Banc admin groupe",
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

    titre("① Alice active depuis l'écran du fil")
    await A.page.goto(`${WEB}/chats/${G}`, { waitUntil: "networkidle" })
    await fermerPortillon(A.page, "Alice")
    const bouton = A.page.getByRole("button", { name: "Chiffrement de bout en bout" }).first()
    await bouton.waitFor({ state: "visible", timeout: 15000 }).catch(() => {})
    verifie("le bouton est actif pour l'administratrice", await bouton.isEnabled().catch(() => false))
    await bouton.click()
    let conv = null
    for (let i = 0; i < 30; i++) {
      conv = await prisma.conversation.findUnique({ where: { id: G } })
      if (conv?.e2eeActif) break
      await pause(300)
    }
    verifie("le serveur : chiffré, version 1", conv?.e2eeActif === true && conv.cleVersion === 1)
    for (let i = 0; i < 20 && (await versionsLocales(A.page, G)).length === 0; i++) await pause(300)
    verifie("Alice a la clé 1", JSON.stringify(await versionsLocales(A.page, G)) === "[1]")
    verifie("Bob la reçoit", JSON.stringify(await attendreVersions(B.page, G, [1])) === "[1]")
    verifie("Carole la reçoit", JSON.stringify(await attendreVersions(C.page, G, [1])) === "[1]")

    titre("② Un membre ne peut pas activer")
    const G2 = (
      await prisma.conversation.create({
        data: {
          isGroup: true,
          name: "Banc admin groupe 2",
          participants: { create: [{ userId: alice.id, role: "ADMIN" }, { userId: bob.id, role: "MEMBER" }] },
        },
        select: { id: true },
      })
    ).id
    await B.page.goto(`${WEB}/chats/${G2}`, { waitUntil: "networkidle" })
    await fermerPortillon(B.page, "Bob")
    const boutonB = B.page.getByRole("button", { name: "Chiffrement de bout en bout" }).first()
    await boutonB.waitFor({ state: "visible", timeout: 15000 }).catch(() => {})
    verifie("bouton inerte pour Bob", (await boutonB.isDisabled().catch(() => false)) === true)
    await prisma.conversation.delete({ where: { id: G2 } })

    const texte1 = `Avant Dave ${Date.now().toString(36)}`
    const id1 = await envoyer(A.page, G, texte1)

    titre("③ Alice ajoute Dave : il lit l'historique")
    const bilanAjout = await A.page.evaluate(
      async ([c, n]) => (await import("/src/services/chats-service.ts")).addMembersToGroup(c, [n]),
      [G, dave.publicNumber],
    )
    verifie("le trousseau part vers Dave", bilanAjout?.appareils >= 1, JSON.stringify(bilanAjout))
    verifie("Dave a la clé 1", JSON.stringify(await attendreVersions(D.page, G, [1])) === "[1]")
    let fil = await charger(D.page, G)
    verifie("Dave lit le message d'AVANT son arrivée", fil.find((m) => m.id === id1)?.content === texte1,
      JSON.stringify(fil.find((m) => m.id === id1)))

    titre("④ Alice exclut Carole")
    await A.page.evaluate(
      async ([c, u]) => (await import("/src/services/chats-service.ts")).removeGroupMember(c, u),
      [G, carole.id],
    )
    conv = await prisma.conversation.findUnique({ where: { id: G } })
    verifie("le serveur : version 2, motif EXCLUSION",
      conv?.cleVersion === 2 &&
        (await prisma.e2eeCleVersion.findUnique({ where: { convId_version: { convId: G, version: 2 } } }))?.motif === "EXCLUSION")
    verifie("Bob reçoit la 2", JSON.stringify(await attendreVersions(B.page, G, [1, 2])) === "[1,2]")
    verifie("Dave reçoit la 2", JSON.stringify(await attendreVersions(D.page, G, [1, 2])) === "[1,2]")
    let oublie = false
    for (let i = 0; i < 20 && !oublie; i++) {
      await pause(300)
      oublie = (await versionsLocales(C.page, G)).length === 0
    }
    verifie("Carole a oublié la clé", oublie)
    verifie("aucune enveloppe de la version 2 vers Carole",
      (await prisma.e2eeEnveloppe.count({ where: { convId: G, destinataireId: carole.id, createdAt: { gt: new Date(Date.now() - 60_000) } } })) <= 1)
    const texte2 = `Après Carole ${Date.now().toString(36)}`
    const id2 = await envoyer(B.page, G, texte2)
    verifie("le message suivant est en version 2",
      (await prisma.e2eeMessageGroupe.findUnique({ where: { messageId: id2 } }))?.version === 2)
    fil = await charger(D.page, G)
    verifie("Dave le lit", fil.find((m) => m.id === id2)?.content === texte2)

    titre("⑤ Changer la clé à la main")
    const refus = await B.page.evaluate(async (c) => {
      try {
        await (await import("/src/services/e2ee-groupe-admin.ts")).changerCle(c, "MANUEL")
        return null
      } catch (e) {
        return String(e?.status ?? e?.message ?? e)
      }
    }, G)
    verifie("refusé à Bob (membre)", refus !== null, String(refus))
    const r3 = await A.page.evaluate(
      async (c) => (await import("/src/services/e2ee-groupe-admin.ts")).changerCle(c, "MANUEL"),
      G,
    )
    verifie("accepté pour Alice : version 3", r3?.version === 3, JSON.stringify(r3))
    verifie("Bob reçoit la 3", JSON.stringify(await attendreVersions(B.page, G, [1, 2, 3])) === "[1,2,3]")

    titre("⑥bis Lot 7 : l'écran")
    await B.page.goto(`${WEB}/chats/${G}`, { waitUntil: "networkidle" })
    await fermerPortillon(B.page, "Bob")
    const avisActive = await B.page.getByText(/a activé le chiffrement de bout en bout/).first()
      .waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false)
    verifie("l'avis « a activé le chiffrement » s'affiche", avisActive)
    verifie("l'avis « a changé la clé du groupe » s'affiche",
      await B.page.getByText(/a changé la clé du groupe/).first().isVisible().catch(() => false))

    // Une version 4 qu'Alice a, et que Bob n'a pas encore.
    const v4 = await A.page.evaluate(async (c) => {
      const g = await import("/src/services/e2ee-groupe.ts")
      const gf = await import("/src/services/e2ee-groupe-fil.ts")
      const cle = g.genererCleGroupe()
      await gf.rangerTrousseau(c, [{ n: 4, cle, creeLe: Date.now() }], { deposerCopie: false })
      return btoa(String.fromCharCode(...cle))
    }, G)
    await prisma.e2eeCleVersion.create({
      data: { convId: G, version: 4, creePar: alice.id, creeParAppareil: (await prisma.e2eeIdentite.findFirst({ where: { userId: alice.id } })).deviceId, motif: "MANUEL" },
    })
    await prisma.conversation.update({ where: { id: G }, data: { cleVersion: 4 } })
    const texte4 = `En version 4 ${Date.now().toString(36)}`
    await envoyer(A.page, G, texte4)
    /*
     * ⚠️ DEPUIS LE 10/10, BOB REDEMANDE AUSSITÔT LA CLÉ AUX ADMINISTRATEURS, et
     * Alice la renvoie en un instant : la bulle « en attente » ne durerait pas
     * assez pour être vue. On bloque ses dépôts le temps de la regarder.
     */
    const bloquerDepots = (r) => (r.request().method() === "POST" ? r.abort() : r.continue())
    await B.page.route("**/api/e2ee/enveloppes", bloquerDepots)
    await B.page.reload({ waitUntil: "networkidle" })
    await fermerPortillon(B.page, "Bob")
    const attente = await B.page.getByText("Message chiffré — en attente de la clé du groupe.").first()
      .waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false)
    verifie("la bulle dit « en attente de la clé du groupe »", attente)
    await B.page.unroute("**/api/e2ee/enveloppes", bloquerDepots)
    // Alice distribue la version 4 : la sonnette e2ee_trousseau rouvre le fil de Bob.
    await A.page.evaluate(
      async ([c, cle, dest]) => {
        const admin = await import("/src/services/e2ee-groupe-admin.ts")
        const gf = await import("/src/services/e2ee-groupe-fil.ts")
        return admin.distribuerTrousseau(c, "MANUEL", await gf.trousseauLocal(c), dest)
      },
      [G, v4, [bob.id, dave.id]],
    )
    const rempli = await B.page.getByText(texte4, { exact: true }).first()
      .waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false)
    verifie("la clé arrive : la bulle se remplit sans recharger", rempli)

    titre("⑥ Lot 6 : la copie personnelle, et un nouvel appareil")
    let copies = []
    for (let i = 0; i < 20; i++) {
      copies = await prisma.e2eeTrousseau.findMany({ where: { convId: G } })
      if (copies.some((c) => c.userId === bob.id) && copies.some((c) => c.userId === alice.id)) break
      await pause(400)
    }
    verifie("Alice et Bob ont déposé leur copie", copies.some((c) => c.userId === alice.id) && copies.some((c) => c.userId === bob.id),
      JSON.stringify(copies.map((c) => c.userId)))
    verifie("aucune copie pour Carole (exclue)", !copies.some((c) => c.userId === carole.id))
    const copieBob = copies.find((c) => c.userId === bob.id)?.corps ?? ""
    const cles = await B.page.evaluate(async (c) => {
      const gf = await import("/src/services/e2ee-groupe-fil.ts")
      const t = await gf.trousseauLocal(c)
      return t.map((v) => btoa(String.fromCharCode(...v.cle)))
    }, G)
    verifie("la copie ne contient aucune clé en clair", cles.length === 4 && cles.every((k) => !copieBob.includes(k)) &&
      !copieBob.includes("trousseau"))

    const B2 = await connecter(navigateur, bob)
    verifie("nouvel appareil de Bob : clés publiées", await attendreCles(bob, 2))
    verifie("son archive s'ouvre avec le mot de passe", await attendreArchive(B2.page))
    let repris = []
    for (let i = 0; i < 30; i++) {
      repris = await versionsLocales(B2.page, G)
      if (repris.length === 4) break
      await pause(500)
    }
    verifie("il reprend les quatre versions depuis sa copie", JSON.stringify(repris) === "[1,2,3,4]", JSON.stringify(repris))
    fil = await charger(B2.page, G)
    verifie("il relit tout l'historique", fil.find((m) => m.id === id1)?.content === texte1 &&
      fil.find((m) => m.id === id2)?.content === texte2)

    titre("⑦ Repli APPAREIL : pas de copie, un autre appareil répond")
    await prisma.e2eeTrousseau.deleteMany({ where: { convId: G, userId: bob.id } })
    const B3 = await connecter(navigateur, bob)
    verifie("troisième navigateur de Bob : clés publiées", await attendreCles(bob, 3))
    await attendreArchive(B3.page)
    verifie("il n'a aucune clé, et aucune copie ne l'attend",
      (await versionsLocales(B3.page, G)).length === 0 &&
        (await prisma.e2eeTrousseau.count({ where: { convId: G, userId: bob.id } })) === 0)
    await charger(B3.page, G) // une clé manque : la demande part
    let recues = []
    for (let i = 0; i < 40; i++) {
      recues = await versionsLocales(B3.page, G)
      if (recues.length === 4) break
      await pause(500)
    }
    verifie("ses autres navigateurs lui renvoient les quatre versions", JSON.stringify(recues) === "[1,2,3,4]",
      JSON.stringify(recues))
    fil = await charger(B3.page, G)
    verifie("et il relit l'historique", fil.find((m) => m.id === id1)?.content === texte1)
    // Le refus d'une demande venue d'un AUTRE compte est prouvé côté mobile
    // (test Dart) : ici, Carole exclue n'a de toute façon plus accès au groupe.

    titre("⑧ Pas de limite de clés : 1 000 versions")
    const bilanMille = await A.page.evaluate(
      async ([c, dest]) => {
        const gf = await import("/src/services/e2ee-groupe-fil.ts")
        const admin = await import("/src/services/e2ee-groupe-admin.ts")
        const neuves = []
        for (let n = 5; n <= 1000; n++) {
          neuves.push({ n, cle: crypto.getRandomValues(new Uint8Array(32)), creeLe: n })
        }
        const toutes = await gf.rangerTrousseau(c, neuves, { deposerCopie: false })
        return admin.distribuerTrousseau(c, "MANUEL", toutes, dest)
      },
      [G, [bob.id]],
    )
    verifie("le vrai serveur accepte la distribution (aucun échec)",
      bilanMille.echecs.length === 0 && bilanMille.appareils >= 3, JSON.stringify(bilanMille))
    let mille = []
    for (let i = 0; i < 30; i++) {
      await relever(B.page)
      mille = await versionsLocales(B.page, G)
      if (mille.length === 1000) break
      await pause(500)
    }
    verifie("Bob reçoit les 1 000 versions", mille.length === 1000 && mille[999] === 1000, String(mille.length))
    let copieMille = null
    for (let i = 0; i < 20; i++) {
      copieMille = await prisma.e2eeTrousseau.findUnique({ where: { userId_convId: { userId: bob.id, convId: G } } })
      if (copieMille && copieMille.corps.length > 100_000) break
      await pause(400)
    }
    verifie("sa copie personnelle les garde toutes",
      (copieMille?.corps.length ?? 0) > 100_000, String(copieMille?.corps.length))

    titre("⑨ Clé perdue : l'administratrice la renvoie")
    await D.page.evaluate(async (c) => (await import("/src/services/e2ee-groupe-fil.ts")).oublierTrousseau(c), G)
    await prisma.e2eeTrousseau.deleteMany({ where: { convId: G, userId: dave.id } })
    // Ni boîte (un appareil apparu après la distribution) : c'est le chemin de
    // la demande à l'administratrice qu'on éprouve ici ; ⑩ éprouve la boîte.
    await prisma.e2eeBoite.deleteMany({ where: { convId: G, userId: dave.id } })
    verifie("Dave n'a plus aucune clé, ni copie, ni autre appareil",
      (await versionsLocales(D.page, G)).length === 0 &&
        (await prisma.e2eeIdentite.count({ where: { userId: dave.id } })) === 1)
    await charger(D.page, G) // une clé manque : la demande part, aussi vers l'administratrice
    let rendues = []
    for (let i = 0; i < 40; i++) {
      rendues = await versionsLocales(D.page, G)
      if (rendues.length === 1000) break
      await pause(500)
    }
    verifie("l'administratrice lui renvoie tout le trousseau", rendues.length === 1000, String(rendues.length))
    fil = await charger(D.page, G)
    verifie("et Dave relit l'historique", fil.find((m) => m.id === id1)?.content === texte1)

    titre("⑩ Aucun administrateur en ligne : la boîte permanente")
    verifie("Dave a une boîte permanente sur le serveur",
      (await prisma.e2eeBoite.count({ where: { convId: G, userId: dave.id } })) >= 1)
    const erreursAlice = [...A.erreurs]
    await A.contexte.close() // Alice, seule administratrice, n'est plus là
    await D.page.evaluate(async (c) => (await import("/src/services/e2ee-groupe-fil.ts")).oublierTrousseau(c), G)
    await prisma.e2eeTrousseau.deleteMany({ where: { convId: G, userId: dave.id } })
    verifie("Dave n'a plus de clé ni de copie", (await versionsLocales(D.page, G)).length === 0)
    const enveloppesAvant = await prisma.e2eeEnveloppe.count({ where: { convId: G, destinataireId: dave.id } })
    // ⚠️ Le repos de 30 s entre deux restaurations d'un même groupe court
    // encore depuis ⑨ : on le laisse passer, sinon la boîte ne serait pas relue.
    await pause(31_000)
    await charger(D.page, G) // une clé manque : la boîte est relue
    const deLaBoite = await versionsLocales(D.page, G)
    verifie("ses 1 000 versions viennent de la boîte", deLaBoite.length === 1000, `${deLaBoite.length} versions`)
    fil = await charger(D.page, G)
    verifie("il relit l'historique avec elles", fil.find((m) => m.id === id1)?.content === texte1,
      JSON.stringify(fil.find((m) => m.id === id1)))
    verifie("… et aucune enveloppe n'a été nécessaire",
      (await prisma.e2eeEnveloppe.count({ where: { convId: G, destinataireId: dave.id } })) === enveloppesAvant)

    const erreurs = [...erreursAlice, ...B.erreurs, ...C.erreurs, ...D.erreurs, ...B2.erreurs, ...B3.erreurs]
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
