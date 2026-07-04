import { loadSessionUser, type SessionUser } from "../data/session-user"
import {
  clearSessionToken,
  loadRefreshToken,
  saveRefreshToken,
  saveSessionToken,
} from "../data/session-auth"
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
  /** Email ou numero Alanya a 6 chiffres. */
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
  refreshToken?: string
}

/** user renvoye par le backend Next.js (login / setup / me). */
interface BackendAuthUser {
  id?: string
  email?: string
  publicNumber?: string
  pseudo?: string | null
  avatarUrl?: string | null
  statusMsg?: string | null
}

interface AuthTokensResponse {
  user?: BackendAuthUser
  accessToken?: string
  refreshToken?: string
}

interface VerifyResponse {
  setupToken?: string
  publicNumber?: string
  needsSetup?: boolean
}

function shouldUsePrototypeFallback(error: unknown) {
  return error instanceof ApiError && [0, 404, 405, 501].includes(error.status)
}

function shouldIgnoreMissingLogout(error: unknown) {
  return error instanceof ApiError && [0, 400, 401, 403, 404, 405, 422, 501].includes(error.status)
}

function toSessionUser(user: BackendAuthUser | undefined, fallback: SessionUser): SessionUser {
  return {
    id: user?.id ?? fallback.id,
    name: user?.pseudo?.trim() || fallback.name,
    phone: user?.publicNumber ?? fallback.phone,
    email: user?.email ?? fallback.email ?? "",
    statusMsg: user?.statusMsg ?? fallback.statusMsg ?? "Disponible",
    avatar: user?.avatarUrl ?? fallback.avatar ?? null,
  }
}

function buildPrototypeUser(identifier: string) {
  const existing = loadSessionUser()

  return {
    name: existing?.name ?? "Utilisateur Alanya",
    phone: identifier.trim(),
    email: existing?.email ?? "",
    statusMsg: existing?.statusMsg ?? "Disponible",
    avatar: existing?.avatar ?? null,
  } satisfies SessionUser
}

/** POST /api/auth/login — identifier = email ou numero Alanya (6 chiffres). */
export async function loginWithPassword(payload: LoginPayload) {
  const identifier = payload.phone.trim()
  const fallbackUser = buildPrototypeUser(identifier)

  try {
    const response = await apiRequest<AuthTokensResponse>("/api/auth/login", {
      method: "POST",
      body: { identifier, password: payload.password },
    })

    return {
      user: toSessionUser(response.user, fallbackUser),
      token: response.accessToken,
      refreshToken: response.refreshToken,
    } satisfies AuthSession
  } catch (error) {
    if (!shouldUsePrototypeFallback(error)) throw error
    return {
      user: await loginPrototypeAccount(fallbackUser.phone, payload.password),
    } satisfies AuthSession
  }
}

/** GET /api/me — restaure la session au chargement de l'app. */
export async function restoreAuthenticatedUser() {
  const existing = loadSessionUser()
  if (!existing) return null

  try {
    const response = await apiRequest<BackendAuthUser>("/api/me")
    return toSessionUser(response, existing)
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

/**
 * POST /api/auth/register — declenche l'envoi du code OTP a l'email.
 * Le code arrive par email (ou dans la console du serveur backend en dev).
 */
export async function requestRegistrationOtp(draft: RegistrationDraft) {
  const normalizedEmail = draft.email.trim().toLowerCase()

  try {
    await apiRequest<{ message?: string; email?: string }>("/api/auth/register", {
      method: "POST",
      body: { email: normalizedEmail },
    })

    return { delivery: "email" as const }
  } catch (error) {
    if (!shouldUsePrototypeFallback(error)) throw error

    if (!normalizedEmail) {
      throw new Error("Une adresse email est requise pour creer un compte.")
    }

    if (draft.phone && findPrototypeAccount(draft.phone)) {
      throw new Error("Ce numero est deja lie a un compte. Connectez-vous a la place.")
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

/**
 * Finalise l'inscription en deux appels :
 * 1. POST /api/auth/verify { email, code }  -> setupToken + numero Alanya
 * 2. POST /api/auth/setup  { pseudo, password } (Bearer setupToken) -> user + tokens
 */
export async function completeRegistration(draft: RegistrationDraft, otp: string) {
  const normalizedEmail = draft.email.trim().toLowerCase()
  const fallbackUser: SessionUser = {
    name: draft.name.trim(),
    phone: draft.phone.trim(),
    email: normalizedEmail,
    statusMsg: "Disponible",
    avatar: null,
  }

  try {
    const verifyResponse = await apiRequest<VerifyResponse>("/api/auth/verify", {
      method: "POST",
      body: { email: normalizedEmail, code: otp },
    })

    if (!verifyResponse.setupToken) {
      throw new Error("Verification impossible : reponse inattendue du serveur.")
    }

    if (verifyResponse.needsSetup === false) {
      throw new Error("Ce compte est deja configure. Connectez-vous a la place.")
    }

    const setupResponse = await apiRequest<AuthTokensResponse>("/api/auth/setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${verifyResponse.setupToken}` },
      body: { pseudo: draft.name.trim(), password: draft.password },
    })

    const withNumber: SessionUser = {
      ...fallbackUser,
      phone: verifyResponse.publicNumber ?? fallbackUser.phone,
    }

    return {
      user: toSessionUser(setupResponse.user, withNumber),
      token: setupResponse.accessToken,
      refreshToken: setupResponse.refreshToken,
    } satisfies AuthSession
  } catch (error) {
    if (!shouldUsePrototypeFallback(error)) throw error
    return {
      user: await registerPrototypeAccount(fallbackUser, draft.password),
    } satisfies AuthSession
  }
}

/** POST /api/auth/logout — revoque le refresh token courant. */
export async function logoutCurrentSession() {
  const refreshToken = loadRefreshToken()
  try {
    if (refreshToken) {
      await apiRequest<void>("/api/auth/logout", {
        method: "POST",
        body: { refreshToken },
      })
    }
  } catch (error) {
    if (!shouldIgnoreMissingLogout(error)) throw error
  } finally {
    clearSessionToken()
  }
}

/** Pas d'endpoint "logout partout" sur ce backend : on revoque la session courante. */
export async function logoutAllSessions() {
  await logoutCurrentSession()
}

/** Pas d'endpoint de suppression de compte sur ce backend : on nettoie localement. */
export async function deleteCurrentAccount() {
  try {
    await apiRequest<void>("/api/me", { method: "DELETE" })
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
  if (session.refreshToken) {
    saveRefreshToken(session.refreshToken)
  }

  return session.user
}
