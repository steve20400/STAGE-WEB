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

/**
 * L'ESCALIER DES PALIERS — décision du user, 13/10/2026.
 *
 * 🐛 « SI LA TAILLE DE LA VIDÉO EST INFÉRIEURE À 720, ON NE COMPRESSE PLUS.
 * Ce n'est pas bon du tout. » Une vidéo déjà en 720p ou moins, et déjà légère,
 * repartait telle quelle : on visait 720 et elle y était déjà.
 *
 * 🔴 LA NOUVELLE RÈGLE : ON DESCEND TOUJOURS D'UNE MARCHE.
 *
 *   · plus grand que 720  → 720
 *   · 361 à 720           → 360
 *   · 241 à 360           → 240
 *   · 240 ou moins        → on ne touche plus à rien
 *
 * ⚠️ CE QU'ELLE COÛTE, ET IL FAUT LE SAVOIR : une vidéo PERD UNE MARCHE À
 * CHAQUE PARTAGE. Envoyée en 1080p elle arrive en 720p ; transférée, 360p ;
 * transférée encore, 240p. C'est la contrepartie assumée de « on compresse
 * toujours » — le plancher à 240 l'empêche de descendre indéfiniment.
 *
 * ⚠️ LE NIVEAU HAUT N'A PAS D'ESCALIER : c'est le bouton « meilleure qualité »,
 * le faire descendre d'une marche serait l'inverse de ce qu'il promet. Il garde
 * son plafond à 1080 et ne réduit que ce qui le dépasse.
 */
export const PALIERS_VIDEO = [720, 360, 240] as const

/** Le plus petit palier : en dessous, on ne convertit plus. */
export const VIDEO_PALIER_PLANCHER = PALIERS_VIDEO[PALIERS_VIDEO.length - 1]

/**
 * Le débit de chaque palier, en bits par seconde.
 *
 * ⚠️ DES VALEURS EXPLICITES, PAS UNE RÈGLE DE TROIS. Le débit nécessaire ne
 * suit pas la surface : une petite image a besoin de PLUS de bits par pixel
 * qu'une grande pour rester regardable. Un 240p calculé au prorata d'un 720p
 * tomberait à 180 kbit/s et serait une bouillie.
 */
export const DEBIT_PALIER: Record<number, number> = {
  720: 1_200_000,
  360: 600_000,
  240: 300_000,
}

/**
 * Le palier visé pour une vidéo dont le petit côté mesure [court], ou `null`
 * quand il n'y a plus rien à faire.
 *
 * 🔴 ON DESCEND D'UNE MARCHE, JAMAIS PLUS : une vidéo en 1080p ne part pas
 * directement en 240p. Et jamais vers le haut — une 480p ne devient pas 720p.
 */
export function palierVideo(court: number): number | null {
  if (court <= VIDEO_PALIER_PLANCHER) return null
  for (const p of PALIERS_VIDEO) {
    if (court > p) return p
  }
  return null
}

/**
 * CE QUE LE SON AJOUTE AU DÉBIT MESURÉ — et pourquoi la marge est ADDITIVE.
 *
 * Le débit qu'on mesure est celui du FICHIER : image plus son plus conteneur.
 * Une piste audio pèse autour de 128 kbit/s, quelle que soit la taille de
 * l'image. Une marge en POURCENTAGE serait donc trop large à 720p et trop
 * étroite à 240p, où le son représente près de la moitié du fichier.
 */
const MARGE_SON = 250_000

/**
 * LE DÉCLENCHEUR : AU DÉBIT, ET NON À LA DÉFINITION.
 *
 * 🔴 DEMANDE DU PROFESSEUR, VALIDÉE PAR LE USER LE 16/10/2026 : « tout ce qui
 * est au-dessus de 1,2 Mbit/s, on compresse ». Avant, on déclenchait sur la
 * DÉFINITION : une vidéo en 720p à 1 Mbit/s — déjà parfaitement légère —
 * descendait quand même en 360p, parce que l'escalier voulait sa marche.
 *
 * LE DÉBIT EST LA BONNE VARIABLE, et c'est de l'arithmétique : le poids d'un
 * fichier vaut débit × durée. La définition ne fait que plafonner le détail que
 * ce débit peut porter. Un fichier déjà sous le seuil ne gagnerait presque rien
 * à être transcodé, et perdrait des pixels pour de bon.
 *
 * ⚠️ LE SEUIL PORTE SUR LE DÉBIT DU FICHIER, et non sur celui de l'image seule :
 * c'est ce qu'on sait mesurer sans décoder (taille ÷ durée), et c'est ce qui
 * voyage sur le réseau. Il vaut donc le débit visé à 720p PLUS ce que le son
 * ajoute.
 *
 * 🔴 CETTE SEULE RÈGLE REMPLACE LA GARDE CONTRE LA CASCADE. L'ancienne
 * (13/10/2026) reconnaissait nos propres fichiers À LEUR FORME — petit côté
 * exactement sur un palier, débit sous celui du palier — pour qu'une vidéo
 * enregistrée dans la galerie puis renvoyée ne perde pas une marche à chaque
 * tour. Elle n'a plus lieu d'être : AUCUNE de nos sorties ne dépasse le seuil,
 * donc aucune ne redéclenche la compression. C'est l'invariant que vérifie le
 * banc mobile `test/compression_video_test.dart` :
 *
 *     pour chaque palier p :  DEBIT_PALIER[p] + MARGE_SON ≤ SEUIL_DEBIT
 *
 * 🔴 ET IL TIENT PAR CONSTRUCTION, non par vigilance : le seuil est DÉFINI
 * comme le débit du palier 720p plus la marge du son. Baisser ou relever le
 * palier déplace le seuil avec lui, et la cascade ne peut pas se rouvrir par
 * distraction. ⚠️ Il reste une chose à vérifier à la main : qu'aucun palier
 * INFÉRIEUR ne dépasse `SEUIL_DEBIT - MARGE_SON`, ce qui serait de toute façon
 * absurde (une petite image ne demande pas plus de débit qu'une grande).
 */
export const SEUIL_DEBIT = DEBIT_PALIER[720] + MARGE_SON

/** Ce fichier est-il déjà assez léger pour qu'on n'y touche pas ? */
export function dejaAssezLegere(debit: number): boolean {
  return debit <= SEUIL_DEBIT
}

/** Le bord court visé pour un niveau donné. */
export function bordCourtVise(niveau: NiveauQualite): number {
  return niveau === "haute" ? VIDEO_BORD_COURT_HAUTE : VIDEO_BORD_COURT
}

/**
 * Débit visé pour du 720p : c'est le repère du palier, et la base du prorata du
 * niveau haut. Un seul nombre, pour qu'ils ne puissent plus se contredire.
 */
const DEBIT_720P = DEBIT_PALIER[720]

/*
 * ⚠️ DEUX RÈGLES ONT VÉCU ICI AVANT LE SEUIL AU DÉBIT, et l'histoire explique
 * le choix actuel :
 *   · `DEBIT_DEJA_LEGER` (jusqu'au 13/10/2026) — « 720p sous 2,5 Mbit/s, on n'y
 *     touche pas ». Il épargnait TOUTE vidéo sous 720p, même lourde : c'est ce
 *     que le user a signalé (« si la taille est inférieure à 720, on ne
 *     compresse plus, ce n'est pas bon »).
 *   · `dejaUnPalierAlanya` (13 au 16/10/2026) — un seuil PAR PALIER, reconnu à
 *     la forme du fichier. Juste, mais il fallait deux règles pour décider.
 * `SEUIL_DEBIT` fait le travail des deux avec un seul nombre : voir sa note.
 */

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
  /**
   * La définition, en pixels de petit côté, que l'AUTRE niveau donnerait.
   *
   * 🔴 L'ÉTIQUETTE DU BOUTON NE PEUT PAS ÊTRE ÉCRITE EN DUR. Elle annonçait
   * « Envoyer en 1080p », ce qui était faux dès que la source faisait moins :
   * pour une vidéo filmée en 720p, le niveau haut rend du 720p, pas du 1080p.
   * Le bouton dit donc ce qu'il va vraiment faire.
   */
  definitionAutreNiveau?: number
  /**
   * Durée du transcodage, en millisecondes.
   *
   * 🔴 POUR MESURER AU LIEU DE SUPPOSER. Le user trouve l'envoi trop lent
   * (16/10/2026) et le temps se répartit entre trois phases — encodage,
   * chiffrement, téléversement — dont une seule se mesure ici. Sans ce nombre,
   * on optimiserait au hasard.
   */
  msEncodage?: number
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
    /*
     * ⚠️ DURÉE INCONNUE ⇒ DÉBIT INFINI, donc on compresse. C'est le bon défaut :
     * un fichier dont on ne sait rien doit passer par l'escalier, pas être
     * épargné par un seuil qu'on n'a pas pu mesurer.
     */
    const debit = duree > 0 ? (file.size * 8) / duree : Infinity

    // Ce que le bouton de l'autre niveau donnerait, pour qu'il le dise lui-même.
    const definitionAutreNiveau =
      niveau === "haute"
        ? (palierVideo(court) ?? court)
        : Math.min(court, VIDEO_BORD_COURT_HAUTE)

    /*
     * ══════ OÙ L'ON DESCEND, ET DE COMBIEN ══════
     *
     * Au niveau NORMAL, l'escalier des paliers (voir [palierVideo]) : on
     * descend toujours d'une marche, et l'on ne s'arrête qu'à 240.
     *
     * Au niveau HAUT, pas d'escalier : un plafond à 1080, et rien d'autre. Le
     * bouton promet mieux, le faire descendre serait l'inverse.
     */
    let vise: number
    if (niveau === "haute") {
      vise = Math.min(court, VIDEO_BORD_COURT_HAUTE)
    } else {
      /*
       * ⚠️ LE DÉCLENCHEUR PASSE AVANT L'ESCALIER — voir `SEUIL_DEBIT`. Un
       * fichier déjà sous le seuil repart intact, quelle que soit sa
       * définition : c'est ce qui empêche de descendre une marche pour rien, et
       * c'est aussi ce qui interdit la cascade.
       *
       * ⚠️ `niveauSuperieurPossible` EST FAUX ICI, et ce n'est pas un oubli :
       * on n'a rien fait, et le niveau haut ne ferait rien non plus — il
       * n'agrandit jamais, et il ne recompresse pas un fichier déjà plus léger
       * que sa propre cible. Proposer le bouton serait promettre un changement
       * qui n'arriverait pas.
       */
      if (dejaAssezLegere(debit)) {
        return { ...intact(file, "deja_legere"), niveauSuperieurPossible: false }
      }
      const palier = palierVideo(court)
      if (palier === null) {
        // 240p ou moins : l'escalier s'arrête là.
        return { ...intact(file, "deja_legere"), niveauSuperieurPossible: false }
      }
      vise = palier
    }

    // ⚠️ JAMAIS AGRANDIR : le facteur est plafonné à 1.
    const facteur = Math.min(1, vise / court)
    // Le H.264 veut des dimensions paires.
    const pair = (n: number) => Math.max(2, 2 * Math.round(n / 2))
    const cible: Cible = {
      largeur: pair(largeur * facteur),
      hauteur: pair(hauteur * facteur),
      debit: 0,
    }
    /*
     * Le débit du palier au niveau normal ; au prorata de la surface au niveau
     * haut, qui n'a pas de palier.
     */
    cible.debit =
      niveau === "haute"
        ? Math.max(400_000, Math.round((DEBIT_720P * cible.largeur * cible.hauteur) / (1280 * 720)))
        : DEBIT_PALIER[vise]

    /*
     * ⚠️ RIEN À GAGNER : ON S'ABSTIENT PLUTÔT QUE DE TRANSCODER POUR RIEN. Au
     * niveau haut, une vidéo déjà en 1080p peut avoir un débit INFÉRIEUR à
     * celui qu'on viserait : la recompresser l'alourdirait. La règle du gain
     * minimum, plus bas, rendrait bien l'original — mais après avoir fait
     * tourner l'encodeur une minute pour rien.
     */
    if (cible.debit >= debit) {
      return {
        ...intact(file, "deja_legere"),
        niveauSuperieurPossible: niveau === "haute" ? false : hautePlusFine(court),
        definitionAutreNiveau,
      }
    }

    /*
     * La voie rapide ne fait que du H.264 dans du MP4 : c'est ce qu'elle a de
     * plus rapide, et ce qui passe partout. La voie lente la rattrape, et
     * rattrape aussi les navigateurs qui n'ont pas de H.264 du tout.
     */
    const depart = performance.now()
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
      definitionAutreNiveau,
      msEncodage: Math.round(performance.now() - depart),
    }
  } catch {
    return intact(file, "conversion_impossible")
  } finally {
    input.dispose()
  }
}

/**
 * La première configuration H.264 que l'encodeur du navigateur accepte.
 *
 * 🔴 ON DEMANDE L'ENCODEUR MATÉRIEL D'ABORD (16/10/2026). On ne le demandait
 * pas : sans `hardwareAcceleration`, la norme laisse le navigateur choisir, et
 * Chrome retombe volontiers sur son encodeur LOGICIEL — cinq à vingt fois plus
 * lent, pour le même fichier à l'arrivée. C'est l'une des trois causes de la
 * lenteur signalée par le user le 16/10 (« rien que le temps que ça compresse…
 * c'est beaucoup trop long »).
 *
 * ⚠️ DEUX PASSES, ET L'ORDRE COMPTE. La puce matérielle est un gain bien plus
 * grand que le profil H.264 : on essaie donc les trois profils EN MATÉRIEL
 * avant d'essayer le premier en logiciel. Un encodeur matériel refuse parfois
 * les très petites images ou les profils élevés — la seconde passe, sans
 * exigence, rattrape ces cas.
 */
async function configurationAvc(cible: Cible): Promise<VideoEncoderConfig | null> {
  // High, Main puis Baseline, niveau 4.0 : de quoi tenir du 720p à 60 i/s.
  const codecs = ["avc1.640028", "avc1.4d4028", "avc1.42e028"]
  for (const acceleration of ["prefer-hardware", undefined] as const) {
    for (const codec of codecs) {
      const config: VideoEncoderConfig = {
        codec,
        width: cible.largeur,
        height: cible.hauteur,
        bitrate: cible.debit,
        avc: { format: "avc" },
        ...(acceleration ? { hardwareAcceleration: acceleration } : {}),
      }
      try {
        if ((await VideoEncoder.isConfigSupported(config)).supported) return config
      } catch {
        /* configuration refusée : on essaie la suivante */
      }
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
