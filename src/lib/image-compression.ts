/**
 * COMPRESSER UNE IMAGE AVANT DE L'ENVOYER.
 *
 * Une photo de téléphone fait 3 à 5 Mo pour 4000 × 3000 pixels. Le fil de
 * discussion l'affiche dans 280 px de large. On payait donc — en données
 * mobiles, des deux côtés — le transport d'une image cinquante fois plus grande
 * que ce qui s'affiche.
 *
 * Réduire le bord long à 1600 px et ré-encoder en JPEG à 0,82 divise le poids
 * par dix à quinze, sans différence visible dans une bulle de conversation.
 * Ce sont les réglages de `avatar.ts`, déjà en production ici.
 *
 * ⚠️ CE MODULE PRÉFÈRE TOUJOURS NE RIEN FAIRE. Chaque incertitude — format
 * inconnu, décodage raté, gain absent — rend le fichier d'origine. Une image
 * envoyée intacte est un non-événement ; une image abîmée, corrompue ou
 * couchée est un défaut que l'utilisateur découvre chez son correspondant,
 * quand il est trop tard.
 */

/**
 * LES DEUX NIVEAUX DE QUALITÉ À L'ENVOI — décision du user, 12/10/2026.
 *
 * 🔴 ILS REMPLACENT LE BOUTON « ENVOYER L'ORIGINAL ». Envoyer l'original,
 * c'était envoyer 5 Mo pour une photo et 30 à 200 Mo pour une vidéo : sur une
 * connexion lente et payée au volume, c'est un envoi qui n'aboutit pas. Les
 * deux niveaux bornent ce qui part, le haut restant bien plus près de
 * l'original que le normal.
 *
 * ⚠️ IL VIT ICI, et non dans le module vidéo, parce que celui-ci importe déjà
 * celui-là : l'inverse ferait un import circulaire.
 */
export type NiveauQualite = "normal" | "haute"

/**
 * L'ESCALIER DES PALIERS — décision du user, 13/10/2026, même règle que la
 * vidéo (voir `video-compression.ts`).
 *
 * 🐛 UNE PHOTO DÉJÀ SOUS 1600 px NE SE COMPRESSAIT PLUS : on visait 1600 et
 * elle y était déjà. La nouvelle règle descend toujours d'une marche.
 *
 *   · plus de 1600 px → 1600
 *   · 1001 à 1600     → 1000
 *   · 641 à 1000      → 640
 *   · 640 ou moins    → on ne touche plus à rien
 *
 * ⚠️ LE NIVEAU HAUT N'A PAS D'ESCALIER : le bouton « meilleure qualité » garde
 * son plafond à 2560 px et ne réduit que ce qui le dépasse.
 */
/**
 * Poids au-delà duquel une image est ré-encodée même si elle est déjà petite.
 *
 * Une photo passée par ici pèse 0,1 à 0,3 octet par pixel : elle reste sous ce
 * seuil. Une image de 1500 px enregistrée en qualité maximale, elle, en pèse 1
 * à 2 — elle passe.
 */
const OCTETS_PAR_PIXEL_MAX = 0.5

export const PALIERS_IMAGE = [1600, 1000, 640] as const

/** Le plus petit palier : en dessous, on ne réduit plus. */
export const IMAGE_PALIER_PLANCHER = PALIERS_IMAGE[PALIERS_IMAGE.length - 1]

/**
 * Le palier visé pour une photo dont le bord long mesure [long], ou `null`
 * quand il n'y a plus rien à faire.
 */
export function palierImage(long: number): number | null {
  if (long <= IMAGE_PALIER_PLANCHER) return null
  for (const p of PALIERS_IMAGE) {
    if (long > p) return p
  }
  return null
}

/**
 * CETTE PHOTO EST-ELLE DÉJÀ SORTIE DE CHEZ NOUS ?
 *
 * 🔴 LA GARDE CONTRE LA CASCADE, jumelle de `dejaUnPalierAlanya` côté vidéo.
 * Sans elle, une photo reçue, enregistrée dans la galerie puis renvoyée
 * perdrait une marche à chaque tour — jusqu'à 640 px.
 *
 * ⚠️ DEUX CONDITIONS, ET LES DEUX COMPTENT : le bord long doit être EXACTEMENT
 * un de nos paliers, et le poids par pixel doit être celui d'une de nos
 * sorties. Une photo de 1000 px lourde comme une brute n'est pas la nôtre.
 */
export function dejaUnPalierImageAlanya(long: number, octets: number, pixels: number): boolean {
  if (!PALIERS_IMAGE.includes(long as (typeof PALIERS_IMAGE)[number])) return false
  return pixels > 0 && octets <= pixels * OCTETS_PAR_PIXEL_MAX
}

/** Bord le plus long après réduction. Repère WhatsApp ; un grand téléphone
 *  affiche environ 1290 px physiques. */
export const IMAGE_BORD_MAX = 1600

/** Même valeur que `AVATAR_QUALITY` — déjà éprouvée dans ce dépôt. */
export const IMAGE_QUALITE = 0.82

/**
 * LE NIVEAU HAUT — ce que le bouton « Meilleure qualité » demande.
 *
 * 🔴 IL REMPLACE « ENVOYER L'ORIGINAL » (décision du user, 12/10/2026). Une
 * photo de 12 Mpx pèse 4 à 6 Mo ; sur une connexion lente, c'est un envoi qui
 * n'aboutit pas. À 2560 px et en qualité 0,90, la même photo pèse 1 à 2 Mo et
 * reste lisible à la loupe — un reçu, une ordonnance, un plan.
 *
 * ⚠️ 2560 px EST UN PLAFOND, PAS UNE CIBLE : on n'agrandit jamais. Une photo de
 * 2000 px reste à 2000 px, simplement ré-encodée plus finement.
 */
export const IMAGE_BORD_MAX_HAUTE = 2560
export const IMAGE_QUALITE_HAUTE = 0.9

/** Le plafond et la qualité d'un niveau donné. */
export function reglagesImage(niveau: NiveauQualite): { bordMax: number; qualite: number } {
  return niveau === "haute"
    ? { bordMax: IMAGE_BORD_MAX_HAUTE, qualite: IMAGE_QUALITE_HAUTE }
    : { bordMax: IMAGE_BORD_MAX, qualite: IMAGE_QUALITE }
}

/** En dessous, le gain ne vaut pas le risque de perte : on garde l'original. */
const GAIN_MINIMUM = 0.9

export type RaisonSaut =
  | "trop_petite"
  | "transparente"
  | "animee"
  | "vectorielle"
  | "decodage_impossible"
  | "sans_gain"
  | "canvas_indisponible"

export interface ResultatCompression {
  /** Le fichier à envoyer — l'ORIGINAL si rien n'a été fait. */
  fichier: File
  compresse: boolean
  /** Pourquoi on n'a rien fait. Sert au diagnostic, pas à l'affichage. */
  raisonSaut?: RaisonSaut
  tailleAvant: number
  tailleApres: number
  /**
   * Le niveau haut donnerait-il vraiment mieux ?
   *
   * 🔴 SERT À NE PAS PROPOSER UN CHOIX QUI NE CHANGE RIEN. On n'agrandit
   * jamais : une photo de 1200 px n'a pas un pixel de plus à offrir, et un
   * bouton « Meilleure qualité » serait un mensonge.
   */
  niveauSuperieurPossible?: boolean
}

function intact(file: File, raisonSaut: RaisonSaut): ResultatCompression {
  return {
    fichier: file,
    compresse: false,
    raisonSaut,
    tailleAvant: file.size,
    tailleApres: file.size,
  }
}

/**
 * Le format réel, lu dans les OCTETS et non dans `file.type`.
 *
 * ⚠️ Le type déclaré n'est pas fiable, et ce dépôt le sait déjà : `chat.tsx`
 * porte le commentaire « Certains téléphones ne renseignent pas File.type » et
 * retombe volontairement sur `application/octet-stream`. Décider de compresser
 * sur un champ vide reviendrait à décider au hasard.
 */
async function formatReel(
  file: File
): Promise<"jpeg" | "png" | "png-anime" | "gif" | "webp-anime" | "svg" | "autre"> {
  const entete = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  const octets = (...valeurs: number[]) => valeurs.every((v, i) => entete[i] === v)

  if (octets(0xff, 0xd8, 0xff)) return "jpeg"

  // PNG : une capture d'écran, le plus souvent — à compresser. Mais l'APNG
  // animé porte la même signature, et un canvas n'en garderait que la première
  // image : on le reconnaît à son bloc `acTL`.
  if (octets(0x89, 0x50, 0x4e, 0x47)) return (await pngAnime(file)) ? "png-anime" : "png"

  // GIF : animé la plupart du temps, et un canvas n'en garderait que la
  // première image. On rendrait un film fixe.
  if (octets(0x47, 0x49, 0x46, 0x38)) return "gif"

  // WebP animé : même piège que le GIF. Le bloc `ANMF` le signale.
  if (octets(0x52, 0x49, 0x46, 0x46) && entete[8] === 0x57 && entete[9] === 0x45) {
    const texte = new TextDecoder("latin1").decode(entete)
    if (texte.includes("ANMF")) return "webp-anime"
  }

  // SVG : du texte, pas des pixels. Le rastériser perdrait tout son intérêt.
  const debut = new TextDecoder("latin1").decode(entete.slice(0, 512)).trimStart()
  if (debut.startsWith("<svg") || (debut.startsWith("<?xml") && debut.includes("<svg"))) {
    return "svg"
  }

  return "autre"
}

/**
 * Ce PNG est-il animé ?
 *
 * La norme place `acTL` AVANT le premier `IDAT` : on parcourt les blocs
 * jusque-là. Si on n'y arrive pas — fichier tronqué, en-têtes démesurés — on
 * répond « animé » : dans le doute, on ne touche à rien.
 */
async function pngAnime(file: File): Promise<boolean> {
  const vue = new DataView(await file.slice(0, 256 * 1024).arrayBuffer())
  let position = 8
  while (position + 8 <= vue.byteLength) {
    const longueur = vue.getUint32(position)
    const type = String.fromCharCode(
      vue.getUint8(position + 4),
      vue.getUint8(position + 5),
      vue.getUint8(position + 6),
      vue.getUint8(position + 7)
    )
    if (type === "acTL") return true
    if (type === "IDAT") return false
    position += 12 + longueur
  }
  return true
}

/**
 * L'ORIENTATION EXIF, lue à la main.
 *
 * Un canvas ne la conserve PAS : une photo prise en portrait arrive couchée
 * chez le destinataire. Et on ne peut pas s'en remettre à l'option
 * `imageOrientation: "from-image"` de `createImageBitmap` — c'est un membre de
 * dictionnaire, donc IGNORÉ EN SILENCE là où il n'est pas implémenté. La photo
 * partirait couchée sans la moindre erreur.
 *
 * Renvoie 1 (aucune rotation) dès que quoi que ce soit est illisible : mieux
 * vaut ne pas tourner que tourner de travers.
 */
async function orientationExif(file: File): Promise<number> {
  try {
    const vue = new DataView(await file.slice(0, 128 * 1024).arrayBuffer())
    if (vue.byteLength < 4 || vue.getUint16(0) !== 0xffd8) return 1 // pas un JPEG

    let position = 2
    while (position + 4 < vue.byteLength) {
      if (vue.getUint8(position) !== 0xff) return 1
      const marqueur = vue.getUint8(position + 1)
      const taille = vue.getUint16(position + 2)
      if (marqueur !== 0xe1) {
        position += 2 + taille
        continue
      }
      // APP1 : « Exif\0\0 » puis l'en-tête TIFF.
      const tiff = position + 10
      if (tiff + 8 > vue.byteLength) return 1
      const petitBoutiste = vue.getUint16(tiff) === 0x4949
      const ifd = tiff + vue.getUint32(tiff + 4, petitBoutiste)
      if (ifd + 2 > vue.byteLength) return 1
      const nombre = vue.getUint16(ifd, petitBoutiste)
      for (let i = 0; i < nombre; i += 1) {
        const entree = ifd + 2 + i * 12
        if (entree + 12 > vue.byteLength) return 1
        if (vue.getUint16(entree, petitBoutiste) === 0x0112) {
          const valeur = vue.getUint16(entree + 8, petitBoutiste)
          return valeur >= 1 && valeur <= 8 ? valeur : 1
        }
      }
      return 1
    }
    return 1
  } catch {
    return 1
  }
}

/** Les orientations 5 à 8 échangent largeur et hauteur. */
function orientationTourne(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8
}

/** Pose la transformation qui remet l'image droite. */
function appliquerOrientation(
  ctx: CanvasRenderingContext2D,
  orientation: number,
  largeur: number,
  hauteur: number
): void {
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, largeur, 0)
      break
    case 3:
      ctx.transform(-1, 0, 0, -1, largeur, hauteur)
      break
    case 4:
      ctx.transform(1, 0, 0, -1, 0, hauteur)
      break
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0)
      break
    case 6:
      ctx.transform(0, 1, -1, 0, hauteur, 0)
      break
    case 7:
      ctx.transform(0, -1, -1, 0, hauteur, largeur)
      break
    case 8:
      ctx.transform(0, -1, 1, 0, 0, largeur)
      break
    default:
      break
  }
}

/**
 * L'encodage a-t-il produit une vraie image ?
 *
 * Sur certains navigateurs anciens, le décodage échoue SANS LEVER : le canvas
 * reste uniformément vide et l'on enverrait un rectangle noir. On échantillonne
 * une grille et l'on refuse une image parfaitement uniforme — un test du
 * résultat, plutôt qu'un seuil de poids arbitraire qui se tromperait sur une
 * photo légitimement unie.
 */
function canvasVraisemblable(ctx: CanvasRenderingContext2D, l: number, h: number): boolean {
  try {
    const pas = 8
    const points: number[] = []
    for (let y = 0; y < pas; y += 1) {
      for (let x = 0; x < pas; x += 1) {
        const px = Math.min(l - 1, Math.floor((x + 0.5) * (l / pas)))
        const py = Math.min(h - 1, Math.floor((y + 0.5) * (h / pas)))
        const d = ctx.getImageData(px, py, 1, 1).data
        points.push(d[0] + d[1] + d[2])
      }
    }
    const moyenne = points.reduce((a, b) => a + b, 0) / points.length
    return points.some((p) => Math.abs(p - moyenne) > 1)
  } catch {
    // Canvas « souillé » par une origine croisée : on ne peut pas vérifier,
    // mais rien n'indique un échec. On laisse passer.
    return true
  }
}

/**
 * Un pixel au moins est-il transparent ?
 *
 * Le JPEG n'a pas de transparence : un logo ou un autocollant détouré
 * arriverait sur fond noir. Ceux-là partent intacts. Une capture d'écran,
 * elle, est entièrement opaque même quand son PNG prévoit une couche alpha.
 */
function transparente(ctx: CanvasRenderingContext2D, l: number, h: number): boolean {
  try {
    const pixels = ctx.getImageData(0, 0, l, h).data
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 255) return true
    }
    return false
  } catch {
    // Illisible : on ne peut pas prouver l'opacité, on ne touche à rien.
    return true
  }
}

/**
 * Compresse une image, ou rend l'original si le moindre doute existe.
 *
 * Ne lève jamais : un envoi ne doit pas échouer parce qu'une optimisation a
 * échoué.
 */
export async function compresserImage(
  file: File,
  niveau: NiveauQualite = "normal"
): Promise<ResultatCompression> {
  const { bordMax, qualite } = reglagesImage(niveau)
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return intact(file, "canvas_indisponible")
  }

  const format = await formatReel(file).catch(() => "autre" as const)
  if (format === "gif" || format === "webp-anime" || format === "png-anime") {
    return intact(file, "animee")
  }
  if (format === "svg") return intact(file, "vectorielle")

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // HEIC hors Safari, AVIF, fichier tronqué. On ne sait pas le lire, on n'y
    // touche pas : le serveur, lui, accepte le HEIC tel quel.
    return intact(file, "decodage_impossible")
  }

  try {
    const orientation = await orientationExif(file)
    const tournee = orientationTourne(orientation)
    const largeurSource = tournee ? bitmap.height : bitmap.width
    const hauteurSource = tournee ? bitmap.width : bitmap.height

    const bordLong = Math.max(largeurSource, hauteurSource)

    /*
     * ⚠️ UNE IMAGE DÉJÀ PETITE ET LÉGÈRE N'EST PAS RECOMPRESSÉE. C'est ce qui
     * empêche une photo reçue puis transférée de perdre un peu de qualité à
     * chaque saut. Le PNG n'est jamais dans ce cas : il n'est pas encore passé
     * par ici, puisque ce module rend du JPEG.
     *
     * 🐛 LES CAPTURES D'ÉCRAN PARTAIENT INTACTES (signalé par le user le
     * 06/10/2026 : « ça ne compresse pas »). Ce module laissait passer TOUT
     * PNG, au nom de la transparence et de l'APNG. Or le PNG est d'abord le
     * format des captures — 400 Ko pour un écran de téléphone, cinq fois le
     * poids du même écran en JPEG. Seuls l'animé et le transparent restent
     * intacts ; ils sont reconnus un par un, plus haut et plus bas.
     */
    /*
     * ══════ OÙ L'ON DESCEND, ET DE COMBIEN ══════
     *
     * Au niveau NORMAL, l'escalier des paliers : on descend d'une marche, et
     * l'on s'arrête à 640 px. Au niveau HAUT, un simple plafond à 2560 px.
     *
     * ⚠️ LE PNG N'EST JAMAIS « DÉJÀ SORTI DE CHEZ NOUS » : ce module rend du
     * JPEG. Une capture d'écran en PNG passe donc toujours, et c'est ce qui a
     * corrigé « ça ne compresse pas » le 06/10/2026.
     */
    let cible: number
    if (niveau === "haute") {
      if (
        format !== "png" &&
        bordLong <= bordMax &&
        file.size <= largeurSource * hauteurSource * OCTETS_PAR_PIXEL_MAX
      ) {
        return { ...intact(file, "trop_petite"), niveauSuperieurPossible: bordLong > IMAGE_BORD_MAX }
      }
      cible = bordMax
    } else {
      // La garde contre la cascade : déjà un de nos paliers, et déjà léger.
      if (
        format !== "png" &&
        dejaUnPalierImageAlanya(bordLong, file.size, largeurSource * hauteurSource)
      ) {
        return { ...intact(file, "trop_petite"), niveauSuperieurPossible: bordLong > IMAGE_BORD_MAX }
      }
      const palier = palierImage(bordLong)
      /*
       * 🐛 UNE PETITE CAPTURE PNG SERAIT REPARTIE INTACTE. L'escalier s'arrête
       * à 640 px ; mais pour un PNG, l'essentiel du gain ne vient pas de la
       * taille — il vient du PASSAGE EN JPEG, qui divise le poids par cinq.
       * Une capture de 500 px repartait donc entière, et c'est exactement le
       * défaut corrigé le 06/10/2026 (« ça ne compresse pas »).
       *
       * En dessous du plancher, un PNG est donc ré-encodé À SA TAILLE.
       */
      if (palier === null && format !== "png") {
        return { ...intact(file, "trop_petite"), niveauSuperieurPossible: false }
      }
      cible = palier ?? bordLong
    }

    // ⚠️ JAMAIS AGRANDIR : le facteur est plafonné à 1.
    const facteur = Math.min(1, cible / bordLong)
    const largeur = Math.round(largeurSource * facteur)
    const hauteur = Math.round(hauteurSource * facteur)

    const canvas = document.createElement("canvas")
    canvas.width = largeur
    canvas.height = hauteur
    const ctx = canvas.getContext("2d")
    if (!ctx) return intact(file, "canvas_indisponible")

    appliquerOrientation(ctx, orientation, largeur, hauteur)
    // Les dimensions passées à `drawImage` sont celles de la SOURCE, remises
    // dans le sens du dessin : la transformation ci-dessus a déjà tourné le
    // repère.
    ctx.drawImage(bitmap, 0, 0, tournee ? hauteur : largeur, tournee ? largeur : hauteur)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    if (!canvasVraisemblable(ctx, largeur, hauteur)) {
      return intact(file, "decodage_impossible")
    }
    if (format !== "jpeg" && transparente(ctx, largeur, hauteur)) {
      return intact(file, "transparente")
    }

    const blob = await new Promise<Blob | null>((resoudre) => {
      canvas.toBlob(resoudre, "image/jpeg", qualite)
    })
    if (!blob || blob.type !== "image/jpeg") return intact(file, "decodage_impossible")
    if (blob.size >= file.size * GAIN_MINIMUM) return intact(file, "sans_gain")

    /*
     * LE NOM ET LE TYPE SUIVENT LES OCTETS, ET CE N'EST PAS DE LA COQUETTERIE.
     *
     * Le serveur choisit l'extension de stockage d'après le NOM du fichier
     * avant de regarder le type. Envoyer des octets JPEG sous un nom `.png`
     * les ferait servir plus tard avec le mauvais en-tête, et certains
     * navigateurs refusent alors de les afficher.
     */
    const nom = file.name.replace(/\.[^.]+$/, "") + ".jpg"
    return {
      fichier: new File([blob], nom, { type: "image/jpeg", lastModified: file.lastModified }),
      compresse: true,
      tailleAvant: file.size,
      tailleApres: blob.size,
      niveauSuperieurPossible: bordLong > IMAGE_BORD_MAX,
    }
  } catch {
    return intact(file, "decodage_impossible")
  } finally {
    // Un bitmap 48 Mpx retient près de 200 Mo de RGBA : le libérer n'est pas
    // une politesse, c'est ce qui évite de faire tomber l'onglet sur un lot.
    bitmap.close()
  }
}
