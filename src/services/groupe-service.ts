import { apiRequest } from "../lib/api-client"

/**
 * LE GROUPE LUI-MEME (01/11/2026, repris d'Alanya2026) — jumeau de
 * `groupe_reglages.dart` sur le mobile : description, proprietaire, reglages,
 * et la banniere « Rester / Quitter ».
 *
 * Rendu par `GET /api/conversations/:id/members`, a cote des membres. Les
 * valeurs par defaut sont le fonctionnement d'avant : un serveur qui ne les
 * envoie pas laisse l'ecran se comporter comme hier.
 */
export interface ReglagesGroupe {
  description: string | null
  /** Garde le role ADMIN ; seul lui change les roles. `null` = groupe d'avant. */
  proprietaireId: string | null
  adminsSeulsEcrivent: boolean
  adminsSeulsModifient: boolean
  adminsSeulsAjoutent: boolean
  historiqueCacheNouveaux: boolean
  /** Ajoute par quelqu'un, je n'ai pas encore dit « Rester ». */
  arriveeAConfirmer: boolean
}

/** Les cles des quatre reglages, reserves aux admins. */
export type CleReglage =
  | "adminsSeulsEcrivent"
  | "adminsSeulsModifient"
  | "adminsSeulsAjoutent"
  | "historiqueCacheNouveaux"

const PAR_DEFAUT: ReglagesGroupe = {
  description: null,
  proprietaireId: null,
  adminsSeulsEcrivent: false,
  adminsSeulsModifient: true,
  adminsSeulsAjoutent: true,
  historiqueCacheNouveaux: false,
  arriveeAConfirmer: false,
}

/** Les derniers reglages connus, par conversation : l'ecran les a avant le reseau. */
const connus = new Map<string, ReglagesGroupe>()

export function reglagesConnus(convId: string): ReglagesGroupe | null {
  return connus.get(convId) ?? null
}

interface ReponseMembres {
  groupe?: Partial<Omit<ReglagesGroupe, "arriveeAConfirmer">>
  moi?: { arriveeAConfirmer?: boolean }
}

/** GET /api/conversations/:id/members — les reglages du groupe. */
export async function lireGroupe(convId: string): Promise<ReglagesGroupe> {
  const r = await apiRequest<ReponseMembres>(`/api/conversations/${encodeURIComponent(convId)}/members`)
  const g = r?.groupe ?? {}
  const reglages: ReglagesGroupe = {
    description: g.description ?? null,
    proprietaireId: g.proprietaireId ?? null,
    adminsSeulsEcrivent: g.adminsSeulsEcrivent ?? PAR_DEFAUT.adminsSeulsEcrivent,
    adminsSeulsModifient: g.adminsSeulsModifient ?? PAR_DEFAUT.adminsSeulsModifient,
    adminsSeulsAjoutent: g.adminsSeulsAjoutent ?? PAR_DEFAUT.adminsSeulsAjoutent,
    historiqueCacheNouveaux: g.historiqueCacheNouveaux ?? PAR_DEFAUT.historiqueCacheNouveaux,
    arriveeAConfirmer: r?.moi?.arriveeAConfirmer === true,
  }
  connus.set(convId, reglages)
  return reglages
}

function retenir(convId: string, partiel: Partial<ReglagesGroupe>): ReglagesGroupe {
  const r = { ...(connus.get(convId) ?? PAR_DEFAUT), ...partiel }
  connus.set(convId, r)
  return r
}

/** Change des reglages du groupe (admins). Rend les reglages retenus. */
export async function changerReglagesGroupe(
  convId: string,
  reglages: Partial<Record<CleReglage, boolean>>,
): Promise<ReglagesGroupe> {
  const r = await apiRequest<Partial<ReglagesGroupe>>(
    `/api/conversations/${encodeURIComponent(convId)}`,
    { method: "PATCH", body: reglages },
  )
  return retenir(convId, {
    adminsSeulsEcrivent: r?.adminsSeulsEcrivent,
    adminsSeulsModifient: r?.adminsSeulsModifient,
    adminsSeulsAjoutent: r?.adminsSeulsAjoutent,
    historiqueCacheNouveaux: r?.historiqueCacheNouveaux,
  } as Partial<ReglagesGroupe>)
}

/** La description du groupe ; vide = l'effacer. */
export async function modifierDescription(convId: string, texte: string): Promise<ReglagesGroupe> {
  const r = await apiRequest<{ description?: string | null }>(
    `/api/conversations/${encodeURIComponent(convId)}`,
    { method: "PATCH", body: { description: texte } },
  )
  return retenir(convId, { description: r?.description ?? null })
}

/** « Rester » sur la banniere d'arrivee, retenu pour tous mes appareils. */
export async function resterDansGroupe(convId: string): Promise<void> {
  await apiRequest(`/api/conversations/${encodeURIComponent(convId)}/rester`, { method: "POST" })
  retenir(convId, { arriveeAConfirmer: false })
}

/** L'etat de la sourdine retenu par le serveur. */
export interface EtatSourdine {
  sourdine: boolean
  sourdineJusqua: string | null
  mentionsSeulement: boolean
}

/**
 * La sourdine complete (01/11/2026) : `sourdine` pour toujours (ou `false`
 * pour tout retablir), `jusqua` pour un temps, `mentionsSeulement` en groupe.
 */
export async function definirSourdineDetail(
  convId: string,
  choix: { sourdine?: boolean; jusqua?: Date; mentionsSeulement?: boolean },
): Promise<EtatSourdine> {
  const r = await apiRequest<Partial<EtatSourdine>>(
    `/api/conversations/${encodeURIComponent(convId)}/sourdine`,
    {
      method: "POST",
      body: {
        ...(choix.sourdine !== undefined ? { sourdine: choix.sourdine } : {}),
        ...(choix.jusqua ? { jusqua: choix.jusqua.toISOString() } : {}),
        ...(choix.mentionsSeulement !== undefined ? { mentionsSeulement: choix.mentionsSeulement } : {}),
      },
    },
  )
  return {
    sourdine: r?.sourdine === true,
    sourdineJusqua: r?.sourdineJusqua ?? null,
    mentionsSeulement: r?.mentionsSeulement === true,
  }
}
