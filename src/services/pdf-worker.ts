/**
 * Mise en place du worker PDF.js, en un seul endroit.
 *
 * En production, ce worker est un fichier a part servi sous
 * /webapp/assets/pdf.worker-<hash>.mjs. Laisser le navigateur l'importer comme
 * module echoue chez une partie des utilisateurs :
 *
 *   Setting up fake worker failed: "Failed to fetch dynamically imported
 *   module: .../assets/pdf.worker-ByF8NTMy.mjs"
 *
 * L'import de module est la partie fragile. Il impose un type MIME exact — un
 * proxy, un antivirus ou un repli SPA qui renvoie autre chose fait tout echouer
 * meme avec un statut 200 —, il exige le support des workers de module, et il ne
 * laisse aucune prise pour reessayer.
 *
 * On telecharge donc le fichier nous-memes : un fetch ordinaire ne verifie aucun
 * type MIME, on peut controler que la reponse est bien du JavaScript, reessayer
 * une fois si le reseau a lache en route, et donner a PDF.js une URL blob:
 * locale, qui ne depend plus ni du serveur ni du reseau. Le worker de la
 * bibliotheque n'a aucun import externe, il fonctionne donc tel quel depuis un
 * blob.
 *
 * Le telechargement n'a lieu qu'une fois par session, et seulement si un PDF est
 * reellement ouvert : les deux appelants (l'apercu du fil et les vignettes des
 * citations) partagent la meme URL blob.
 */

/**
 * Variante minifiee : 1,4 Mo au lieu de 2,3 Mo pour un contenu identique. Sur un
 * reseau mobile, ce presque megaoctet en moins est la premiere cause d'echec
 * qu'on supprime.
 */
const WORKER_ASSET_URL = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()

/** Un seul telechargement par session, partage par tous les appelants. */
let workerSrc: Promise<string> | null = null

async function download(): Promise<string> {
  const response = await fetch(WORKER_ASSET_URL)
  if (!response.ok) throw new Error(`worker PDF indisponible (HTTP ${response.status})`)

  const code = await response.text()
  // Un repli SPA ou un portail captif repond 200 avec une page HTML. Sans ce
  // controle, le worker demarrerait sur du HTML et l'erreur serait illisible.
  if (/^\s*</.test(code)) throw new Error("worker PDF : page HTML recue au lieu du script")
  if (!code.includes("PDFWorker") && !code.includes("GlobalWorkerOptions") && code.length < 100_000) {
    throw new Error("worker PDF : contenu inattendu")
  }

  return URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
}

/** Un reseau mobile coupe en plein telechargement : une seconde tentative suffit le plus souvent. */
async function downloadWithRetry(): Promise<string> {
  try {
    return await download()
  } catch {
    return await download()
  }
}

/**
 * Configure PDF.js et rend la main quand son worker est pret a l'emploi.
 *
 * A appeler avant tout getDocument(). En cas d'echec la promesse est rejetee et
 * la prochaine tentative repart de zero, ce qui permet a l'appelant de proposer
 * un repli (lecteur natif du navigateur, icone typee) plutot que d'attendre.
 */
export async function ensurePdfWorker(pdfjs: {
  GlobalWorkerOptions: { workerSrc: string }
}): Promise<void> {
  if (!workerSrc) {
    workerSrc = downloadWithRetry().catch((error: unknown) => {
      workerSrc = null
      throw error
    })
  }

  pdfjs.GlobalWorkerOptions.workerSrc = await workerSrc
}
