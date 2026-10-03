import { initIndexedDB } from "../indexedDB/schema"
import { loadSessionToken } from "../data/session-auth"
import { resolveMediaUrl } from "./media-service"
import { dechiffrerFichier, type DescripteurMedia } from "./e2ee-media"

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

export function ouvrirMediaChiffre(d: DescripteurMedia): Promise<Blob> {
  const deja = enCours.get(d.id)
  if (deja) return deja
  const p = ouvrir(d).finally(() => enCours.delete(d.id))
  enCours.set(d.id, p)
  return p
}

async function ouvrir(d: DescripteurMedia): Promise<Blob> {
  try {
    const db = await initIndexedDB()
    const garde = (await db.get(MAGASIN, cleCache(d.id))) as { blob?: Blob } | undefined
    if (garde?.blob) return garde.blob
  } catch {
    /* cache indisponible : on télécharge */
  }

  const chiffre = await telechargerChiffre(d.id)
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
 */
async function telechargerChiffre(id: string): Promise<Uint8Array> {
  const adresse = resolveMediaUrl(`/api/media/${id}`)
  try {
    const r = await fetch(adresse)
    if (r.ok) return new Uint8Array(await r.arrayBuffer())
    if (r.status === 403 || r.status === 404 || r.status === 410) {
      throw new MediaIndisponible(r.status)
    }
  } catch (e) {
    if (e instanceof MediaIndisponible) throw e
    /* direct refusé (CORS, réseau) : repli par le serveur */
  }
  const token = loadSessionToken()
  const r = await fetch(`${adresse}&flux=1`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!r.ok) throw new MediaIndisponible(r.status)
  return new Uint8Array(await r.arrayBuffer())
}

/** Le serveur n'a plus ce fichier, ou nous le refuse. */
export class MediaIndisponible extends Error {
  constructor(readonly statut: number) {
    super(`média indisponible (${statut})`)
  }
}
