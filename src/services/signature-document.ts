import { formatAlanyaNumber } from "../lib/alanya-number"
import { ecrireMetadonneesMp4, mp4PrisEnCharge, type ElementsMp4 } from "./mp4-metadonnees"

/**
 * LA SIGNATURE D'UNE COPIE QUI SORT (22/10/2026) — pendant web de
 * `lib/core/signature_document.dart`.
 *
 * Demande du user : un document sensible se télécharge et se partage
 * librement, mais la copie qui sort porte de quoi remonter à qui l'a fait
 * sortir :
 *   - aux QUATRE BORDS (PDF, images) : {@link texteBords} ;
 *   - dans les MÉTADONNÉES (PDF, images, vidéos) : application, Alanya ID,
 *     appareil, date, geste, expéditeur et CODE DE TRACE.
 *
 * Le code est tiré ici et envoyé au serveur avec le geste : un fichier
 * retrouvé ailleurs renvoie, par son code, à la ligne `document_consultation`
 * de qui l'a fait sortir.
 *
 * Le texte des bords n'a AUCUN MOT d'une langue (noms, chiffres, code) : il
 * reste lisible dans un PDF quelle que soit la langue de l'interface. Il est
 * identique à celui du mobile.
 */

export type GesteSortie = "TELECHARGEMENT" | "PARTAGE" | "TRANSFERT"

export const APPLICATION = "Alanya Work"

export interface SignatureSortie {
  geste: GesteSortie
  /** Alanya ID formaté (« 67 64 15 99 »). */
  alanyaId: string
  /** Navigateur et système (« Chrome · Windows »). */
  appareil: string
  quand: Date
  /** 32 caractères hexadécimaux minuscules. */
  code: string
  expediteurId?: string
  mediaId?: string
}

/** 128 bits tirés par le générateur sûr du navigateur. */
export function nouveauCode(): string {
  const o = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(o, (x) => x.toString(16).padStart(2, "0")).join("")
}

export function nouvelleSignature(o: {
  geste: GesteSortie
  alanyaId: string
  expediteurId?: string
  mediaId?: string
}): SignatureSortie {
  return {
    geste: o.geste,
    alanyaId: formatAlanyaNumber(o.alanyaId),
    appareil: appareilNavigateur(),
    quand: new Date(),
    code: nouveauCode(),
    expediteurId: o.expediteurId ? formatAlanyaNumber(o.expediteurId) : undefined,
    mediaId: o.mediaId,
  }
}

/** Le navigateur et le système, faute de marque et de modèle d'appareil. */
export function appareilNavigateur(): string {
  const ua = navigator.userAgent
  const navigateur = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Navigateur"
  const systeme = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : ""
  return systeme ? `${navigateur} · ${systeme}` : navigateur
}

const deux = (n: number) => String(n).padStart(2, "0")

/** « 3F9A 0C1E 5B7D … » : le code tel qu'on le recopie depuis une photo. */
export function codeLisible(code: string): string {
  return (code.toUpperCase().match(/.{1,4}/g) ?? []).join(" ")
}

export function dateLisible(d: Date): string {
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} ${deux(d.getHours())}:${deux(d.getMinutes())}`
}

/** ISO 8601 avec le décalage horaire local. */
export function dateIso(d: Date): string {
  const decalage = -d.getTimezoneOffset()
  const signe = decalage < 0 ? "-" : "+"
  const a = Math.abs(decalage)
  return (
    `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}T` +
    `${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}` +
    `${signe}${deux(Math.floor(a / 60))}:${deux(a % 60)}`
  )
}

/** Le texte écrit aux quatre bords. */
export function texteBords(s: SignatureSortie): string {
  return [APPLICATION, `Alanya ${s.alanyaId}`, s.appareil, dateLisible(s.quand), codeLisible(s.code)].join(" · ")
}

/** Les métadonnées, sous les mêmes clés que le mobile. */
export function metadonnees(s: SignatureSortie): Record<string, string> {
  return {
    AlanyaApplication: APPLICATION,
    AlanyaGeste: s.geste,
    AlanyaID: s.alanyaId,
    AlanyaAppareil: s.appareil,
    AlanyaDate: dateIso(s.quand),
    AlanyaTrace: s.code,
    ...(s.expediteurId ? { AlanyaExpediteur: s.expediteurId } : {}),
    ...(s.mediaId ? { AlanyaDocument: s.mediaId } : {}),
  }
}

export function elementsMp4(s: SignatureSortie): ElementsMp4 {
  return {
    standard: {
      "©too": APPLICATION,
      "©ART": `Alanya ${s.alanyaId}`,
      "©cmt": texteBords(s),
      "©day": dateIso(s.quand),
    },
    libres: {
      application: APPLICATION,
      geste: s.geste,
      alanya_id: s.alanyaId,
      appareil: s.appareil,
      date: dateIso(s.quand),
      trace: s.code,
      ...(s.expediteurId ? { expediteur: s.expediteurId } : {}),
      ...(s.mediaId ? { document: s.mediaId } : {}),
    },
  }
}

export type NatureSignature = "pdf" | "image" | "video" | "aucune"

const IMAGES_SIGNABLES = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "bmp"])

export function natureSignature(mime: string, nom: string): NatureSignature {
  const m = mime.toLowerCase()
  const ext = nom.includes(".") ? nom.slice(nom.lastIndexOf(".") + 1).toLowerCase() : ""
  if (m === "application/pdf" || ext === "pdf") return "pdf"
  // Un GIF animé perdrait son animation, un SVG n'est pas une image en points.
  if (IMAGES_SIGNABLES.has(ext) || (m.startsWith("image/") && m !== "image/gif" && !m.includes("svg"))) return "image"
  if (mp4PrisEnCharge(m, nom)) return "video"
  return "aucune"
}

export interface CopieSignee {
  /** La copie, sous le nom à donner (une image non PNG devient un JPEG). */
  fichier: File
  /** Faux : format non pris en charge, ou échec — la copie sort telle quelle. */
  signee: boolean
}

/**
 * Signe une copie de `source` (le clair déchiffré). Ne lève jamais : un échec
 * rend la copie telle quelle, avec `signee: false`.
 */
export async function signerCopie(source: Blob, nom: string, mime: string, s: SignatureSortie): Promise<CopieSignee> {
  try {
    switch (natureSignature(mime, nom)) {
      case "pdf": {
        const { signerPdf } = await import("./signature-pdf")
        const octets = await signerPdf(await source.arrayBuffer(), texteBords(s), metadonnees(s))
        // pdf-lib rend un Uint8Array sur un ArrayBuffer ordinaire.
        return { fichier: new File([octets as Uint8Array<ArrayBuffer>], nom, { type: "application/pdf" }), signee: true }
      }
      case "image": {
        const { signerImage } = await import("./signature-image")
        const r = await signerImage(source, mime, texteBords(s), metadonnees(s))
        const base = nom.includes(".") ? nom.slice(0, nom.lastIndexOf(".")) : nom
        const ext = nom.includes(".") ? nom.slice(nom.lastIndexOf(".") + 1).toLowerCase() : ""
        const garde = ext === r.extension || (r.extension === "jpg" && ext === "jpeg")
        return { fichier: new File([r.blob], garde ? nom : `${base}.${r.extension}`, { type: r.mime }), signee: true }
      }
      case "video": {
        const blob = await ecrireMetadonneesMp4(source, elementsMp4(s))
        return { fichier: new File([blob], nom, { type: mime }), signee: true }
      }
      case "aucune":
        break
    }
  } catch (e) {
    console.warn("[signature] copie non signée :", nom, e)
  }
  return { fichier: new File([source], nom, { type: mime }), signee: false }
}
