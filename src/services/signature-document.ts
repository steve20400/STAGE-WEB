import { formatAlanyaNumber } from "../lib/alanya-number"
import type { ProtectionPdf } from "./e2ee-media"
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

/**
 * L'Alanya ID tel que l'écrit le filigrane : « AW 67 64 15 99 ». Par
 * `formatAlanyaNumber`, comme partout ailleurs (27/10/2026, user) : le
 * découpage écrit ici à la main (« 6764 1599 ») ne ressemblait à aucun
 * Alanya ID affiché dans l'application.
 */
export function alanyaIdAw(s: SignatureSortie): string {
  return `AW ${formatAlanyaNumber(s.alanyaId)}`
}

/**
 * PHOTOS ET VIDÉOS : UN CHAMP PAR BORD (25/10/2026, recommandation retenue
 * par le patron) — haut, bas, gauche, droite, séparés par « \n » :
 * l'application et l'Alanya ID, la date, l'appareil, l'empreinte. Écrits en
 * blanc cerné de noir, 16 px au moins (`peindreBords`). Jumeau du mobile.
 */
export function bordsVisuels(s: SignatureSortie): string {
  return [`${APPLICATION} · ${alanyaIdAw(s)}`, dateLisible(s.quand), s.appareil, codeLisible(s.code)].join("\n")
}

/**
 * PDF : l'EMPREINTE NUMÉRIQUE à la place de l'Alanya ID (25/10/2026, demande
 * du patron). L'Alanya ID reste dans les métadonnées.
 */
export function texteBordsPdf(s: SignatureSortie): string {
  return [APPLICATION, codeLisible(s.code), s.appareil, dateLisible(s.quand)].join(" · ")
}

/** La chaîne complète (commentaire d'une vidéo, ancien filigrane). */
export function texteBords(s: SignatureSortie): string {
  return [APPLICATION, `Alanya ${s.alanyaId}`, s.appareil, dateLisible(s.quand), codeLisible(s.code)].join(" · ")
}

/**
 * Les noms des champs de métadonnées, courts et lisibles (24/10/2026, demande
 * du user). Les mêmes que `CleMeta` du mobile.
 */
export const CLE = {
  application: "Application",
  alanyaId: "Alanya ID",
  appareil: "Appareil",
  dateCreation: "Date Creation",
  /** Le code de trace, noté aussi par le serveur avec le geste. */
  empreinte: "Empreinte numerique",
  geste: "Geste",
  expediteur: "Expediteur",
  document: "Document",
} as const

/** Les métadonnées : Info d'un PDF, EXIF ou iTXt d'une image, éléments libres d'une vidéo. */
export function metadonnees(s: SignatureSortie): Record<string, string> {
  return {
    [CLE.application]: APPLICATION,
    [CLE.alanyaId]: s.alanyaId,
    [CLE.appareil]: s.appareil,
    [CLE.dateCreation]: dateIso(s.quand),
    [CLE.empreinte]: s.code,
    [CLE.geste]: s.geste,
    ...(s.expediteurId ? { [CLE.expediteur]: s.expediteurId } : {}),
    ...(s.mediaId ? { [CLE.document]: s.mediaId } : {}),
  }
}

/**
 * 🐛 LES MÉTADONNÉES D'UNE VIDÉO SEMBLAIENT INCOMPLÈTES (user, 25/10/2026) :
 * les huit champs n'étaient que dans des éléments libres (`----`), que
 * l'Explorateur de Windows n'affiche pas. Ils vont aussi, en toutes lettres,
 * dans le COMMENTAIRE (`©cmt`) — comme le commentaire EXIF d'une image — ;
 * titre, description et copyright suivent. Jumeau du mobile.
 */
export function elementsMp4(s: SignatureSortie): ElementsMp4 {
  const meta = metadonnees(s)
  return {
    standard: {
      "©nam": texteBords(s),
      desc: texteBords(s),
      "©too": APPLICATION,
      "©ART": `Alanya ${s.alanyaId}`,
      "©cmt": Object.entries(meta)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      "©day": dateIso(s.quand),
      cprt: APPLICATION,
    },
    libres: meta,
  }
}

export type NatureSignature = "pdf" | "image" | "video" | "audio" | "aucune"

const IMAGES_SIGNABLES = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "bmp"])
const AUDIOS = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "amr", "3ga", "weba"])

export function natureSignature(mime: string, nom: string): NatureSignature {
  const m = mime.toLowerCase()
  const ext = nom.includes(".") ? nom.slice(nom.lastIndexOf(".") + 1).toLowerCase() : ""
  if (m === "application/pdf" || ext === "pdf") return "pdf"
  // Un GIF animé perdrait son animation, un SVG n'est pas une image en points.
  if (IMAGES_SIGNABLES.has(ext) || (m.startsWith("image/") && m !== "image/gif" && !m.includes("svg"))) return "image"
  // L'audio AVANT la vidéo : un M4A est un MP4, il ne doit pas être réencodé.
  if (m.startsWith("audio/") || AUDIOS.has(ext)) return "audio"
  if (mp4PrisEnCharge(m, nom) || m.startsWith("video/") || VIDEOS_AUTRES.has(ext)) return "video"
  return "aucune"
}

/** Les conteneurs vidéo que `mediabunny` lit, en plus de MP4 / MOV / 3GP. */
const VIDEOS_AUTRES = new Set(["webm", "mkv"])

export interface CopieSignee {
  /** La copie, sous le nom à donner (une image non PNG devient un JPEG). */
  fichier: File
  /** Faux : format non pris en charge, ou échec — la copie sort telle quelle. */
  signee: boolean
}

/**
 * Signe une copie de `source` (le clair déchiffré). Ne lève jamais : un échec
 * rend la copie telle quelle, avec `signee: false`.
 *
 * `onProgression` (0 à 1) : l'avancement d'une vidéo, seule à prendre du
 * temps — elle est réencodée image par image.
 */
export async function signerCopie(
  source: Blob,
  nom: string,
  mime: string,
  s: SignatureSortie,
  onProgression?: (fraction: number) => void,
  /** Un PDF protégé par l'expéditeur (26/10/2026). Un échec LÈVE : rien ne sort sans elle. */
  protection?: ProtectionPdf,
): Promise<CopieSignee> {
  if (protection && natureSignature(mime, nom) === "pdf") {
    const { signerPdf } = await import("./signature-pdf")
    const octets = await signerPdf(
      await source.arrayBuffer(),
      texteBordsPdf(s),
      metadonnees(s),
      protection,
      codeLisible(s.code),
    )
    return { fichier: new File([octets as Uint8Array<ArrayBuffer>], nom, { type: "application/pdf" }), signee: true }
  }
  try {
    switch (natureSignature(mime, nom)) {
      case "pdf": {
        const { signerPdf } = await import("./signature-pdf")
        const octets = await signerPdf(await source.arrayBuffer(), texteBordsPdf(s), metadonnees(s))
        // pdf-lib rend un Uint8Array sur un ArrayBuffer ordinaire.
        return { fichier: new File([octets as Uint8Array<ArrayBuffer>], nom, { type: "application/pdf" }), signee: true }
      }
      case "image": {
        const { signerImage } = await import("./signature-image")
        const r = await signerImage(source, mime, bordsVisuels(s), metadonnees(s))
        const base = nom.includes(".") ? nom.slice(0, nom.lastIndexOf(".")) : nom
        const ext = nom.includes(".") ? nom.slice(nom.lastIndexOf(".") + 1).toLowerCase() : ""
        const garde = ext === r.extension || (r.extension === "jpg" && ext === "jpeg")
        return { fichier: new File([r.blob], garde ? nom : `${base}.${r.extension}`, { type: r.mime }), signee: true }
      }
      case "video": {
        /*
         * 🔴 D'ABORD LA SIGNATURE INCRUSTÉE AUX QUATRE BORDS (24/10/2026) : elle
         * survit à WhatsApp, qui réencode la vidéo et efface les métadonnées.
         * La vidéo est réencodée ici ; un MP4 reçoit en plus les huit champs.
         */
        const { signerVideoIncrustee } = await import("./signature-video")
        const v = await signerVideoIncrustee(source, bordsVisuels(s), metadonnees(s), onProgression)
        if (v) {
          const blob = v.extension === "mp4" ? await ecrireMetadonneesMp4(v.blob, elementsMp4(s)) : v.blob
          const base = nom.includes(".") ? nom.slice(0, nom.lastIndexOf(".")) : nom
          return { fichier: new File([blob], `${base}.${v.extension}`, { type: v.mime }), signee: true }
        }
        // Repli : le navigateur ne sait pas réencoder. Un MP4 / MOV / 3GP garde
        // au moins ses métadonnées ; un autre conteneur sort tel quel.
        if (!mp4PrisEnCharge(mime, nom)) break
        const blob = await ecrireMetadonneesMp4(source, elementsMp4(s))
        return { fichier: new File([blob], nom, { type: mime }), signee: true }
      }
      case "audio": {
        // L'empreinte SEULE (25/10/2026, demande du patron).
        const { signerAudio } = await import("./signature-audio")
        const blob = await signerAudio(source, s.code)
        if (!blob) break
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
