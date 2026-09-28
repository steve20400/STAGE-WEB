/**
 * LA PAGE /restauration, DANS LE VRAI CHROME.
 *
 * Demande du user, 28/09/2026 : entre la connexion et la session, une page
 * récupère l'archive, la déchiffre, la range en local, avec une barre.
 *
 * LE SCÉNARIO :
 *   · un compte vierge reçoit une archive de 120 messages (préparation par
 *     `restauration-connexion.mjs`, vrais modules, vrai serveur) ;
 *   · un navigateur NEUF se connecte par l'écran de connexion ;
 *   · il doit passer par /restauration, y voir la barre, puis arriver sur
 *     /chats — et les 120 messages doivent être dans SON cache local.
 *
 * Usage : node scripts/restauration-navigateur.mjs   (backend :3000, web :5173)
 */
import { execSync } from "node:child_process"
import { chromium } from "playwright"

const WEB = process.env.WEB_URL ?? "http://localhost:5173"
const EMAIL = "restauration@e2ee.test"
const MDP = "MotDePasseDeTest!2026"

let echecs = 0
function verifie(libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`)
  if (!condition) {
    echecs++
    if (detail !== undefined) console.log(`      \x1b[31m${detail}\x1b[0m`)
  }
}

console.log("\n⚙  Préparation : compte vierge + archive de 120 messages…")
execSync("node scripts/restauration-connexion.mjs", {
  stdio: "inherit",
  env: { ...process.env, RESTAURATION_PREP: "1" },
})

console.log("\n\x1b[1m════ LA PAGE /restauration, DANS CHROME ════\x1b[0m")
const navigateur = await chromium.launch({ channel: "chrome" })
try {
  const page = await (await navigateur.newContext()).newPage()
  const chemins = []
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) chemins.push(new URL(f.url()).pathname)
  })

  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" })
  await page.locator("#phone").fill(EMAIL)
  await page.locator("#password").fill(MDP)
  await page.locator("button.btn-submit").click()

  const vuePage = await page
    .waitForURL((u) => u.pathname.endsWith("/restauration"), { timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  verifie("la connexion mène à /restauration", vuePage, chemins.join(" → "))

  const barre = await page
    .locator(".restauration [role=progressbar]")
    .waitFor({ state: "attached", timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  verifie("la barre de progression s'affiche", barre)

  const arrive = await page
    .waitForURL((u) => u.pathname.startsWith("/chats"), { timeout: 60000 })
    .then(() => true)
    .catch(() => false)
  verifie("puis la session s'ouvre sur /chats", arrive, chemins.join(" → "))

  const enCache = await page.evaluate(
    () =>
      new Promise((ok) => {
        const r = indexedDB.open("alanya_messaging_client_db")
        r.onerror = () => ok(-1)
        r.onsuccess = () => {
          const db = r.result
          if (!db.objectStoreNames.contains("messages")) return ok(-2)
          const tout = db.transaction("messages").objectStore("messages").getAll()
          tout.onsuccess = () =>
            ok(tout.result.filter((m) => String(m.id).startsWith("restau-")).length)
          tout.onerror = () => ok(-3)
        }
      }),
  )
  verifie("les 120 messages sont dans le cache de CE navigateur", enCache === 120, `${enCache}`)
} finally {
  await navigateur.close()
}

console.log(
  `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
)
process.exit(echecs === 0 ? 0 : 1)
