import { loadSessionUser, toInitials } from "../data/session-user"
import { type ConversationMock } from "../mocks/chat-data"
import { apiRequest } from "../lib/api-client"
import { fetchContacts } from "./contacts-service"
import { fetchChatConversations } from "./chats-service"
import { fetchCallsHistory, type CallRecord } from "./calls-service"

export interface DashboardCall {
  id: string
  contactId: string
  name: string
  initials: string
  type: "audio" | "video"
  direction: "in" | "out" | "missed"
  duration: string
  time: string
}

export interface DashboardContact {
  id: string
  name: string
  initials: string
  status: string
  online: boolean
}

export interface DashboardUser {
  name: string
  initials: string
  email: string
  statusMsg: string
  memberSince: string
}

export interface DashboardData {
  currentUser: DashboardUser
  recentChats: ConversationMock[]
  recentCalls: DashboardCall[]
  contacts: DashboardContact[]
}

/** GET /api/me — reponse a plat du backend Next.js. */
interface UserMeResponse {
  id?: string
  email?: string
  publicNumber?: string
  pseudo?: string | null
  avatarUrl?: string | null
  statusMsg?: string | null
}

/* ---------- Mapping helpers ---------- */

function formatMemberSince(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
}

function formatCallTime(ts: Date): string {
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - ts.getTime()) / 86400000)
  const hhmm = ts.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  if (diffDays === 0) return hhmm
  if (diffDays === 1) return `Hier ${hhmm}`
  if (diffDays < 7) return `${ts.toLocaleDateString("fr-FR", { weekday: "short" })} ${hhmm}`
  return ts.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
}

function formatCallDuration(raw?: string): string {
  if (!raw) return "-"
  // raw = "MM:SS"
  const [m, s] = raw.split(":").map((n) => parseInt(n, 10))
  if (isNaN(m)) return "-"
  if (m === 0) return `${s ?? 0} sec`
  return `${m} min`
}

function toDashboardCall(c: CallRecord): DashboardCall {
  return {
    id: c.id,
    contactId: c.contactId,
    name: c.contactName,
    initials: c.contactInitials,
    type: c.type,
    direction: c.direction,
    duration: formatCallDuration(c.duration),
    time: formatCallTime(c.ts),
  }
}

/* ---------- Main loader ---------- */

/**
 * Charge en parallele les 4 sources backend (users/me, contacts, chats, calls)
 * et assemble les donnees du dashboard.
 */
export async function fetchDashboardData(): Promise<DashboardData> {
  const [meResult, contactsList, chatsList, callsList] = await Promise.all([
    apiRequest<UserMeResponse>("/api/me").catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[dashboard] /api/me a echoue", err)
      return null
    }),
    fetchContacts(),
    fetchChatConversations(),
    fetchCallsHistory(),
  ])

  const sessionUser = loadSessionUser()
  const name = meResult?.pseudo?.trim() || sessionUser?.name || "Utilisateur"
  const email = meResult?.email ?? sessionUser?.email ?? ""
  const statusMsg = meResult?.statusMsg ?? sessionUser?.statusMsg ?? "Disponible"
  const memberSince = formatMemberSince(undefined)

  const currentUser: DashboardUser = {
    name,
    initials: toInitials(name),
    email,
    statusMsg,
    memberSince,
  }

  const contacts: DashboardContact[] = contactsList.slice(0, 4).map((c) => ({
    id: c.id,
    name: c.name,
    initials: c.initials,
    status: c.online ? "En ligne" : "Disponible",
    online: c.online,
  }))

  return {
    currentUser,
    recentChats: chatsList.slice(0, 5),
    recentCalls: callsList.slice(0, 4).map(toDashboardCall),
    contacts,
  }
}
