import { loadPreviewBlob } from "./media-preview-cache"
import { ensurePdfWorker } from "./pdf-worker"

/**
 * Vignettes reelles pour les blocs de citation (repondre a un message).
 *
 * Volontairement en memoire seulement : les octets sources, eux, sont deja
 * caches dans IndexedDB par loadPreviewBlob. Regenerer un rendu de 96 px depuis
 * un blob deja present coute quelques dizaines de millisecondes, ce qui ne
 * justifie pas une seconde couche de persistance a entretenir.
 */

/** Cote maximal de la vignette generee, en pixels. */
const THUMBNAIL_SIZE = 96

/** Qualite JPEG : au-dela, le gain visuel a cette taille est nul. */
const THUMBNAIL_QUALITY = 0.72

const cache = new Map<string, string | null>()
const inFlight = new Map<string, Promise<string | null>>()

/**
 * Premiere page d'un PDF en data-URL, ou null si le document est illisible.
 *
 * Un echec est un cas normal, pas une anomalie : sans proxy same-origin, les
 * octets sont hors de portee (voir MEDIA_PREVIEW_PROXY.md). L'appelant retombe
 * alors sur l'icone typee du fichier.
 */
export function loadPdfThumbnail(url: string): Promise<string | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null)

  const pending = inFlight.get(url)
  if (pending) return pending

  const task = renderPdfThumbnail(url)
    .catch(() => null)
    .then((dataUrl) => {
      cache.set(url, dataUrl)
      inFlight.delete(url)
      return dataUrl
    })

  inFlight.set(url, task)
  return task
}

async function renderPdfThumbnail(url: string): Promise<string | null> {
  const blob = await loadPreviewBlob(url)
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  await ensurePdfWorker(pdfjs)

  const loadingTask = pdfjs.getDocument({ data: await blob.arrayBuffer() })
  try {
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(1)
    const natural = page.getViewport({ scale: 1 })
    const scale = THUMBNAIL_SIZE / Math.max(natural.width, natural.height)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    const context = canvas.getContext("2d")
    if (!context) return null

    // Un PDF ne peint pas son fond : sans ce blanc, la page sort transparente
    // et devient illisible sur le fond sombre du bloc de citation.
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise

    return canvas.toDataURL("image/jpeg", THUMBNAIL_QUALITY)
  } finally {
    void loadingTask.destroy?.()
  }
}

/**
 * URL d'une vidéo positionnée sur sa première image.
 *
 * Le fragment de media `#t=` demande au navigateur d'afficher cette image sans
 * lecture, et `preload="metadata"` limite le telechargement a l'en-tete du
 * fichier. C'est ce qui permet une vraie vignette sans passer par un canvas :
 * le rendu resterait bloque, la redirection du backend vers Backblaze B2 etant
 * cross-origin, elle contamine le canvas et interdit toDataURL().
 */
export function videoPosterUrl(url: string): string {
  return `${url}#t=0.1`
}
