/**
 * MÉTADONNÉES D'UNE VIDÉO MP4 / MOV / 3GP, SANS LA RÉENCODER (22/10/2026).
 *
 * Même logique que `lib/core/mp4_metadonnees.dart` du mobile : la copie d'un
 * document sensible qui sort d'Alanya porte, dans `moov/udta/meta/ilst`, de
 * quoi remonter à qui l'a fait sortir. L'image n'est pas touchée.
 *
 * Seule la boîte `moov` (l'index, quelques Ko à quelques Mo) est lue et
 * reconstruite ; le reste est recopié par tranches de `Blob` : une vidéo de
 * 300 Mo n'est jamais chargée entière en mémoire.
 *
 * ⚠️ Si `moov` précède les données, l'agrandir décale tout ce qui suit : les
 * positions `stco` / `co64` sont corrigées du même décalage. Une vidéo
 * fragmentée (`moof`) après `moov` est refusée plutôt que cassée.
 */

export const ESPACE_MP4 = "com.alanya237.work"

/** Au-delà, `moov` n'est pas une table d'index plausible. */
const MOOV_MAX = 64 * 1024 * 1024

const EXTENSIONS = new Set(["mp4", "m4v", "mov", "3gp", "3g2"])
const TYPES = new Set(["video/mp4", "video/quicktime", "video/3gpp", "video/3gpp2", "video/x-m4v"])

export interface ElementsMp4 {
  /** Éléments standard, par clé de quatre caractères (`©cmt`, `©ART`…). */
  standard: Record<string, string>
  /** Éléments libres (`----`) sous {@link ESPACE_MP4}. */
  libres: Record<string, string>
}

export class Mp4NonPrisEnCharge extends Error {}

export function mp4PrisEnCharge(mime: string, nom: string): boolean {
  if (TYPES.has(mime.toLowerCase())) return true
  const point = nom.lastIndexOf(".")
  return point >= 0 && EXTENSIONS.has(nom.slice(point + 1).toLowerCase())
}

interface Boite {
  type: string
  debut: number
  /** Début du contenu, après l'en-tête. */
  charge: number
  fin: number
}

const utf8 = new TextEncoder()
const deUtf8 = new TextDecoder()

/** Les types de boîte sont en Latin-1 (« © » = 0xA9). */
function latin1(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0) & 0xff)
}
function deLatin1(o: Uint8Array): string {
  return String.fromCharCode(...o)
}

/** Copie de `fichier` avec `elements` écrits dans ses métadonnées. */
export async function ecrireMetadonneesMp4(fichier: Blob, elements: ElementsMp4): Promise<Blob> {
  const boites = await boitesDuHaut(fichier)
  const moovs = boites.filter((b) => b.type === "moov")
  if (moovs.length !== 1) throw new Mp4NonPrisEnCharge("Pas de boîte moov unique")
  const moov = moovs[0]
  if (moov.fin - moov.debut > MOOV_MAX) throw new Mp4NonPrisEnCharge("Boîte moov démesurée")
  const ancien = new Uint8Array(await fichier.slice(moov.debut, moov.fin).arrayBuffer())
  const nouveau = remplacerMoov(ancien, elements)
  const decalage = nouveau.length - ancien.length
  if (decalage !== 0 && boites.some((b) => b.type === "moof" && b.debut >= moov.fin)) {
    throw new Mp4NonPrisEnCharge("Vidéo fragmentée : non prise en charge")
  }
  deplacerPositions(nouveau, moov.fin, decalage)
  const morceaux: BlobPart[] = boites.map((b) => (b === moov ? nouveau : fichier.slice(b.debut, b.fin)))
  return new Blob(morceaux, { type: fichier.type })
}

/** La boîte `moov` avec les métadonnées dans `udta/meta/ilst`. */
export function remplacerMoov(moov: Uint8Array, elements: ElementsMp4): Uint8Array<ArrayBuffer> {
  const tete = entete(moov, 0)
  if (tete.type !== "moov") throw new Mp4NonPrisEnCharge("Pas une boîte moov")
  const morceaux: Uint8Array[] = []
  let udtaVue = false
  for (const e of enfants(moov, tete.charge, moov.length)) {
    if (e.type === "udta" && !udtaVue) {
      udtaVue = true
      morceaux.push(remplacerUdta(moov.subarray(e.debut, e.fin), elements))
    } else {
      morceaux.push(moov.subarray(e.debut, e.fin))
    }
  }
  if (!udtaVue) morceaux.push(boite("udta", meta(elements, [])))
  return boite("moov", ...morceaux)
}

function remplacerUdta(udta: Uint8Array, elements: ElementsMp4): Uint8Array<ArrayBuffer> {
  const tete = entete(udta, 0)
  const morceaux: Uint8Array[] = []
  let metaVue = false
  for (const e of enfants(udta, tete.charge, udta.length)) {
    if (e.type === "meta" && !metaVue) {
      metaVue = true
      morceaux.push(remplacerMeta(udta.subarray(e.debut, e.fin), elements))
    } else {
      morceaux.push(udta.subarray(e.debut, e.fin))
    }
  }
  if (!metaVue) morceaux.push(meta(elements, []))
  return boite("udta", ...morceaux)
}

/**
 * Une `meta` iTunes (`hdlr` = `mdir`) garde ses autres éléments ; une `meta`
 * d'une autre sorte est remplacée.
 */
function remplacerMeta(m: Uint8Array, elements: ElementsMp4): Uint8Array<ArrayBuffer> {
  const tete = entete(m, 0)
  // « full box » en MP4 (version + drapeaux), pas toujours en QuickTime.
  const pleine = tete.charge + 8 <= m.length && !estTypeDeBoite(m, tete.charge + 4)
  const enfantsMeta = enfants(m, tete.charge + (pleine ? 4 : 0), m.length)
  const hdlr = enfantsMeta.find((e) => e.type === "hdlr")
  const mdir =
    hdlr !== undefined &&
    hdlr.charge + 12 <= hdlr.fin &&
    deLatin1(m.subarray(hdlr.charge + 8, hdlr.charge + 12)) === "mdir"
  if (!mdir) return meta(elements, [])

  const ilst = enfantsMeta.find((e) => e.type === "ilst")
  const gardes: Uint8Array[] = []
  if (ilst) {
    for (const item of enfants(m, ilst.charge, ilst.fin)) {
      if (!estAMoi(item, m, elements)) gardes.push(m.subarray(item.debut, item.fin))
    }
  }
  const autres = enfantsMeta.filter((e) => e.type !== "ilst").map((e) => m.subarray(e.debut, e.fin))
  return boite(
    "meta",
    ...(pleine ? [m.subarray(tete.charge, tete.charge + 4)] : []),
    ...autres,
    boite("ilst", ...gardes, ...items(elements)),
  )
}

/** Même clé standard, ou élément libre d'Alanya : une copie re-signée ne cumule pas deux traces. */
function estAMoi(item: Boite, d: Uint8Array, elements: ElementsMp4): boolean {
  if (item.type in elements.standard) return true
  if (item.type !== "----") return false
  for (const e of enfants(d, item.charge, item.fin)) {
    if (e.type === "mean" && e.charge + 4 <= e.fin) {
      return deUtf8.decode(d.subarray(e.charge + 4, e.fin)) === ESPACE_MP4
    }
  }
  return false
}

function meta(elements: ElementsMp4, gardes: Uint8Array[]): Uint8Array<ArrayBuffer> {
  // hdlr iTunes : version/drapeaux, pre_defined, « mdir », « appl », 0, 0, nom vide.
  const hdlr = boite(
    "hdlr",
    new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, ...latin1("mdir"), ...latin1("appl"), 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  )
  return boite("meta", new Uint8Array(4), hdlr, boite("ilst", ...gardes, ...items(elements)))
}

function items(elements: ElementsMp4): Uint8Array[] {
  return [
    ...Object.entries(elements.standard).map(([cle, valeur]) => boite(cle, donnee(valeur))),
    ...Object.entries(elements.libres).map(([cle, valeur]) =>
      boite(
        "----",
        boite("mean", new Uint8Array(4), utf8.encode(ESPACE_MP4)),
        boite("name", new Uint8Array(4), utf8.encode(cle)),
        donnee(valeur),
      ),
    ),
  ]
}

/** Une boîte `data` de texte UTF-8 (type 1, langue 0). */
function donnee(texte: string): Uint8Array {
  return boite("data", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]), utf8.encode(texte))
}

const CONTENEURS = new Set(["trak", "mdia", "minf", "stbl", "edts"])

/** Ajoute `decalage` aux positions `stco` / `co64` situées après l'ancienne `moov`. */
function deplacerPositions(moov: Uint8Array, seuil: number, decalage: number): void {
  if (decalage === 0) return
  const vue = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  const parcourir = (debut: number, fin: number) => {
    for (const e of enfants(moov, debut, fin)) {
      if (CONTENEURS.has(e.type)) {
        parcourir(e.charge, e.fin)
      } else if (e.type === "stco") {
        const n = vue.getUint32(e.charge + 4)
        for (let i = 0; i < n; i++) {
          const p = e.charge + 8 + i * 4
          const v = vue.getUint32(p)
          if (v < seuil) continue
          if (v + decalage > 0xffffffff) throw new Mp4NonPrisEnCharge("Position hors de stco")
          vue.setUint32(p, v + decalage)
        }
      } else if (e.type === "co64") {
        const n = vue.getUint32(e.charge + 4)
        for (let i = 0; i < n; i++) {
          const p = e.charge + 8 + i * 8
          const v = vue.getBigUint64(p)
          if (v >= BigInt(seuil)) vue.setBigUint64(p, v + BigInt(decalage))
        }
      }
    }
  }
  parcourir(entete(moov, 0).charge, moov.length)
}

async function boitesDuHaut(fichier: Blob): Promise<Boite[]> {
  const longueur = fichier.size
  const boites: Boite[] = []
  let pos = 0
  while (pos < longueur) {
    if (longueur - pos < 8) throw new Mp4NonPrisEnCharge("En-tête tronqué")
    const h = new Uint8Array(await fichier.slice(pos, pos + 16).arrayBuffer())
    const vue = new DataView(h.buffer)
    let taille = vue.getUint32(0)
    const type = deLatin1(h.subarray(4, 8))
    let tete = 8
    if (taille === 1) {
      if (h.length < 16) throw new Mp4NonPrisEnCharge("Taille tronquée")
      taille = Number(vue.getBigUint64(8))
      tete = 16
    } else if (taille === 0) {
      taille = longueur - pos
    }
    if (taille < tete || pos + taille > longueur) throw new Mp4NonPrisEnCharge(`Boîte ${type} mal formée`)
    boites.push({ type, debut: pos, charge: pos + tete, fin: pos + taille })
    pos += taille
  }
  if (boites.length === 0 || !estTypeDeBoite(new Uint8Array(latin1(boites[0].type)), 0)) {
    throw new Mp4NonPrisEnCharge("Pas un fichier MP4")
  }
  return boites
}

function entete(d: Uint8Array, debut: number): Boite {
  if (debut + 8 > d.length) throw new Mp4NonPrisEnCharge("En-tête tronqué")
  const vue = new DataView(d.buffer, d.byteOffset, d.byteLength)
  let taille = vue.getUint32(debut)
  const type = deLatin1(d.subarray(debut + 4, debut + 8))
  let tete = 8
  if (taille === 1) {
    if (debut + 16 > d.length) throw new Mp4NonPrisEnCharge("Taille tronquée")
    taille = Number(vue.getBigUint64(debut + 8))
    tete = 16
  } else if (taille === 0) {
    taille = d.length - debut
  }
  if (taille < tete || debut + taille > d.length) throw new Mp4NonPrisEnCharge(`Boîte ${type} mal formée`)
  return { type, debut, charge: debut + tete, fin: debut + taille }
}

function enfants(d: Uint8Array, debut: number, fin: number): Boite[] {
  const r: Boite[] = []
  let pos = debut
  while (pos + 8 <= fin) {
    const b = entete(d, pos)
    if (b.fin > fin) throw new Mp4NonPrisEnCharge(`Boîte ${b.type} déborde`)
    r.push(b)
    pos = b.fin
  }
  return r
}

/** Quatre octets imprimables (ou ©) : un type de boîte plausible. */
function estTypeDeBoite(d: Uint8Array, debut: number): boolean {
  if (debut + 4 > d.length) return false
  for (let i = debut; i < debut + 4; i++) {
    const c = d[i]
    if (c !== 0xa9 && (c < 0x20 || c > 0x7e)) return false
  }
  return true
}

function boite(type: string, ...charges: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const taille = 8 + charges.reduce((n, c) => n + c.length, 0)
  const o = new Uint8Array(taille)
  new DataView(o.buffer).setUint32(0, taille)
  o.set(latin1(type), 4)
  let p = 8
  for (const c of charges) {
    o.set(c, p)
    p += c.length
  }
  return o
}
