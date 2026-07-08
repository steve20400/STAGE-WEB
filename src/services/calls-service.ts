import { apiRequest } from "../lib/api-client"
import { createPrivateChat } from "./chats-service"

export type CallDirection = "in" | "out" | "missed"
export type CallType = "audio" | "video"
export type CallStatus = "ended" | "declined" | "no_answer"

export interface CallRecord {
  id: string
  /** Numero Alanya du correspondant (ou id de conversation pour un groupe). */
  contactId: string
  contactName: string
  contactInitials: string
  contactColor: keyof typeof CALL_COLORS
  direction: CallDirection
  type: CallType
  status: CallStatus
  duration?: string
  ts: Date
  isGroup?: boolean
}

export const CALL_COLORS = {
  amber: { bg: "#C8895E22", fg: "#C8895E" },
  blue: { bg: "#53bde522", fg: "#53bde5" },
  violet: { bg: "#a78bfa22", fg: "#a78bfa" },
  teal: { bg: "#34d39922", fg: "#34d399" },
  rose: { bg: "#fb718522", fg: "#fb7185" },
}

const COLOR_WHEEL: (keyof typeof CALL_COLORS)[] = ["amber", "blue", "violet", "teal", "rose"]

function pickColor(id: string): keyof typeof CALL_COLORS {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return COLOR_WHEEL[sum % COLOR_WHEEL.length]
}

/** Appel tel que renvoye par GET /api/calls sur le backend Next.js. */
interface BackendCall {
  id: string
  convId: string | null
  type: string // AUDIO | VIDEO
  status: string // RINGING | ONGOING | ENDED | MISSED | REJECTED
  isOutgoing: boolean
  isGroup: boolean
  peerName: string
  peerNumber: string | null
  participantCount: number
  startedAt: string
  answeredAt: string | null
  endedAt: string | null
  durationSec: number | null
}

interface ListCallsResponse {
  calls: BackendCall[]
}

function toInitials(name: string) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
  return initials || "??"
}

function mapStatus(status: string): CallStatus {
  if (status === "REJECTED") return "declined"
  if (status === "MISSED" || status === "RINGING") return "no_answer"
  return "ended"
}

function mapDirection(c: BackendCall): CallDirection {
  if (c.isOutgoing) return "out"
  if (c.status === "MISSED" || c.status === "REJECTED") return "missed"
  return "in"
}

function formatDuration(seconds: number | null): string | undefined {
  if (!seconds || seconds <= 0) return undefined
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function toCallRecord(c: BackendCall): CallRecord {
  const contactId = c.peerNumber ?? c.convId ?? c.id
  return {
    id: c.id,
    contactId,
    contactName: c.peerName,
    contactInitials: toInitials(c.peerName),
    contactColor: pickColor(contactId),
    direction: mapDirection(c),
    type: c.type === "VIDEO" ? "video" : "audio",
    status: mapStatus(c.status),
    duration: formatDuration(c.durationSec),
    ts: new Date(c.startedAt),
    isGroup: Boolean(c.isGroup),
  }
}

/** GET /api/calls — historique d'appels de l'utilisateur. */
export async function fetchCallsHistory(): Promise<CallRecord[]> {
  try {
    const response = await apiRequest<ListCallsResponse>("/api/calls")
    return (response.calls ?? []).map(toCallRecord)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[calls] fetch a echoue", error)
    return []
  }
}

/* ----------------- Endpoints WebRTC ----------------- */

export interface StartedCall {
  id: string
  convId: string
  type: string
  status: string
  isGroup: boolean
  groupName: string | null
  memberCount: number
  callerName: string
  callees: Array<{ userId: string; pseudo: string | null; publicNumber: string }>
}

/** POST /api/calls — cree l'appel (statut RINGING) dans une conversation existante. */
export async function startCallRest(convId: string, type: CallType): Promise<StartedCall> {
  return apiRequest<StartedCall>("/api/calls", {
    method: "POST",
    body: { convId, type: type === "video" ? "VIDEO" : "AUDIO" },
  })
}

/** Demarre un appel direct vers un numero Alanya (cree/retrouve la conversation d'abord). */
export async function startCallToNumber(
  publicNumber: string,
  type: CallType
): Promise<StartedCall> {
  const conversation = await createPrivateChat(publicNumber)
  return startCallRest(conversation.id, type)
}

export interface AcceptCallResult {
  id: string
  isGroup: boolean
  groupName: string | null
  activeParticipants: Array<{ userId: string; displayName: string }>
}

/** POST /api/calls/:id/accept — accepte / rejoint l'appel. */
export async function acceptCallRest(callId: string): Promise<AcceptCallResult> {
  return apiRequest<AcceptCallResult>(`/api/calls/${callId}/accept`, { method: "POST" })
}

/** POST /api/calls/:id/reject — refuse (direct) ou decline (groupe). */
export async function rejectCallRest(callId: string): Promise<void> {
  await apiRequest<void>(`/api/calls/${callId}/reject`, { method: "POST" })
}

/** POST /api/calls/:id/end — termine l'appel pour tout le monde. */
export async function endCallRest(callId: string): Promise<void> {
  await apiRequest<void>(`/api/calls/${callId}/end`, { method: "POST" })
}

/** POST /api/calls/:id/leave — quitte un appel de groupe sans le terminer. */
export async function leaveCallRest(callId: string): Promise<void> {
  await apiRequest<void>(`/api/calls/${callId}/leave`, { method: "POST" })
}

/**
 * Ids des appels encore actifs cote serveur (RINGING/ONGOING) ou l'on figure.
 * Sert a nettoyer les appels fantomes laisses par un onglet ferme/recharge
 * (le backend n'a pas de timeout : sans nettoyage, il repond 409 BUSY a vie).
 */
export async function listActiveCallIds(): Promise<string[]> {
  const response = await apiRequest<ListCallsResponse>("/api/calls")
  return (response.calls ?? [])
    .filter((c) => c.status === "RINGING" || c.status === "ONGOING")
    .map((c) => c.id)
}

export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
]

/**
 * Serveur TURN par defaut du projet (fourni par l'encadrant), accessible sur
 * open.alanya.cloud en TLS sur le port 443 (seul point d'acces ouvert). C'est
 * ce relais qui fait passer l'audio/video quand les deux participants sont
 * derriere des NAT stricts (4G, box) : sans lui, l'appel "decroche" mais aucun
 * flux ne circule. Utilise par defaut, sans configuration.
 */
const DEFAULT_TURN_SERVERS: RTCIceServer[] = [
  {
    urls: [
      // Le relais fonctionne sur le port 3478 (UDP le plus rapide, TCP en repli).
      "turn:open.alanya.cloud:3478",
      "turn:open.alanya.cloud:3478?transport=tcp",
      // 443/TLS ajoute pour traverser les pare-feux stricts si l'encadrant
      // l'active (aujourd'hui il ne delivre pas de relais, donc simplement ignore).
      "turns:open.alanya.cloud:443?transport=tcp",
    ],
    username: "alanya",
    credential: "alanya2026",
  },
]

/**
 * Relais TURN configure cote front (VITE_TURN_*). Permet de surcharger le
 * serveur par defaut (autre fournisseur, tests). Si aucune variable n'est
 * definie, on retombe sur DEFAULT_TURN_SERVERS (open.alanya.cloud).
 */
function configuredTurnServers(): RTCIceServer[] {
  const urls = String(import.meta.env.VITE_TURN_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
  if (urls.length === 0) return DEFAULT_TURN_SERVERS
  return [
    {
      urls,
      username: import.meta.env.VITE_TURN_USERNAME ?? undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL ?? undefined,
    },
  ]
}

/** Un relais TURN est-il disponible ? (toujours vrai : serveur par defaut du projet). */
export function isTurnConfigured(): boolean {
  return configuredTurnServers().length > 0
}

function hasTurnServer(servers: RTCIceServer[]): boolean {
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
    return urls.some((url) => typeof url === "string" && url.startsWith("turn"))
  })
}

/** GET /api/calls/ice — serveurs STUN/TURN du backend, completes par un TURN public si absent. */
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  let servers: RTCIceServer[]
  try {
    const response = await apiRequest<{ iceServers: RTCIceServer[] }>("/api/calls/ice")
    servers = response.iceServers?.length ? response.iceServers : [...FALLBACK_ICE_SERVERS]
  } catch {
    servers = [...FALLBACK_ICE_SERVERS]
  }

  // Le backend sans identifiants Metered ne renvoie que du STUN : on complete
  // avec le TURN du projet (open.alanya.cloud par defaut, surchargeable via
  // VITE_TURN_*).
  if (!hasTurnServer(servers)) {
    servers = [...servers, ...configuredTurnServers()]
  }

  return servers
}
