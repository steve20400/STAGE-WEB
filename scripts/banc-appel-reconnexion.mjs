/**
 * Banc d'essai bout en bout : DEUX vrais clients web, un vrai appel, une vraie
 * coupure reseau.
 *
 * Pile visee (tout en local, rien de la production) :
 *   - API Next          http://localhost:3002
 *   - temps reel        ws://localhost:3010   (sursis raccourci par variable)
 *   - client web (vite) http://localhost:5173
 *
 * LA COUPURE TUE LA VRAIE SOCKET, par interception (`page.routeWebSocket`).
 * `Network.emulateNetworkConditions` ne suffit PAS : Chrome laisse vivre une
 * socket deja ouverte, le serveur ne voyait donc partir personne, et le banc
 * concluait a tort que le client n'affichait rien.
 *
 * Prealables : `npm i -D playwright-core`, l'API sur 3002, le temps reel sur
 * 3010 (`SURSIS_RECONNEXION_MS` raccourci), vite sur 5173, et
 * `node scripts/prepare-banc.mjs` cote backend avant chaque passage.
 */
import { chromium } from "playwright-core"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
const WEB = "http://localhost:5173"
const COMPTES = JSON.parse(
  readFileSync("C:/Users/Administrator/Documents/Dev/backend-alanya-appels/banc-comptes.json", "utf8"),
)
const CLICHES = "C:/Users/ADMINI~1/AppData/Local/Temp/claude/C--Users-Administrator/5f1fd8db-ab80-484c-8b83-8500c8cd429c/scratchpad"

let echecs = 0
const verifie = (ok, libelle, detail = "") => {
  if (!ok) echecs++
  console.log(`${ok ? "  OK  " : "ECHEC "} ${libelle}${detail ? "  — " + detail : ""}`)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/** Attend qu'un texte apparaisse dans la page, sans faire echouer le banc. */
async function attendTexte(page, motif, plafondMs = 20000) {
  const debut = Date.now()
  while (Date.now() - debut < plafondMs) {
    const corps = await page.textContent("body").catch(() => "")
    if (corps && motif.test(corps)) return true
    await pause(300)
  }
  return false
}

async function connecte(navigateur, compte, nom, interception) {
  const contexte = await navigateur.newContext({ permissions: ["microphone", "camera"] })
  const page = await contexte.newPage()

  /*
   * On s'interpose sur la WebSocket temps reel pour pouvoir la TUER en plein
   * appel. `Network.emulateNetworkConditions` ne suffit pas : Chrome laisse
   * vivre une socket deja ouverte, et le serveur ne voyait donc jamais partir
   * personne — la coupure n'en etait pas une.
   */
  if (interception) {
    await page.routeWebSocket(/:3010/, (ws) => {
      const serveur = ws.connectToServer()
      interception.vivante = { ws, serveur }
      ws.onMessage((m) => serveur.send(m))
      serveur.onMessage((m) => ws.send(m))
      ws.onClose(() => serveur.close())
      serveur.onClose(() => ws.close())
    })
  }
  page.on("console", (m) => {
    const t = m.text()
    if (/webrtc|reconnex|ICE|call_rejoin/i.test(t)) console.log(`      [${nom}] ${t}`)
  })
  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#phone", { timeout: 30000 })
  await page.fill("#phone", compte.numero)
  await page.fill("#password", COMPTES.motDePasse)
  await page.click(".btn-submit")
  const entre = await attendTexte(page, /.+/, 5000)
  await page.waitForSelector("#phone", { state: "detached", timeout: 30000 }).catch(() => {})

  // Premiere connexion : une fenetre « Nommez cet appareil » couvre l'ecran et
  // avale tous les clics tant qu'on ne l'a pas refermee.
  if (await attendTexte(page, /Nommez cet appareil/i, 6000)) {
    const champs = await page.$$("input")
    if (champs.length) await champs[champs.length - 1].fill(`Banc ${nom}`)
    await page.click("text=Enregistrer", { timeout: 8000 }).catch(() => {})
    await pause(1200)
  }
  return { contexte, page, entre }
}

async function main() {
  const navigateur = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  })

  const socketDeA = { vivante: null }
  const A = await connecte(navigateur, COMPTES.a, "A", socketDeA)
  const B = await connecte(navigateur, COMPTES.b, "B")

  verifie(!(await A.page.$("#phone")), `connexion de A (${COMPTES.a.numero})`, A.page.url())
  verifie(!(await B.page.$("#phone")), `connexion de B (${COMPTES.b.numero})`, B.page.url())
  if (echecs) {
    await A.page.screenshot({ path: `${CLICHES}/banc-A-connexion.png` })
    await B.page.screenshot({ path: `${CLICHES}/banc-B-connexion.png` })
    await navigateur.close()
    return
  }

  // --- A appelle B
  await A.page.goto(`${WEB}/calls/new`, { waitUntil: "domcontentloaded" })
  await pause(1500)
  const champ = await A.page.$("input")
  if (champ) await champ.fill(COMPTES.b.nom)
  await pause(1000)
  const ligne = A.page.locator(`text=${COMPTES.b.nom}`).first()
  await ligne.click({ timeout: 15000 }).catch(() => {})
  await A.page.click(".new-call-btn", { timeout: 15000 }).catch(() => {})

  const sonne = await attendTexte(B.page, /Appel entrant|Incoming|appelle/i, 25000)
  verifie(sonne, "B voit l'appel entrant")
  if (!sonne) {
    await A.page.screenshot({ path: `${CLICHES}/banc-A-appel.png` })
    await B.page.screenshot({ path: `${CLICHES}/banc-B-appel.png` })
    await navigateur.close()
    return
  }

  await B.page.click(".ical-action.accept", { timeout: 15000 })
  const enLigne = await attendTexte(B.page, /\d{2}:\d{2}/, 30000)
  verifie(enLigne, "l'appel est etabli (chronometre affiche)")

  /*
   * L'ECRAN NE SUFFIT PAS : il affiche un chronometre des l'acceptation, alors
   * que la base peut encore etre en RINGING si la requete d'acceptation traine.
   * Or le sursis ne couvre QUE les appels decroches — couper trop tot testait
   * donc le chemin oppose a celui qu'on veut prouver.
   */
  let etat = ""
  for (let i = 0; i < 25; i++) {
    etat = execFileSync("node", ["etat-appel.mjs"], {
      cwd: "C:/Users/Administrator/Documents/Dev/backend-alanya-appels",
      encoding: "utf8",
    }).trim()
    if (etat.startsWith("ONGOING")) break
    await pause(1000)
  }
  verifie(etat.startsWith("ONGOING"), "la base porte bien un appel DECROCHE avant la coupure", etat)
  if (!etat.startsWith("ONGOING")) {
    await navigateur.close()
    console.log(`\n${echecs} ECHEC(S)\n`)
    process.exit(1)
  }

  // --- la coupure : la socket de A meurt sans un mot, comme dans un tunnel
  verifie(!!socketDeA.vivante, "la socket de A est bien sous interception")
  socketDeA.vivante?.serveur.close()
  socketDeA.vivante?.ws.close()
  console.log("      >>> la socket temps reel de A est coupee")

  // On observe SECONDE PAR SECONDE ce que B affiche : c'est le delai de
  // detection qu'on mesure autant que l'affichage lui-meme.
  let vuA = 0
  let reconnexionVueA = 0
  for (let s = 1; s <= 60; s++) {
    await pause(1000)
    const corps = (await B.page.textContent("body").catch(() => "")) ?? ""
    if (/Reconnexion/i.test(corps) && !reconnexionVueA) {
      reconnexionVueA = s
      console.log(`      >>> B affiche « Reconnexion… » apres ${s} s`)
    }
    if (/Appel termin|Call ended/i.test(corps) && !vuA) {
      vuA = s
      console.log(`      >>> B voit « Appel termine » apres ${s} s`)
      break
    }
    if (reconnexionVueA) break
  }
  verifie(reconnexionVueA > 0, "B affiche « Reconnexion… »", reconnexionVueA ? `au bout de ${reconnexionVueA} s` : "jamais en 60 s")
  verifie(vuA === 0, "l'appel n'est PAS termine pendant la coupure")

  // --- le retour : l'application rouvre sa socket toute seule (backoff), et
  // l'interception la reprend au vol. On n'a donc rien a « rebrancher ».
  console.log("      >>> on laisse A se reconnecter tout seul")

  // Reprendre, c'est SORTIR de « Reconnexion… » — pas seulement afficher un
  // chronometre, qui n'a jamais disparu.
  let repriseVueA = 0
  for (let s = 1; s <= 40; s++) {
    await pause(1000)
    const corps = (await B.page.textContent("body").catch(() => "")) ?? ""
    if (!/Reconnexion/i.test(corps) && !/Appel termin|Call ended/i.test(corps)) {
      repriseVueA = s
      break
    }
  }
  verifie(repriseVueA > 0, "B sort de « Reconnexion… » : l'appel a repris", repriseVueA ? `apres ${repriseVueA} s` : "jamais en 40 s")

  const finInattendue = await attendTexte(B.page, /Appel termin|Call ended/i, 2000)
  verifie(!finInattendue, "aucune fin d'appel apres le retour du reseau")

  await A.page.screenshot({ path: `${CLICHES}/banc-A-final.png` })
  await B.page.screenshot({ path: `${CLICHES}/banc-B-final.png` })
  await navigateur.close()

  console.log(`\n${echecs === 0 ? "TOUT EST VERT" : echecs + " ECHEC(S)"}\n`)
  process.exit(echecs === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error("banc interrompu :", e)
  process.exit(2)
})
