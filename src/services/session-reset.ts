import { clearAllData } from "../indexedDB/messageRepository"
import { viderCoffre } from "./coffre-chiffre"
import { refermer as refermerSauvegarde } from "./e2ee-sauvegarde"

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
 * Le moteur de traduction fait exception a cette regle et part avec le compte,
 * alors qu'il ressemble a un reglage d'appareil comme les bascules `notif_*`.
 * L'asymetrie de risque tranche : un moteur distant laisse en place par
 * l'utilisateur precedent enverrait le texte des messages du compte suivant a
 * un tiers sans que personne l'ait decide. L'absence de valeur vaut
 * « navigateur », donc le defaut de securite est aussi le defaut de repli. La
 * liste des
 * conversations traduites automatiquement et les traductions en cache
 * contiennent, elles, des fragments de messages : donnee de compte sans debat.
 */
const ACCOUNT_CACHE_KEYS = [
  "alanya-contacts-v1",
  // Miroir des listes de contacts. Donnee de COMPTE et non preference d'appareil,
  // malgre son air de reglage de sonnerie : il porte les membres des listes, donc
  // l'identifiant et le numero Alanya de gens du repertoire du compte precedent.
  // Laisse en place, il s'affiche au compte suivant avant la premiere reponse du
  // serveur, et `sonneriePourAppelant()` arbitre la sonnerie d'un appel entrant sur
  // les listes de quelqu'un d'autre.
  "alanya-listes-contacts-v1",
  "alanya-local-conversations-v1",
  "alanya-local-messages-v1",
  "alanya-local-groups-v1",
  "alanya_last_preview_error",
  "alanya_preview_cache_generation",
  "alanya-traduction-moteur-v1",
  // Ancienne cle du reglage, remplacee par « moteur ». Elle reste listee : un
  // navigateur qui n'a pas rouvert les Parametres depuis la mise a jour la
  // porte encore, et elle ne doit pas suivre le compte suivant.
  "alanya-traduction-mode-v1",
  "alanya-traduction-auto-v1",
  "alanya_traduction_cache_generation",
  // Sonneries importees : cette liste ne retient pas un choix mais des URL de
  // medias televerses sur le compte (`/api/media/{id}`) avec leurs libelles.
  // Laissee en place, elle affiche au compte suivant des sonneries qui ne sont
  // pas les siennes, et les ecouter va chercher les medias d'un autre.
  // A distinguer de `alanya-ringtone-incoming`, `-outgoing` et `-message`, qui
  // ne retiennent que le son choisi dans un catalogue commun a tous : ceux-la
  // sont des preferences d'appareil, comme le theme, et restent hors de cette
  // liste.
  "alanya-ringtones-custom-v1",
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

  /*
   * 🔴 LE COFFRE DE CHIFFREMENT PART AVEC LE COMPTE.
   *
   * 🐛 SEULE LA DÉCONNEXION SIMPLE LE VIDAIT. Après une session expirée, un
   * « déconnecter partout » ou une suppression de compte, le compte SUIVANT
   * qui se connectait dans ce navigateur reprenait l'identité privée du
   * précédent — et la publiait comme la sienne —, avec ses sessions et la clé
   * de son archive. Prouvé par `scripts/e2ee-coffre-compte.mjs` le 29/09/2026.
   *
   * ⚠️ ICI, ET PAS SEULEMENT À LA DÉCONNEXION : cette purge est appelée par
   * toutes les sorties de session (`leaveSessionLocally`) ET par le verrou de
   * propriétaire quand un autre compte prend la main — le seul chemin qui
   * couvre la session expirée ou l'onglet fermé sans se déconnecter.
   *
   * ⚠️ LA MÊME PERSONNE QUI SE RECONNECTE GARDE SON COFFRE : le verrou ne
   * purge que si le propriétaire CHANGE. Pas d'alerte « clé changée » chez ses
   * correspondants pour une simple expiration de session.
   */
  // La clé de l'archive, gardée en mémoire par la page, part la première :
  // sinon le compte suivant archiverait ses messages avec celle du précédent.
  refermerSauvegarde()
  try {
    await viderCoffre()
  } catch {
    // IndexedDB refusé : rien d'autre à tenter.
  }
  try {
    const aRetirer: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const cle = localStorage.key(i)
      if (cle?.startsWith("alanya.e2ee.")) aRetirer.push(cle)
    }
    for (const cle of aRetirer) localStorage.removeItem(cle)
  } catch {
    // stockage inaccessible
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
