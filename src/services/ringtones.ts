import { publicAsset } from "../lib/asset-url"
import { resolveMediaUrl, uploadMedia } from "./media-service"
import { langueInitiale, traduire, type Cle } from "../i18n"

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
  note?: Cle
}

/**
 * Catalogue des sons disponibles. Les trois premiers sont ceux du mobile, repris
 * a l'octet pres depuis `assets/sounds/` de l'application Flutter : meme
 * empreinte, donc meme son sur les deux plateformes.
 */
export const RINGTONES: Ringtone[] = [
  { file: "incoming_ring.mp3", label: "Sonnerie Alanya", note: "ring_note_mobile" },
  { file: "outgoing_ring.mp3", label: "Tonalite Alanya", note: "ring_note_mobile" },
  { file: "notification.mp3", label: "Notification Alanya", note: "ring_note_mobile" },
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

/* Des CLES : ce tableau est construit a l'import, un libelle deja traduit y
   resterait fige dans la langue du chargement. */
export const RINGTONE_LABELS: Record<RingtoneEvent, Cle> = {
  incoming: "ring_incoming_call",
  outgoing: "ring_outgoing_call",
  message: "new_message",
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

/* ----------------- Sonneries importees par l'utilisateur ----------------- */

/**
 * Une sonnerie importee est designee par l'URL relative du media televerse
 * (`/api/media/{id}`), la ou une sonnerie fournie est designee par son nom de
 * fichier. Les deux espaces de noms ne se croisent pas — un nom de fichier ne
 * commence jamais par une barre oblique — ce qui evite un champ « type » a
 * trainer partout.
 *
 * Le fichier vit cote serveur, donc il reste disponible depuis un autre
 * navigateur ; seule la liste de ce qui a ete importe est locale, faute d'un
 * champ de profil pour la porter.
 */
const CUSTOM_STORAGE_KEY = "alanya-ringtones-custom-v1"

/** Taille maximale d'une sonnerie importee. Les sonneries fournies font 15 Ko a 800 Ko. */
export const MAX_CUSTOM_RINGTONE_BYTES = 5 * 1024 * 1024

export interface CustomRingtone {
  /** URL relative du media televerse, qui sert aussi d'identifiant. */
  url: string
  label: string
}

export function customRingtones(): CustomRingtone[] {
  try {
    const brut = localStorage.getItem(CUSTOM_STORAGE_KEY)
    const liste = brut ? (JSON.parse(brut) as CustomRingtone[]) : []
    return Array.isArray(liste) ? liste.filter((entree) => typeof entree?.url === "string") : []
  } catch {
    return []
  }
}

function saveCustomRingtones(liste: CustomRingtone[]) {
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(liste))
  } catch {
    // stockage indisponible : l'import ne survivra pas a la session
  }
}

/** Vrai si l'identifiant designe une sonnerie importee et non un fichier fourni. */
export function isCustomRingtone(id: string): boolean {
  return id.startsWith("/")
}

/**
 * Televerse un fichier audio et l'ajoute au catalogue. L'endpoint est celui des
 * medias de discussion, `POST /api/media`, deja utilise pour les messages vocaux :
 * aucune modification du backend n'est necessaire.
 */
export async function importRingtone(file: File): Promise<CustomRingtone> {
  if (!file.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(file.name)) {
    throw new Error(traduire(langueInitiale(), "ring_not_a_sound"))
  }
  if (file.size > MAX_CUSTOM_RINGTONE_BYTES) {
    throw new Error(
      traduire(langueInitiale(), "v2_ringtone_too_heavy", {
        taille: (file.size / 1024 / 1024).toFixed(1),
        maximum: MAX_CUSTOM_RINGTONE_BYTES / 1024 / 1024,
      })
    )
  }

  const media = await uploadMedia(file, file.name)
  const entree: CustomRingtone = {
    url: media.url,
    // Le nom du fichier sans son extension : c'est ce que l'utilisateur reconnait.
    // Le repli, lui, s'affiche dans la liste des sonneries : il se traduit.
    label:
      file.name.replace(/\.[^.]+$/, "").trim() ||
      traduire(langueInitiale(), "set_ringtone_imported"),
  }
  saveCustomRingtones([...customRingtones().filter((e) => e.url !== entree.url), entree])
  return entree
}

/**
 * Retire une sonnerie importee du catalogue, et rend leur son par defaut aux
 * evenements qui l'utilisaient — sinon ils deviendraient muets.
 */
export function removeCustomRingtone(url: string) {
  saveCustomRingtones(customRingtones().filter((entree) => entree.url !== url))
  for (const event of Object.keys(STORAGE_KEYS) as RingtoneEvent[]) {
    if (ringtoneFile(event) === url) setRingtone(event, RINGTONE_DEFAULTS[event])
  }
}

function isKnownFile(file: string | null): file is string {
  if (!file) return false
  if (isCustomRingtone(file)) return customRingtones().some((entree) => entree.url === file)
  return RINGTONES.some((ringtone) => ringtone.file === file)
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

/**
 * URL jouable d'un son, quelle que soit son origine : un fichier fourni est
 * prefixe par le chemin de base du deploiement, une sonnerie importee passe par
 * le resolveur de medias, qui y ajoute le jeton de session.
 */
export function ringtoneSource(id: string): string {
  return isCustomRingtone(id) ? resolveMediaUrl(id) : publicAsset(`sounds/${id}`)
}

/** URL jouable du son choisi pour cet evenement. */
export function ringtoneUrl(event: RingtoneEvent): string {
  return ringtoneSource(ringtoneFile(event))
}

let previewAudio: HTMLAudioElement | null = null

/**
 * Ecoute d'un son depuis les reglages. Un seul extrait a la fois, et borne a
 * quelques secondes : les sonneries d'appel durent une trentaine de secondes,
 * les laisser aller au bout serait penible.
 */
export function previewRingtone(file: string, seconds = 4) {
  stopRingtonePreview()
  const audio = new Audio(ringtoneSource(file))
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
