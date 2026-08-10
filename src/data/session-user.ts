export interface SessionUser {
  /** UUID backend — sert a distinguer "moi" dans les messages/evenements WS. */
  id?: string
  name: string
  /** Numero Alanya, publicNumber cote backend. */
  phone: string
  email?: string
  statusMsg?: string
  avatar?: string | null
}

const STORAGE_KEY = "alanya-session-user-v2"
const LEGACY_STORAGE_KEYS = ["alanya-session-user-v1"]
const MIGRATION_KEY = "alanya-auth-storage-migrated-v2"

/**
 * UUID de l'utilisateur connecte — source fiable pour distinguer "moi"
 * dans les messages et les evenements WebSocket.
 * Priorite au user en session ; sinon on decode le JWT d'acces (champ sub),
 * qui contient toujours l'id meme si la session locale est incomplete.
 */
export function getMyUserId(): string | null {
  const sessionId = loadSessionUser()?.id
  if (sessionId) return sessionId

  if (!hasStorage()) return null
  const token = window.localStorage.getItem("alanya-session-token-v2")
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null
  } catch {
    return null
  }
}

function hasStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function runStorageMigration() {
  if (!hasStorage()) return
  if (window.localStorage.getItem(MIGRATION_KEY)) return

  for (const key of LEGACY_STORAGE_KEYS) {
    window.localStorage.removeItem(key)
  }

  window.localStorage.setItem(MIGRATION_KEY, "true")
}

export function normalizePhoneNumber(phone: string) {
  return phone.replace(/\s+/g, "").replace(/[()-]/g, "")
}

export function toInitials(name: string) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
  return initials || "UA"
}

export function loadSessionUser(): SessionUser | null {
  if (!hasStorage()) return null
  runStorageMigration()

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionUser
    if (!parsed?.name || !parsed?.phone) return null
    return parsed
  } catch {
    return null
  }
}

export function saveSessionUser(user: SessionUser) {
  if (!hasStorage()) return
  runStorageMigration()
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
}

export function clearSessionUser() {
  if (!hasStorage()) return
  runStorageMigration()
  window.localStorage.removeItem(STORAGE_KEY)
}
