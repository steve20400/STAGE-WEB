import {
  clearSessionToken,
  loadRefreshToken,
  loadSessionToken,
  saveRefreshToken,
  saveSessionToken,
} from "../data/session-auth"

export class ApiError extends Error {
  status: number
  payload?: unknown

  constructor(message: string, status = 0, payload?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.payload = payload
  }
}

interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | object | null
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "")

function buildUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path
  return `${API_BASE_URL}${path}`
}

function parsePayload(text: string) {
  if (!text) return undefined

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** Extrait un message lisible de la reponse d'erreur (enveloppe { error: { message } } du backend). */
function inferMessage(payload: unknown, fallback: string) {
  if (typeof payload === "string" && payload.trim()) return payload
  if (payload && typeof payload === "object") {
    if ("error" in payload) {
      const error = (payload as { error?: { message?: unknown } }).error
      if (error && typeof error === "object" && typeof error.message === "string") {
        return error.message
      }
    }
    if ("message" in payload) {
      const message = (payload as { message?: unknown }).message
      if (typeof message === "string" && message.trim()) return message
    }
  }
  return fallback
}

interface TokenPair {
  accessToken: string
  refreshToken: string
}

let refreshPromise: Promise<boolean> | null = null

/**
 * POST /api/auth/refresh — echange le refresh token contre un nouveau couple
 * access/refresh (rotation cote backend). Retourne false si impossible.
 */
export async function tryRefreshTokens(): Promise<boolean> {
  const refreshToken = loadRefreshToken()
  if (!refreshToken) return false

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(buildUrl("/api/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        })
        if (!response.ok) return false
        const pair = (await response.json()) as TokenPair
        if (!pair.accessToken || !pair.refreshToken) return false
        saveSessionToken(pair.accessToken)
        saveRefreshToken(pair.refreshToken)
        // Les balises img/video/iframe ne passent pas par apiRequest : prévient
        // l'interface pour qu'elle reconstruise leurs URLs avec le nouveau token.
        if (typeof window !== "undefined") window.dispatchEvent(new Event("alanya:media-token-refreshed"))
        return true
      } catch {
        return false
      } finally {
        refreshPromise = null
      }
    })()
  }

  return refreshPromise
}

/** Renouvelle explicitement le jeton avant de charger les médias navigateur. */
export async function refreshMediaSession(): Promise<boolean> {
  return tryRefreshTokens()
}

async function rawRequest(path: string, options: ApiRequestOptions) {
  const headers = new Headers(options.headers)
  const sessionToken = loadSessionToken()
  const body =
    options.body && typeof options.body === "object" && !(options.body instanceof FormData)
      ? JSON.stringify(options.body)
      : (options.body ?? undefined)

  if (sessionToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${sessionToken}`)
  }

  if (body && !headers.has("Content-Type") && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }

  try {
    return await fetch(buildUrl(path), {
      credentials: "same-origin",
      ...options,
      headers,
      body,
    })
  } catch (error) {
    throw new ApiError("Impossible de joindre le serveur.", 0, error)
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}) {
  let response = await rawRequest(path, options)

  // Access token expire -> on tente un refresh puis on rejoue la requete une fois.
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    const refreshed = await tryRefreshTokens()
    if (refreshed) {
      response = await rawRequest(path, options)
    } else {
      clearSessionToken()
    }
  }

  const text = await response.text()
  const payload = parsePayload(text)

  if (!response.ok) {
    throw new ApiError(
      inferMessage(payload, `La requete a echoue (${response.status}).`),
      response.status,
      payload
    )
  }

  return payload as T
}
