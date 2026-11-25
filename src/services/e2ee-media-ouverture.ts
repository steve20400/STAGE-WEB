import { initIndexedDB } from "../indexedDB/schema"
import { loadSessionToken } from "../data/session-auth"
import { resolveMediaUrl } from "./media-service"
import { dechiffrerFichier, type DescripteurMedia } from "./e2ee-media"
import { ControleTransfert } from "./controle-envoi"
import { telechargerAvecReprise, RefusTelechargement } from "./telechargement-reprise"

/**
 * OUVRIR UN MÉDIA CHIFFRÉ — le télécharger, le vérifier, le déchiffrer.
 *
 * Cours, chapitre 23. Le fichier du serveur est illisible ; le descripteur reçu
 * dans l'enveloppe en donne la clé et l'empreinte.
 *
 * ⚠️ LE CLAIR EST GARDÉ DANS CE NAVIGATEUR, dans le même cache que les aperçus
 * ordinaires. C'est la règle décidée pour les textes (le stockage local en
 * clair est VOULU) : un média ouvert une fois ne se retélécharge plus.
 */

const MAGASIN = "previewMedia"
const cleCache = (id: string) => `e2ee:${id}`

/** Ouvertures en cours : dix bulles qui demandent le même média = un seul téléchargement. */
const enCours = new Map<string, Promise<Blob>>()

/** Ce que l'interface observe d'un téléchargement : où il en est, et sa pause. */
type Spectateur = (fraction: number, enPause: boolean) => void

interface Suivi {
  controle: ControleTransfert
  spectateurs: Set<Spectateur>
  fraction: number
}

/**
 * LES TÉLÉCHARGEMENTS QU'ON PEUT SUIVRE ET METTRE EN PAUSE (25/11/2026).
 *
 * ⚠️ UN SUIVI PAR MÉDIA, PAS PAR BULLE. Le même fichier peut être demandé par
 * plusieurs endroits à la fois — la bulle, la galerie, l'écran des fichiers
 * partagés ; `enCours` fait déjà qu'un seul téléchargement part. La pause doit
 * suivre la même règle : mettre en pause depuis la galerie met en pause LE
 * téléchargement, pas une copie imaginaire.
 */
const suivis = new Map<string, Suivi>()

export function ouvrirMediaChiffre(
  d: DescripteurMedia,
  o?: {
    /** Avancement du téléchargement, de 0 à 1, et son état de pause. */
    onProgression?: Spectateur
  },
): Promise<Blob> {
  const deja = enCours.get(d.id)
  if (deja) {
    const suivi = suivis.get(d.id)
    if (o?.onProgression && suivi) {
      suivi.spectateurs.add(o.onProgression)
      // Dire TOUT DE SUITE où on en est : un second spectateur ne doit pas
      // attendre le prochain paquet pour que sa barre se remplisse.
      o.onProgression(suivi.fraction, suivi.controle.enPause)
    }
    return deja
  }

  const suivi: Suivi = {
    controle: new ControleTransfert(),
    spectateurs: new Set(o?.onProgression ? [o.onProgression] : []),
    fraction: 0,
  }
  suivis.set(d.id, suivi)
  suivi.controle.surChangement((enPause) => prevenir(suivi, suivi.fraction, enPause))

  const p = ouvrir(d, suivi).finally(() => {
    enCours.delete(d.id)
    suivis.delete(d.id)
  })
  enCours.set(d.id, p)
  return p
}

/** Met en pause le téléchargement de ce média, ou le reprend. */
export function basculerPauseTelechargement(id: string): void {
  suivis.get(id)?.controle.basculer()
}

function prevenir(suivi: Suivi, fraction: number, enPause: boolean): void {
  suivi.fraction = fraction
  for (const f of [...suivi.spectateurs]) {
    try {
      f(fraction, enPause)
    } catch {
      /* un spectateur qui jette ne doit pas couper le téléchargement */
    }
  }
}

async function ouvrir(d: DescripteurMedia, suivi: Suivi): Promise<Blob> {
  try {
    const db = await initIndexedDB()
    const garde = (await db.get(MAGASIN, cleCache(d.id))) as { blob?: Blob } | undefined
    if (garde?.blob) return garde.blob
  } catch {
    /* cache indisponible : on télécharge */
  }

  const chiffre = await telechargerChiffre(d.id, suivi)
  const clair = await dechiffrerFichier(chiffre, d)
  const blob = new Blob([clair as Uint8Array<ArrayBuffer>], { type: d.mime })

  try {
    const db = await initIndexedDB()
    await db.put(MAGASIN, { key: cleCache(d.id), blob, cachedAt: Date.now() })
  } catch {
    /* pas de cache : il sera simplement retéléchargé la prochaine fois */
  }
  return blob
}

/**
 * Range le clair d'un média qu'on vient d'ENVOYER : l'expéditeur l'a déjà,
 * le retélécharger pour le déchiffrer aussitôt serait absurde.
 */
export async function garderClair(id: string, blob: Blob): Promise<void> {
  try {
    const db = await initIndexedDB()
    await db.put(MAGASIN, { key: cleCache(id), blob, cachedAt: Date.now() })
  } catch {
    /* pas de cache : il sera téléchargé au besoin */
  }
}

/**
 * Télécharge le fichier CHIFFRÉ.
 *
 * Décision du user (03/10/2026) : EN DIRECT depuis Backblaze. Le serveur
 * redirige vers une adresse signée ; le navigateur suit, et le fichier ne
 * transite pas par nous. Il faut pour cela que Backblaze autorise notre
 * origine (règle CORS du bucket) et que la politique de sécurité du site
 * autorise sa lecture (`connect-src`, `vite.config.ts`).
 *
 * ⚠️ REPLI PAR LE SERVEUR (`?flux=1`) si le direct échoue — CORS pas encore
 * posé, réseau d'entreprise qui bloque Backblaze. Le fichier étant chiffré, le
 * faire passer par nous ne révèle rien : c'est un coût de bande passante, pas
 * une fuite.
 *
 * 🔴 EN FLUX, AVEC REPRISE ET PAUSE DEPUIS LE 25/11/2026. C'était un
 * `fetch().arrayBuffer()` : aucun avancement affiché, aucune reprise, et une
 * coupure à 95 % renvoyait au premier octet. Avec un plafond à 500 Mo, c'était
 * la moitié d'un forfait perdue pour rien.
 *
 * ⚠️ LA REPRISE PAR PLAGE DEMANDE L'ACCORD DU STOCKAGE. L'en-tête `Range` sur
 * une autre origine exige une requête préalable ; si le seau ne l'autorise pas,
 * `telechargerAvecReprise` repart de zéro — jamais moins bien qu'avant, mais
 * pas mieux non plus. C'est un réglage à poser sur le seau, pas dans ce code.
 */
async function telechargerChiffre(id: string, suivi: Suivi): Promise<Uint8Array> {
  const adresse = resolveMediaUrl(`/api/media/${id}`)
  const avance = (recu: number, total: number) => {
    /*
     * ⚠️ PAS DE TAILLE ANNONCÉE, PAS DE POURCENTAGE. Afficher « 0 % » pendant
     * tout un téléchargement serait pire que de ne rien afficher : on croirait
     * que rien n'avance. Sans total, l'interface garde son sablier.
     */
    if (total <= 0) return
    prevenir(suivi, Math.min(1, recu / total), suivi.controle.enPause)
  }
  try {
    return await telechargerAvecReprise(adresse, {
      onProgression: avance,
      controle: suivi.controle,
    })
  } catch (e) {
    if (e instanceof RefusTelechargement) throw new MediaIndisponible(e.statut)
    /* direct refusé (CORS, réseau) : repli par le serveur */
  }
  const token = loadSessionToken()
  try {
    return await telechargerAvecReprise(`${adresse}&flux=1`, {
      entetes: token ? { Authorization: `Bearer ${token}` } : undefined,
      onProgression: avance,
      controle: suivi.controle,
    })
  } catch (e) {
    throw e instanceof RefusTelechargement ? new MediaIndisponible(e.statut) : e
  }
}

/** Le serveur n'a plus ce fichier, ou nous le refuse. */
export class MediaIndisponible extends Error {
  constructor(readonly statut: number) {
    super(`média indisponible (${statut})`)
  }
}
