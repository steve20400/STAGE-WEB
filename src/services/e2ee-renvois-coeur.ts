import { ecrireCharge, type DescripteurMedia, type GenreCharge } from "./e2ee-media.ts"

/**
 * LE CŒUR DU RENVOI PAR L'EXPÉDITEUR (piste B, 15/11/2026).
 *
 * Toute la logique, sans aucune dépendance au navigateur : l'API, le cache et
 * le chiffrement arrivent en paramètres. C'est ce qui permet de l'éprouver
 * avec Node seul (`scripts/e2ee-renvois-test.mjs`). Le branchement réel est
 * dans `e2ee-renvois.ts`.
 *
 * Jumeau du mobile : `RenvoisE2ee` (`lib/services/e2ee/e2ee_renvois.dart`).
 */

export interface Demande {
  id: string
  messageId: string
  convId: string
  demandeurId: string
  demandeurDevice: number
}

/** Un message tel que le cache local le garde. */
export interface MessageEnCache {
  id: string
  senderId?: unknown
  content?: unknown
  type?: unknown
  replyToId?: unknown
  mediaChiffre?: unknown
}

export interface EnveloppeChiffree {
  destinataireId: string
  destinataireDevice: number
  type: number
  corps: string
}

export interface DependancesRenvois {
  api: <T>(chemin: string, options?: { method?: string; body?: unknown }) => Promise<T>
  monAppareil: () => number
  /** Mon compte : seuls MES messages se renvoient. */
  moi: () => string | null | undefined
  lireMessages: (convId: string) => Promise<MessageEnCache[]>
  ouvrirSessions: (userId: string) => Promise<number[]>
  chiffrerPour: (userId: string, appareils: number[], charge: string) => Promise<EnveloppeChiffree[]>
  avertir?: (texte: string, erreur: unknown) => void
}

export function creerRenvois(d: DependancesRenvois) {
  /**
   * Demande au serveur les messages qui manquent à cet appareil. Rend le
   * nombre de demandes créées. ⚠️ Ne lève jamais.
   */
  async function demander(): Promise<number> {
    try {
      const r = await d.api<{ demandes?: number }>("/api/e2ee/renvois", {
        method: "POST",
        body: { deviceId: d.monAppareil() },
      })
      return typeof r?.demandes === "number" ? r.demandes : 0
    } catch {
      return 0
    }
  }

  let enCours = false

  /**
   * Sert les demandes qui visent MES messages. Rend le nombre servi.
   * ⚠️ Ne lève jamais, et une demande qui échoue n'arrête pas les autres.
   */
  async function servir(): Promise<number> {
    if (enCours) return 0
    enCours = true
    let servis = 0
    try {
      const { demandes } = await d.api<{ demandes?: Demande[] }>("/api/e2ee/renvois")
      if (!demandes?.length) return 0
      const moi = d.moi()
      const fils = new Map<string, Map<string, MessageEnCache>>()
      for (const dem of demandes) {
        try {
          let fil = fils.get(dem.convId)
          if (!fil) {
            fil = new Map((await d.lireMessages(dem.convId)).map((m) => [m.id, m]))
            fils.set(dem.convId, fil)
          }
          const m = fil.get(dem.messageId)
          // Absent, ou pas de moi : un autre de mes appareils l'a peut-être.
          if (!m || !moi || m.senderId !== moi) continue
          const media = m.mediaChiffre as DescripteurMedia | undefined
          const texte = typeof m.content === "string" ? m.content : ""
          if (!media && !texte) continue
          const type = typeof m.type === "string" ? m.type : "TEXT"
          const genre = !media && type !== "TEXT" ? (type as GenreCharge) : undefined
          const reponseA = typeof m.replyToId === "string" ? m.replyToId : undefined
          const charge = ecrireCharge(dem.messageId, texte, media, { reponseA, genre })
          const appareils = await d.ouvrirSessions(dem.demandeurId)
          // L'appareil demandeur n'est plus publié : rien à servir.
          if (!appareils.includes(dem.demandeurDevice)) continue
          const [e] = await d.chiffrerPour(dem.demandeurId, [dem.demandeurDevice], charge)
          if (!e) continue
          await d.api("/api/e2ee/renvois/servir", {
            method: "POST",
            body: { id: dem.id, deviceId: d.monAppareil(), type: e.type, corps: e.corps },
          })
          servis++
        } catch (err) {
          d.avertir?.("[e2ee] renvoi impossible :", err)
        }
      }
    } catch {
      /* serveur ancien ou réseau coupé */
    } finally {
      enCours = false
    }
    return servis
  }

  return { demander, servir }
}
