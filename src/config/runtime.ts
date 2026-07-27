export type DataMode = "auto" | "prototype" | "api"

const rawDataMode = (import.meta.env.VITE_DATA_MODE ?? "auto").toLowerCase()

function normalizeDataMode(value: string): DataMode {
  if (value === "prototype" || value === "api" || value === "auto") {
    return value
  }

  return "auto"
}

export const dataMode: DataMode = normalizeDataMode(rawDataMode)

export function isPrototypeMode() {
  return dataMode === "prototype"
}

export function isApiOnlyMode() {
  return dataMode === "api"
}

/* ----------------- Adresses du backend ----------------- */

/**
 * Backend par defaut : le VPS OVH qui sert l'API Next.js et, via Nginx, le
 * serveur temps reel sur /ws. C'est la meme adresse que celle utilisee par
 * l'application mobile (server_config.dart).
 *
 * La valeur par defaut est indispensable : `npm run dev` ne charge PAS
 * .env.production, donc sans elle toutes les requetes partiraient vers le
 * serveur de developpement Vite et repondraient 404.
 */
const DEFAULT_API_BASE_URL = "https://alanyavox.com"

function trimmed(value: string | undefined) {
  return value?.trim() ? value.trim() : undefined
}

/** Deduit l'adresse du WebSocket de celle de l'API quand VITE_WS_URL est absent. */
function deriveWsUrl(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl)
    const scheme = url.protocol === "https:" ? "wss:" : "ws:"
    // Backend lance en local : le serveur temps reel ecoute sur son propre port.
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return `${scheme}//${url.hostname}:3001`
    }
    // Deploiement : Nginx proxifie /ws vers ce meme serveur.
    return `${scheme}//${url.host}/ws`
  } catch {
    return "ws://localhost:3001"
  }
}

/** Racine de l'API REST, sans slash final. */
export const API_BASE_URL = (
  trimmed(import.meta.env.VITE_API_BASE_URL) ?? DEFAULT_API_BASE_URL
).replace(/\/$/, "")

/** Adresse du serveur WebSocket temps reel, sans slash final. */
export const WS_URL = (trimmed(import.meta.env.VITE_WS_URL) ?? deriveWsUrl(API_BASE_URL)).replace(
  /\/$/,
  ""
)
