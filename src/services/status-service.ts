import { apiRequest } from "../lib/api-client"
import { uploadMedia } from "./media-service"

/** Statut ephemere (24 h) tel que renvoye par GET /api/statuses. */
export interface StatusItem {
  id: string
  type: "TEXT" | "IMAGE" | "VIDEO"
  text: string | null
  /** URL relative backend (/api/media/{id}) pour IMAGE/VIDEO. */
  mediaUrl: string | null
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

/** Upload du media puis POST /api/statuses (IMAGE ou VIDEO). */
export async function postMediaStatus(file: File): Promise<void> {
  const isVideo = file.type.startsWith("video/")
  const media = await uploadMedia(file, file.name)
  await apiRequest("/api/statuses", {
    method: "POST",
    body: { type: isVideo ? "VIDEO" : "IMAGE", mediaId: media.id },
  })
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
