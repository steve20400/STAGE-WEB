/**
 * BANC VISUEL — REVUE DES ÉCRANS à toutes les largeurs (20/11/2026).
 *
 * Rejoue HORS LIGNE la session enregistrée par `enregistrer-session.mjs`
 * (fichier HAR) : aucune connexion au serveur, aucun tunnel. Pour chaque écran
 * et chaque largeur, une capture d'écran et des mesures :
 *   · défilement horizontal de la page (un écran qui déborde) ;
 *   · taille de police calculée du corps de texte et du champ de saisie ;
 *   · cibles tactiles trop petites (au téléphone).
 *
 * Usage : node scripts/banc-ecrans/revue-ecrans.mjs <url-web> <id-groupe> <fichier.har> <dossier-captures> [écran,…]
 */
import fs from "node:fs"
import { chromium } from "playwright"

const web = (process.argv[2] ?? "http://localhost:5200").replace(/\/$/, "")
const groupe = process.argv[3]
const har = process.argv[4]
const dossier = process.argv[5] ?? "."
const filtre = process.argv[6]?.split(",")
fs.mkdirSync(dossier, { recursive: true })

const LARGEURS = [
  ["360", { width: 360, height: 760 }, true],
  ["768", { width: 768, height: 1024 }, true],
  ["1024", { width: 1024, height: 768 }, false],
  ["1440", { width: 1440, height: 900 }, false],
  ["2560", { width: 2560, height: 1440 }, false],
]
const ECRANS = [
  ["liste", "/chats"],
  ["groupe", `/chats/${groupe}`],
  ["infos", `/chats/${groupe}/info`],
  ["statuts", "/status"],
  ["appels", "/calls"],
  ["contacts", "/contacts"],
  ["reglages", "/settings"],
  ["reunions", "/meetings"],
  ["collegues", "/collegues"],
  ["entreprises", "/entreprises"],
  ["assistant", "/ai"],
].filter(([n]) => !filtre || filtre.includes(n))

// La session enregistrée appartient à l'origine d'enregistrement (son port) :
// elle est replacée sur celle du web testé, sinon on tombe sur la connexion.
const etatSession = JSON.parse(fs.readFileSync(har.replace(/\.har$/, ".storage.json"), "utf8"))
for (const o of etatSession.origins ?? []) o.origin = new URL(web).origin

const navigateur = await chromium.launch({ channel: process.env.NAVIGATEUR ?? "msedge" })
const resume = []
for (const [nomLargeur, viewport, tactile] of LARGEURS) {
  const contexte = await navigateur.newContext({
    viewport,
    hasTouch: tactile,
    isMobile: tactile,
    storageState: etatSession,
  })
  await contexte.routeFromHAR(har, { url: /:3100\//, notFound: "abort" })
  // L'appareil a déjà un nom : pas de fenêtre « Nommez cet appareil ».
  await contexte.addInitScript(() => localStorage.setItem("alanya-pseudo-appareil-30000999", "Banc visuel"))
  const page = await contexte.newPage()
  const erreurs = []
  page.on("pageerror", (e) => erreurs.push(e.message))
  for (const [nomEcran, chemin] of ECRANS) {
    await page.goto(`${web}${chemin}`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2500)
    const fichier = `${dossier}/${nomEcran}-${nomLargeur}.png`
    await page.screenshot({ path: fichier })
    const m = await page.evaluate((tactile) => {
      const doc = document.documentElement
      const champ = document.querySelector("textarea, input[type=text], input:not([type])")
      const petites = tactile
        ? [...document.querySelectorAll("button, a[href], [role=button]")].filter((el) => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40) && getComputedStyle(el).visibility !== "hidden"
          }).length
        : null
      return {
        debordeX: doc.scrollWidth > window.innerWidth + 1 ? doc.scrollWidth - window.innerWidth : 0,
        policeRacine: getComputedStyle(doc).fontSize,
        policeBody: getComputedStyle(document.body).fontSize,
        policeChamp: champ ? getComputedStyle(champ).fontSize : null,
        ciblesPetites: petites,
      }
    }, tactile)
    resume.push({ ecran: nomEcran, largeur: nomLargeur, ...m, erreurs: erreurs.splice(0).length })
  }
  await contexte.close()
}
await navigateur.close()
fs.writeFileSync(`${dossier}/resume.json`, JSON.stringify(resume, null, 1))
for (const r of resume) {
  console.log(
    `${r.ecran.padEnd(9)} ${r.largeur.padStart(4)}px  débord ${String(r.debordeX).padStart(4)}  racine ${r.policeRacine}  corps ${r.policeBody}  champ ${r.policeChamp ?? "-"}  petites cibles ${r.ciblesPetites ?? "-"}  erreurs ${r.erreurs}`,
  )
}
