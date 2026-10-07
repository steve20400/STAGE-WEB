/**
 * UN PARTAGE REÇU D'UNE AUTRE APPLICATION — demande du user, 07/10/2026.
 *
 * Le système envoie le partage au service worker
 * (`public/firebase-messaging-sw.js`), qui range texte et fichiers dans le
 * cache du navigateur sous un identifiant, puis ouvre `partage-recu?id=…`.
 * Ce module relit ce rangement, et le vide une fois le partage envoyé.
 *
 * Rien ne quitte le téléphone avant que l'utilisateur ait choisi une
 * discussion : l'envoi passe alors par l'écran d'envoi ordinaire —
 * compression, légende, chiffrement si le fil l'est.
 */

const CACHE_PARTAGE = "alanya-partage-recu"

export interface PartageRecu {
  id: string
  texte: string
  fichiers: File[]
}

function adresse(chemin: string): string {
  return new URL(`${import.meta.env.BASE_URL}${chemin}`, window.location.origin).href
}

/** Le partage rangé sous `id`, ou `null` s'il n'existe plus. */
export async function lirePartageRecu(id: string): Promise<PartageRecu | null> {
  if (!/^[a-z0-9]+$/.test(id) || typeof caches === "undefined") return null
  try {
    const cache = await caches.open(CACHE_PARTAGE)
    const brut = await cache.match(adresse(`partage-recu/${id}/meta`))
    if (!brut) return null
    const meta = (await brut.json()) as {
      texte?: string
      fichiers?: Array<{ cle: string; nom: string; type: string }>
    }
    const fichiers: File[] = []
    for (const f of meta.fichiers ?? []) {
      const r = await cache.match(f.cle)
      if (!r) continue
      fichiers.push(new File([await r.blob()], f.nom, { type: f.type }))
    }
    return { id, texte: meta.texte ?? "", fichiers }
  } catch {
    return null
  }
}

/** Vide le rangement : le partage est parti, ou abandonné. */
export async function oublierPartageRecu(id: string): Promise<void> {
  if (typeof caches === "undefined") return
  try {
    const cache = await caches.open(CACHE_PARTAGE)
    const prefixe = adresse(`partage-recu/${id}/`)
    for (const requete of await cache.keys()) {
      if (requete.url.startsWith(prefixe)) await cache.delete(requete)
    }
  } catch {
    /* le cache se videra avec le navigateur */
  }
}

/**
 * 🔴 LE SERVICE WORKER DOIT EXISTER POUR RECEVOIR UN PARTAGE.
 *
 * Il n'était enregistré qu'à l'activation des notifications. Sans lui, le
 * partage arrivait au serveur web, qui ne sait pas le traiter.
 *
 * ⚠️ JAMAIS PAR-DESSUS CELUI DES NOTIFICATIONS. Ce dernier est enregistré
 * avec sa configuration Firebase dans l'adresse ; le remplacer par la version
 * nue couperait les notifications en arrière-plan. On n'enregistre donc que
 * s'il n'y a encore AUCUN service worker pour l'application — et c'est le
 * même fichier : il porte aussi la réception des partages.
 */
export async function assurerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  try {
    const existant = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
    if (existant) return
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}firebase-messaging-sw.js`, {
      scope: import.meta.env.BASE_URL,
    })
  } catch {
    // Navigation privée, refus du navigateur : on ne recevra pas de partage,
    // le reste de l'application n'en dépend pas.
  }
}
