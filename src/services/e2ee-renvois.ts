import { apiRequest } from "../lib/api-client"
import { loadCachedMessages } from "./indexeddb-cache"
import { ecrireCharge, type DescripteurMedia, type GenreCharge } from "./e2ee-media"
import { chiffrerPour, idAppareil, ouvrirSessions } from "./e2ee-service"

/**
 * RENVOI PAR L'EXPÉDITEUR (piste B, 15/11/2026) — jumeau de
 * `PileE2ee.demanderRenvois` / `servirRenvois` du mobile, et des routes
 * serveur `api/e2ee/renvois`.
 *
 * Un message chiffré pour mes seuls anciens appareils, qu'aucun n'a relevé,
 * est illisible ici : personne ne l'a chiffré pour ce navigateur. Je le
 * DEMANDE ; le serveur choisit lui-même les messages éligibles et sonne leurs
 * expéditeurs (`e2ee_renvoi`). Un appareil de l'expéditeur retrouve le clair
 * dans SON cache, le rechiffre pour moi et le dépose. La relève ordinaire
 * remplit ensuite la bulle.
 *
 * ⚠️ NE LÈVE JAMAIS : un serveur ancien ou un réseau coupé ne doit gêner
 * personne ; on retentera au prochain chargement.
 */

interface Demande {
  id: string
  messageId: string
  convId: string
  demandeurId: string
  demandeurDevice: number
}

export async function demanderRenvois(): Promise<void> {
  try {
    await apiRequest("/api/e2ee/renvois", { method: "POST", body: { deviceId: idAppareil() } })
  } catch {
    /* on redemandera */
  }
}

let servirEnCours = false

/** Sert les demandes qui visent MES messages. Rend le nombre servi. */
export async function servirRenvois(): Promise<number> {
  if (servirEnCours) return 0
  servirEnCours = true
  let servis = 0
  try {
    const { demandes } = await apiRequest<{ demandes: Demande[] }>("/api/e2ee/renvois")
    if (!demandes?.length) return 0
    const fils = new Map<string, Map<string, Record<string, unknown>>>()
    for (const d of demandes) {
      try {
        let fil = fils.get(d.convId)
        if (!fil) {
          const lus = await loadCachedMessages(d.convId, 5000)
          fil = new Map(lus.map((m) => [m.id, m as Record<string, unknown>]))
          fils.set(d.convId, fil)
        }
        const m = fil.get(d.messageId)
        // Le clair n'est pas ici : un autre de mes appareils l'a peut-être.
        if (!m) continue
        const media = m.mediaChiffre as DescripteurMedia | undefined
        const texte = typeof m.content === "string" ? m.content : ""
        if (!media && !texte) continue
        const type = typeof m.type === "string" ? m.type : "TEXT"
        const genre = !media && type !== "TEXT" ? (type as GenreCharge) : undefined
        const reponseA = typeof m.replyToId === "string" ? m.replyToId : undefined
        const charge = ecrireCharge(d.messageId, texte, media, { reponseA, genre })
        const appareils = await ouvrirSessions(d.demandeurId)
        if (!appareils.includes(d.demandeurDevice)) continue
        const [e] = await chiffrerPour(d.demandeurId, [d.demandeurDevice], charge)
        if (!e) continue
        await apiRequest("/api/e2ee/renvois/servir", {
          method: "POST",
          body: { id: d.id, deviceId: idAppareil(), type: e.type, corps: e.corps },
        })
        servis++
      } catch (err) {
        console.warn("[e2ee] renvoi impossible :", err)
      }
    }
  } catch {
    /* serveur ancien ou réseau coupé */
  } finally {
    servirEnCours = false
  }
  return servis
}
