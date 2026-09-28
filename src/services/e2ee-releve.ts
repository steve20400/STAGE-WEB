/**
 * LA RELÈVE QUI RANGE TOUT — le seul point d'entrée des écrans.
 *
 * 🔴 POURQUOI CE FICHIER EXISTE. `releverEtDechiffrer()` ramène les enveloppes
 * de TOUS les fils et les acquitte toutes. Ses deux appelants — le chargement
 * d'un fil et l'arrivée d'un message — ne rangeaient que le texte du fil
 * affiché. Le texte des autres fils était donc perdu à jamais : acquitté sur le
 * serveur, clé consommée chez nous. Prouvé par
 * `scripts/e2ee-releve-multifil.mjs` le 28/09/2026.
 *
 * ⚠️ D'OÙ UNE RÈGLE : aucun écran n'appelle plus `releverEtDechiffrer()` en
 * direct. Il passe par ici, et ce qui est relevé est rangé dans SON fil, quel
 * que soit celui qu'on regarde.
 *
 * ⚠️ FICHIER À PART, et non une fonction de plus dans `e2ee-fil.ts` : le
 * rangement a besoin de l'archive, et `e2ee-sauvegarde.ts` importe déjà
 * `e2ee-fil.ts`. Les réunir ferait une dépendance circulaire.
 */
import { releverEtDechiffrer, type ClairRecu } from "./e2ee-fil"
import { cacheClairRecu } from "./indexeddb-cache"
import { archiver } from "./e2ee-sauvegarde"

/**
 * Range chaque message relevé dans le cache de SON fil, puis dans l'archive.
 *
 * ⚠️ LE CACHE EST ATTENDU, L'ARCHIVE NON. Le cache est la seule copie du texte
 * sur cet appareil au moment où l'enveloppe va être acquittée ; l'archive
 * accumule par lots et ne lève jamais.
 *
 * ⚠️ LA FUSION PROTÈGE LE TEXTE. `upsertMessage` garde un contenu connu quand
 * une écriture ultérieure arrive vide — c'est le cas de la liste du serveur,
 * qui rend `content: null` pour un message chiffré. Ranger ici une ligne
 * partielle ne l'expose donc pas à être effacée au prochain chargement.
 */
async function ranger(recus: ClairRecu[]): Promise<void> {
  for (const r of recus) {
    // ⚠️ Écarté si la ligne existante est d'un autre expéditeur ou d'un autre
    // fil — et alors pas archivé non plus. Voir `rangerClairRecu`.
    const range = await cacheClairRecu({
      id: r.messageId,
      conversationId: r.convId,
      senderId: r.expediteurId,
      content: r.texte,
      type: "TEXT",
      status: "SENT",
      createdAt: r.quand,
    })
    if (!range) continue
    archiver({
      id: r.messageId,
      convId: r.convId,
      expediteurId: r.expediteurId,
      texte: r.texte,
      quand: r.quand,
    })
  }
}

/**
 * La file des relèves : une seule à la fois.
 *
 * ⚠️ DEUX RELÈVES SIMULTANÉES RAMÈNENT LES MÊMES ENVELOPPES — rien n'est
 * acquitté tant que la première n'a pas fini. La seconde tente alors de
 * déchiffrer des messages déjà ouverts, échoue, et le journal se remplit
 * d'« illisibles » qui n'en sont pas. Or une arrivée de message déclenche
 * justement deux appels presque ensemble : la ligne du fil, puis la sonnette.
 *
 * ⚠️ UNE FILE, ET NON « REPRENDRE LA RELÈVE EN COURS » : un appel arrivé
 * pendant la relève peut viser une enveloppe déposée après son départ. Il doit
 * donc avoir son propre tour.
 */
let file: Promise<unknown> = Promise.resolve()

export function releverEtRanger(): Promise<Map<string, ClairRecu>> {
  const tour = file.then(
    () => releverEtDechiffrer(ranger),
    () => releverEtDechiffrer(ranger),
  )
  file = tour.catch(() => undefined)
  return tour
}
