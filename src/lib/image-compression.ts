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

/** Bord le plus long après réduction. Repère WhatsApp ; un grand téléphone
 *  affiche environ 1290 px physiques. */
export const IMAGE_BORD_MAX = 1600

/** Même valeur que `AVATAR_QUALITY` — déjà éprouvée dans ce dépôt. */
export const IMAGE_QUALITE = 0.82

/** En dessous, le gain ne vaut pas le risque de perte : on garde l'original. */
const GAIN_MINIMUM = 0.9

export type RaisonSaut =
  | "trop_petite"
  | "png"
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
async function formatReel(file: File): Promise<"png" | "gif" | "webp-anime" | "svg" | "autre"> {
  const entete = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  const octets = (...valeurs: number[]) => valeurs.every((v, i) => entete[i] === v)

  // PNG. Couvre d'un seul test les captures d'écran, la transparence et l'APNG
  // animé — trois cas qu'un ré-encodage JPEG abîmerait chacun à sa façon.
  if (octets(0x89, 0x50, 0x4e, 0x47)) return "png"

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
 * Compresse une image, ou rend l'original si le moindre doute existe.
 *
 * Ne lève jamais : un envoi ne doit pas échouer parce qu'une optimisation a
 * échoué.
 */
export async function compresserImage(file: File): Promise<ResultatCompression> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return intact(file, "canvas_indisponible")
  }

  const format = await formatReel(file).catch(() => "autre" as const)
  if (format === "png") return intact(file, "png")
  if (format === "gif" || format === "webp-anime") return intact(file, "animee")
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

    // ⚠️ TEST SUR LES DIMENSIONS, PAS SUR LE POIDS. C'est lui qui empêche de
    // recompresser indéfiniment une image déjà passée par ici — une photo
    // reçue puis transférée perdrait un peu de qualité à chaque saut.
    if (Math.max(largeurSource, hauteurSource) <= IMAGE_BORD_MAX) {
      return intact(file, "trop_petite")
    }

    const facteur = IMAGE_BORD_MAX / Math.max(largeurSource, hauteurSource)
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

    const blob = await new Promise<Blob | null>((resoudre) => {
      canvas.toBlob(resoudre, "image/jpeg", IMAGE_QUALITE)
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
    }
  } catch {
    return intact(file, "decodage_impossible")
  } finally {
    // Un bitmap 48 Mpx retient près de 200 Mo de RGBA : le libérer n'est pas
    // une politesse, c'est ce qui évite de faire tomber l'onglet sur un lot.
    bitmap.close()
  }
}
