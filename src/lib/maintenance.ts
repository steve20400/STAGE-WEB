import { useSyncExternalStore } from "react"
import { noterLimiteServeur } from "../services/media-service"
import { API_BASE_URL } from "../config/runtime"

/**
 * LE MODE MAINTENANCE (24/10/2026) — jumeau de `core/maintenance.dart`.
 *
 * Le serveur refuse l'application par un 503 `MAINTENANCE` quand la console
 * active la maintenance. `apiRequest` le signale ici ; l'écran
 * `EcranMaintenance` recouvre alors tout, et interroge `GET /api/maintenance`
 * (la seule route qui répond pendant ce temps) pour savoir quand reprendre.
 */
let active = false
let sondage: ReturnType<typeof setInterval> | null = null
const abonnes = new Set<() => void>()

function prevenir() {
  for (const f of abonnes) f()
}

export function signalerMaintenance() {
  if (active) return
  active = true
  prevenir()
  if (sondage) clearInterval(sondage)
  sondage = setInterval(() => void verifierMaintenance(), 20_000)
}

/** Interroge le serveur ; lève la maintenance s'il l'a levée. */
export async function verifierMaintenance() {
  try {
    const r = await fetch(`${API_BASE_URL}/api/maintenance`, { cache: "no-store" })
    const d = (await r.json()) as { maintenance?: boolean; mediaMaxMo?: unknown }
    // La limite des médias voyage dans la même réponse (25/11/2026) : la lire
    // ici évite un aller-retour de plus, et la tient à jour pendant la session.
    noterLimiteServeur(d?.mediaMaxMo)
    if (r.ok && d.maintenance === false) {
      if (sondage) clearInterval(sondage)
      sondage = null
      active = false
      prevenir()
    }
  } catch {
    // Hors ligne ou serveur indisponible : on réessaiera au tour suivant.
  }
}

export function useMaintenance(): boolean {
  return useSyncExternalStore(
    (f) => {
      abonnes.add(f)
      return () => abonnes.delete(f)
    },
    () => active,
  )
}
