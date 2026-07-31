import { publicAsset } from "../lib/asset-url"

/**
 * Les trois moments sonores de l'application, nommes par le sens de l'evenement
 * et non par le fichier — c'est le renommage qui avait deja evite de reinverser
 * les sonneries d'appel.
 */
export type RingtoneEvent = "incoming" | "outgoing" | "message"

export interface Ringtone {
  /** Nom du fichier dans public/sounds/. */
  file: string
  /** Libelle affiche a l'utilisateur. */
  label: string
  /** Precision affichee sous le libelle. */
  note?: string
}

/**
 * Catalogue des sons disponibles. Les trois premiers sont ceux du mobile, repris
 * a l'octet pres depuis `assets/sounds/` de l'application Flutter : meme
 * empreinte, donc meme son sur les deux plateformes.
 */
export const RINGTONES: Ringtone[] = [
  { file: "incoming_ring.mp3", label: "Sonnerie Alanya", note: "celle de l'application mobile" },
  { file: "outgoing_ring.mp3", label: "Tonalite Alanya", note: "celle de l'application mobile" },
  { file: "notification.mp3", label: "Notification Alanya", note: "celle de l'application mobile" },
  { file: "ringtone.mp3", label: "Sonnerie classique" },
  { file: "message.mp3", label: "Bip message" },
]

/**
 * Choix par defaut, aligne sur le mobile : `ringtone_service.dart` associe
 * `incoming_ring.mp3` a l'appel entrant, `outgoing_ring.mp3` a l'appel sortant
 * et `notification.mp3` a l'arrivee d'un message.
 */
export const RINGTONE_DEFAULTS: Record<RingtoneEvent, string> = {
  incoming: "incoming_ring.mp3",
  outgoing: "outgoing_ring.mp3",
  message: "notification.mp3",
}

export const RINGTONE_LABELS: Record<RingtoneEvent, string> = {
  incoming: "Appel entrant",
  outgoing: "Appel sortant",
  message: "Nouveau message",
}

/**
 * Le choix est une preference d'appareil, pas une donnee de compte : il survit a
 * la deconnexion, comme le theme ou le volume.
 */
const STORAGE_KEYS: Record<RingtoneEvent, string> = {
  incoming: "alanya-ringtone-incoming",
  outgoing: "alanya-ringtone-outgoing",
  message: "alanya-ringtone-message",
}

function isKnownFile(file: string | null): file is string {
  return Boolean(file) && RINGTONES.some((ringtone) => ringtone.file === file)
}

/** Fichier choisi pour cet evenement, ou celui du mobile a defaut. */
export function ringtoneFile(event: RingtoneEvent): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS[event])
    // Un fichier retire du catalogue ne doit pas rendre l'application muette.
    if (isKnownFile(stored)) return stored
  } catch {
    // stockage indisponible : on retombe sur le defaut
  }
  return RINGTONE_DEFAULTS[event]
}

export function setRingtone(event: RingtoneEvent, file: string) {
  if (!isKnownFile(file)) return
  try {
    localStorage.setItem(STORAGE_KEYS[event], file)
  } catch {
    // stockage indisponible : le choix ne survivra pas a la session
  }
}

/** URL jouable du son choisi, prefixee par le chemin de base du deploiement. */
export function ringtoneUrl(event: RingtoneEvent): string {
  return publicAsset(`sounds/${ringtoneFile(event)}`)
}

let previewAudio: HTMLAudioElement | null = null

/**
 * Ecoute d'un son depuis les reglages. Un seul extrait a la fois, et borne a
 * quelques secondes : les sonneries d'appel durent une trentaine de secondes,
 * les laisser aller au bout serait penible.
 */
export function previewRingtone(file: string, seconds = 4) {
  stopRingtonePreview()
  const audio = new Audio(publicAsset(`sounds/${file}`))
  previewAudio = audio
  window.setTimeout(() => {
    if (previewAudio === audio) stopRingtonePreview()
  }, seconds * 1000)
  return audio.play()
}

export function stopRingtonePreview() {
  if (!previewAudio) return
  previewAudio.pause()
  previewAudio.currentTime = 0
  previewAudio = null
}
