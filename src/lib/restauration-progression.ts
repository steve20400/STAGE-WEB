/**
 * LA BARRE DE LA PAGE DE RESTAURATION : une seule barre pour quatre étapes.
 *
 * 🔴 JUMEAU DE `alanya/lib/features/auth/restauration_progression.dart`.
 * Module PUR, sans import : éprouvé par `scripts/restauration-progression.mjs`.
 */

export type EtapeRestauration = "ouverture" | "telechargement" | "dechiffrement" | "rangement"

/** Où en est la restauration. `total` absent : on ne sait pas encore combien. */
export interface ProgressionRestauration {
  etape: EtapeRestauration
  fait: number
  total?: number
}

export type SuiviRestauration = (p: ProgressionRestauration) => void

/** La part de la barre que prend chaque étape. Le déchiffrement et le rangement durent. */
const PARTS: Record<EtapeRestauration, [number, number]> = {
  ouverture: [0, 0.1],
  telechargement: [0.1, 0.35],
  dechiffrement: [0.35, 0.7],
  rangement: [0.7, 1],
}

/**
 * Où en est la barre, de 0 à 1 — ou `null` pour une barre ANIMÉE.
 *
 * ⚠️ `null` quand on ne peut pas le dire : l'ouverture (Argon2id) ne donne aucun
 * signe d'avancement, et un serveur ancien ne dit pas combien de blocs il a.
 * Une barre qui avancerait sans savoir mentirait.
 */
export function fractionGlobale(p: ProgressionRestauration): number | null {
  const [debut, fin] = PARTS[p.etape]
  if (p.etape === "ouverture" || p.total === undefined) return null
  if (p.total <= 0) return fin
  const dedans = Math.min(1, Math.max(0, p.fait / p.total))
  return debut + (fin - debut) * dedans
}

export function libelleEtape(e: EtapeRestauration): string {
  switch (e) {
    case "ouverture":
      return "Ouverture de votre sauvegarde…"
    case "telechargement":
      return "Téléchargement de l’archive…"
    case "dechiffrement":
      return "Déchiffrement des messages…"
    case "rangement":
      return "Enregistrement dans ce navigateur…"
  }
}

/** Le compteur sous la barre : « 1 250 / 2 100 blocs », ou rien. */
export function compteur(p: ProgressionRestauration): string | null {
  if (p.etape === "ouverture" || p.total === undefined) return null
  const unite = p.etape === "rangement" ? "messages" : "blocs"
  return `${milliers(p.fait)} / ${milliers(p.total)} ${unite}`
}

function milliers(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
}
