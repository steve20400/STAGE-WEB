import { apiRequest } from "../lib/api-client"
import { uploadMedia } from "./media-service"

/** Statut ephemere (24 h) tel que renvoye par GET /api/statuses. */
export interface StatusItem {
  id: string
  type: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO"
  text: string | null
  /** URL relative backend (/api/media/{id}) pour IMAGE/VIDEO/AUDIO. */
  mediaUrl: string | null
  /** Duree d'un statut audio ou video (01/11/2026). Absente sur un ancien serveur. */
  mediaDurationMs?: number | null
  /** L'ai-je aime ? (01/11/2026) */
  likedByMe?: boolean
  /** Nombre de « J'aime » — envoye a l'auteur seul. */
  likesCount?: number
  bgColor: string | null
  createdAt: string
  expiresAt: string
  viewed: boolean
  viewsCount: number
}

export interface StatusGroup {
  userId: string
  pseudo: string | null
  avatarUrl: string | null
  publicNumber: string
  hasUnviewed: boolean
  statuses: StatusItem[]
}

export interface StatusFeed {
  me: StatusGroup | null
  others: StatusGroup[]
}

/** GET /api/statuses — mes statuts + ceux de mes contacts (non expires). */
export async function fetchStatusFeed(): Promise<StatusFeed> {
  return apiRequest<StatusFeed>("/api/statuses")
}

/** POST /api/statuses — statut texte sur fond colore. */
export async function postTextStatus(text: string, bgColor: string): Promise<void> {
  await apiRequest("/api/statuses", {
    method: "POST",
    body: { type: "TEXT", text, bgColor },
  })
}

/** Le type de statut d'un fichier, d'apres son MIME. */
export function typeStatutDe(mime: string): "IMAGE" | "VIDEO" | "AUDIO" {
  if (mime.startsWith("video/")) return "VIDEO"
  if (mime.startsWith("audio/")) return "AUDIO"
  return "IMAGE"
}

/**
 * Upload du media puis POST /api/statuses (IMAGE, VIDEO ou AUDIO).
 *
 * [dureeMs] : la visionneuse d'un audio ou d'une video s'y cale (01/11/2026).
 */
export async function postMediaStatus(file: File, dureeMs?: number): Promise<void> {
  const type = typeStatutDe(file.type)
  const media = await uploadMedia(file, file.name, dureeMs)
  await apiRequest("/api/statuses", {
    method: "POST",
    body: {
      type,
      mediaId: media.id,
      ...(type !== "IMAGE" && dureeMs && dureeMs > 0 ? { mediaDurationMs: Math.round(dureeMs) } : {}),
    },
  })
}

/**
 * « J'AIME » SUR UN STATUT (01/11/2026, repris d'Alanya). Rend le nombre de
 * « J'aime » du statut. Pas sur son propre statut : le serveur le refuse.
 */
export async function aimerStatut(statusId: string, aime: boolean): Promise<number> {
  const r = await apiRequest<{ liked: boolean; likesCount: number }>(
    `/api/statuses/${statusId}/like`,
    { method: aime ? "POST" : "DELETE" },
  )
  return r?.likesCount ?? 0
}

/** Une personne qui a vu mon statut (01/11/2026). */
export interface VueStatut {
  userId: string
  name: string
  avatarUrl: string | null
  viewedAt: string
  liked: boolean
  likedAt: string | null
}

/** GET /api/statuses/:id/views — qui a vu MON statut, et qui l'a aime. */
export async function fetchStatusViews(statusId: string): Promise<VueStatut[]> {
  const r = await apiRequest<{ views: VueStatut[] }>(`/api/statuses/${statusId}/views`)
  return r?.views ?? []
}

/** POST /api/statuses/:id/view — marque un statut comme vu. */
export async function viewStatus(statusId: string): Promise<void> {
  try {
    await apiRequest(`/api/statuses/${statusId}/view`, { method: "POST" })
  } catch {
    // non critique
  }
}

/** DELETE /api/statuses/:id — supprime un de ses propres statuts. */
export async function deleteStatus(statusId: string): Promise<void> {
  await apiRequest(`/api/statuses/${statusId}`, { method: "DELETE" })
}
