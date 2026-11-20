/**
 * BANC VISUEL — ENREGISTRE une session réelle (20/11/2026).
 *
 * Se connecte au serveur de TEST avec le compte ecran-moi@e2ee.test, parcourt
 * les écrans principaux et enregistre tous les échanges avec l'API dans un
 * fichier HAR. `revue-ecrans.mjs` les rejoue ensuite HORS LIGNE, à toutes les
 * largeurs d'écran, sans serveur ni tunnel.
 *
 * Usage : node scripts/banc-ecrans/enregistrer-session.mjs <url-web> <id-groupe> <fichier.har>
 */
import { chromium } from "playwright"

const web = (process.argv[2] ?? "http://localhost:5200").replace(/\/$/, "")
const groupe = process.argv[3]
const har = process.argv[4] ?? "session.har"

const navigateur = await chromium.launch({ channel: process.env.NAVIGATEUR ?? "msedge" })
const contexte = await navigateur.newContext({
  viewport: { width: 1280, height: 860 },
  recordHar: { path: har, urlFilter: /:3100\//, content: "embed" },
})
const page = await contexte.newPage()
await page.goto(`${web}/login`, { waitUntil: "domcontentloaded" })
await page.fill("#phone", "ecran-moi@e2ee.test")
await page.fill("#password", "MotDePasseDeTest!2026")
await page.click("button.btn-submit")
await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 })
await page.waitForTimeout(3000)
const arrierePlan = page.locator('button:has-text("arrière-plan")')
if (await arrierePlan.count()) await arrierePlan.click()
const nomAppareil = page.locator('input[placeholder*="Poste"]')
if (await nomAppareil.count()) {
  await nomAppareil.fill("Banc visuel")
  await page.keyboard.press("Enter")
}
await page.waitForTimeout(1500)

for (const chemin of ["/chats", `/chats/${groupe}`, `/chats/${groupe}/info`, "/status", "/calls", "/contacts", "/settings", "/meetings", "/collegues", "/entreprises", "/ai"]) {
  await page.goto(`${web}${chemin}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3500)
  console.log("visité", chemin)
}
// Le jeton de session, pour rejouer la session sans se reconnecter.
const stockage = await contexte.storageState()
await contexte.close()
await navigateur.close()
const fs = await import("node:fs")
fs.writeFileSync(har.replace(/\.har$/, ".storage.json"), JSON.stringify(stockage))
console.log("HAR enregistré :", har)
