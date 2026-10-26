import { CLE } from "./signature-document"

/**
 * IMAGE SIGNÉE D'UN DOCUMENT SENSIBLE (22/10/2026) — pendant web de
 * `SignatureDocument.kt` du mobile.
 *
 * Le texte est peint aux QUATRE BORDS (contour blanc : lisible sur fond clair
 * comme sombre), puis les métadonnées sont écrites dans le fichier :
 *   - JPEG : un segment EXIF (Artist, Software, ImageDescription, Copyright,
 *     UserComment avec tous les champs, ImageUniqueID = empreinte) ;
 *   - PNG : des blocs texte `iTXt` (Author, Description, Software, Comment et
 *     les champs Alanya), lus par exiftool et la plupart des visionneuses.
 * Une image qui n'est pas un PNG devient un JPEG (le navigateur ne sait pas
 * écrire l'EXIF d'un WebP ou d'un HEIC).
 */

/** Au-delà, l'image est réduite : 4096² pixels suffisent largement. */
const COTE_MAX = 4096

export interface ImageSignee {
  blob: Blob
  mime: string
  extension: string
}

export async function signerImage(
  source: Blob,
  mime: string,
  texte: string,
  meta: Record<string, string>,
): Promise<ImageSignee> {
  // `from-image` : l'orientation EXIF est appliquée, la copie sort droite.
  const image = await createImageBitmap(source, { imageOrientation: "from-image" })
  const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height))
  const l = Math.max(1, Math.round(image.width * echelle))
  const h = Math.max(1, Math.round(image.height * echelle))
  const toile = document.createElement("canvas")
  toile.width = l
  toile.height = h
  const ctx = toile.getContext("2d")
  if (!ctx) throw new Error("Toile indisponible")
  ctx.drawImage(image, 0, 0, l, h)
  image.close()
  peindreBords(ctx, l, h, texte)

  const png = mime.toLowerCase() === "image/png"
  const brut = await new Promise<Blob>((ok, ko) =>
    toile.toBlob((b) => (b ? ok(b) : ko(new Error("Encodage impossible"))), png ? "image/png" : "image/jpeg", 0.92),
  )
  const octets = new Uint8Array(await brut.arrayBuffer())
  // Les quatre lignes des bords, sur une seule ligne de description.
  const description = texte.replace(/\n/g, " · ")
  const signe = png ? avecTextesPng(octets, description, meta) : avecExif(octets, description, meta)
  return {
    blob: new Blob([signe], { type: png ? "image/png" : "image/jpeg" }),
    mime: png ? "image/png" : "image/jpeg",
    extension: png ? "png" : "jpg",
  }
}

/**
 * Le texte de la signature le long des quatre bords — images et vidéos
 * (chaque image d'une vidéo passe ici).
 *
 * 🐛 LES COINS SE CHEVAUCHAIENT (capture du user, 24/10/2026) : sur une image
 * presque carrée, chaque ligne occupait tout son bord et mordait sur la
 * colonne voisine. Chaque ligne laisse maintenant libre, à ses deux bouts, la
 * bande où court le texte perpendiculaire.
 */
export function peindreBords(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  l: number,
  h: number,
  texte: string,
): void {
  // 🔴 UN CHAMP PAR BORD (25/10/2026) : quatre lignes séparées par « \n » —
  // haut, bas, gauche, droite (`bordsVisuels`). Une seule ligne est répétée.
  const lignes = texte.split("\n")
  const [haut, bas, gauche, droite] = lignes.length === 4 ? lignes : [texte, texte, texte, texte]
  // 16 px au moins (25/10/2026, demande du patron), davantage sur une grande
  // image : la ligne reste lisible une fois l'image réduite par WhatsApp.
  const base = Math.max(16, Math.min(l, h) / 50)
  const marge = base * 0.6
  // La bande du texte perpendiculaire : sa marge, plus sa hauteur de ligne.
  const coin = marge + base * 1.3
  const police = (t: number) => `bold ${t}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  // Réduite seulement si la ligne ne tient pas sur son bord.
  const taillePour = (ligne: string, longueur: number) => {
    ctx.font = police(base)
    const unite = ctx.measureText(ligne).width / base
    return unite > 0 ? Math.min(base, (longueur - 2 * coin) / unite) : base
  }

  const bord = (ligne: string, cx: number, cy: number, angle: number, t: number) => {
    if (!ligne.trim()) return
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    ctx.font = police(t)
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.lineJoin = "round"
    // 🔴 BLANC CERNÉ DE NOIR (25/10/2026) : le rouge sur blanc devenait
    // illisible quand WhatsApp recompressait la photo ou la vidéo.
    ctx.lineWidth = t * 0.22
    ctx.strokeStyle = "rgba(0,0,0,0.9)"
    ctx.strokeText(ligne, 0, 0)
    ctx.fillStyle = "rgba(255,255,255,0.94)"
    ctx.fillText(ligne, 0, 0)
    ctx.restore()
  }

  const tHaut = taillePour(haut, l)
  const tBas = taillePour(bas, l)
  const tGauche = taillePour(gauche, h)
  const tDroite = taillePour(droite, h)
  bord(haut, l / 2, marge + tHaut * 0.6, 0, tHaut)
  bord(bas, l / 2, h - marge - tBas * 0.6, 0, tBas)
  // Gauche : lu de bas en haut. Droite : lu de haut en bas.
  bord(gauche, marge + tGauche * 0.6, h / 2, -Math.PI / 2, tGauche)
  bord(droite, l - marge - tDroite * 0.6, h / 2, Math.PI / 2, tDroite)
}

const utf8 = new TextEncoder()

// ── JPEG : segment APP1 « Exif » ─────────────────────────────────────────

/**
 * Les champs texte de l'EXIF sont de l'ASCII : « · » s'y lisait « Â· », et un
 * accent pareil. Le séparateur devient « | », les accents tombent, le reste
 * devient « ? » — même règle que le mobile (`SignatureDocument.kt`).
 */
export function asciiExif(s: string): string {
  return s
    .replace(/ · /g, " | ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
}

/** Insère un segment EXIF juste après l'en-tête JFIF (ou après SOI). */
export function avecExif(jpeg: Uint8Array, texte: string, meta: Record<string, string>): Uint8Array<ArrayBuffer> {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("Pas un JPEG")
  const application = meta[CLE.application] ?? "Alanya Work"
  const exif = segmentExif({
    description: asciiExif(texte),
    logiciel: asciiExif(application),
    auteur: asciiExif(meta[CLE.alanyaId] ? `Alanya ${meta[CLE.alanyaId]}` : application),
    droits: asciiExif(application),
    commentaire: asciiExif(
      Object.entries(meta)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    ),
    code: meta[CLE.empreinte],
  })
  // Après SOI et, s'il est là, après le segment JFIF (APP0).
  let pos = 2
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) pos = 4 + ((jpeg[4] << 8) | jpeg[5])
  const r = new Uint8Array(jpeg.length + exif.length)
  r.set(jpeg.subarray(0, pos), 0)
  r.set(exif, pos)
  r.set(jpeg.subarray(pos), pos + exif.length)
  return r
}

interface ChampsExif {
  description: string
  logiciel: string
  auteur: string
  droits: string
  commentaire: string
  code?: string
}

/** APP1 : « Exif\0\0 », puis un TIFF gros-boutiste : IFD0 → IFD Exif. */
function segmentExif(c: ChampsExif): Uint8Array {
  const ascii = (s: string) => {
    const o = utf8.encode(s)
    const r = new Uint8Array(o.length + 1)
    r.set(o)
    return r
  }
  // UserComment : 8 octets d'en-tête de jeu de caractères, puis le texte.
  const commentaire = (() => {
    const o = utf8.encode(c.commentaire)
    const r = new Uint8Array(8 + o.length)
    r.set(utf8.encode("ASCII\0\0\0"))
    r.set(o, 8)
    return r
  })()
  type Entree = { tag: number; type: number; valeur: Uint8Array | number }
  const ifd0: Entree[] = [
    { tag: 0x010e, type: 2, valeur: ascii(c.description) },
    { tag: 0x0131, type: 2, valeur: ascii(c.logiciel) },
    { tag: 0x013b, type: 2, valeur: ascii(c.auteur) },
    { tag: 0x8298, type: 2, valeur: ascii(c.droits) },
    { tag: 0x8769, type: 4, valeur: 0 }, // position de l'IFD Exif, posée plus bas
  ]
  const ifdExif: Entree[] = [
    { tag: 0x9286, type: 7, valeur: commentaire },
    ...(c.code ? [{ tag: 0xa420, type: 2, valeur: ascii(c.code) }] : []),
  ]

  const tailleIfd = (e: Entree[]) => 2 + e.length * 12 + 4
  const horsLigne = (e: Entree[]) =>
    e.reduce((n, x) => n + (typeof x.valeur === "number" || x.valeur.length <= 4 ? 0 : x.valeur.length + (x.valeur.length % 2)), 0)
  const debutIfd0 = 8
  const debutIfdExif = debutIfd0 + tailleIfd(ifd0) + horsLigne(ifd0)
  const total = debutIfdExif + tailleIfd(ifdExif) + horsLigne(ifdExif)
  ifd0[4].valeur = debutIfdExif

  const tiff = new Uint8Array(total)
  const v = new DataView(tiff.buffer)
  tiff.set([0x4d, 0x4d, 0x00, 0x2a]) // « MM », 42
  v.setUint32(4, debutIfd0)
  const ecrireIfd = (debut: number, entrees: Entree[]) => {
    v.setUint16(debut, entrees.length)
    let donnees = debut + tailleIfd(entrees)
    entrees.forEach((e, i) => {
      const p = debut + 2 + i * 12
      v.setUint16(p, e.tag)
      v.setUint16(p + 2, e.type)
      if (typeof e.valeur === "number") {
        v.setUint32(p + 4, 1)
        v.setUint32(p + 8, e.valeur)
        return
      }
      v.setUint32(p + 4, e.valeur.length)
      if (e.valeur.length <= 4) {
        tiff.set(e.valeur, p + 8)
      } else {
        v.setUint32(p + 8, donnees)
        tiff.set(e.valeur, donnees)
        donnees += e.valeur.length + (e.valeur.length % 2)
      }
    })
    v.setUint32(debut + 2 + entrees.length * 12, 0) // pas d'IFD suivant
  }
  ecrireIfd(debutIfd0, ifd0)
  ecrireIfd(debutIfdExif, ifdExif)

  const charge = new Uint8Array(6 + tiff.length)
  charge.set(utf8.encode("Exif\0\0"))
  charge.set(tiff, 6)
  if (charge.length + 2 > 0xffff) throw new Error("EXIF trop long")
  const segment = new Uint8Array(4 + charge.length)
  segment.set([0xff, 0xe1, (charge.length + 2) >> 8, (charge.length + 2) & 0xff])
  segment.set(charge, 4)
  return segment
}

// ── PNG : blocs iTXt ─────────────────────────────────────────────────────

/** Insère des blocs `iTXt` (texte UTF-8) juste avant `IEND`. */
export function avecTextesPng(png: Uint8Array, texte: string, meta: Record<string, string>): Uint8Array<ArrayBuffer> {
  const application = meta[CLE.application] ?? "Alanya Work"
  const textes: Record<string, string> = {
    Author: meta[CLE.alanyaId] ? `Alanya ${meta[CLE.alanyaId]}` : application,
    Description: texte,
    Software: application,
    Copyright: application,
    Comment: Object.entries(meta)
      .map(([k, v]) => `${k}=${v}`)
      .join("; "),
    ...meta,
  }
  const blocs = Object.entries(textes).map(([cle, valeur]) =>
    blocPng("iTXt", concat(latin1(cle), new Uint8Array([0, 0, 0, 0, 0]), utf8.encode(valeur))),
  )
  // IEND : les 12 derniers octets d'un PNG bien formé.
  const fin = png.length - 12
  if (String.fromCharCode(...png.subarray(fin + 4, fin + 8)) !== "IEND") throw new Error("PNG sans IEND")
  return concat(png.subarray(0, fin), ...blocs, png.subarray(fin))
}

function latin1(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)
}

function concat(...parties: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const r = new Uint8Array(parties.reduce((n, p) => n + p.length, 0))
  let p = 0
  for (const x of parties) {
    r.set(x, p)
    p += x.length
  }
  return r
}

function blocPng(type: string, donnees: Uint8Array): Uint8Array {
  const r = new Uint8Array(12 + donnees.length)
  const v = new DataView(r.buffer)
  v.setUint32(0, donnees.length)
  r.set(latin1(type), 4)
  r.set(donnees, 8)
  v.setUint32(8 + donnees.length, crc32(r.subarray(4, 8 + donnees.length)))
  return r
}

let TABLE_CRC: Uint32Array | null = null
function crc32(o: Uint8Array): number {
  if (!TABLE_CRC) {
    TABLE_CRC = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      TABLE_CRC[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const x of o) c = TABLE_CRC[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
