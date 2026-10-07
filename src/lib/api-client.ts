import { API_BASE_URL } from "../config/runtime"
import {
  clearSessionToken,
  loadRefreshToken,
  loadSessionToken,
  saveRefreshToken,
  saveSessionToken,
} from "../data/session-auth"
import { MESSAGE_EVICTION, MESSAGE_REJEU, poseMessageDeconnexion } from "../data/session-message"
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
  /** Envoi de fichier : (octets partis, total), au fil de l'envoi. */
  onUploadProgress?: (envoyes: number, total: number) => void
}

/**
 * Plafond de duree d'une requete. Sans lui, aucun appel n'avait de fin : un
 * serveur injoignable bloquait jusqu'au timeout TCP du navigateur, ce qui rendait
 * notamment la deconnexion interminable.
 */
const REQUEST_TIMEOUT_MS = 20_000

/*
 * 🐛 UN ENVOI DE FICHIER N'A PLUS DE DURÉE MAXIMALE (signalé par le user le
 * 07/10/2026 : « l'envoi en taille originale échoue à chaque fois »).
 *
 * Il était coupé au bout de 2 minutes, quel que soit son avancement. Au débit
 * d'une connexion mobile au Cameroun — 1 Mbit/s en montée —, 2 minutes font
 * 15 Mo : toute vidéo d'origine échouait, et repartait de zéro pour échouer
 * encore. « L'envoi peut durer une heure » : on ne mesure plus la DURÉE mais
 * le SILENCE. Tant que des octets partent, on attend ; on n'abandonne que si
 * plus rien ne bouge.
 */
/** Aucun octet parti pendant ce temps : la connexion est morte. */
const ENVOI_SILENCE_MAX_MS = 5 * 60_000
/**
 * Fichier entièrement parti, réponse attendue : le serveur le range dans le
 * stockage, ce qui prend du temps pour 250 Mo.
 */
const ENVOI_REPONSE_MAX_MS = 10 * 60_000

/**
 * Un envoi de fichier par `XMLHttpRequest` plutôt que `fetch` : seul lui dit,
 * octet par octet, ce qui est PARTI — c'est ce qui permet de distinguer un
 * envoi lent d'un envoi mort, et d'afficher sa progression.
 *
 * Rend une `Response` comme `fetch`, pour que tout le reste — rejeu après
 * rafraîchissement du jeton, lecture des erreurs — ne change pas. Une coupure
 * lève une `ApiError` de statut 0, comme une panne réseau de `fetch` : la file
 * hors ligne la reconnaît et renverra le fichier au retour du réseau.
 */
function envoyerFichier(
  url: string,
  headers: Headers,
  body: FormData,
  onUploadProgress?: (envoyes: number, total: number) => void,
  signal?: AbortSignal | null
): Promise<Response> {
  return new Promise((resoudre, rejeter) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    headers.forEach((valeur, nom) => xhr.setRequestHeader(nom, valeur))

    let dernierSigne = Date.now()
    let envoiTermine = false
    const veille = setInterval(() => {
      const delai = envoiTermine ? ENVOI_REPONSE_MAX_MS : ENVOI_SILENCE_MAX_MS
      if (Date.now() - dernierSigne > delai) xhr.abort()
    }, 10_000)
    const finir = () => {
      clearInterval(veille)
      signal?.removeEventListener("abort", interrompre)
    }
    const interrompre = () => xhr.abort()
    signal?.addEventListener("abort", interrompre)

    xhr.upload.onprogress = (e) => {
      dernierSigne = Date.now()
      onUploadProgress?.(e.loaded, e.lengthComputable ? e.total : 0)
    }
    xhr.upload.onload = () => {
      envoiTermine = true
      dernierSigne = Date.now()
    }
    xhr.onload = () => {
      finir()
      const sansCorps = [101, 204, 205, 304].includes(xhr.status)
      resoudre(
        new Response(sansCorps ? null : xhr.responseText, {
          status: xhr.status,
          headers: { "Content-Type": xhr.getResponseHeader("Content-Type") ?? "application/json" },
        })
      )
    }
    const echec = () => {
      finir()
      rejeter(new ApiError(traduire(langueInitiale(), "core_server_unreachable"), 0))
    }
    xhr.onerror = echec
    xhr.onabort = echec
    xhr.ontimeout = echec
    xhr.send(body)
  })
}

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
          let code: string | undefined
          try {
            const corps = (await response.json()) as { error?: { code?: string } }
            code = corps?.error?.code
            if (code === "SESSION_EVINCEE") poseMessageDeconnexion(MESSAGE_EVICTION)
            if (code === "JETON_REJOUE") poseMessageDeconnexion(MESSAGE_REJEU)
          } catch {
            // Corps illisible : on reste sur un échec sans explication.
          }

          /*
           * 🔴 CE N'EST PLUS LE STATUT QUI DECIDE, MAIS LE CODE NOMME.
           *
           * L'ancienne regle — « 4xx = le serveur a juge le jeton » — etait
           * beaucoup trop large, et c'est la cause des deconnexions alors que
           * rien n'avait expire. Le serveur fait TOURNER le jeton de
           * rafraichissement : chaque appel revoque l'ancien. Un rejeu du meme
           * jeton — reponse perdue, onglet duplique, deux appels concurrents —
           * recevait 401 `BAD_REFRESH`, qui tombait du cote « refuse », et la
           * session etait detruite.
           *
           * `BAD_REFRESH` veut desormais dire « reessaie », pas « c'est fini ».
           * Seuls ces quatre codes ferment une session, et ce sont quatre
           * DECISIONS que le serveur prend et nomme.
           *
           * ⚠️ MEME LISTE QUE `codesSessionFermee` DANS L'APPLICATION MOBILE
           * (`auth_controller.dart`). Les deux clients parlent au meme serveur :
           * une divergence ici se paierait en deconnexions d'un seul cote, la
           * classe de panne la plus difficile a relier a sa cause.
           */
          const CODES_SESSION_FERMEE = [
            "SESSION_EVINCEE",
            "JETON_REJOUE",
            "SESSION_REVOQUEE",
            "SESSION_EXPIREE",
          ]
          if (code && CODES_SESSION_FERMEE.includes(code)) return "refuse"

          /*
           * ⚠️ EN CAS DE DOUTE, ON GARDE — y compris sur un 4xx sans code, et y
           * compris quand le corps etait illisible. Une session gardee a tort
           * se corrige au rafraichissement suivant ; une session detruite a
           * tort oblige a retaper son mot de passe.
           */
          return "injoignable"
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

  /*
   * LA LANGUE CHOISIE DANS L'APPLICATION, et non celle du navigateur.
   *
   * Le serveur écrit les courriels (code d'inscription, mot de passe oublié,
   * nouvelle adresse) dans la langue de cet en-tête. Sans lui, le navigateur
   * envoie la SIENNE : un utilisateur qui a choisi le russe sur un poste
   * réglé en français recevrait ses codes en français.
   */
  if (!headers.has("Accept-Language")) {
    headers.set("Accept-Language", langueInitiale())
  }

  if (body instanceof FormData && (options.method ?? "GET").toUpperCase() === "POST") {
    return envoyerFichier(buildUrl(path), headers, body, options.onUploadProgress, options.signal)
  }

  const { onUploadProgress: _ignore, ...optionsFetch } = options
  void _ignore
  try {
    return await fetch(buildUrl(path), {
      credentials: "same-origin",
      ...optionsFetch,
      headers,
      body,
      // Apres le spread, pour qu'un signal fourni par l'appelant garde la main.
      signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
