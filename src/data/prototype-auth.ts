import { normalizePhoneNumber, type SessionUser } from "./session-user"
import { langueInitiale, traduire, type Cle } from "../i18n"

/** Traduction hors composant : la langue est relue a chaque message. */
const tr = (cle: Cle) => traduire(langueInitiale(), cle)

interface PrototypeAuthAccount extends SessionUser {
  passwordHash: string
  password?: never
}

interface LegacyPrototypeAuthAccount extends SessionUser {
  password?: string
  passwordHash?: string
}

type StoredPrototypeAuthAccount = PrototypeAuthAccount | LegacyPrototypeAuthAccount

const STORAGE_KEY = "alanya-prototype-auth-v1"
const NEXT_STORAGE_KEY = "alanya-prototype-auth-v2"
const MIGRATION_KEY = "alanya-prototype-auth-migrated-v2"

function hasStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

async function hashPassword(password: string) {
  const cryptoApi = globalThis.crypto?.subtle

  if (!cryptoApi) {
    throw new Error(tr("auth_hash_unavailable"))
  }

  const buffer = await cryptoApi.digest("SHA-256", new TextEncoder().encode(password))
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, "0")).join("")
}

function hasLegacyPassword(
  account: StoredPrototypeAuthAccount
): account is LegacyPrototypeAuthAccount & { password: string } {
  return typeof account.password === "string" && account.password.length > 0
}

function hasPasswordHash(account: StoredPrototypeAuthAccount): account is PrototypeAuthAccount {
  return typeof account.passwordHash === "string" && account.passwordHash.length > 0
}

function runStorageMigration() {
  if (!hasStorage()) return
  if (window.localStorage.getItem(MIGRATION_KEY)) return

  window.localStorage.removeItem(STORAGE_KEY)
  window.localStorage.setItem(MIGRATION_KEY, "true")
}

function loadAccounts() {
  if (!hasStorage()) return [] as StoredPrototypeAuthAccount[]
  runStorageMigration()

  try {
    const raw = window.localStorage.getItem(NEXT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredPrototypeAuthAccount[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAccounts(accounts: StoredPrototypeAuthAccount[]) {
  if (!hasStorage()) return
  runStorageMigration()
  window.localStorage.setItem(NEXT_STORAGE_KEY, JSON.stringify(accounts))
}

async function toHashedAccount(account: StoredPrototypeAuthAccount): Promise<PrototypeAuthAccount> {
  if (hasPasswordHash(account)) {
    return account
  }

  const passwordHash = await hashPassword(account.password ?? "")
  const { password: _password, ...rest } = account

  return {
    ...rest,
    passwordHash,
  } satisfies PrototypeAuthAccount
}

function sanitizeSessionUser(account: StoredPrototypeAuthAccount): SessionUser {
  return {
    name: account.name,
    phone: account.phone,
    email: normalizeEmail(account.email ?? ""),
    statusMsg: account.statusMsg ?? "Disponible",
    avatar: account.avatar ?? null,
  }
}

export function restorePrototypeSession(phone: string) {
  const account = findPrototypeAccount(phone)
  return account ? sanitizeSessionUser(account) : null
}

export function findPrototypeAccount(phone: string) {
  const normalizedPhone = normalizePhoneNumber(phone)
  return loadAccounts().find((account) => account.phone === normalizedPhone) ?? null
}

export function findPrototypeAccountByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email)
  return (
    loadAccounts().find((account) => normalizeEmail(account.email ?? "") === normalizedEmail) ??
    null
  )
}

export async function migrateLegacyPrototypeAccounts() {
  const accounts = loadAccounts()

  if (!accounts.some(hasLegacyPassword)) {
    return
  }

  saveAccounts(await Promise.all(accounts.map(toHashedAccount)))
}

export async function registerPrototypeAccount(user: SessionUser, password: string) {
  const normalizedPhone = normalizePhoneNumber(user.phone)
  const normalizedEmail = normalizeEmail(user.email ?? "")

  if (!normalizedEmail) {
    throw new Error(tr("auth_email_required_signup"))
  }

  const phoneOwner = findPrototypeAccount(normalizedPhone)
  if (phoneOwner) {
    throw new Error(tr("auth_phone_taken_local"))
  }

  const emailOwner = findPrototypeAccountByEmail(normalizedEmail)
  if (emailOwner) {
    throw new Error(tr("auth_email_taken_local"))
  }

  const accounts = loadAccounts()
  const passwordHash = await hashPassword(password)

  const nextAccount: PrototypeAuthAccount = {
    name: user.name.trim(),
    phone: normalizedPhone,
    email: normalizedEmail,
    statusMsg: user.statusMsg ?? "Disponible",
    avatar: user.avatar ?? null,
    passwordHash,
  }

  saveAccounts([...(await Promise.all(accounts.map(toHashedAccount))), nextAccount])

  return sanitizeSessionUser(nextAccount)
}

export async function loginPrototypeAccount(phone: string, password: string) {
  const normalizedPhone = normalizePhoneNumber(phone)
  const accounts = loadAccounts()
  const accountIndex = accounts.findIndex((account) => account.phone === normalizedPhone)

  if (accountIndex === -1) {
    throw new Error(tr("auth_no_account_for_number"))
  }

  const account = accounts[accountIndex]
  const passwordHash = await hashPassword(password)
  const matchesPassword = hasPasswordHash(account)
    ? account.passwordHash === passwordHash
    : account.password === password

  if (!matchesPassword) {
    throw new Error(tr("auth_wrong_password"))
  }

  if (!hasPasswordHash(account) && hasLegacyPassword(account)) {
    const migratedAccount = await toHashedAccount(account)
    const nextAccounts = [...accounts]
    nextAccounts[accountIndex] = migratedAccount
    saveAccounts(await Promise.all(nextAccounts.map(toHashedAccount)))
    return sanitizeSessionUser(migratedAccount)
  }

  return sanitizeSessionUser(account)
}

export function updatePrototypeAccountProfile(user: SessionUser) {
  const normalizedPhone = normalizePhoneNumber(user.phone)
  const normalizedEmail = normalizeEmail(user.email ?? "")
  const accounts = loadAccounts()
  const index = accounts.findIndex((account) => account.phone === normalizedPhone)

  if (index === -1) return

  const emailOwner = accounts.find(
    (account, currentIndex) =>
      currentIndex !== index && normalizeEmail(account.email ?? "") === normalizedEmail
  )

  if (emailOwner) {
    throw new Error(tr("auth_email_taken_other"))
  }

  accounts[index] = {
    ...accounts[index],
    name: user.name.trim(),
    email: normalizedEmail,
    statusMsg: user.statusMsg ?? "Disponible",
    avatar: user.avatar ?? null,
  }

  saveAccounts(accounts)
}

export function deletePrototypeAccount(phone: string) {
  const normalizedPhone = normalizePhoneNumber(phone)
  const accounts = loadAccounts().filter((account) => account.phone !== normalizedPhone)
  saveAccounts(accounts)
}
