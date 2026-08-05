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
  blockedBy?: PersonneBloquee[]
}

/** Les deux sens du blocage, tels que le serveur les expose. */
export interface Blocages {
  /** Comptes que j'ai bloques. */
  bloques: PersonneBloquee[]
  /**
   * Comptes qui m'ont bloque.
   *
   * Vide si mes accuses de lecture sont desactives : dans ce cas la regle est
   * que je ne dois pas apprendre qu'on m'a bloque, et le serveur ne me le dit
   * pas. Le client n'a donc rien a filtrer lui-meme.
   */
  quiMOntBloque: PersonneBloquee[]
}

/** GET /api/blocked — les blocages dans les deux sens. */
export async function listerBlocages(): Promise<Blocages> {
  try {
    const reponse = await apiRequest<ReponseListe>("/api/blocked")
    return { bloques: reponse.blocked ?? [], quiMOntBloque: reponse.blockedBy ?? [] }
  } catch (err) {
    console.warn("[blocked] liste indisponible", err)
    return { bloques: [], quiMOntBloque: [] }
  }
}

/** GET /api/blocked — seulement les personnes que j'ai bloquees. */
export async function listerBloques(): Promise<PersonneBloquee[]> {
  return (await listerBlocages()).bloques
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
