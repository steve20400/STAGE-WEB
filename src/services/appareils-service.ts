import { apiRequest } from "../lib/api-client"

/**
 * Registre des appareils du compte : ce qui alimente un ecran
 * « Appareils connectes ».
 *
 * A ne pas confondre avec push-service.ts, qui n'enregistre qu'un jeton FCM
 * pour les notifications, sans etat presentable a l'utilisateur.
 */

/** Codes du referentiel equipe pour la colonne typeDevice. */
export const TYPE_DEVICE = {
  web: 0,
  android: 1,
  ios: 2,
  bureau: 3,
} as const

/** Appareil tel que renvoye par le backend Next.js. */
export interface Appareil {
  appareilId: number
  cookiesWebId: string | null
  libelle: string
  isOnline: boolean
  typeDevice: number
  system: string | null
  /** Pseudo donne a cet appareil pour ce compte. Null tant qu'il n'en a pas. */
  nomAgent: string | null
  createAt: string
  lastLogin: string | null
  /** Deconnecte a distance. La ligne survit pour garder l'historique. */
  revoked: boolean
}

interface ListResponse {
  appareils: Appareil[]
}

interface SingleResponse {
  appareil: Appareil
}

const CLE_LOCALE = "cookies_WebID"

/**
 * Identifiant stable de ce navigateur, cree au premier appel puis conserve.
 *
 * C'est lui qui permet au serveur de reconnaitre l'appareil d'une session a
 * l'autre : sans lui, chaque connexion creerait une ligne de plus. Le nom de la
 * cle vient du referentiel equipe.
 */
export function getOrCreateWebDeviceId(): string {
  let id = localStorage.getItem(CLE_LOCALE)
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(CLE_LOCALE, id)
  }
  return id
}

/**
 * Libelle par defaut, devine depuis le navigateur.
 *
 * Volontairement grossier : il ne sert qu'a distinguer les appareils dans la
 * liste avant que l'utilisateur ne les renomme. On evite d'exposer la chaine
 * user-agent complete, illisible et inutilement bavarde.
 */
function libelleParDefaut(): string {
  const ua = navigator.userAgent
  const navigateur = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Navigateur"

  const systeme = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : ""

  return systeme ? `${navigateur} sur ${systeme}` : navigateur
}

function systemeCourt(): string {
  const ua = navigator.userAgent
  if (/Windows NT 10/.test(ua)) return "Windows 10/11"
  if (/Windows/.test(ua)) return "Windows"
  if (/Android/.test(ua)) return "Android"
  if (/iPhone|iPad/.test(ua)) return "iOS"
  if (/Mac OS X/.test(ua)) return "macOS"
  if (/Linux/.test(ua)) return "Linux"
  return "Inconnu"
}

/**
 * POST /api/appareils — signale la presence de ce navigateur.
 *
 * Idempotent : appelable a chaque ouverture de session sans creer de doublon.
 * Le libelle n'est envoye qu'a la creation implicite ; si l'utilisateur a
 * renomme son appareil, le serveur conserve son choix.
 */
/**
 * Identifiant de la LIGNE d'appareil de ce navigateur pour le compte courant.
 *
 * A ne pas confondre avec `cookies_WebID`, qui identifie le navigateur : la
 * ligne, elle, vaut pour un couple (navigateur, compte). C'est elle que le
 * verrou de conversation designe, puisqu'il se joue entre appareils d'un meme
 * compte.
 *
 * Conserve pour survivre a un rechargement : l'enregistrement ne repasse pas a
 * chaque montage, et le verrou doit pouvoir partir sans l'attendre.
 */
const CLE_APPAREIL_COURANT = "alanya-appareil-courant"

export function appareilCourantId(): number | null {
  if (typeof window === "undefined") return null
  const brut = window.localStorage.getItem(CLE_APPAREIL_COURANT)
  const valeur = Number(brut)
  return Number.isFinite(valeur) && valeur > 0 ? valeur : null
}

function retenirAppareilCourant(appareil: Appareil | null) {
  if (typeof window === "undefined") return
  if (appareil?.appareilId) {
    window.localStorage.setItem(CLE_APPAREIL_COURANT, String(appareil.appareilId))
  }
}

export async function enregistrerAppareilCourant(): Promise<Appareil | null> {
  try {
    const response = await apiRequest<SingleResponse>("/api/appareils", {
      method: "POST",
      body: {
        cookiesWebId: getOrCreateWebDeviceId(),
        libelle: libelleParDefaut(),
        typeDevice: TYPE_DEVICE.web,
        system: systemeCourt(),
        isOnline: 1,
      },
    })
    retenirAppareilCourant(response.appareil)
    return response.appareil
  } catch (error) {
    // Un echec ici ne doit jamais empecher l'utilisateur d'entrer dans l'app :
    // le registre des appareils est un confort, pas un prerequis.
    console.warn("[appareils] enregistrement impossible", error)
    return null
  }
}

/** GET /api/appareils — les appareils du compte, actifs d'abord. */
export async function fetchAppareils(): Promise<Appareil[]> {
  const response = await apiRequest<ListResponse>("/api/appareils")
  return response.appareils ?? []
}

/** PUT /api/appareils/:id — renomme un appareil. */
export async function renommerAppareil(appareilId: number, libelle: string): Promise<Appareil> {
  const response = await apiRequest<SingleResponse>(`/api/appareils/${appareilId}`, {
    method: "PUT",
    body: { libelle: libelle.trim() },
  })
  return response.appareil
}

/** DELETE /api/appareils/:id — deconnecte un appareil a distance. */
export async function deconnecterAppareil(appareilId: number): Promise<Appareil> {
  const response = await apiRequest<SingleResponse>(`/api/appareils/${appareilId}`, {
    method: "DELETE",
  })
  return response.appareil
}

/** Vrai si l'appareil passe est celui depuis lequel on navigue. */
export function estAppareilCourant(a: Appareil): boolean {
  return a.cookiesWebId !== null && a.cookiesWebId === localStorage.getItem(CLE_LOCALE)
}
