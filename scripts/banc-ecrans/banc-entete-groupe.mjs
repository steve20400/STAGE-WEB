/**
 * BANC VISUEL — l'en-tête d'un grand groupe (20/11/2026).
 *
 * Signalé par le user : dans un groupe de ~80 personnes, la liste des membres
 * de l'en-tête couvrait tout l'écran. Ce banc ouvre la VRAIE application,
 * connectée au serveur de TEST (base alanya_banc), entre dans un groupe de 80
 * membres et vérifie que l'en-tête reste sur sa hauteur normale, au bureau puis
 * à la largeur d'un téléphone (même session, fenêtre redimensionnée). Captures
 * d'écran à regarder.
 *
 * Prérequis : groupe « 3GI (banc) » et compte ecran-moi@e2ee.test sur la base
 * de test, API de test joignable (tunnel SSH vers le port 3100), et le web
 * lancé avec VITE_API_BASE_URL=http://localhost:3100.
 *
 * Usage : node scripts/banc-ecrans/banc-entete-groupe.mjs <url-web> <id-groupe> <dossier-captures>
 */
import { chromium } from "playwright"

const web = (process.argv[2] ?? "http://localhost:5200").replace(/\/$/, "")
const groupe = process.argv[3]
const dossier = process.argv[4] ?? "."
let echecs = 0
const verifie = (libelle, ok, detail) => {
  console.log(`  ${ok ? "OK   " : "ECHEC"} ${libelle}${ok || detail === undefined ? "" : " — " + detail}`)
  if (!ok) echecs++
}

const navigateur = await chromium.launch({ channel: process.env.NAVIGATEUR ?? "msedge" })
const page = await navigateur.newPage({ viewport: { width: 1280, height: 860 } })
const erreurs = []
page.on("pageerror", (e) => erreurs.push(e.message))

await page.goto(`${web}/login`, { waitUntil: "domcontentloaded" })
await page.fill("#phone", "ecran-moi@e2ee.test")
await page.fill("#password", "MotDePasseDeTest!2026")
await page.click("button.btn-submit")
await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(2500)
// L'écran « Récupération de vos messages » peut précéder la liste.
const arrierePlan = page.locator('button:has-text("arrière-plan")')
if (await arrierePlan.count()) {
  await arrierePlan.click()
  await page.waitForTimeout(1500)
}
// La fenêtre « Nommez cet appareil » apparaît à la première connexion.
const nomAppareil = page.locator('input[placeholder*="Poste"]')
if (await nomAppareil.count()) {
  await nomAppareil.fill("Banc visuel")
  await page.keyboard.press("Enter")
  await page.waitForTimeout(800)
}

for (const [nom, taille] of [["bureau", { width: 1280, height: 860 }], ["telephone", { width: 390, height: 780 }]]) {
  console.log(`\n== ${nom}`)
  await page.setViewportSize(taille)
  await page.goto(`${web}/chats/${groupe}`, { waitUntil: "domcontentloaded" })
  try {
    await page.waitForSelector(".room-name", { timeout: 30000 })
  } catch (e) {
    await page.screenshot({ path: `${dossier}/groupe-${nom}-echec.png` })
    throw e
  }
  await page.waitForFunction(() => (document.querySelector(".room-sub")?.textContent ?? "").includes(","), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${dossier}/groupe-${nom}-conversation.png` })

  const m = await page.evaluate(() => {
    const sous = document.querySelector(".room-sub")
    const entete = sous?.parentElement?.parentElement
    const r = sous.getBoundingClientRect()
    const ligne = parseFloat(getComputedStyle(sous).lineHeight) || parseFloat(getComputedStyle(sous).fontSize) * 1.4
    return {
      hauteurSous: r.height,
      ligne,
      hauteurEntete: entete?.getBoundingClientRect().height ?? 0,
      texte: sous.textContent.length,
      infobulle: (sous.getAttribute("title") ?? "").length,
    }
  })
  verifie("la liste des membres est chargée (texte long)", m.texte > 300, `${m.texte} caractères`)
  verifie("la liste tient sur UNE ligne", m.hauteurSous <= m.ligne * 1.5, JSON.stringify(m))
  verifie("l'en-tête garde sa hauteur normale (< 90 px)", m.hauteurEntete < 90, `${m.hauteurEntete}px`)
  verifie("la liste complète reste en infobulle", m.infobulle > 300, `${m.infobulle}`)
  verifie("aucune erreur dans la page", erreurs.length === 0, erreurs.join(" | "))
}
await navigateur.close()
console.log(echecs === 0 ? "\nTout est conforme." : `\n${echecs} vérification(s) en échec.`)
process.exit(echecs === 0 ? 0 : 1)
