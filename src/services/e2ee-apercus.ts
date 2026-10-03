import { ensurePdfWorker } from "./pdf-worker"

/**
 * LES APERÇUS D'UN MÉDIA CHIFFRÉ — fabriqués par l'EXPÉDITEUR (chapitre 24).
 *
 * Le serveur ne peut plus faire de vignette : il n'a que des octets illisibles.
 * L'expéditeur, lui, a le fichier en clair. C'est donc lui qui fabrique
 * l'aperçu, et l'aperçu voyage DANS l'enveloppe, chiffré avec la clé.
 *
 * ⚠️ UNE ENVELOPPE NE DÉPASSE PAS 64 KO (`CORPS_MAX` côté serveur), et la
 * charge y est ensuite chiffrée par Signal puis encodée en base64. L'aperçu
 * est donc PLAFONNÉ (`APERCU_MAX`) : trop gros, il est refait plus petit, puis
 * abandonné — un média sans aperçu reste envoyable, un média trop lourd pour
 * son enveloppe ne le serait pas.
 *
 * ⚠️ NE LÈVE JAMAIS : un aperçu raté ne doit pas empêcher l'envoi.
 */

export interface Apercu {
  /** JPEG en base64. */
  apercu?: string
  largeur?: number
  hauteur?: number
  dureeMs?: number
  pages?: number
}

/** Plafond de l'aperçu, en caractères base64 (≈ 30 Ko d'image). */
const APERCU_MAX = 40_000

export async function fabriquerApercu(fichier: Blob, mime: string, dureeConnue?: number): Promise<Apercu> {
  try {
    if (mime.startsWith("image/")) return await apercuImage(fichier)
    if (mime.startsWith("video/")) return await apercuVideo(fichier)
    if (mime.startsWith("audio/")) return { dureeMs: dureeConnue ?? (await dureeAudio(fichier)) }
    if (mime === "application/pdf") return await apercuPdf(fichier)
  } catch (e) {
    console.warn("[e2ee] aperçu impossible, le média part sans :", e)
  }
  return dureeConnue ? { dureeMs: dureeConnue } : {}
}

/**
 * Une photo : une MINI-IMAGE de 32 px de côté, floutée à l'affichage.
 *
 * Pourquoi si petite : elle n'est là que le temps du téléchargement de la vraie
 * photo, et un flou n'a pas besoin de détails. ~1 à 3 Ko. Ce sont surtout ses
 * DIMENSIONS qui comptent — la bulle prend sa taille d'emblée.
 */
async function apercuImage(fichier: Blob): Promise<Apercu> {
  const bitmap = await createImageBitmap(fichier)
  try {
    return {
      largeur: bitmap.width,
      hauteur: bitmap.height,
      apercu: reduire(bitmap, bitmap.width, bitmap.height, [32, 20], 0.55),
    }
  } finally {
    bitmap.close()
  }
}

/**
 * Une vidéo : la PREMIÈRE IMAGE, nette, ~320 px — elle sert de couverture tant
 * qu'on n'a pas choisi de lire, donc elle doit se reconnaître.
 */
function apercuVideo(fichier: Blob): Promise<Apercu> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(fichier)
    const v = document.createElement("video")
    v.muted = true
    v.preload = "auto"
    v.playsInline = true
    let fini = false
    const terminer = (a: Apercu) => {
      if (fini) return
      fini = true
      URL.revokeObjectURL(url)
      v.removeAttribute("src")
      v.load()
      resolve(a)
    }
    // Un format que le navigateur ne lit pas ne doit pas bloquer l'envoi.
    const garde = window.setTimeout(() => terminer({}), 8000)
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.1, (v.duration || 0) / 2)
    }
    v.onseeked = () => {
      window.clearTimeout(garde)
      const largeur = v.videoWidth
      const hauteur = v.videoHeight
      terminer({
        largeur,
        hauteur,
        dureeMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : undefined,
        apercu: largeur && hauteur ? reduire(v, largeur, hauteur, [320, 200, 120], 0.6) : undefined,
      })
    }
    v.onerror = () => {
      window.clearTimeout(garde)
      terminer({})
    }
    v.src = url
  })
}

function dureeAudio(fichier: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(fichier)
    const a = document.createElement("audio")
    a.preload = "metadata"
    const fin = (d?: number) => {
      URL.revokeObjectURL(url)
      resolve(d)
    }
    a.onloadedmetadata = () => fin(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : undefined)
    a.onerror = () => fin(undefined)
    window.setTimeout(() => fin(undefined), 5000)
    a.src = url
  })
}

/** Un PDF : la première page (~160 px) et le nombre de pages. */
async function apercuPdf(fichier: Blob): Promise<Apercu> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  await ensurePdfWorker(pdfjs)
  const tache = pdfjs.getDocument({ data: new Uint8Array(await fichier.arrayBuffer()) })
  try {
    const pdf = await tache.promise
    const page = await pdf.getPage(1)
    const naturel = page.getViewport({ scale: 1 })
    const echelle = 160 / Math.max(naturel.width, naturel.height)
    const vue = page.getViewport({ scale: echelle })
    const toile = document.createElement("canvas")
    toile.width = Math.max(1, Math.round(vue.width))
    toile.height = Math.max(1, Math.round(vue.height))
    const ctx = toile.getContext("2d")
    if (!ctx) return { pages: pdf.numPages }
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, toile.width, toile.height)
    await page.render({ canvasContext: ctx, viewport: vue }).promise
    const apercu = toile.toDataURL("image/jpeg", 0.6).split(",")[1]
    return { pages: pdf.numPages, apercu: apercu.length <= APERCU_MAX ? apercu : undefined }
  } finally {
    void tache.destroy?.()
  }
}

/**
 * Réduit une image à `cotes[0]` px sur son plus grand côté, en JPEG — puis
 * plus petit si le résultat dépasse le plafond, et rien du tout en dernier
 * recours.
 */
function reduire(
  source: CanvasImageSource,
  largeur: number,
  hauteur: number,
  cotes: number[],
  qualite: number,
): string | undefined {
  for (const cote of cotes) {
    const echelle = Math.min(1, cote / Math.max(largeur, hauteur))
    const toile = document.createElement("canvas")
    toile.width = Math.max(1, Math.round(largeur * echelle))
    toile.height = Math.max(1, Math.round(hauteur * echelle))
    const ctx = toile.getContext("2d")
    if (!ctx) return undefined
    ctx.drawImage(source, 0, 0, toile.width, toile.height)
    const b64 = toile.toDataURL("image/jpeg", qualite).split(",")[1]
    if (b64.length <= APERCU_MAX) return b64
  }
  return undefined
}
