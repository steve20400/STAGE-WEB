/**
 * LE DERNIER MESSAGE D'UN FIL CHIFFRÉ, DANS LA LISTE DES CONVERSATIONS.
 *
 * Jumeau de `alanya/lib/features/home/dernier_message_local.dart`.
 *
 * 🐛 DEMANDE DU USER, 28/09/2026 : dans la liste, un fil chiffré n'affichait
 * pas son dernier message. Le serveur n'a pas ce texte — c'est tout le
 * principe — et rend `lastMessage: null`. Le texte, lui, EXISTE sur cet
 * appareil : la relève range chaque message déchiffré dans le cache de SON
 * fil (`e2ee-releve.ts`), et nos propres messages y sont rangés à l'envoi.
 *
 * ⚠️ LE COMPTEUR DE NON-LUS NE VIENT PAS D'ICI : le serveur l'incrémente aussi
 * pour un message chiffré — il sait qu'un message est arrivé, pas ce qu'il dit.
 */
import { loadCachedMessages } from "./indexeddb-cache"
import { chargeRangee } from "./e2ee-media"
import { apercuStructure } from "./message-payload"

export interface DernierMessage {
  id: string
  content: string | null
  type: string
  senderId: string
  createdAt: string
}

interface AvecDernier {
  id: string
  e2eeActif?: boolean
  lastMessage?: DernierMessage | null
}

/**
 * Remplace l'aperçu des fils CHIFFRÉS par le dernier texte connu localement.
 *
 * ⚠️ LE SERVEUR GAGNE S'IL EST PLUS RÉCENT : un fil chiffré peut avoir reçu un
 * MÉDIA après le dernier texte — les pièces jointes ne sont pas chiffrées, le
 * serveur en a le libellé (« 📷 Photo »), et c'est bien lui le dernier message.
 *
 * ⚠️ LES FILS ORDINAIRES NE SONT PAS TOUCHÉS : le serveur y a le texte.
 */
export function appliquerDerniersTextes<T extends AvecDernier>(
  convs: T[],
  locaux: Map<string, DernierMessage>,
): T[] {
  return convs.map((c) => {
    const local = locaux.get(c.id)
    if (!c.e2eeActif || !local) return c
    const serveur = c.lastMessage
    const serveurPlusRecent =
      !!serveur?.content && new Date(serveur.createdAt).getTime() > new Date(local.createdAt).getTime()
    return serveurPlusRecent ? c : { ...c, lastMessage: local }
  })
}

/**
 * Le dernier message AVEC TEXTE de chaque fil chiffré, lu dans le cache.
 *
 * ⚠️ NE LÈVE JAMAIS : sans cache lisible, la liste s'affiche comme avant.
 */
export async function derniersTextesLocaux(convs: AvecDernier[]): Promise<Map<string, DernierMessage>> {
  const locaux = new Map<string, DernierMessage>()
  await Promise.all(
    convs
      .filter((c) => c.e2eeActif)
      .map(async (c) => {
        try {
          const messages = (await loadCachedMessages(c.id, 50)) as Array<{
            id: string
            senderId?: string
            content?: string | null
            type?: string
            createdAt?: number | string
            deletedAt?: unknown
          }>
          let dernier: (typeof messages)[number] | undefined
          for (const brut of messages) {
            // Une charge v2 rangée brute ne doit pas devenir l'aperçu de la
            // liste : on n'en garde que la légende (voir `chargeRangee`).
            const m = { ...brut, content: chargeRangee(brut.id, brut.content).texte }
            if (!m.content || m.deletedAt) continue
            const t = new Date(m.createdAt ?? 0).getTime()
            if (!dernier || t > new Date(dernier.createdAt ?? 0).getTime()) dernier = m
          }
          if (dernier) {
            locaux.set(c.id, {
              id: dernier.id,
              // Un contact ou une position chiffrés sont rangés en JSON : la liste
              // montre leur libellé (« 👤 Jean »), comme le serveur pour un fil clair.
              content: apercuStructure(dernier.type ?? "", dernier.content) ?? dernier.content ?? null,
              type: dernier.type ?? "TEXT",
              senderId: dernier.senderId ?? "",
              createdAt: new Date(dernier.createdAt ?? 0).toISOString(),
            })
          }
        } catch {
          // Cache illisible pour ce fil : son aperçu reste celui du serveur.
        }
      }),
  )
  return locaux
}

/** Les deux à la suite — à appliquer à TOUTE liste affichée. */
export async function avecDerniersTextesLocaux<T extends AvecDernier>(convs: T[]): Promise<T[]> {
  if (!convs.some((c) => c.e2eeActif)) return convs
  return appliquerDerniersTextes(convs, await derniersTextesLocaux(convs))
}
