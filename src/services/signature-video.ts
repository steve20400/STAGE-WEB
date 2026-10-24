import { peindreBords } from "./signature-image"

/**
 * VIDÉO SIGNÉE D'UN DOCUMENT SENSIBLE, SIGNATURE INCRUSTÉE (24/10/2026).
 *
 * Demande du user : comme pour une image, le texte de la signature court aux
 * QUATRE BORDS de la vidéo. Contrairement aux métadonnées, il survit à une
 * vidéo renvoyée par WhatsApp (qui réencode tout et efface les métadonnées).
 *
 * Le prix : la vidéo est RÉENCODÉE, image par image, sur l'appareil — c'est
 * plus long qu'une simple copie (27 s pour 69 s de 720p dans Chrome). On
 * vise une qualité TRÈS haute : en « haute », une vidéo de 9,2 Mo ressortait
 * à 5,4 Mo, visiblement dégradée ; en « très haute », à 11 Mo, sans perte
 * visible. `mediabunny` décode, redresse l'image (`allowTransformation
 * Metadata: false` : la rotation est appliquée aux pixels, pas laissée en
 * métadonnée, sans quoi le texte tournerait avec elle), appelle `process` pour
 * chaque image, où l'on dessine les bords, puis réencode.
 *
 * Le conteneur suit le codec que le navigateur sait encoder : MP4 (H.264) si
 * possible, sinon WebM (VP9, puis VP8 — Firefox n'encode pas le H.264).
 * Rend `null` si rien n'est possible : l'appelant garde alors la copie aux
 * seules métadonnées.
 */

const CODECS = [
  { codec: "avc", conteneur: "mp4", mime: "video/mp4" },
  { codec: "vp9", conteneur: "webm", mime: "video/webm" },
  { codec: "vp8", conteneur: "webm", mime: "video/webm" },
] as const

export interface VideoSignee {
  blob: Blob
  mime: string
  extension: "mp4" | "webm"
}

export function videoIncrustable(): boolean {
  return typeof VideoEncoder === "function" && typeof VideoDecoder === "function" && typeof OffscreenCanvas === "function"
}

export async function signerVideoIncrustee(
  source: Blob,
  texte: string,
  meta: Record<string, string>,
  onProgression?: (fraction: number) => void,
): Promise<VideoSignee | null> {
  if (!videoIncrustable()) return null
  const mb = await import("mediabunny")
  const input = new mb.Input({ source: new mb.BlobSource(source), formats: mb.ALL_FORMATS })
  try {
    const piste = await input.getPrimaryVideoTrack()
    if (!piste) return null
    // Dimensions À L'ÉCRAN (rotation comprise), paires pour les encodeurs.
    const l = piste.displayWidth - (piste.displayWidth % 2)
    const h = piste.displayHeight - (piste.displayHeight % 2)
    if (l < 16 || h < 16) return null

    let choix: (typeof CODECS)[number] | null = null
    for (const c of CODECS) {
      const possible = await mb
        .canEncodeVideo(c.codec, { width: l, height: h, bitrate: mb.QUALITY_VERY_HIGH })
        .catch(() => false)
      if (possible) {
        choix = c
        break
      }
    }
    if (!choix) return null

    const output = new mb.Output({
      format: choix.conteneur === "mp4" ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat(),
      target: new mb.BufferTarget(),
    })
    // Une seule toile pour toute la vidéo : chaque image rendue est copiée par
    // l'encodeur au moment où `process` la rend.
    const toile = new OffscreenCanvas(l, h)
    const ctx = toile.getContext("2d")
    if (!ctx) return null

    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        codec: choix.codec,
        quality: mb.QUALITY_VERY_HIGH,
        forceTranscode: true,
        allowTransformationMetadata: false,
        processedWidth: l,
        processedHeight: h,
        process: (echantillon) => {
          echantillon.draw(ctx, 0, 0, l, h)
          peindreBords(ctx, l, h, texte)
          return toile
        },
      },
      // Le son est recopié quand le conteneur l'accepte, réencodé sinon.
      audio: {},
      // Les métadonnées, dans les deux conteneurs : le texte des bords en
      // commentaire, et les huit champs sous leurs noms courts.
      tags: {
        comment: texte,
        artist: meta["Alanya ID"] ? `Alanya ${meta["Alanya ID"]}` : undefined,
        description: Object.entries(meta)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
        ...(choix.conteneur === "webm" ? { raw: { ...meta } } : {}),
      },
      showWarnings: false,
    })
    // Une piste écartée (le son, faute d'encodeur), c'est une vidéo muette :
    // on préfère la copie aux seules métadonnées.
    if (!conversion.isValid || conversion.discardedTracks.length > 0) return null
    if (onProgression) conversion.onProgress = (p) => onProgression(p)
    await conversion.execute()
    const tampon = (output.target as InstanceType<typeof mb.BufferTarget>).buffer
    if (!tampon) return null
    return { blob: new Blob([tampon], { type: choix.mime }), mime: choix.mime, extension: choix.conteneur }
  } catch (e) {
    console.warn("[signature] vidéo non incrustée :", e)
    return null
  } finally {
    input.dispose?.()
  }
}
