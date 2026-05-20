import { loadSessionUser, normalizePhoneNumber, type SessionUser } from "../data/session-user"
import { clearSessionToken, saveSessionToken } from "../data/session-auth"
import {
  findPrototypeAccount,
  findPrototypeAccountByEmail,
  loginPrototypeAccount,
  migrateLegacyPrototypeAccounts,
  registerPrototypeAccount,
  restorePrototypeSession,
} from "../data/prototype-auth"
import { ApiError, apiRequest } from "../lib/api-client"

export interface LoginPayload {
  phone: string
  password: string
}

export interface RegistrationDraft {
  name: string
  phone: string
  email: string
  password: string
}

export interface RegistrationOtpResponse {
  delivery: "debug" | "email"
  debugOtp?: string
}

interface AuthSession {
  user: SessionUser
  token?: string
}

type AuthUserPayload = Partial<SessionUser> & {
  avatarUrl?: string | null
}

interface AuthUserResponse {
  user?: AuthUserPayload
  name?: string
  phone?: string
  email?: string
  statusMsg?: string
  avatar?: string | null
  avatarUrl?: string | null
  token?: string
  accessToken?: string
  refreshToken?: string
}

function shouldUsePrototypeFallback(error: unknown) {
  return error instanceof ApiError && [0, 404, 405, 501].includes(error.status)
}

function toSessionUser(user: AuthUserPayload | undefined, fallback: SessionUser): SessionUser {
  return {
    name: user?.name?.trim() || fallback.name,
    phone: user?.phone ? normalizePhoneNumber(user.phone) : fallback.phone,
    email: user?.email ?? fallback.email ?? "",
    statusMsg: user?.statusMsg ?? fallback.statusMsg ?? "Disponible",
    avatar: user?.avatar ?? user?.avatarUrl ?? fallback.avatar ?? null,
  }
}

function buildPrototypeUser(phone: string) {
  const normalizedPhone = normalizePhoneNumber(phone)
  const existing = loadSessionUser()

  return {
    name: existing?.name ?? "Utilisateur Alanya",
    phone: normalizedPhone,
    email: existing?.email ?? "",
    statusMsg: existing?.statusMsg ?? "Disponible",
    avatar: existing?.avatar ?? null,
  } satisfies SessionUser
}

export async function loginWithPassword(payload: LoginPayload) {
  const fallbackUser = buildPrototypeUser(payload.phone)

  try {
    const response = await apiRequest<AuthUserResponse>("/api/auth/login", {
      method: "POST",
      body: {
        identifier: normalizePhoneNumber(payload.phone),
        password: payload.password,
      },
    })

    return {
      user: toSessionUser(response.user ?? response, fallbackUser),
      token: response.token ?? response.accessToken,
    } satisfies AuthSession
  } catch (error) {
    if (!shouldUsePrototypeFallback(error)) throw error
    return {
      user: await loginPrototypeAccount(fallbackUser.phone, payload.password),
    } satisfies AuthSession
  }
}

export async function restoreAuthenticatedUser() {
  const existing = loadSessionUser()
  if (!existing) return null

  try {
    const response = await apiRequest<AuthUserResponse>("/api/users/me")
    return toSessionUser(response.user ?? response, existing)
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      return null
    }

    if (!shouldUsePrototypeFallback(error)) {
      return existing
    }

    void migrateLegacyPrototypeAccounts()
    return restorePrototypeSession(existing.phone)
  }
}

export async function requestRegistrationOtp(draft: RegistrationDraft) {
  const normalizedPhone = normalizePhoneNumber(draft.phone)
  const normalizedEmail = draft.email.trim().toLowerCase()

  try {
    const response = await apiRequest<RegistrationOtpResponse & { debugOtp?: string }>(
      "/api/auth/register-otp",
      {
        method: "POST",
        body: {
          ...draft,
          phone: normalizedPhone,
          email: normalizedEmail,
        },
      }
    )

    return {
      delivery: response.delivery ?? "debug",
      debugOtp: response.debugOtp,
    }
  } catch (error) {
    if (!shouldUsePrototypeFallback(error)) throw error

    if (!normalizedEmail) {
      throw new Error("Une adresse email est requise pour creer un compte.")
    }

    if (findPrototypeAccount(normalizedPhone)) {
      throw new Error("Ce numero de telephone est deja lie a un compte. Connectez-vous a la place.")
    }

    if (findPrototypeAccountByEmail(normalizedEmail)) {
      throw new Error("Cette adresse email est deja liee a un compte. Connectez-vous a la place.")
    }

    return {
      delivery: "debug" as const,
      debugOtp: String(Math.floor(100000 + Math.random() * 900000)),
    }
  }
}

export async function completeRegistration(draft: RegistrationDraft, otp: string) {
  const fallbackUser: SessionUser = {
    name: draft.name.trim(),
    phone: normalizePhoneNumber(draft.phone),
    email: draft.email.trim().toLowerCase(),
    statusMsg: "Disponible",
    avatar: null,
  }

  try {
    const response = await apiRequest<AuthUserResponse>("/api/auth/register", {
      method: "POST",
      body: {
        ...draft,
        phone: fallbackUser.phone,
        email: fallbackUser.email,
      },
    })

    return {
      user: toSessionUser(response.user ?? response, fallbackUser),
      token: response.token ?? response.accessToken,
    } satisfies AuthSession
  } catch (error) {
    if (!shouldUsePrototypeFallback(error)) throw error
    void otp
    return {
      user: await registerPrototypeAccount(fallbackUser, draft.password),
    } satisfies AuthSession
  }
}

export async function logoutCurrentSession() {
  try {
    await apiRequest<void>("/api/auth/logout", { method: "POST" })
  } catch (error) {
    if (!shouldUsePrototypeFallback(error)) throw error
  } finally {
    clearSessionToken()
  }
}

export async function logoutAllSessions() {
  try {
    await apiRequest<void>("/api/auth/logout-all", { method: "POST" })
  } catch (error) {
    if (!shouldUsePrototypeFallback(error)) throw error
  } finally {
    clearSessionToken()
  }
}

export async function deleteCurrentAccount() {
  try {
    await apiRequest<void>("/api/users/me", { method: "DELETE" })
  } catch (error) {
    if (!shouldUsePrototypeFallback(error)) throw error
  } finally {
    clearSessionToken()
  }
}

export function storeAuthenticatedSession(session: AuthSession) {
  if (session.token) {
    saveSessionToken(session.token)
  } else {
    clearSessionToken()
  }

  return session.user
}
