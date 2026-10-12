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
  isGroup?: boolean
  lastMessage?: DernierMessage | null
}

/**
 * Combien de GROUPES chiffrés sans aperçu local on va ouvrir en silence, au
 * plus, à chaque affichage de la liste.
 *
 * ⚠️ UNE BORNE, PARCE QUE C'EST UNE REQUÊTE PAR GROUPE. Quelqu'un qui aurait
 * trente groupes chiffrés et un téléphone neuf ferait trente appels d'un coup
 * sur une connexion lente. Les premiers de la liste sont ceux qu'il regarde ;
 * les autres se rempliront au prochain affichage, ou à l'ouverture.
 */
const GROUPES_A_ECLAIRER_MAX = 8

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

/**
 * LES GROUPES CHIFFRÉS QUE PERSONNE N'A ENCORE OUVERTS ICI.
 *
 * 🐛 UN GROUPE CHIFFRÉ N'AVAIT AUCUN APERÇU DANS LA LISTE tant qu'on ne
 * l'avait pas ouvert sur CET appareil (trouvé le 12/10/2026 en vérifiant, à la
 * demande du user, que le chiffrement des groupes n'avait rien cassé).
 *
 * 🔴 LA CAUSE : un message de tête-à-tête voyage dans une ENVELOPPE, et la
 * relève de fond les ramène toutes, quel que soit le fil affiché — le cache se
 * remplit donc tout seul. Le corps d'un message de GROUPE, lui, est posé sur le
 * message lui-même et ne se déchiffre qu'en chargeant les messages de ce fil.
 * Sans ouverture, rien n'arrive dans le cache, et la liste n'a rien à montrer.
 *
 * ⚠️ ON NE CHARGE QUE CE QU'IL FAUT, ET PAS PLUS : les groupes chiffrés QUI
 * N'ONT PAS d'aperçu local. Un groupe déjà ouvert une fois n'en a pas besoin,
 * et un fil de tête-à-tête encore moins.
 *
 * ⚠️ NE LÈVE JAMAIS, et ne bloque pas la liste : c'est un complément. Un
 * groupe qui échoue garde l'aperçu qu'il avait, c'est-à-dire aucun.
 */
async function eclairerGroupesJamaisOuverts(
  convs: AvecDernier[],
  locaux: Map<string, DernierMessage>,
): Promise<void> {
  const aFaire = convs
    .filter((c) => c.e2eeActif && c.isGroup && !locaux.has(c.id))
    .slice(0, GROUPES_A_ECLAIRER_MAX)
  if (aFaire.length === 0) return

  // Séquentiel : huit requêtes lancées ensemble sur une connexion mobile se
  // ralentissent l'une l'autre, et la liste est déjà affichée.
  for (const c of aFaire) {
    try {
      // `fetchMessages` déchiffre les messages de groupe et les range dans le
      // cache (`eclairerGroupe`) : c'est tout ce qu'on lui demande ici.
      const { fetchMessages } = await import("./messages-service")
      // Cinq : de quoi tomber sur un message qui porte du texte, même si les
      // derniers sont des photos ou des messages effacés.
      await fetchMessages(c.id, 5)
    } catch {
      /* Hors ligne, clé pas encore reçue : la liste reste comme elle était. */
    }
  }
}

/** Les deux à la suite — à appliquer à TOUTE liste affichée. */
export async function avecDerniersTextesLocaux<T extends AvecDernier>(convs: T[]): Promise<T[]> {
  if (!convs.some((c) => c.e2eeActif)) return convs
  const locaux = await derniersTextesLocaux(convs)

  /*
   * Les groupes jamais ouverts ici sont éclairés APRÈS une première lecture du
   * cache, et la liste est recalculée ensuite : on affiche tout de suite ce
   * qu'on sait, puis on complète.
   */
  const manquants = convs.some((c) => c.e2eeActif && c.isGroup && !locaux.has(c.id))
  if (!manquants) return appliquerDerniersTextes(convs, locaux)

  await eclairerGroupesJamaisOuverts(convs, locaux)
  return appliquerDerniersTextes(convs, await derniersTextesLocaux(convs))
}
