import { getOrCreateWebDeviceId } from "./appareils-service"
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
  /** Email ou numero Alanya (6 ou 8 chiffres). */
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

/** POST /api/auth/login — identifier = email ou numero Alanya (6 ou 8 chiffres). */
export async function loginWithPassword(payload: LoginPayload) {
  const identifier = payload.phone.trim()
  const fallbackUser = buildPrototypeUser(identifier)

  try {
    const response = await apiRequest<AuthTokensResponse>("/api/auth/login", {
      method: "POST",
      // deviceId rattache la session a ce navigateur : c'est ce qui permet de
      // la revoquer depuis « Sessions actives ». Sans lui, le serveur sait a
      // quel compte appartient le jeton, pas depuis quel appareil il vient.
      body: { identifier, password: payload.password, deviceId: getOrCreateWebDeviceId() },
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
      body: {
        pseudo: draft.name.trim(),
        password: draft.password,
        deviceId: getOrCreateWebDeviceId(),
      },
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

/**
 * Revoque une session dont les jetons ont deja quitte le stockage local.
 *
 * La deconnexion vide l'etat local en premier — c'est ce qui la rend immediate et
 * ce qui empeche le compte suivant de voir les donnees du precedent — donc
 * l'appel de revocation ne peut plus relire les jetons : il les porte lui-meme.
 * Sans en-tete explicite, `rawRequest` n'en ajouterait aucun et le serveur ne
 * saurait pas quelle session revoquer.
 */
export async function revokeSession(tokens: {
  accessToken: string | null
  refreshToken: string | null
}) {
  if (!tokens.refreshToken) return
  try {
    await apiRequest<void>("/api/auth/logout", {
      method: "POST",
      body: { refreshToken: tokens.refreshToken },
      headers: tokens.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : undefined,
    })
  } catch (error) {
    if (!shouldIgnoreMissingLogout(error)) throw error
  }
}

/** Pas d'endpoint "logout partout" sur ce backend : on revoque la session courante. */
export async function logoutAllSessions(tokens: {
  accessToken: string | null
  refreshToken: string | null
}) {
  await revokeSession(tokens)
}

/**
 * DELETE /api/account — supprime definitivement le compte. Le backend exige le
 * mot de passe dans le corps de la requete pour confirmer l'identite. Le jeton
 * local n'est efface que si la suppression a reellement abouti.
 */
export async function deleteCurrentAccount(password: string) {
  await apiRequest<{ message?: string }>("/api/account", {
    method: "DELETE",
    body: { password },
  })
  clearSessionToken()
}

/**
 * POST /api/account/password — change le mot de passe (verifie l'ancien cote
 * backend). Le nouveau doit faire au moins 8 caracteres et differer de l'actuel.
 */
export async function changePasswordApi(currentPassword: string, newPassword: string) {
  await apiRequest<{ message?: string }>("/api/account/password", {
    method: "POST",
    body: { currentPassword, newPassword },
  })
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

/**
 * PATCH /api/account/profile — persiste le profil cote backend (pseudo,
 * message de statut, avatar). C'est ce qui rend la photo visible par les
 * autres et la fait survivre a une reconnexion. L'avatar est une data-URL
 * miniature (le backend limite avatarUrl a 2048 caracteres).
 */
export async function updateProfileApi(payload: {
  pseudo?: string
  statusMsg?: string | null
  avatarUrl?: string | null
}): Promise<{ pseudo: string | null; avatarUrl: string | null; statusMsg: string | null }> {
  return apiRequest("/api/account/profile", { method: "PATCH", body: payload })
}
