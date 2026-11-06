/**
 * LA QUALITE VIDEO D'UN APPEL (procedure du patron, 01/11/2026, tableau revu
 * le 06/11/2026 avec la Full HD) — jumeau de `qualite_video.dart` sur le mobile.
 *
 * On ne pilote plus la qualite pendant l'appel : WebRTC gere seul les
 * variations du reseau. Nous fixons seulement une capture maximale, sa cadence
 * et le debit maximal de l'encodeur qui va avec. Le choix est propre a CE
 * navigateur.
 *
 *   Full HD   1920×1080   30 images/s   5 Mbit/s
 *   Haute     1280×720    30 images/s   2,5 Mbit/s
 *   Standard   854×480    30 images/s   1,2 Mbit/s
 *   Basse      640×360    20 images/s   0,6 Mbit/s
 */
export type QualiteVideo = "fullhd" | "haute" | "standard" | "basse"

export interface Preset {
  largeur: number
  hauteur: number
  /** Images par seconde, au plus. */
  cadence: number
  /** En bits par seconde. */
  debitMax: number
  cleLibelle:
    | "video_quality_full_hd"
    | "video_quality_high"
    | "video_quality_standard"
    | "video_quality_low"
  /** « 720p — 2,5 Mbit/s » */
  detail: string
}

export const QUALITES: Record<QualiteVideo, Preset> = {
  fullhd: {
    largeur: 1920,
    hauteur: 1080,
    cadence: 30,
    debitMax: 5_000_000,
    cleLibelle: "video_quality_full_hd",
    detail: "1080p — 5 Mbit/s",
  },
  haute: {
    largeur: 1280,
    hauteur: 720,
    cadence: 30,
    debitMax: 2_500_000,
    cleLibelle: "video_quality_high",
    detail: "720p — 2,5 Mbit/s",
  },
  standard: {
    largeur: 854,
    hauteur: 480,
    cadence: 30,
    debitMax: 1_200_000,
    cleLibelle: "video_quality_standard",
    detail: "480p — 1,2 Mbit/s",
  },
  basse: {
    largeur: 640,
    hauteur: 360,
    cadence: 20,
    debitMax: 600_000,
    cleLibelle: "video_quality_low",
    detail: "360p — 0,6 Mbit/s",
  },
}

export const ORDRE_QUALITES: QualiteVideo[] = ["fullhd", "haute", "standard", "basse"]

const CLE = "alanya.appel.video.qualite"

export function qualiteChoisie(): QualiteVideo {
  try {
    const v = localStorage.getItem(CLE)
    if (v && (ORDRE_QUALITES as string[]).includes(v)) return v as QualiteVideo
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
 * y envoie sa video a chacun des autres, et la Full HD a quatre demanderait
 * 3 × 5 Mbit/s a l'envoi.
 */
export function qualitePourAppel(groupe: boolean): Preset {
  const p = QUALITES[qualiteChoisie()]
  return groupe && p.hauteur > QUALITES.standard.hauteur ? QUALITES.standard : p
}
