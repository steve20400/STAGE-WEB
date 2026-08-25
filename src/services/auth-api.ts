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
import { RAISON_EVICTION, sendSessionRevoked } from "./websocket-service"
import { langueInitiale, traduire, type Cle } from "../i18n"

/** Traduction hors composant : la langue est relue a chaque message. */
const tr = (cle: Cle) => traduire(langueInitiale(), cle)

export interface LoginPayload {
  /** Email ou numero Alanya. */
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
  /**
   * Appareils que cette connexion vient de fermer — les autres navigateurs du
   * compte. Le serveur les a deja coupes en base ; cette liste sert a les
   * prevenir TOUT DE SUITE, sans quoi ils resteraient utilisables jusqu'a
   * l'expiration de leur jeton d'acces, soit un quart d'heure.
   */
  sessionsFermees?: string[]
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

/**
 * Previent TOUT DE SUITE les navigateurs que cette connexion vient de fermer.
 *
 * Le serveur les a deja coupes en base — c'est la garantie de fond. Mais l'API
 * Next et `ws-server.mjs` sont deux process sans canal entre eux : sans cette
 * annonce, les sessions sortantes resteraient utilisables jusqu'a l'expiration
 * de leur jeton d'acces, soit un quart d'heure.
 *
 * `sendSessionRevoked` met la trame en attente et ouvre la connexion si elle ne
 * l'est pas encore : au sortir d'un login, elle ne l'est justement jamais.
 */
function annonceLesEvictions(appareils: string[]) {
  for (const deviceId of appareils) {
    if (deviceId) sendSessionRevoked(deviceId, RAISON_EVICTION)
  }
}

/** POST /api/auth/login — identifier = email ou numero Alanya. */
export async function loginWithPassword(payload: LoginPayload) {
  const identifier = payload.phone.trim()
  const fallbackUser = buildPrototypeUser(identifier)

  try {
    const response = await apiRequest<AuthTokensResponse>("/api/auth/login", {
      method: "POST",
      // deviceId rattache la session a ce navigateur : c'est ce qui permet de
      // la revoquer depuis « Sessions actives ». Sans lui, le serveur sait a
      // quel compte appartient le jeton, pas depuis quel appareil il vient.
      body: {
        identifier,
        password: payload.password,
        deviceId: getOrCreateWebDeviceId(),
        // La FAMILLE de l'appareil — 0 = web. Le serveur ne ferme alors que les
        // autres navigateurs et laisse le telephone joignable. Sans cette
        // annonce, il ne peut la deduire qu'a partir de la deuxieme connexion,
        // le navigateur n'etant pas encore au registre a la premiere.
        typeDevice: 0,
      },
    })

    // Les navigateurs evinces sont prevenus par le temps reel — l'API Next et
    // `ws-server.mjs` sont deux process sans canal entre eux, c'est donc au
    // client qui vient d'ouvrir la session de faire le lien.
    annonceLesEvictions(response.sessionsFermees ?? [])

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
/**
 * POST /api/auth/forgot-password — envoie un code de reinitialisation par mail.
 *
 * Le serveur repond toujours un succes, meme si l'adresse est inconnue : c'est
 * volontaire, cela empeche de deviner quels comptes existent. On ne peut donc
 * pas promettre que le mail est parti, seulement que la demande a ete prise.
 */
export async function demanderReinitialisation(email: string): Promise<void> {
  await apiRequest<{ message?: string }>("/api/auth/forgot-password", {
    method: "POST",
    body: { email },
  })
}

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
      throw new Error(tr("auth_email_required_signup"))
    }

    if (draft.phone && findPrototypeAccount(draft.phone)) {
      throw new Error(tr("auth_phone_taken"))
    }

    if (findPrototypeAccountByEmail(normalizedEmail)) {
      throw new Error(tr("auth_email_taken"))
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
    statusMsg: tr("set_status_available"),
    avatar: null,
  }

  try {
    const verifyResponse = await apiRequest<VerifyResponse>("/api/auth/verify", {
      method: "POST",
      body: { email: normalizedEmail, code: otp },
    })

    if (!verifyResponse.setupToken) {
      throw new Error(tr("auth_verify_unexpected"))
    }

    if (verifyResponse.needsSetup === false) {
      throw new Error(tr("auth_already_setup"))
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

/* ==========================================================================
 * INSCRIPTION SANS ADRESSE, ET RÉCUPÉRATION PAR CODE
 *
 * L'adresse ne sert qu'à REPRENDRE le compte. Depuis le 25/08/2026 elle est
 * facultative : qui n'en donne pas reçoit un code de récupération de 10
 * caractères, montré une seule fois.
 * ========================================================================== */

interface ReponseInscriptionSansEmail {
  setupToken: string
  publicNumber: string
  idRecuperation: string
  needsSetup?: boolean
}

/**
 * Inscription SANS adresse : le compte est créé immédiatement.
 *
 * Il n'y a rien à confirmer, donc pas d'OTP : `register` sans champ `email`
 * rend directement le `setupToken`, et on enchaîne sur `setup` dans la foulée.
 *
 * ⚠️ LE CORPS EST VIDE, il ne contient pas `email: ""`. Le serveur refuse la
 * chaîne vide à dessein — ne pas fournir le champ est une intention, l'envoyer
 * vide est une erreur de formulaire.
 *
 * ⚠️ PAS DE REPLI « PROTOTYPE » ici, contrairement à `completeRegistration` :
 * ce parcours n'existe que côté serveur, et un compte de démonstration local
 * n'aurait pas de code de récupération à montrer — on afficherait un écran vide
 * en promettant à l'utilisateur que c'est son seul moyen de reprise.
 */
export async function registerSansEmail(draft: Omit<RegistrationDraft, "email">) {
  const reponse = await apiRequest<ReponseInscriptionSansEmail>("/api/auth/register", {
    method: "POST",
    body: {},
  })

  if (!reponse.setupToken || !reponse.idRecuperation) {
    throw new Error(tr("auth_verify_unexpected"))
  }

  const setup = await apiRequest<AuthTokensResponse>("/api/auth/setup", {
    method: "POST",
    headers: { Authorization: `Bearer ${reponse.setupToken}` },
    body: {
      pseudo: draft.name.trim(),
      password: draft.password,
      deviceId: getOrCreateWebDeviceId(),
    },
  })

  const base: SessionUser = {
    name: draft.name.trim(),
    phone: reponse.publicNumber,
    email: "",
    statusMsg: tr("set_status_available"),
    avatar: null,
  }

  return {
    session: {
      user: toSessionUser(setup.user, base),
      token: setup.accessToken,
      refreshToken: setup.refreshToken,
    } satisfies AuthSession,
    idRecuperation: reponse.idRecuperation,
    publicNumber: reponse.publicNumber,
  }
}

/** POST /api/auth/forgot-password — envoie le code de reprise par courriel. */
export async function demanderCodeReinitialisation(email: string) {
  await apiRequest<{ message?: string }>("/api/auth/forgot-password", {
    method: "POST",
    body: { email: email.trim().toLowerCase() },
  })
}

/** POST /api/auth/reset-password — chemin par ADRESSE (code à 6 chiffres). */
export async function reinitialiserParEmail(email: string, code: string, motDePasse: string) {
  await apiRequest<{ message?: string }>("/api/auth/reset-password", {
    method: "POST",
    body: { email: email.trim().toLowerCase(), code: code.trim(), password: motDePasse },
  })
}

/**
 * POST /api/auth/reset-password — chemin par CODE DE RÉCUPÉRATION.
 *
 * ⚠️ N'ENVOYER NI `email` NI `code` avec : le serveur refuse explicitement un
 * mélange des deux chemins plutôt que d'en choisir un.
 *
 * La saisie part TELLE QUELLE : c'est le serveur qui relève la casse, ignore
 * les séparateurs et traduit les I/L/O mal lus. La nettoyer ici ferait une
 * seconde règle à tenir accordée avec la sienne.
 */
export async function reinitialiserParCodeRecuperation(idRecuperation: string, motDePasse: string) {
  await apiRequest<{ message?: string }>("/api/auth/reset-password", {
    method: "POST",
    body: { idRecuperation: idRecuperation.trim(), password: motDePasse },
  })
}

/** GET /api/account/recovery-id — revoir son code (utilisateur connecté). */
export async function lireCodeRecuperation() {
  return apiRequest<{ idRecuperation: string | null; aAdresse: boolean }>(
    "/api/account/recovery-id",
  )
}

/** POST /api/account/email — ajouter une adresse : demande du code. */
export async function demanderAjoutEmail(email: string) {
  await apiRequest<{ message?: string }>("/api/account/email", {
    method: "POST",
    body: { email: email.trim().toLowerCase() },
  })
}

/** POST /api/account/email/verify — ajouter une adresse : confirmation. */
export async function confirmerAjoutEmail(email: string, code: string) {
  await apiRequest<{ message?: string }>("/api/account/email/verify", {
    method: "POST",
    body: { email: email.trim().toLowerCase(), code: code.trim() },
  })
}
