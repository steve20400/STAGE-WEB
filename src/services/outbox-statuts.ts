import { initIndexedDB } from "../indexedDB/schema"
import { uploadMedia } from "./media-service"
import { apiRequest } from "../lib/api-client"
import { estPanneReseau } from "./messages-service"

/**
 * LES STATUTS ECRITS SANS RESEAU, ET PUBLIES DES SON RETOUR.
 *
 * 🔴 SANS CETTE FILE, LA PHOTO ETAIT PERDUE. Publier un statut se fait en deux
 * temps — televerser le fichier, puis declarer le statut qui le cite. Hors
 * ligne, le premier temps echoue : l'ecran annoncait « Statut non publie » et la
 * photo disparaissait. Il fallait la retrouver, la recadrer, la reannoter.
 *
 * ⚠️ MAGASIN SEPARE DE `outboxQueue`. Celle-la est drainee en envoyant des
 * messages DANS UNE CONVERSATION, et jette comme corrompue toute entree qui n'en
 * designe aucune. Un statut n'appartient a aucune conversation.
 */

/** Au-dela de ce delai, un statut en attente est ABANDONNE. */
const PEREMPTION_MS = 24 * 60 * 60 * 1000

/**
 * ⚠️ POURQUOI UN STATUT EN ATTENTE PERIME, alors qu'un message, lui, attend
 * indefiniment.
 *
 * Un statut ne porte pas sa date : le serveur le date au moment ou il le
 * REÇOIT, et le montre pendant vingt-quatre heures a partir de la. Republier
 * trois jours plus tard une photo prise lundi la presenterait donc comme prise a
 * l'instant, a tout le repertoire, sans que personne ne l'ait demande. Un
 * message, lui, garde son horodatage et reste juste.
 *
 * Vingt-quatre heures : au-dela, le statut aurait de toute facon expire s'il
 * etait parti tout de suite. On ne publie pas ce que l'utilisateur ne verrait
 * meme plus.
 */

interface StatutEnAttente {
  id: string
  blob: Blob
  nomFichier: string
  estVideo: boolean
  createdAt: number
}

/** Met un statut en file d'attente, octets compris. */
export async function mettreStatutEnFile(fichier: File): Promise<void> {
  const db = await initIndexedDB()
  await db.put("outboxStatuts", {
    id: `statut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    blob: fichier,
    nomFichier: fichier.name,
    estVideo: fichier.type.startsWith("video/"),
    createdAt: Date.now(),
  } satisfies StatutEnAttente)
}

/** Combien de statuts attendent le reseau. Sert au libelle de l'ecran. */
export async function compterStatutsEnAttente(): Promise<number> {
  try {
    const db = await initIndexedDB()
    const tous = (await db.getAll("outboxStatuts")) as StatutEnAttente[]
    return tous.filter((s) => Date.now() - s.createdAt < PEREMPTION_MS).length
  } catch {
    return 0
  }
}

/** Un seul drain a la fois : « online » et la reconnexion peuvent coincider. */
let enCours = false

/**
 * Publie les statuts en attente. Rend le nombre de statuts publies.
 *
 * ⚠️ NE LEVE JAMAIS. Un drain qui echoue ne doit rien casser de l'ecran d'ou il
 * a ete declenche : au pire, la file reste pleine et le prochain retour de
 * reseau reessaiera.
 */
export async function viderFileStatuts(): Promise<number> {
  if (enCours || !navigator.onLine) return 0
  enCours = true
  let publies = 0

  try {
    const db = await initIndexedDB()
    const tous = (await db.getAll("outboxStatuts")) as StatutEnAttente[]
    tous.sort((a, b) => a.createdAt - b.createdAt)

    for (const statut of tous) {
      if (Date.now() - statut.createdAt >= PEREMPTION_MS) {
        await db.delete("outboxStatuts", statut.id)
        continue
      }

      try {
        const media = await uploadMedia(statut.blob, statut.nomFichier)
        await apiRequest("/api/statuses", {
          method: "POST",
          body: { type: statut.estVideo ? "VIDEO" : "IMAGE", mediaId: media.id },
        })
        publies += 1
      } catch (err) {
        // Reseau encore absent : on reprendra. Un REFUS du serveur, lui, ne se
        // reparera jamais — on retire l'entree plutot que de bloquer la file.
        if (estPanneReseau(err)) break
        await db.delete("outboxStatuts", statut.id)
        continue
      }

      await db.delete("outboxStatuts", statut.id)
    }
  } catch {
    // IndexedDB indisponible : rien a publier.
  } finally {
    enCours = false
  }

  return publies
}
