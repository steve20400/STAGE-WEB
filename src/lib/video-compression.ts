/**
 * COMPRESSER UNE VIDÉO AVANT DE L'ENVOYER.
 *
 * Une vidéo de téléphone sort en 1080p — souvent en 4K — à 15 à 20 Mo la
 * minute. Le fil de discussion la montre dans 280 px de large. Comme pour les
 * photos, on payait des deux côtés le transport d'un fichier plusieurs fois
 * plus lourd que ce qui s'affiche.
 *
 * 🐛 LES VIDÉOS PARTAIENT INTACTES (signalé par le user le 06/10/2026 :
 * « rassure-toi que les images et les vidéos sont bel et bien compressées à
 * l'envoi »). Aucun navigateur ne transcode sans aide : on passe par
 * `mediabunny`, qui pilote les encodeurs WebCodecs du navigateur — ceux de la
 * carte graphique quand il y en a.
 *
 * Réglages : 720p (bord COURT à 720 px, soit 1280 × 720 en paysage), H.264 —
 * le seul codec que lisent tous les téléphones et tous les navigateurs —, et
 * le son recopié tel quel quand le conteneur MP4 l'accepte. C'est ce que
 * produit le mobile (`compression_video.dart`, `Res1280x720Quality`).
 *
 * ⚠️ CE MODULE PRÉFÈRE TOUJOURS NE RIEN FAIRE, comme son jumeau des images.
 * Navigateur sans WebCodecs, codec illisible, piste son impossible à garder,
 * gain absent : on rend l'original. Une vidéo envoyée intacte est un
 * non-événement ; une vidéo muette ou tronquée est un défaut que
 * l'utilisateur découvre chez son correspondant.
 */
import type { ResultatCompression } from "./image-compression"

/** Bord court visé, en pixels. */
export const VIDEO_BORD_COURT = 720

/** Débit vidéo visé pour du 720p. Repère WhatsApp : 1,2 à 1,6 Mbit/s. */
const DEBIT_720P = 1_600_000

/**
 * Au-dessous de ce débit, une vidéo déjà en 720p n'est pas retouchée. C'est ce
 * qui empêche une vidéo reçue puis transférée de perdre un peu de qualité à
 * chaque saut — une vidéo sortie d'ici tourne autour de 1,8 Mbit/s, son
 * compris.
 */
const DEBIT_DEJA_LEGER = 2_500_000

/** En dessous, le gain ne vaut pas le risque de perte : on garde l'original. */
const GAIN_MINIMUM = 0.9

export type RaisonSautVideo =
  | "webcodecs_indisponible"
  | "illisible"
  | "deja_legere"
  | "conversion_impossible"
  | "sans_gain"

export interface ResultatCompressionVideo extends Omit<ResultatCompression, "raisonSaut"> {
  raisonSaut?: RaisonSautVideo
}

function intact(file: File, raisonSaut: RaisonSautVideo): ResultatCompressionVideo {
  return { fichier: file, compresse: false, raisonSaut, tailleAvant: file.size, tailleApres: file.size }
}

/**
 * Le navigateur sait-il transcoder ? Sans WebCodecs (Firefox ancien, Safari
 * avant la 16.4), la vidéo part telle quelle.
 */
export function videoCompressible(): boolean {
  return typeof VideoEncoder === "function" && typeof VideoDecoder === "function"
}

/*
 * UNE CONVERSION À LA FOIS. Le lot accepte dix fichiers, et les encodeurs
 * matériels sont en nombre limité : dix conversions simultanées se
 * disputeraient la carte graphique et finiraient toutes plus tard qu'en file.
 */
let fileAttente: Promise<unknown> = Promise.resolve()

/**
 * Compresse une vidéo, ou rend l'original si le moindre doute existe.
 *
 * Ne lève jamais : un envoi ne doit pas échouer parce qu'une optimisation a
 * échoué. [onProgression] reçoit une valeur de 0 à 1.
 */
export function compresserVideo(
  file: File,
  onProgression?: (p: number) => void
): Promise<ResultatCompressionVideo> {
  const tour = fileAttente.then(() => convertir(file, onProgression))
  fileAttente = tour.catch(() => undefined)
  return tour.catch(() => intact(file, "conversion_impossible"))
}

type Mediabunny = typeof import("mediabunny")

interface Cible {
  largeur: number
  hauteur: number
  debit: number
}

async function convertir(
  file: File,
  onProgression?: (p: number) => void
): Promise<ResultatCompressionVideo> {
  if (!videoCompressible()) return intact(file, "webcodecs_indisponible")

  // Chargée à la demande : 300 Ko que ne paie que celui qui envoie une vidéo.
  const mb = await import("mediabunny")
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS })
  try {
    const piste = await input.getPrimaryVideoTrack().catch(() => null)
    if (!piste || !(await piste.canDecode().catch(() => false))) return intact(file, "illisible")

    // Les dimensions STOCKÉES. Une vidéo filmée en portrait l'est souvent en
    // paysage, avec une rotation dans ses métadonnées : on réduit l'image
    // telle qu'elle est stockée, et l'on recopie la rotation.
    const largeur = piste.codedWidth
    const hauteur = piste.codedHeight
    const court = Math.min(largeur, hauteur)
    if (!court) return intact(file, "illisible")

    const duree =
      (await input.getDurationFromMetadata().catch(() => null)) ??
      (await input.computeDuration().catch(() => 0))
    const debit = duree > 0 ? (file.size * 8) / duree : Infinity
    if (court <= VIDEO_BORD_COURT && debit <= DEBIT_DEJA_LEGER) {
      return intact(file, "deja_legere")
    }

    const facteur = Math.min(1, VIDEO_BORD_COURT / court)
    // Le H.264 veut des dimensions paires.
    const pair = (n: number) => Math.max(2, 2 * Math.round(n / 2))
    const cible: Cible = {
      largeur: pair(largeur * facteur),
      hauteur: pair(hauteur * facteur),
      debit: 0,
    }
    // Une vidéo plus petite que du 720p n'a pas besoin du débit d'un 720p.
    cible.debit = Math.max(400_000, Math.round((DEBIT_720P * cible.largeur * cible.hauteur) / (1280 * 720)))

    const octets =
      (await transcoderRapide(mb, input, piste, cible, duree, onProgression).catch(() => null)) ??
      (await transcoderParConversion(mb, input, cible, onProgression).catch(() => null))
    if (!octets || octets.byteLength === 0) return intact(file, "conversion_impossible")
    if (octets.byteLength >= file.size * GAIN_MINIMUM) return intact(file, "sans_gain")

    /*
     * LE NOM ET LE TYPE SUIVENT LES OCTETS : le serveur choisit l'extension de
     * stockage d'après le NOM avant de regarder le type. Un `.mov` ou un
     * `.webm` converti qui garderait son nom serait servi plus tard avec le
     * mauvais en-tête.
     */
    const nom = file.name.replace(/\.[^.]+$/, "") + ".mp4"
    return {
      fichier: new File([octets], nom, { type: "video/mp4", lastModified: file.lastModified }),
      compresse: true,
      tailleAvant: file.size,
      tailleApres: octets.byteLength,
    }
  } catch {
    return intact(file, "conversion_impossible")
  } finally {
    input.dispose()
  }
}

/** La première configuration H.264 que l'encodeur du navigateur accepte. */
async function configurationAvc(cible: Cible): Promise<VideoEncoderConfig | null> {
  // High, Main puis Baseline, niveau 4.0 : de quoi tenir du 720p à 60 i/s.
  for (const codec of ["avc1.640028", "avc1.4d4028", "avc1.42e028"]) {
    const config: VideoEncoderConfig = {
      codec,
      width: cible.largeur,
      height: cible.hauteur,
      bitrate: cible.debit,
      avc: { format: "avc" },
    }
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config
    } catch {
      /* configuration refusée : on essaie la suivante */
    }
  }
  return null
}

/*
 * L'ENCODEUR SAIT-IL RÉDUIRE L'IMAGE LUI-MÊME ?
 *
 * Chrome réduit, sans frais, une image plus grande que la taille configurée.
 * C'est TOUT le gain de la voie rapide : réduire par un canvas coûte dix fois
 * le reste du travail (mesuré le 06/10/2026 : 65 s au lieu de 12 pour 12 s de
 * 1080p). Mais rien dans la norme ne l'exige, et un encodeur pourrait ROGNER
 * au lieu de réduire. On le vérifie donc une fois : une image rouge à gauche,
 * bleue à droite, doit ressortir deux fois plus petite ET bicolore.
 */
let reductionVerifiee: Promise<boolean> | null = null

function encodeurReduit(codec: string): Promise<boolean> {
  reductionVerifiee ??= verifierReduction(codec)
  return reductionVerifiee
}

async function verifierReduction(codec: string): Promise<boolean> {
  try {
    const toile = new OffscreenCanvas(320, 192)
    const g = toile.getContext("2d")
    if (!g) return false
    g.fillStyle = "#f00"
    g.fillRect(0, 0, 160, 192)
    g.fillStyle = "#00f"
    g.fillRect(160, 0, 160, 192)

    const recu: { paquet?: EncodedVideoChunk; config?: VideoDecoderConfig; image?: VideoFrame } = {}
    const encodeur = new VideoEncoder({
      output: (paquet, meta) => {
        recu.paquet ??= paquet
        recu.config ??= meta?.decoderConfig
      },
      error: () => undefined,
    })
    encodeur.configure({ codec, width: 160, height: 96, bitrate: 300_000, avc: { format: "avc" } })
    const source = new VideoFrame(toile, { timestamp: 0 })
    encodeur.encode(source, { keyFrame: true })
    source.close()
    await encodeur.flush()
    encodeur.close()
    if (!recu.paquet || !recu.config) return false

    const decodeur = new VideoDecoder({
      output: (image) => {
        if (recu.image) image.close()
        else recu.image = image
      },
      error: () => undefined,
    })
    decodeur.configure(recu.config)
    decodeur.decode(recu.paquet)
    await decodeur.flush()
    decodeur.close()
    const image = recu.image
    if (!image) return false
    try {
      if (image.displayWidth !== 160 || image.displayHeight !== 96) return false
      const lecture = new OffscreenCanvas(160, 96)
      const l = lecture.getContext("2d")
      if (!l) return false
      l.drawImage(image, 0, 0)
      const gauche = l.getImageData(30, 48, 1, 1).data
      const droite = l.getImageData(130, 48, 1, 1).data
      return gauche[0] > 150 && gauche[2] < 100 && droite[2] > 150 && droite[0] < 100
    } finally {
      image.close()
    }
  } catch {
    return false
  }
}

/**
 * LA VOIE RAPIDE : décoder, confier chaque image à l'encodeur, recopier le son.
 *
 * Le son n'est pas ré-encodé : ses paquets passent tels quels dans le MP4.
 * C'est plus rapide, sans perte, et cela évite l'écueil des navigateurs qui ne
 * savent pas encoder l'AAC. Un son que le MP4 n'accepte pas — rare — renvoie
 * à la voie lente.
 *
 * Rend `null` à la moindre difficulté : la voie lente prend alors le relais.
 */
async function transcoderRapide(
  mb: Mediabunny,
  input: InstanceType<Mediabunny["Input"]>,
  piste: NonNullable<Awaited<ReturnType<InstanceType<Mediabunny["Input"]>["getPrimaryVideoTrack"]>>>,
  cible: Cible,
  duree: number,
  onProgression?: (p: number) => void
): Promise<ArrayBuffer | null> {
  const format = new mb.Mp4OutputFormat({ fastStart: "in-memory" })
  const pisteSon = await input.getPrimaryAudioTrack().catch(() => null)
  const codecSon = pisteSon?.codec ?? null
  if (pisteSon && (!codecSon || !format.getSupportedAudioCodecs().includes(codecSon))) return null

  const config = await configurationAvc(cible)
  if (!config) return null
  const reduitSeul = await encodeurReduit(config.codec)

  const output = new mb.Output({ format, target: new mb.BufferTarget() })
  const sortieVideo = new mb.EncodedVideoPacketSource("avc")
  output.addVideoTrack(sortieVideo, { rotation: await piste.getRotation().catch(() => 0 as const) })
  const sortieSon = pisteSon && codecSon ? new mb.EncodedAudioPacketSource(codecSon) : null
  if (sortieSon) output.addAudioTrack(sortieSon)
  await output.start()

  let panne: unknown = null
  // Les paquets s'ajoutent DANS L'ORDRE où l'encodeur les rend.
  let ajouts: Promise<void> = Promise.resolve()
  const encodeur = new VideoEncoder({
    output: (paquet, meta) => {
      const p = mb.EncodedPacket.fromEncodedChunk(paquet)
      ajouts = ajouts.then(() => sortieVideo.add(p, meta))
    },
    error: (e) => {
      panne = e
    },
  })
  encodeur.configure(config)

  const recopierSon = async () => {
    if (!pisteSon || !sortieSon) return
    const decoderConfig = await pisteSon.getDecoderConfig()
    if (!decoderConfig) throw new Error("son sans configuration")
    const sink = new mb.EncodedPacketSink(pisteSon)
    let paquet = await sink.getFirstPacket()
    let premier = true
    while (paquet) {
      await sortieSon.add(paquet, premier ? { decoderConfig } : undefined)
      premier = false
      paquet = await sink.getNextPacket(paquet)
    }
  }

  const encoderImages = async () => {
    const sink = new mb.VideoSampleSink(piste)
    let prochaineCle = -Infinity
    for await (const echantillon of sink.samples()) {
      const instant = echantillon.timestamp
      let image = echantillon.toVideoFrame()
      echantillon.close()
      if (panne) {
        image.close()
        throw panne
      }
      if (!reduitSeul && (image.displayWidth !== cible.largeur || image.displayHeight !== cible.hauteur)) {
        const reduite = await createImageBitmap(image, {
          resizeWidth: cible.largeur,
          resizeHeight: cible.hauteur,
          resizeQuality: "low",
        })
        const remplacante = new VideoFrame(reduite, {
          timestamp: image.timestamp,
          duration: image.duration ?? undefined,
        })
        reduite.close()
        image.close()
        image = remplacante
      }
      // Une image clé toutes les 3 s : on peut avancer dans la vidéo sans
      // tout décoder depuis le début.
      const cle = image.timestamp >= prochaineCle
      if (cle) prochaineCle = image.timestamp + 3_000_000
      encodeur.encode(image, { keyFrame: cle })
      image.close()
      // Contre-pression : on ne laisse pas la file de l'encodeur grossir sans
      // fin — chaque image 1080p en attente pèse 3 Mo.
      while (encodeur.encodeQueueSize > 8 && !panne) {
        await new Promise((r) => setTimeout(r, 4))
      }
      if (onProgression && duree > 0) onProgression(Math.min(1, Math.max(0, instant / duree)))
    }
    await encodeur.flush()
    await ajouts
  }

  try {
    await Promise.all([recopierSon(), encoderImages()])
    if (panne) throw panne
    await output.finalize()
    const tampon = (output.target as InstanceType<Mediabunny["BufferTarget"]>).buffer
    return tampon ?? null
  } catch {
    await output.cancel().catch(() => undefined)
    return null
  } finally {
    if (encodeur.state !== "closed") encodeur.close()
  }
}

/**
 * LA VOIE LENTE, mais générale : la conversion complète de `mediabunny`, qui
 * sait ré-encoder le son et réduire par un canvas. Elle ne sert que si la voie
 * rapide a renoncé.
 */
async function transcoderParConversion(
  mb: Mediabunny,
  input: InstanceType<Mediabunny["Input"]>,
  cible: Cible,
  onProgression?: (p: number) => void
): Promise<ArrayBuffer | null> {
  const qualite = new mb.Quality({ bitrate: cible.debit })
  if (!(await mb.canEncodeVideo("avc", { width: cible.largeur, height: cible.hauteur, quality: qualite }))) {
    return null
  }
  const output = new mb.Output({
    // `in-memory` place l'index en tête du fichier : la lecture commence
    // avant la fin du téléchargement, chez le correspondant.
    format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new mb.BufferTarget(),
  })
  const rotation = await (await input.getPrimaryVideoTrack())?.getRotation().catch(() => 0)
  const couchee = rotation === 90 || rotation === 270
  // Les dimensions de la conversion sont celles À L'ÉCRAN, après rotation.
  const ecranL = couchee ? cible.hauteur : cible.largeur
  const ecranH = couchee ? cible.largeur : cible.hauteur
  const conversion = await mb.Conversion.init({
    input,
    output,
    tracks: "primary",
    video: {
      // Un seul bord est imposé : l'autre suit les proportions.
      ...(ecranL <= ecranH ? { width: ecranL } : { height: ecranH }),
      codec: "avc",
      quality: qualite,
    },
    // Le son est recopié quand le MP4 l'accepte, ré-encodé sinon.
    audio: {},
    showWarnings: false,
  })
  /*
   * ⚠️ UNE PISTE ÉCARTÉE, C'EST UNE VIDÉO MUETTE. `isValid` resterait vrai
   * avec la seule image : la conversion « réussirait » en jetant le son, par
   * exemple quand le navigateur ne sait encoder ni AAC ni Opus. On refuse.
   */
  if (!conversion.isValid || conversion.discardedTracks.length > 0) return null
  if (onProgression) conversion.onProgress = (p) => onProgression(p)
  await conversion.execute()
  const tampon = (output.target as InstanceType<Mediabunny["BufferTarget"]>).buffer
  return tampon ?? null
}
