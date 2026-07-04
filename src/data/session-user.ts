export interface SessionUser {
  /** UUID backend — sert a distinguer "moi" dans les messages/evenements WS. */
  id?: string
  name: string
  /** Numero Alanya a 6 chiffres (publicNumber cote backend). */
  phone: string
  email?: string
  statusMsg?: string
  avatar?: string | null
}

const STORAGE_KEY = "alanya-session-user-v2"
const LEGACY_STORAGE_KEYS = ["alanya-session-user-v1"]
const MIGRATION_KEY = "alanya-auth-storage-migrated-v2"

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
