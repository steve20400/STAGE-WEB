import { apiRequest } from "../lib/api-client"

/**
 * Lecture de la file d'attente cote agent (demande user 15/08/2026) :
 * /api/queue/live et /api/queue/history, tous deux reserves aux comptes
 * agents/centre par le serveur (403 sinon — voir centresDeLAgent cote back).
 */

export interface QueueLiveEntry {
  idFile: number
  centerAlanyaID: string
  idCustomer: string
  customerName: string | null
  customerAvatarUrl: string | null
  rang: number
  priorite: number
  createdAt: string
  idService: number | null
  serviceName: string | null
}

export interface QueueHistoryEntry {
  idHist: string
  idCompany: number
  companyName: string | null
  centerId: string
  serviceId: number | null
  serviceName: string | null
  agentId: string | null
  agentName: string | null
  customerId: string
  customerName: string | null
  customerAvatarUrl: string | null
  /** RECONTACTER : rappelé par un agent après son abandon, et il a décroché. */
  statut: "MIS_EN_RELATION" | "ABANDON" | "TIMEOUT" | "REJETE" | "RECONTACTER"
  joinedAt: string
  leftAt: string | null
  attenteDureeSec: number | null
  appelDureeSec: number | null
}

/**
 * L'appelant est-il agent d'au moins un centre ? Sert UNIQUEMENT à décider
 * si le menu "Clients abandonnés" doit être montré (demande user
 * 15/08/2026 : un non-agent ne doit rien voir). La protection réelle reste
 * sur `fetchAbandonedClients` (403).
 */
export async function isAgent(): Promise<boolean> {
  try {
    const data = await apiRequest<{ isAgent: boolean }>("/api/queue/agent-status")
    return data.isAgent ?? false
  } catch {
    // Un menu qui disparaît sur une erreur reseau vaut mieux qu'un menu
    // casse — l'agent le retrouvera au prochain chargement.
    return false
  }
}

export async function fetchLiveQueue(centerAlanyaID?: string): Promise<QueueLiveEntry[]> {
  const qs = centerAlanyaID ? `?centerAlanyaID=${encodeURIComponent(centerAlanyaID)}` : ""
  const data = await apiRequest<{ live: QueueLiveEntry[] }>(`/api/queue/live${qs}`)
  return data.live ?? []
}

/**
 * `excludeServed=1` : ne garde que ce qui n'a PAS abouti a un agent —
 * ABANDON/TIMEOUT/REJETE. C'est la vue "a rappeler".
 */
export async function fetchAbandonedClients(
  centerAlanyaID?: string
): Promise<QueueHistoryEntry[]> {
  const params = new URLSearchParams({ excludeServed: "1", limit: "100" })
  if (centerAlanyaID) params.set("centerAlanyaID", centerAlanyaID)
  const data = await apiRequest<{ history: QueueHistoryEntry[] }>(
    `/api/queue/history?${params.toString()}`
  )
  return data.history ?? []
}
