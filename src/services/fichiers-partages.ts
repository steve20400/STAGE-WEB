/**
 * LES FICHIERS PARTAGÉS D'UNE DISCUSSION — page « Infos », onglet Fichiers.
 *
 * 🐛 LA LISTE ÉTAIT TOUJOURS VIDE (signalé par le user le 10/10/2026 : « on ne
 * voit pas les fichiers partagés alors qu'il y en a »). L'écran n'avait jamais
 * été branché : la liste était initialisée à vide, en dur, et rien ne la
 * remplissait.
 *
 * Même méthode que le mobile (`lib/features/chat/medias_partages.dart`) : on
 * relit les messages de la discussion page par page, et l'on garde ceux qui
 * portent un fichier. Pas de route nouvelle côté serveur.
 *
 * 🔴 UN FICHIER CHIFFRÉ NE SE DÉCRIT QUE SUR L'APPAREIL. Le serveur n'en connaît
 * que « chiffre.bin » : son vrai nom, son vrai type et sa clé sont dans le
 * descripteur, rangé dans le cache de CE navigateur au déchiffrement. Un
 * fichier chiffré dont ce navigateur n'a pas la clé n'est pas listé — il ne
 * pourrait ni s'afficher ni s'ouvrir.
 */
import { apiRequest } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { toFrontMessage, type BackendMessage } from "./messages-service"
import { loadCachedMessages } from "./indexeddb-cache"
import { chargeRangee, type DescripteurMedia } from "./e2ee-media"

export type GenreFichier = "image" | "video" | "document" | "autre"

export interface FichierPartage {
  /** Unique dans la liste : un message peut porter plusieurs fichiers. */
  cle: string
  messageId: string
  nom: string
  mime: string
  /** En octets. */
  taille: number
  genre: GenreFichier
  /** « me » pour mes propres fichiers, sinon l'identifiant de l'expéditeur. */
  expediteurId: string
  date: Date
  /** Fichier en clair : son adresse sur le serveur (`/api/media/<id>`). */
  url?: string
  /** Fichier chiffré : de quoi le télécharger, le vérifier et le déchiffrer. */
  descripteur?: DescripteurMedia
}

/** Au plus tant de pages de 100 messages — même borne que le mobile. */
const PAGES_MAX = 30
const PAR_PAGE = 100

const EXTENSIONS_DOCUMENT = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "txt", "csv", "rtf", "md", "epub", "pages", "numbers", "key",
]

/** Le rayon où ranger un fichier : images, vidéos, documents, autres. */
export function genreDuFichier(mime: string, nom: string): GenreFichier {
  const m = (mime || "").toLowerCase()
  const ext = (nom.split(".").pop() ?? "").toLowerCase()
  if (m.startsWith("image/")) return "image"
  if (m.startsWith("video/")) return "video"
  if (
    m === "application/pdf" ||
    m.startsWith("text/") ||
    m.includes("word") ||
    m.includes("excel") ||
    m.includes("spreadsheet") ||
    m.includes("presentation") ||
    m.includes("opendocument") ||
    m.includes("rtf") ||
    EXTENSIONS_DOCUMENT.includes(ext)
  ) {
    return "document"
  }
  // Un fichier dont le navigateur ignorait le type : on se fie à l'extension.
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp"].includes(ext)) return "image"
  if (["mp4", "mov", "webm", "mkv", "avi", "3gp"].includes(ext)) return "video"
  return "autre"
}

/**
 * Tous les fichiers de la discussion, du plus récent au plus ancien.
 * Lève seulement si la toute première page ne peut pas être lue.
 */
export async function chargerFichiersPartages(convId: string): Promise<FichierPartage[]> {
  const moi = getMyUserId()

  // Les descripteurs des fichiers chiffrés déjà ouverts ici, par message.
  const descripteurs = new Map<string, DescripteurMedia>()
  try {
    for (const ligne of await loadCachedMessages(convId, 100_000)) {
      const l = ligne as { id: string; content?: string | null; mediaChiffre?: DescripteurMedia }
      const r = chargeRangee(l.id, l.content, l.mediaChiffre)
      if (r.media) descripteurs.set(l.id, r.media)
    }
  } catch {
    // Cache indisponible (navigation privée) : seuls les fichiers en clair.
  }

  const fichiers: FichierPartage[] = []
  let curseur: string | null = null
  for (let page = 0; page < PAGES_MAX; page++) {
    const chemin =
      `/api/conversations/${encodeURIComponent(convId)}/messages?limit=${PAR_PAGE}` +
      (curseur ? `&cursor=${encodeURIComponent(curseur)}` : "")
    let reponse: { messages?: BackendMessage[]; nextCursor?: string | null }
    try {
      reponse = await apiRequest(chemin)
    } catch (e) {
      // Une page plus ancienne qui échoue : on montre ce qu'on a déjà.
      if (page === 0) throw e
      break
    }
    const lot = reponse.messages ?? []
    for (const brut of lot) {
      const m = toFrontMessage(brut, moi)
      if (m.isDeleted || m.vueUnique) continue
      ;(m.medias ?? []).forEach((j, i) => {
        if (j.chiffre) {
          const d = m.mediaChiffre ?? descripteurs.get(m.id)
          if (!d) return
          const nom = d.nom ?? "fichier"
          fichiers.push({
            cle: `${m.id}:${i}`,
            messageId: m.id,
            nom,
            mime: d.mime,
            taille: d.taille,
            genre: genreDuFichier(d.mime, nom),
            expediteurId: m.senderId,
            date: m.timestamp,
            descripteur: d,
          })
          return
        }
        fichiers.push({
          cle: `${m.id}:${i}`,
          messageId: m.id,
          nom: j.filename || "fichier",
          mime: j.mimeType,
          taille: j.sizeBytes,
          genre: genreDuFichier(j.mimeType, j.filename || ""),
          expediteurId: m.senderId,
          date: m.timestamp,
          url: j.url,
        })
      })
    }
    curseur = reponse.nextCursor ?? (lot.length === PAR_PAGE ? lot[lot.length - 1]?.id ?? null : null)
    if (!curseur) break
  }

  return fichiers.sort((a, b) => b.date.getTime() - a.date.getTime())
}
