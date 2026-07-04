const STORAGE_KEY = "alanya-session-token-v2"
const REFRESH_STORAGE_KEY = "alanya-session-refresh-v1"
const LEGACY_STORAGE_KEYS = ["alanya-session-token-v1"]
const MIGRATION_KEY = "alanya-session-token-migrated-v2"

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

export function loadSessionToken() {
  if (!hasStorage()) return null
  runStorageMigration()
  return window.localStorage.getItem(STORAGE_KEY)
}

export function saveSessionToken(token: string) {
  if (!hasStorage()) return
  runStorageMigration()
  window.localStorage.setItem(STORAGE_KEY, token)
}

export function loadRefreshToken() {
  if (!hasStorage()) return null
  return window.localStorage.getItem(REFRESH_STORAGE_KEY)
}

export function saveRefreshToken(token: string) {
  if (!hasStorage()) return
  window.localStorage.setItem(REFRESH_STORAGE_KEY, token)
}

export function clearSessionToken() {
  if (!hasStorage()) return
  runStorageMigration()
  window.localStorage.removeItem(STORAGE_KEY)
  window.localStorage.removeItem(REFRESH_STORAGE_KEY)
}
