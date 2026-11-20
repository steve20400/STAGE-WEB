/**
 * BANC VISUEL — l'éditeur de photo (20/11/2026).
 *
 * Ouvre la VRAIE composante dans un navigateur (Edge, ou Chrome) et la
 * manipule comme une main :
 *   ① des traits rapides, puis un toucher éclair (appui, mouvements, levée
 *     dans le même instant) — la course qui faisait planter la page ;
 *   ② les traits se VOIENT : épaisseur réelle à l'écran ;
 *   ③ un trait rouge au milieu de la photo est au même endroit dans l'image
 *     publiée ;
 *   ④ annuler, publier, aucune erreur dans la page.
 * Enregistre des captures d'écran (bureau et téléphone) à regarder.
 *
 * Usage : (serveur Vite lancé) node scripts/banc-ecrans/banc-editeur.mjs <url> <dossier-captures>
 */
import { chromium } from "playwright"

const url = process.argv[2] ?? "http://localhost:5173/scripts/banc-ecrans/editeur.html"
const dossier = process.argv[3] ?? "."
let echecs = 0
const verifie = (libelle, ok, detail) => {
  console.log(`  ${ok ? "OK   " : "ECHEC"} ${libelle}${ok || detail === undefined ? "" : " — " + detail}`)
  if (!ok) echecs++
}

// Edge (installé avec Windows) ou Chrome : aucun navigateur à télécharger.
const navigateur = await chromium.launch({ channel: process.env.NAVIGATEUR ?? "msedge" })
for (const [nom, taille] of [["bureau", { width: 1280, height: 860 }], ["telephone", { width: 390, height: 780 }]]) {
  console.log(`\n== ${nom}`)
  const page = await navigateur.newPage({ viewport: taille })
  const erreurs = []
  page.on("pageerror", (e) => erreurs.push(e.message))
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) erreurs.push(m.text())
  })
  await page.goto(url)
  await page.waitForSelector(".es-zone img")
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".es-zone")).visibility !== "hidden")

  await page.click("button[aria-pressed]") // le crayon
  const zone = await page.locator(".es-zone").boundingBox()
  const img = await page.locator(".es-zone img").boundingBox()
  verifie("la zone de dessin couvre exactement la photo", Math.abs(zone.width - img.width) < 1 && Math.abs(zone.height - img.height) < 1, JSON.stringify({ zone, img }))
  const cx = zone.x + zone.width / 2
  const cy = zone.y + zone.height / 2

  // ① Traits rapides à la souris.
  for (let i = 0; i < 6; i++) {
    const x0 = zone.x + zone.width * (0.15 + i * 0.05)
    await page.mouse.move(x0, zone.y + zone.height * 0.2)
    await page.mouse.down()
    for (let k = 1; k <= 5; k++) await page.mouse.move(x0 + k * 4, zone.y + zone.height * (0.2 + k * 0.04))
    await page.mouse.up()
  }
  // ① bis Toucher éclair : tout dans la même tâche, React n'a pas le temps de peindre.
  await page.evaluate(() => {
    const z = document.querySelector(".es-zone")
    const r = z.getBoundingClientRect()
    for (let n = 0; n < 10; n++) {
      const ev = (type, f) =>
        z.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: "touch", isPrimary: true,
          clientX: r.left + r.width * (0.6 + f * 0.2), clientY: r.top + r.height * (0.15 + n * 0.03) }))
      ev("pointerdown", 0)
      for (let k = 1; k <= 8; k++) ev("pointermove", k / 8)
      ev("pointerup", 1)
    }
  })
  await page.waitForTimeout(400)
  const traits = await page.locator(".es-traces polyline").count()
  verifie("16 traits dessinés, aucun perdu", traits === 16, `${traits} traits`)
  const vides = await page.$$eval(".es-traces polyline", (l) => l.filter((p) => !p.getAttribute("points")).length)
  verifie("aucun trait vide", vides === 0, `${vides} vides`)
  verifie("aucune erreur dans la page", erreurs.length === 0, erreurs.join(" | "))
  verifie("pas d'écran « rafraîchir »", (await page.locator("text=/rafra/i").count()) === 0)

  // ② Les traits se voient.
  const epaisseur = await page.$eval(".es-traces polyline", (l) => parseFloat(getComputedStyle(l).strokeWidth))
  verifie("épaisseur visible à l'écran (≥ 2 px)", epaisseur >= 2, `${epaisseur}px`)

  // ③ Un trait rouge horizontal au milieu de la photo.
  await page.locator(".es-couleurs button").nth(2).click()
  await page.mouse.move(cx - zone.width * 0.2, cy)
  await page.mouse.down()
  await page.mouse.move(cx + zone.width * 0.2, cy, { steps: 15 })
  await page.mouse.up()
  await page.screenshot({ path: `${dossier}/editeur-${nom}-dessin.png` })

  // ④ Annuler puis refaire le rouge, publier.
  await page.click('button:has-text("↶")')
  verifie("annuler retire le dernier trait", (await page.locator(".es-traces polyline").count()) === 16)
  await page.mouse.move(cx - zone.width * 0.2, cy)
  await page.mouse.down()
  await page.mouse.move(cx + zone.width * 0.2, cy, { steps: 15 })
  await page.mouse.up()
  await page.click(".es-publier")
  await page.waitForFunction(() => document.getElementById("resultat")?.textContent?.startsWith("publie"), null, { timeout: 15000 })
  const res = await page.textContent("#resultat")
  verifie("publication : une image JPEG", /^publie:image\/jpeg:\d{4,}/.test(res), res)
  const pixels = await page.evaluate(async () => {
    const f = window.__publie
    const b = await createImageBitmap(f)
    const c = document.createElement("canvas")
    c.width = b.width
    c.height = b.height
    const g = c.getContext("2d")
    g.drawImage(b, 0, 0)
    const lire = (fx, fy) => Array.from(g.getImageData(Math.round(fx * b.width), Math.round(fy * b.height), 1, 1).data)
    return { centre: lire(0.5, 0.5), dessus: lire(0.5, 0.42), taille: [b.width, b.height] }
  })
  const rouge = ([r, g, b]) => r > 180 && g < 110 && b < 110
  verifie("le trait rouge est au centre de l'image publiée", rouge(pixels.centre), JSON.stringify(pixels))
  verifie("…et pas à côté", !rouge(pixels.dessus), JSON.stringify(pixels))
  verifie("toujours aucune erreur", erreurs.length === 0, erreurs.join(" | "))
  await page.close()
}
await navigateur.close()
console.log(echecs === 0 ? "\nTout est conforme." : `\n${echecs} vérification(s) en échec.`)
process.exit(echecs === 0 ? 0 : 1)
