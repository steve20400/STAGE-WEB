import { API_BASE_URL } from "../config/runtime"
import {
  clearSessionToken,
  loadRefreshToken,
  loadSessionToken,
  saveRefreshToken,
  saveSessionToken,
} from "../data/session-auth"
import { MESSAGE_EVICTION, poseMessageDeconnexion } from "../data/session-message"
import { langueInitiale, traduire } from "../i18n"

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

/**
 * Plafond de duree d'une requete. Sans lui, aucun appel n'avait de fin : un
 * serveur injoignable bloquait jusqu'au timeout TCP du navigateur, ce qui rendait
 * notamment la deconnexion interminable.
 */
const REQUEST_TIMEOUT_MS = 20_000

/** Un envoi de fichier dure legitimement plus longtemps qu'un appel d'API. */
const UPLOAD_TIMEOUT_MS = 120_000

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

let refreshPromise: Promise<ResultatRafraichissement> | null = null

/**
 * POST /api/auth/refresh — echange le refresh token contre un nouveau couple
 * access/refresh (rotation cote backend). Retourne false si impossible.
 */
/**
 * Ce que le rafraîchissement a donné.
 *
 * 🔴 TROIS ÉTATS, ET NON UN BOOLÉEN, parce que les deux façons d'échouer
 * appellent des conduites OPPOSÉES (corrigé le 27/08/2026) :
 *
 *  - `refuse` — le serveur a RÉPONDU et a dit non : le jeton de rafraîchissement
 *    est mort (expiré, révoqué, session évincée). Effacer la session est alors
 *    la bonne conduite ;
 *  - `injoignable` — on n'a pas eu de réponse, ou une panne serveur : réseau
 *    coupé, délai dépassé, 502 pendant un redéploiement. Le jeton est
 *    probablement encore bon, et il faut le GARDER.
 *
 * Le booléen d'avant confondait les deux, et `apiRequest` effaçait la session
 * dans les deux cas — `clearSessionToken()` retirant AUSSI le jeton de
 * rafraîchissement. Une coupure passagère au moment où le jeton d'accès venait
 * d'expirer suffisait donc à détruire la session : c'est la cause des
 * « déconnexions intempestives » signalées par le user le 26/08/2026.
 *
 * ⚠️ UN 5xx N'EST PAS UN REFUS. Le serveur qui redémarre répond 502 par Nginx ;
 * le lire comme « votre session est morte » déconnecterait tout le monde à
 * chaque déploiement.
 */
export type ResultatRafraichissement = "ok" | "refuse" | "injoignable"

export async function tryRefreshTokens(): Promise<ResultatRafraichissement> {
  const refreshToken = loadRefreshToken()
  // Rien a rafraichir : c est un refus, pas une panne.
  if (!refreshToken) return "refuse"

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(buildUrl("/api/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        })
        if (!response.ok) {
          /*
           * ⚠️ LE SEUL CHEMIN qui couvre l'onglet FERMÉ au moment de
           * l'éviction : il n'a pas reçu l'événement temps réel, et ne
           * l'apprend qu'en tentant de se rafraîchir à sa réouverture. Sans ce
           * cas, l'utilisateur retomberait sur l'écran de connexion sans la
           * moindre explication.
           *
           * Le code est distinct de `BAD_REFRESH` parce que la rotation révoque
           * l'ancien jeton à chaque rafraîchissement : sans cette distinction,
           * un simple réessai après une réponse perdue afficherait « votre
           * compte a été ouvert ailleurs », ce qui serait faux.
           */
          try {
            const corps = (await response.json()) as { error?: { code?: string } }
            if (corps?.error?.code === "SESSION_EVINCEE") {
              poseMessageDeconnexion(MESSAGE_EVICTION)
            }
          } catch {
            // Corps illisible : on reste sur un échec sans explication.
          }
          // 4xx : le serveur a juge le jeton. 5xx : il est en panne, et le
          // jeton n y est pour rien — un 502 de Nginx pendant un redeploiement
          // ne doit pas deconnecter tout le monde.
          return response.status >= 500 ? "injoignable" : "refuse"
        }
        const pair = (await response.json()) as TokenPair
        // Reponse 200 mais illisible : on ne sait pas quoi croire, et detruire
        // la session sur un doute coute plus cher que de reessayer.
        if (!pair.accessToken || !pair.refreshToken) return "injoignable"
        saveSessionToken(pair.accessToken)
        saveRefreshToken(pair.refreshToken)
        return "ok"
      } catch {
        // Reseau coupe, delai depasse, DNS : AUCUNE reponse du serveur. On garde
        // les jetons.
        return "injoignable"
      } finally {
        refreshPromise = null
      }
    })()
  }

  return refreshPromise
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
      // Apres le spread, pour qu'un signal fourni par l'appelant garde la main.
      signal:
        options.signal ??
        AbortSignal.timeout(body instanceof FormData ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // Un depassement de delai arrive ici comme une panne reseau, donc en statut
    // 0 : les appels facultatifs (revocation, desinscription push, repli
    // prototype) le tolerent deja.
    throw new ApiError(traduire(langueInitiale(), "core_server_unreachable"), 0, error)
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}) {
  let response = await rawRequest(path, options)

  // Access token expire -> on tente un refresh puis on rejoue la requete une fois.
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    const refreshed = await tryRefreshTokens()
    if (refreshed === "ok") {
      response = await rawRequest(path, options)
    } else if (refreshed === "refuse") {
      // Le serveur a dit non : la session est bel et bien morte.
      clearSessionToken()
    }
    // "injoignable" : on ne touche a RIEN. La requete ressortira en erreur, et
    // la session repartira au prochain reseau. C est ce qui evite la
    // deconnexion intempestive sur une coupure passagere.
  }

  const text = await response.text()
  const payload = parsePayload(text)

  if (!response.ok) {
    throw new ApiError(
      inferMessage(
        payload,
        traduire(langueInitiale(), "v2_request_failed", { statut: response.status })
      ),
      response.status,
      payload
    )
  }

  return payload as T
}
