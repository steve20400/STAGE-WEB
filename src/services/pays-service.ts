import { apiRequest } from "../lib/api-client"

/** Un pays de la table de référence du serveur. */
export interface Pays {
  idPays: number
  libelle: string
  libelleAnglais: string
  iso2: string | null
  /** Indicatif téléphonique, « +237 ». Peut être vide sur d'anciennes lignes. */
  prefix: string
}

/**
 * 🔴 REMPLACE `src/data/countries.ts`, UNE LISTE CODÉE EN DUR ET FAUSSE.
 *
 * Elle portait ses propres identifiants — « 1 = Cameroun » — quand la table
 * `pays` dit « 1 = Afrique du Sud ». Le mobile avait sa variante, différente
 * encore. Mesuré en production le 25/08/2026 : 4 comptes enregistrés en Afrique
 * du Sud par des gens qui ont choisi le Cameroun.
 *
 * ⚠️ `GET /api/pays` EST PUBLIQUE depuis le 25/08/2026, et il le fallait :
 * l'inscription n'a pas encore de jeton d'accès. C'est précisément parce
 * qu'elle ne l'était pas que chaque client avait recopié sa liste.
 */
let cache: Pays[] | null = null

export async function listerPays(): Promise<Pays[]> {
  if (cache) return cache
  const reponse = await apiRequest<{ pays: Pays[] }>("/api/pays")
  cache = reponse.pays ?? []
  return cache
}

/**
 * Le drapeau, DÉRIVÉ du code ISO plutôt que stocké.
 *
 * Les 26 lettres A–Z ont un équivalent « indicateur régional » en Unicode
 * (U+1F1E6…U+1F1FF) : deux accolés forment le drapeau. « CM » donne 🇨🇲 sans
 * qu'aucun drapeau ne soit stocké, et un pays ajouté en base apparaît avec le
 * sien sans toucher au client.
 */
export function drapeau(iso2: string | null): string {
  const code = (iso2 ?? "").toUpperCase()
  if (code.length !== 2) return ""
  const a = code.charCodeAt(0)
  const b = code.charCodeAt(1)
  if (a < 65 || a > 90 || b < 65 || b > 90) return ""
  return String.fromCodePoint(0x1f1e6 + (a - 65), 0x1f1e6 + (b - 65))
}
