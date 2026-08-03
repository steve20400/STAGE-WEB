import { apiRequest } from "../lib/api-client"

export interface Meeting {
  id: number
  idMeeting?: number
  objet: string
  type_media: number
  duree: number
  start_time?: string
  room?: string
  isEnd?: number
  connecte?: number
  startTime?: string
  organizerPseudo?: string
  organizerId?: string
  participants?: Array<{
    userId: string
    displayName: string
    connecte?: number
    start_time?: string
    duree?: number
  }>
}

export interface CreateMeetingRequest {
  objet: string
  type_media: number
  duree?: number
  participantNumbers?: string[]
  start_time?: string
  room?: string
}

export async function fetchMeetings(): Promise<Meeting[]> {
  const res = await apiRequest<{ meetings?: Meeting[] }>("/api/meetings")
  return (res.meetings || []) as Meeting[]
}

export async function fetchMeeting(id: number): Promise<Meeting> {
  const res = await apiRequest<Meeting>(`/api/meetings/${id}`)
  return res
}

export async function createMeeting(data: CreateMeetingRequest): Promise<{ id: number; idMeeting?: number }> {
  const body: Record<string, unknown> = {
    objet: data.objet,
    type_media: data.type_media,
    duree: data.duree ?? 3600,
  }
  if (data.participantNumbers?.length) {
    body.participantNumbers = data.participantNumbers
  }
  if (data.start_time) body.start_time = data.start_time
  if (data.room) body.room = data.room

  const res = await apiRequest<{ idMeeting?: number; id?: number }>("/api/meetings", {
    method: "POST",
    body,
  })
  const id = (res.idMeeting ?? res.id) as number
  if (!id) throw new Error("Backend did not return meeting ID")
  return { id, idMeeting: res.idMeeting }
}

export async function joinMeeting(id: number): Promise<void> {
  await apiRequest(`/api/meetings/${id}/join`, { method: "POST", body: {} })
}

export async function leaveMeeting(id: number): Promise<void> {
  await apiRequest(`/api/meetings/${id}/leave`, { method: "POST", body: {} })
}

export async function declineMeeting(id: number): Promise<void> {
  await apiRequest(`/api/meetings/${id}/decline`, { method: "POST", body: {} })
}

export async function endMeeting(id: number): Promise<void> {
  await apiRequest(`/api/meetings/${id}/end`, { method: "POST", body: {} })
}

export async function deleteMeeting(id: number): Promise<void> {
  await apiRequest(`/api/meetings/${id}/delete`, { method: "DELETE" })
}
