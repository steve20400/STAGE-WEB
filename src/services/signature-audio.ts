import { ecrireMetadonneesMp4 } from "./mp4-metadonnees"

/**
 * L'EMPREINTE D'UN FICHIER AUDIO (25/10/2026, demande du patron) — jumeau de
 * `alanya/lib/core/audio_metadonnees.dart`.
 *
 * Un audio envoyé comme document sensible ne reçoit, à sa sortie, QUE le champ
 * « Empreinte numerique » dans ses métadonnées : rien d'audible, rien d'autre.
 * Le format est reconnu à ses OCTETS :
 *
 * - MP3 : une trame ID3v2 `TXXX` (description « Empreinte numerique ») ;
 * - WAV : un bloc `LIST`/`INFO`, commentaire `ICMT` ;
 * - M4A / MP4 audio : un élément libre `----` (`mp4-metadonnees.ts`).
 *
 * Les autres (OGG, Opus, WebM, FLAC…) sortent tels quels — le serveur note
 * quand même le geste et son empreinte.
 */
const CLE = "Empreinte numerique"
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 0xff)

export type FormatAudio = "mp3" | "mp4" | "wav"

export function formatAudio(o: Uint8Array): FormatAudio | null {
  const texte = (a: number, b: number) => String.fromCharCode(...o.subarray(a, b))
  if (o.length >= 12 && texte(0, 4) === "RIFF" && texte(8, 12) === "WAVE") return "wav"
  if (o.length >= 12 && texte(4, 8) === "ftyp") return "mp4"
  if (o.length >= 3 && texte(0, 3) === "ID3") return "mp3"
  if (o.length >= 2 && o[0] === 0xff && (o[1] & 0xe0) === 0xe0) return "mp3"
  return null
}

const lireSyncsafe = (o: Uint8Array, i: number) =>
  ((o[i] & 0x7f) << 21) | ((o[i + 1] & 0x7f) << 14) | ((o[i + 2] & 0x7f) << 7) | (o[i + 3] & 0x7f)
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]
const bigEndian = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

function trameEmpreinte(code: string, version: number): number[] {
  const contenu = [0x00, ...ascii(CLE), 0x00, ...ascii(code)]
  return [...ascii("TXXX"), ...(version === 4 ? syncsafe(contenu.length) : bigEndian(contenu.length)), 0, 0, ...contenu]
}

/** Le MP3 avec l'empreinte : dans l'étiquette ID3v2 existante (v2.3/v2.4 simple), ou une neuve en tête. */
export function avecEmpreinteMp3(o: Uint8Array, code: string): Uint8Array<ArrayBuffer> {
  if (o.length >= 10 && o[0] === 0x49 && o[1] === 0x44 && o[2] === 0x33) {
    const version = o[3]
    if ((version !== 3 && version !== 4) || o[5] !== 0) throw new Error("Étiquette ID3 non prise en charge")
    const fin = 10 + lireSyncsafe(o, 6)
    if (fin > o.length) throw new Error("Étiquette ID3 tronquée")
    let i = 10
    while (i + 10 <= fin && o[i] !== 0) {
      const t = version === 4 ? lireSyncsafe(o, i + 4) : ((o[i + 4] << 24) | (o[i + 5] << 16) | (o[i + 6] << 8) | o[i + 7]) >>> 0
      if (t <= 0 || i + 10 + t > fin) break
      i += 10 + t
    }
    const trames = [...o.subarray(10, i), ...trameEmpreinte(code, version)]
    const sortie = new Uint8Array(10 + trames.length + (o.length - fin))
    sortie.set([...ascii("ID3"), version, 0, 0, ...syncsafe(trames.length)], 0)
    sortie.set(trames, 10)
    sortie.set(o.subarray(fin), 10 + trames.length)
    return sortie
  }
  const trame = trameEmpreinte(code, 3)
  const sortie = new Uint8Array(10 + trame.length + o.length)
  sortie.set([...ascii("ID3"), 3, 0, 0, ...syncsafe(trame.length)], 0)
  sortie.set(trame, 10)
  sortie.set(o, 10 + trame.length)
  return sortie
}

/** Le WAV avec l'empreinte : un bloc `LIST`/`INFO` en fin de fichier, taille RIFF à jour. */
export function avecEmpreinteWav(o: Uint8Array, code: string): Uint8Array<ArrayBuffer> {
  const texte = [...ascii(`${CLE}=${code}`), 0]
  if (texte.length % 2) texte.push(0)
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
  const icmt = [...ascii("ICMT"), ...le32(texte.length), ...texte]
  const liste = [...ascii("LIST"), ...le32(4 + icmt.length), ...ascii("INFO"), ...icmt]
  const bourrage = o.length % 2
  const sortie = new Uint8Array(o.length + bourrage + liste.length)
  sortie.set(o, 0)
  sortie.set(liste, o.length + bourrage)
  new DataView(sortie.buffer).setUint32(4, sortie.length - 8, true)
  return sortie
}

/** La copie audio avec l'empreinte seule, ou `null` si le format n'est pas pris en charge. */
export async function signerAudio(source: Blob, code: string): Promise<Blob | null> {
  const debut = new Uint8Array(await source.slice(0, 16).arrayBuffer())
  switch (formatAudio(debut)) {
    case "mp4":
      return ecrireMetadonneesMp4(source, { standard: {}, libres: { [CLE]: code } })
    case "mp3":
      return new Blob([avecEmpreinteMp3(new Uint8Array(await source.arrayBuffer()), code)], { type: source.type })
    case "wav":
      return new Blob([avecEmpreinteWav(new Uint8Array(await source.arrayBuffer()), code)], { type: source.type })
    default:
      return null
  }
}
