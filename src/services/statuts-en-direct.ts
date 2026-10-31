import { useSyncExternalStore } from "react"
import {
  fetchStatusFeed,
  type StatusFeed,
  type StatusGroup,
  type StatusItem,
} from "./status-service"
import { subscribeToStatutsEnDirect, type EvenementStatut } from "./websocket-service"

/**
 * LES STATUTS QUE TOUTE L'APPLICATION PARTAGE (01/11/2026), jumeau de
 * `statuts_en_direct.dart` sur le mobile.
 *
 * Deux besoins l'ont fait naitre :
 *
 *  - la LISTE DES DISCUSSIONS dessine un anneau autour de l'avatar d'un
 *    contact qui a des statuts (repris d'Alanya) ; or le fil des statuts
 *    vivait dans la page Statuts, que la liste ne voyait pas ;
 *  - les VUES et les « J'AIME » arrivent EN DIRECT (`statut_vu`,
 *    `statut_aime`) : l'auteur voit ses compteurs bouger sans rouvrir la
 *    visionneuse. Les compteurs recus passent devant ceux du dernier fil.
 */

let fil: StatusFeed | null = null
let version = 0
const vues = new Map<string, number>()
const aimes = new Map<string, number>()
const aimeParMoi = new Map<string, boolean>()
const abonnes = new Set<() => void>()
let desabonnementWs: (() => void) | null = null

function prevenir() {
  version += 1
  abonnes.forEach((f) => f())
}

/**
 * Retient le dernier fil charge. Les compteurs recus en direct repartent de
 * lui : il est plus recent qu'eux.
 */
export function retenirFil(f: StatusFeed): void {
  fil = f
  vues.clear()
  aimes.clear()
  aimeParMoi.clear()
  prevenir()
}

export function filStatuts(): StatusFeed | null {
  return fil
}

let chargement: Promise<void> | null = null

/** Recharge le fil. Deux appels simultanes n'en font qu'un. */
export function chargerFil(): Promise<void> {
  chargement ??= fetchStatusFeed()
    .then(retenirFil)
    .catch(() => {
      // Hors ligne : l'ancien fil (ou rien) suffit a dessiner les anneaux.
    })
    .finally(() => {
      chargement = null
    })
  return chargement
}

/** Les statuts encore en ligne d'un contact, ou `null`. */
export function groupeDe(userId: string | null | undefined): StatusGroup | null {
  if (!userId) return null
  const g = fil?.others.find((x) => x.userId === userId)
  if (!g) return null
  const maintenant = Date.now()
  const restants = g.statuses.filter((s) => new Date(s.expiresAt).getTime() > maintenant)
  if (restants.length === 0) return null
  return { ...g, statuses: restants, hasUnviewed: restants.some((s) => !s.viewed) }
}

export const vuesDe = (s: StatusItem): number => vues.get(s.id) ?? s.viewsCount
export const aimesDe = (s: StatusItem): number => aimes.get(s.id) ?? s.likesCount ?? 0
export const aimeParMoiDe = (s: StatusItem): boolean =>
  aimeParMoi.get(s.id) ?? s.likedByMe ?? false

/** Mon « J'aime » vient de changer, avant meme la reponse du serveur. */
export function marquerAime(statusId: string, aime: boolean): void {
  aimeParMoi.set(statusId, aime)
  prevenir()
}

function recevoir(e: EvenementStatut) {
  if (e.type === "statut_vu" && typeof e.viewsCount === "number") {
    vues.set(e.statusId, e.viewsCount)
  } else if (e.type === "statut_aime" && typeof e.likesCount === "number") {
    aimes.set(e.statusId, e.likesCount)
  } else {
    return
  }
  prevenir()
}

/*
 * ⚠️ L'ECOUTE DU TEMPS REEL SUIT LES ABONNES : ouverte au premier ecran qui
 * s'abonne, fermee quand le dernier s'en va. Elle n'a pas a vivre sans
 * personne pour la lire.
 */
function abonner(f: () => void): () => void {
  abonnes.add(f)
  desabonnementWs ??= subscribeToStatutsEnDirect(recevoir)
  return () => {
    abonnes.delete(f)
    if (abonnes.size === 0 && desabonnementWs) {
      desabonnementWs()
      desabonnementWs = null
    }
  }
}

/**
 * Redessine le composant a chaque changement du fil ou des compteurs. Le
 * numero rendu ne sert qu'a cela ; on lit ensuite par `groupeDe`, `vuesDe`…
 */
export function useStatutsEnDirect(): number {
  return useSyncExternalStore(abonner, () => version)
}
