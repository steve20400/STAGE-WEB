/**
 * LA RESTAURATION À LA CONNEXION, SUIVIE — scénario compilé par
 * `restauration-connexion.mjs`, contre le VRAI serveur local.
 *
 * Éprouve `restaurerALaConnexionSuivie` (page `/restauration`, 28/09/2026) :
 * les trois issues qui comptent, et une progression qui avance dans l'ordre.
 */
import {
  estOuverte,
  lireSerrures,
  archiver,
  refermer,
  restaurerALaConnexionSuivie,
  toutEffacer,
  vider,
} from "../src/services/e2ee-sauvegarde"

const MDP = "MotDePasseDeTest!2026"
const N = 120

let echecs = 0
function verifie(libelle, condition, detail) {
  console.log(`  ${condition ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${libelle}`)
  if (!condition) {
    echecs++
    if (detail !== undefined) console.log(`      \x1b[31m${detail}\x1b[0m`)
  }
}
const titre = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`)

const ORDRE = ["ouverture", "telechargement", "dechiffrement", "rangement"]

export async function scenario() {
  console.log("\n\x1b[1m════ LA RESTAURATION À LA CONNEXION ════\x1b[0m")
  titre("① Un compte sans archive : rien à restaurer, et l'archive est créée")
  const r0 = await restaurerALaConnexionSuivie(MDP, async () => {})
  verifie("issue « rien à restaurer »", r0.issue === "rienARestaurer", r0.issue)
  verifie("l’archive est créée et ouverte sur cet appareil", await estOuverte())
  const serrures = await lireSerrures()
  verifie("une serrure « mot de passe » est posée", serrures.some((s) => s.type === "motdepasse"), JSON.stringify(serrures.map((s) => s.type)))

  titre(`② Cet appareil archive ${N} messages`)
  for (let n = 1; n <= N; n++) {
    archiver({
      id: `restau-${n}`,
      convId: "fil-restauration",
      expediteurId: "moi",
      texte: `message ${n}`,
      quand: Date.now() - (N - n) * 1000,
    })
    /*
     * ⚠️ PAR LOTS DE 9, CHACUN ATTENDU. Au 10ᵉ, `archiver` lance un dépôt SANS
     * l attendre : un `vider()` final trouvait alors le tampon vide et rendait
     * la main avant la fin des dépôts — la restauration lisait une archive
     * encore vide (vécu au premier essai).
     */
    if (n % 9 === 0 || n === N) await vider()
  }

  // Préparation seule, pour le banc navigateur (`restauration-navigateur.mjs`) :
  // l archive reste en place, un vrai Chrome viendra la restaurer.
  if (process.env.RESTAURATION_PREP) {
    refermer()
    return echecs
  }

  titre("③ Un appareil NEUF se connecte avec le bon mot de passe")
  refermer() // la clé quitte la mémoire ET le coffre local : appareil neuf
  const ranges = []
  const etapes = []
  const r1 = await restaurerALaConnexionSuivie(
    MDP,
    async (m) => {
      ranges.push(m)
    },
    (p) => etapes.push(p),
  )
  verifie("issue « restaurée »", r1.issue === "restauree", r1.issue)
  verifie(`les ${N} messages sont rangés`, ranges.length === N, `${ranges.length} rangé(s)`)
  verifie(
    "le plus récent est là",
    ranges.some((m) => m.texte === `message ${N}`),
  )
  const vues = [...new Set(etapes.map((p) => p.etape))]
  verifie(
    "les quatre étapes, dans l'ordre",
    JSON.stringify(vues) === JSON.stringify(ORDRE),
    JSON.stringify(vues),
  )
  const tele = etapes.filter((p) => p.etape === "telechargement").at(-1)
  verifie(
    "le total de l'archive est connu (serveur récent)",
    tele?.total !== undefined && tele.total === tele.fait,
    JSON.stringify(tele),
  )
  const range = etapes.filter((p) => p.etape === "rangement").at(-1)
  verifie(
    "le rangement finit à 100 %",
    range?.fait === N && range?.total === N,
    JSON.stringify(range),
  )

  titre("④ Un appareil neuf, un MAUVAIS mot de passe : « fermée », pas « échec »")
  refermer()
  const r2 = await restaurerALaConnexionSuivie("pas-le-bon", async () => {})
  verifie("issue « fermée »", r2.issue === "fermee", r2.issue)

  await toutEffacer().catch(() => undefined)
  console.log(
    `\n\x1b[1m════ ${echecs === 0 ? "\x1b[32mTOUT EST VERT" : `\x1b[31m${echecs} ÉCHEC(S)`}\x1b[0m\x1b[1m ════\x1b[0m\n`,
  )
  return echecs
}
