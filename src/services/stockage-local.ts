import { initIndexedDB } from "../indexedDB/schema"

/**
 * CE QUE L'APPLICATION OCCUPE DANS CE NAVIGATEUR, ET DE QUOI LE LIBÉRER.
 *
 * 🔴 LE MOBILE A CET ÉCRAN DEPUIS LE 11/11/2026
 * (`lib/features/settings/screens/stockage_screen.dart`) ; le web n'avait rien.
 *
 * ⚠️ ET CE N'EST PAS QU'UN ALIGNEMENT. Chaque photo, vidéo ou document chiffré
 * qu'on ouvre est gardé EN CLAIR dans la base du navigateur, sans limite et
 * sans ménage — c'est une décision assumée (`e2ee-media-ouverture.ts` : « un
 * média ouvert une fois ne se retélécharge plus »). Mais personne ne pouvait
 * voir ce que cela pèse, ni le vider. Sur un ordinateur partagé, ou un disque
 * qui se remplit, c'était un angle mort.
 */

/** Le magasin des médias déchiffrés et des aperçus. */
const MAGASIN_MEDIAS = "previewMedia"

export interface RepartitionStockage {
  /** Octets des médias gardés — mesurés un par un, pas estimés. */
  medias: number
  /** Nombre de fichiers gardés. */
  nbMedias: number
  /** Le reste de ce que le navigateur nous compte : messages, réglages, caches. */
  autres: number
  /** Total occupé, tel que le navigateur le voit. */
  total: number
  /** Ce que le navigateur nous autorise, quand il veut bien le dire. */
  quota: number | null
}

/**
 * La taille des médias gardés.
 *
 * ⚠️ LIRE UN `Blob` DEPUIS LA BASE NE CHARGE PAS SES OCTETS : on reçoit une
 * référence, dont `.size` est connue sans rien lire. Mesurer deux cents
 * mégaoctets ne coûte donc pas deux cents mégaoctets de mémoire — ce qui serait
 * absurde pour une page dont tout le propos est de dire qu'il y en a trop.
 */
async function tailleDesMedias(): Promise<{ octets: number; nombre: number }> {
  let octets = 0
  let nombre = 0
  try {
    const db = await initIndexedDB()
    const tx = db.transaction(MAGASIN_MEDIAS, "readonly")
    let curseur = await tx.store.openCursor()
    while (curseur) {
      const valeur = curseur.value as { blob?: Blob } | undefined
      if (valeur?.blob) {
        octets += valeur.blob.size
        nombre += 1
      }
      curseur = await curseur.continue()
    }
    await tx.done
  } catch {
    // Base indisponible (navigation privée, quota, onglet bloquant) : on rend
    // zéro plutôt que de faire échouer l'écran qui veut justement l'afficher.
  }
  return { octets, nombre }
}

/** Ce que l'application occupe, et comment ça se répartit. */
export async function mesurer(): Promise<RepartitionStockage> {
  const { octets: medias, nombre: nbMedias } = await tailleDesMedias()

  /*
   * ⚠️ LE TOTAL VIENT DU NAVIGATEUR, PAS DE NOUS. `storage.estimate()` compte
   * tout ce que l'origine occupe — base, caches du service worker, réglages —
   * là où nous ne savons mesurer que nos médias. Annoncer notre seule somme
   * comme « espace utilisé » serait un chiffre faux, et toujours trop petit.
   */
  let total = medias
  let quota: number | null = null
  try {
    const e = await navigator.storage?.estimate?.()
    if (e && typeof e.usage === "number") total = Math.max(e.usage, medias)
    if (e && typeof e.quota === "number") quota = e.quota
  } catch {
    /* estimation refusée : le total vaut au moins nos médias */
  }

  return { medias, nbMedias, autres: Math.max(0, total - medias), total, quota }
}

/**
 * Vide le cache des médias. Rend le nombre de fichiers effacés.
 *
 * 🔴 RIEN N'EST PERDU, et c'est ce que l'écran doit dire : les fichiers restent
 * dans les discussions et se retéléchargeront à la prochaine ouverture. C'est
 * un cache, pas une archive.
 */
export async function viderMedias(): Promise<number> {
  const { nombre } = await tailleDesMedias()
  const db = await initIndexedDB()
  await db.clear(MAGASIN_MEDIAS)
  return nombre
}

/** « 12,3 Mo » — deux chiffres significatifs, dans la langue de la page. */
export function poidsLisible(octets: number, langue?: string): string {
  if (octets <= 0) return "0 o"
  const unites = ["o", "ko", "Mo", "Go", "To"]
  const i = Math.min(unites.length - 1, Math.floor(Math.log(octets) / Math.log(1024)))
  const valeur = octets / 1024 ** i
  return `${valeur.toLocaleString(langue, {
    maximumFractionDigits: valeur < 10 && i > 0 ? 1 : 0,
  })} ${unites[i]}`
}
