import { clearAllData } from "../indexedDB/messageRepository"

/**
 * Efface les traces locales d'un compte : caches de lecture rapide et donnees
 * hors ligne. Sans cela, le compte suivant qui se connecte dans le meme
 * navigateur voit s'afficher, par le chemin cache-first, les conversations, les
 * messages et les contacts du precedent — le mobile, lui, purge tout a la
 * deconnexion.
 *
 * Ne sont PAS effacees les preferences de l'appareil, qui n'appartiennent a
 * aucun compte : theme, palette, etat de la navigation, reglages de
 * notification, identifiant d'appareil (`cookies_WebID`, qui doit survivre
 * sinon le registre des appareils du compte se remplit de doublons) et comptes
 * de demonstration du mode prototype.
 *
 * Le mode de traduction fait exception a cette regle et part avec le compte,
 * alors qu'il ressemble a un reglage d'appareil comme les bascules `notif_*`.
 * L'asymetrie de risque tranche : un « en ligne » laisse en place par
 * l'utilisateur precedent enverrait le texte des messages du compte suivant a
 * un tiers sans que personne l'ait decide. L'absence de valeur vaut « local »,
 * donc le defaut de securite est aussi le defaut de repli. La liste des
 * conversations traduites automatiquement et les traductions en cache
 * contiennent, elles, des fragments de messages : donnee de compte sans debat.
 */
const ACCOUNT_CACHE_KEYS = [
  "alanya-contacts-v1",
  "alanya-local-conversations-v1",
  "alanya-local-messages-v1",
  "alanya-local-groups-v1",
  "alanya_last_preview_error",
  "alanya_preview_cache_generation",
  "alanya-traduction-mode-v1",
  "alanya-traduction-auto-v1",
  "alanya_traduction_cache_generation",
]

/** Marque le compte a qui appartiennent les caches actuellement en place. */
const CACHE_OWNER_KEY = "alanya-cache-owner-v1"

export async function purgeLocalAccountData(): Promise<void> {
  try {
    await clearAllData()
  } catch {
    // IndexedDB indisponible (navigation privee, quota) : les caches
    // localStorage restent a nettoyer, on ne s'arrete pas la.
  }

  for (const key of ACCOUNT_CACHE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      // stockage inaccessible : rien de plus a faire
    }
  }

  try {
    localStorage.removeItem(CACHE_OWNER_KEY)
  } catch {
    // idem
  }
}

/**
 * Verrou de proprietaire, appele des qu'une session devient active.
 *
 * La purge a la deconnexion ne suffit pas : un onglet ferme sans se
 * deconnecter, un plantage, une session expiree laissent les caches en place.
 * On retient donc a qui ils appartiennent, et on les vide des qu'un autre
 * compte prend la main.
 */
export async function claimLocalCaches(accountKey: string): Promise<void> {
  let previous: string | null = null
  try {
    previous = localStorage.getItem(CACHE_OWNER_KEY)
  } catch {
    return
  }

  if (previous && previous !== accountKey) {
    await purgeLocalAccountData()
  }

  try {
    localStorage.setItem(CACHE_OWNER_KEY, accountKey)
  } catch {
    // stockage inaccessible : la purge a quand meme eu lieu
  }
}
