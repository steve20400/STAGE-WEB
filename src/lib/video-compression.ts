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
import type { NiveauQualite, ResultatCompression } from "./image-compression"

export type { NiveauQualite }

/**
 * LES DEUX NIVEAUX DE QUALITÉ — décision du user, 12/10/2026.
 *
 * 🔴 LE BOUTON « ENVOYER L'ORIGINAL » EST DEVENU « ENVOYER EN 1080p ». Envoyer
 * l'original, c'était envoyer 30, 60, parfois 200 Mo tels quels : au Cameroun,
 * sur une connexion lente et payée au volume, c'est un envoi qui n'aboutit pas.
 * Le niveau haut borne donc ce qui part, tout en restant bien plus près de
 * l'original que le niveau normal.
 *
 * 🔴 POURQUOI 1080p ET NON « 720p AVEC PLUS DE DÉBIT ». À 720p, les pixels
 * perdus sont perdus : aucun débit ne les ramène. Or ce qui déclenche la
 * demande, c'est une vidéo de COURS — un tableau, des diapositives. Là, c'est
 * la définition qui rend le texte lisible, pas le débit.
 *
 * ⚠️ SEULE LA DÉFINITION CHANGE D'UN NIVEAU À L'AUTRE. Le débit suit la même
 * formule pour les deux (voir [debitPour]) : il est proportionnel à la surface,
 * donc du 1080p reçoit 3,6 Mbit/s là où du 720p reçoit 1,6. Deux formules
 * auraient pu se croiser — le niveau « haut » rendant alors MOINS de débit que
 * le normal à dimensions égales, ce qui serait l'inverse de la promesse.
 */

/** Bord court visé, en pixels. */
export const VIDEO_BORD_COURT = 720

/** Bord court visé au niveau haut : du 1080p. */
export const VIDEO_BORD_COURT_HAUTE = 1080

/** Le bord court visé pour un niveau donné. */
export function bordCourtVise(niveau: NiveauQualite): number {
  return niveau === "haute" ? VIDEO_BORD_COURT_HAUTE : VIDEO_BORD_COURT
}

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
 * Le niveau haut donnerait-il vraiment mieux que le niveau normal ?
 *
 * 🔴 SERT À NE PAS PROPOSER UN CHOIX QUI NE CHANGE RIEN (demande du user :
 * « quand les deux boutons donneraient la même chose, n'affiche qu'une ligne »).
 * On n'agrandit JAMAIS : une vidéo filmée en 720p ou moins n'a pas un pixel de
 * plus à offrir, et le bouton « 1080p » serait un mensonge.
 */
function hautePlusFine(bordCourtSource: number): boolean {
  return bordCourtSource > VIDEO_BORD_COURT
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
  onProgression?: (p: number) => void,
  niveau: NiveauQualite = "normal"
): Promise<ResultatCompressionVideo> {
  const tour = fileAttente.then(() => convertir(file, onProgression, niveau))
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
  onProgression?: (p: number) => void,
  niveau: NiveauQualite = "normal"
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
    const vise = bordCourtVise(niveau)
    if (court <= vise && debit <= DEBIT_DEJA_LEGER) {
      return { ...intact(file, "deja_legere"), niveauSuperieurPossible: hautePlusFine(court) }
    }

    // ⚠️ JAMAIS AGRANDIR : le facteur est plafonné à 1. Une vidéo plus petite
    // que l'objectif garde ses dimensions et ne voit baisser que son débit.
    const facteur = Math.min(1, vise / court)
    // Le H.264 veut des dimensions paires.
    const pair = (n: number) => Math.max(2, 2 * Math.round(n / 2))
    const cible: Cible = {
      largeur: pair(largeur * facteur),
      hauteur: pair(hauteur * facteur),
      debit: 0,
    }
    // Une vidéo plus petite que du 720p n'a pas besoin du débit d'un 720p.
    cible.debit = Math.max(400_000, Math.round((DEBIT_720P * cible.largeur * cible.hauteur) / (1280 * 720)))

    /*
     * ⚠️ RIEN À GAGNER : ON S'ABSTIENT PLUTÔT QUE DE TRANSCODER POUR RIEN. Au
     * niveau haut, une vidéo déjà en 1080p peut avoir un débit INFÉRIEUR à
     * celui qu'on viserait : la recompresser l'alourdirait. La règle du gain
     * minimum, plus bas, rendrait bien l'original — mais après avoir fait
     * tourner l'encodeur une minute pour rien.
     */
    if (cible.debit >= debit) {
      return { ...intact(file, "deja_legere"), niveauSuperieurPossible: hautePlusFine(court) }
    }

    /*
     * La voie rapide ne fait que du H.264 dans du MP4 : c'est ce qu'elle a de
     * plus rapide, et ce qui passe partout. La voie lente la rattrape, et
     * rattrape aussi les navigateurs qui n'ont pas de H.264 du tout.
     */
    const rapide = await transcoderRapide(mb, input, piste, cible, duree, onProgression).catch(
      () => null
    )
    const produit: VideoTranscodee | null = rapide
      ? { octets: rapide, conteneur: "mp4", mime: "video/mp4" }
      : await transcoderParConversion(mb, input, cible, onProgression).catch(() => null)
    const octets = produit?.octets
    if (!octets || octets.byteLength === 0) return intact(file, "conversion_impossible")
    if (octets.byteLength >= file.size * GAIN_MINIMUM) return intact(file, "sans_gain")

    /*
     * LE NOM ET LE TYPE SUIVENT LES OCTETS : le serveur choisit l'extension de
     * stockage d'après le NOM avant de regarder le type. Un `.mov` ou un
     * `.webm` converti qui garderait son nom serait servi plus tard avec le
     * mauvais en-tête.
     */
    const nom = file.name.replace(/\.[^.]+$/, "") + "." + produit!.conteneur
    return {
      fichier: new File([octets], nom, { type: produit!.mime, lastModified: file.lastModified }),
      compresse: true,
      tailleAvant: file.size,
      tailleApres: octets.byteLength,
      niveauSuperieurPossible: hautePlusFine(court),
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
 * LES CODECS ESSAYÉS, DANS L'ORDRE, ET LE CONTENEUR DE CHACUN.
 *
 * 🐛 « SUR CERTAINS NAVIGATEURS LA COMPRESSION NE MARCHE PAS » (user,
 * 12/10/2026 : « j'ai ouvert sur Chrome, sur Edge, ça marchait »). Les deux
 * voies de ce module ne demandaient que du H.264 — `configurationAvc` pour la
 * voie rapide, `canEncodeVideo("avc")` pour la voie lente. Or AVOIR WebCodecS
 * NE VEUT PAS DIRE SAVOIR ENCODER EN H.264 : Firefox expose `VideoEncoder`
 * mais n'embarque pas d'encodeur H.264, le format étant breveté. Les deux
 * voies renonçaient donc, la vidéo partait entière, et rien ne le disait.
 *
 * 🔴 L'ORDRE EST CELUI DE LA COMPATIBILITÉ CHEZ LE DESTINATAIRE, pas celui de
 * la qualité. Le H.264 passe partout — vieux téléphones, vieux navigateurs,
 * lecteurs de bureau — et reste donc le premier choix. Le VP9 et le VP8 ne
 * servent qu'aux navigateurs qui ne savent pas faire de H.264 : là, le choix
 * n'est pas « WebM ou MP4 », c'est « WebM ou 30 Mo envoyés tels quels ».
 *
 * ⚠️ LE CONTENEUR SUIT LE CODEC, et ce n'est pas un détail de forme : un MP4
 * n'accepte pas de VP8, et un WebM n'accepte ni H.264 ni AAC. Se tromper
 * produit un fichier que personne n'ouvre.
 */
const CODECS_VIDEO = [
  { codec: "avc", conteneur: "mp4", mime: "video/mp4" },
  { codec: "vp9", conteneur: "webm", mime: "video/webm" },
  { codec: "vp8", conteneur: "webm", mime: "video/webm" },
] as const

export interface VideoTranscodee {
  octets: ArrayBuffer
  /** L'extension à donner au fichier, sans le point. */
  conteneur: "mp4" | "webm"
  mime: string
}

/**
 * LA VOIE LENTE, mais générale : la conversion complète de `mediabunny`, qui
 * sait ré-encoder le son et réduire par un canvas. Elle ne sert que si la voie
 * rapide a renoncé — et c'est elle qui rattrape les navigateurs sans H.264,
 * en repassant sur du VP9 puis du VP8.
 */
async function transcoderParConversion(
  mb: Mediabunny,
  input: InstanceType<Mediabunny["Input"]>,
  cible: Cible,
  onProgression?: (p: number) => void
): Promise<VideoTranscodee | null> {
  const qualite = new mb.Quality({ bitrate: cible.debit })
  const choix = await premierCodecPossible(mb, cible, qualite)
  if (!choix) return null

  const output = new mb.Output({
    format:
      choix.conteneur === "mp4"
        ? // `in-memory` place l'index en tête du fichier : la lecture commence
          // avant la fin du téléchargement, chez le correspondant.
          new mb.Mp4OutputFormat({ fastStart: "in-memory" })
        : new mb.WebMOutputFormat(),
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
      codec: choix.codec,
      quality: qualite,
    },
    // Le son est recopié quand le conteneur l'accepte, ré-encodé sinon.
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
  return tampon ? { octets: tampon, conteneur: choix.conteneur, mime: choix.mime } : null
}

/**
 * Le premier codec de [CODECS_VIDEO] que CE navigateur sait vraiment encoder.
 *
 * ⚠️ ON DEMANDE AU NAVIGATEUR, ON NE DEVINE PAS d'après son nom. Les versions
 * se suivent, les encodeurs matériels diffèrent d'une machine à l'autre, et un
 * même Firefox n'a pas les mêmes codecs sur Linux et sur Windows.
 */
async function premierCodecPossible(
  mb: Mediabunny,
  cible: Cible,
  qualite: InstanceType<Mediabunny["Quality"]>
): Promise<(typeof CODECS_VIDEO)[number] | null> {
  for (const choix of CODECS_VIDEO) {
    const possible = await mb
      .canEncodeVideo(choix.codec, {
        width: cible.largeur,
        height: cible.hauteur,
        quality: qualite,
      })
      .catch(() => false)
    if (possible) return choix
  }
  return null
}
