import { apiRequest } from "../lib/api-client"

/**
 * Blocage de contacts.
 *
 * A ne pas confondre avec le verrou de conversation : bloquer empeche les
 * messages d'un numero d'arriver chez soi ; verrouiller empeche les AUTRES
 * appareils de son propre compte d'ecrire dans une conversation. Deux
 * fonctions differentes, deux emplacements differents dans l'interface.
 *
 * Les trois routes existent deja cote serveur et sont celles qu'utilise
 * l'application mobile : les deux clients voient donc la meme liste.
 */

/** Personne bloquee, telle que renvoyee par le backend. */
export interface PersonneBloquee {
  /** Identifiant de la LIGNE de blocage — c'est lui qui sert a debloquer. */
  idBlock: number
  /** Identifiant de l'utilisateur bloque. */
  idCallerBlock: string
  pseudo: string | null
  publicNumber: string | null
  avatarUrl: string | null
  dateBlock: string
}

interface ReponseListe {
  blocked: PersonneBloquee[]
}

/** GET /api/blocked — les personnes que j'ai bloquees. */
export async function listerBloques(): Promise<PersonneBloquee[]> {
  try {
    const reponse = await apiRequest<ReponseListe>("/api/blocked")
    return reponse.blocked ?? []
  } catch (err) {
    console.warn("[blocked] liste indisponible", err)
    return []
  }
}

/** POST /api/blocked — bloque quelqu'un par son numero Alanya. */
export async function bloquer(publicNumber: string): Promise<PersonneBloquee> {
  return apiRequest<PersonneBloquee>("/api/blocked", {
    method: "POST",
    body: { publicNumber },
  })
}

/**
 * DELETE /api/blocked/:idBlock — debloque.
 *
 * L'identifiant attendu est celui de la LIGNE de blocage, pas celui de la
 * personne : c'est ce que renvoie la liste.
 */
export async function debloquer(idBlock: number): Promise<void> {
  await apiRequest<void>(`/api/blocked/${idBlock}`, { method: "DELETE" })
}

/** Nom affichable d'une personne bloquee, quel que soit ce que le serveur a. */
export function nomDuBloque(personne: PersonneBloquee): string {
  return personne.pseudo?.trim() || personne.publicNumber || "Inconnu"
}
