import { apiRequest } from "../lib/api-client"

/**
 * Journal des connexions du compte.
 *
 * A distinguer de appareils-service.ts : celui-ci decrit l'ETAT courant (quels
 * appareils ont acces), celui-la les EVENEMENTS (quand et depuis ou on s'est
 * connecte). Un appareil retire du registre garde ses connexions au journal.
 */

/** Valeur du referentiel quand l'information manque. */
const INDEFINI = "INDEFINI"

export interface LoginAccess {
  idLogin: number
  device: string
  ipAdress: string
  osSystem: string
  dateLogin: string
}

interface ListResponse {
  acces: LoginAccess[]
}

/** GET /api/user-access — l'historique du compte connecte, du plus recent au plus ancien. */
export async function fetchLoginHistory(limit = 30): Promise<LoginAccess[]> {
  const response = await apiRequest<ListResponse>(`/api/user-access?limit=${limit}`)
  return response.acces ?? []
}

/** Vrai si la valeur est exploitable — « INDEFINI » n'a rien a faire a l'ecran. */
export function estRenseigne(valeur: string | null | undefined): boolean {
  return Boolean(valeur) && valeur !== INDEFINI && valeur !== "unknown"
}

/** « Aujourd'hui a 14:32 », « Hier a 09:05 », puis la date complete. */
export function quand(iso: string): string {
  const d = new Date(iso)
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  const jour = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const now = new Date()
  const ceJour = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const ecart = Math.round((ceJour.getTime() - jour.getTime()) / 86400000)

  if (ecart === 0) return `Aujourd'hui a ${heure}`
  if (ecart === 1) return `Hier a ${heure}`
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })} a ${heure}`
}
