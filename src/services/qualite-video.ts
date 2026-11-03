/**
 * LA QUALITE VIDEO D'UN APPEL (procedure du patron, 01/11/2026) — jumeau de
 * `qualite_video.dart` sur le mobile.
 *
 * On ne pilote plus la qualite pendant l'appel : WebRTC gere seul les
 * variations du reseau. Nous fixons seulement une capture maximale et le debit
 * maximal de l'encodeur qui va avec. Le choix est propre a CE navigateur.
 */
export type QualiteVideo = "haute" | "standard" | "basse"

export interface Preset {
  largeur: number
  hauteur: number
  /** En bits par seconde. */
  debitMax: number
  cleLibelle: "video_quality_high" | "video_quality_standard" | "video_quality_low"
  /** « 720p — 2 Mbit/s » */
  detail: string
}

export const QUALITES: Record<QualiteVideo, Preset> = {
  haute: { largeur: 1280, hauteur: 720, debitMax: 2_000_000, cleLibelle: "video_quality_high", detail: "720p — 2 Mbit/s" },
  standard: { largeur: 640, hauteur: 480, debitMax: 1_000_000, cleLibelle: "video_quality_standard", detail: "480p — 1 Mbit/s" },
  basse: { largeur: 640, hauteur: 360, debitMax: 400_000, cleLibelle: "video_quality_low", detail: "360p — 0,4 Mbit/s" },
}

export const ORDRE_QUALITES: QualiteVideo[] = ["haute", "standard", "basse"]

/** Cadence visee : WebRTC la baisse lui-meme si le reseau ne suit pas. */
export const CADENCE_VISEE = 24

const CLE = "alanya.appel.video.qualite"

export function qualiteChoisie(): QualiteVideo {
  try {
    const v = localStorage.getItem(CLE)
    if (v === "haute" || v === "standard" || v === "basse") return v
  } catch {
    // Stockage indisponible (navigation privee) : la qualite par defaut.
  }
  return "standard"
}

export function choisirQualite(q: QualiteVideo): void {
  try {
    localStorage.setItem(CLE, q)
  } catch {
    // Non retenu : le choix vaudra pour cette page seulement.
  }
}

/**
 * La qualite d'un appel donne. EN GROUPE, PAS AU-DELA DE « STANDARD » : chacun
 * y envoie sa video a chacun des autres, et la haute definition a quatre
 * demanderait 3 × 2 Mbit/s a l'envoi.
 */
export function qualitePourAppel(groupe: boolean): Preset {
  const q = qualiteChoisie()
  return QUALITES[groupe && q === "haute" ? "standard" : q]
}
