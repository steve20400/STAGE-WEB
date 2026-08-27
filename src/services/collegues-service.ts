import { apiRequest } from "../lib/api-client"

/**
 * L'ANNUAIRE DES COLLÈGUES — miroir web de l'onglet mobile.
 *
 * ⚠️ Le contrat vit côté serveur (`backend-alanya/src/lib/collegues.ts`). Ce
 * service ne fait que le traduire, il n'ajoute aucune règle — en particulier ce
 * n'est pas lui qui décide qui a le droit de voir l'annuaire : `GET
 * /api/collegues` répond 403 à qui n'est pas agent.
 */

/** Un service de l'entreprise, avec son effectif. */
export interface ServiceCollegues {
  nom: string
  /**
   * Nombre de collègues, MOI EXCLU — c'est le serveur qui compte ainsi.
   *
   * ⚠️ Zéro est une valeur normale, pas une anomalie : un service peut n'être
   * tenu que par le standard lui-même, ou par moi seul. L'écran doit le dire
   * plutôt que de masquer la ligne.
   */
  effectif: number
}

/** Un collègue : un agent de mon entreprise. */
export interface Collegue {
  id: string
  /**
   * L'Alanya ID. C'est LUI qui permet d'appeler et d'écrire dans Alanya — le
   * mobile de la personne, lui, sortirait de l'application.
   */
  publicNumber: string
  nom: string
  avatarUrl: string | null
  isOnline: number
  /**
   * L'agence de rattachement, ou `null`.
   *
   * NUL, ET JAMAIS UNE CHAÎNE VIDE : un agent sans fonction rattachée n'a pas
   * d'agence, et le cas est réel en production. Le distinguer permet de ne rien
   * afficher du tout, là où un libellé vide dessinerait une ligne creuse sous
   * le numéro.
   */
  agence: string | null
}

interface ReponseServices {
  services?: ServiceCollegues[]
  porteeRestreinte?: boolean
}

/**
 * Les services, ET la raison d'une liste vide.
 *
 * 🔴 LES DEUX ENSEMBLE, parce qu'une liste vide seule ne dit pas POURQUOI.
 * L'écran affichait « Aucun service n'est configuré » dans tous les cas ; depuis
 * que l'entreprise peut resserrer le répertoire au propre service de l'agent
 * (`company.collegue`), ce texte peut être faux — des services existent, on n'a
 * simplement pas le droit de les voir.
 */
export interface ListeServices {
  services: ServiceCollegues[]
  /**
   * Faux par défaut : c'est le comportement d'avant ce réglage, et un serveur
   * qui ne renvoie pas le champ ne doit pas faire croire à une restriction.
   */
  porteeRestreinte: boolean
}

interface ReponseCollegues {
  collegues?: Collegue[]
}

/** Les services de mon entreprise. */
export async function listerServices(): Promise<ListeServices> {
  const reponse = await apiRequest<ReponseServices>("/api/collegues")
  return {
    services: reponse.services ?? [],
    porteeRestreinte: reponse.porteeRestreinte ?? false,
  }
}

/** Les collègues d'un service. */
export async function membresDuService(service: string): Promise<Collegue[]> {
  const reponse = await apiRequest<ReponseCollegues>(
    `/api/collegues?service=${encodeURIComponent(service)}`,
  )
  return reponse.collegues ?? []
}

/**
 * Recherche parmi TOUS les collègues de l'entreprise.
 *
 * 🔴 NE PASSE PAS PAR LES SERVICES, et c'est tout son intérêt : un agent peut
 * n'être rattaché à AUCUN service — cas réel en production — et la navigation
 * par service ne peut alors pas l'atteindre. Sans elle, un collègue existant
 * serait introuvable dans son propre annuaire.
 */
export async function chercherCollegues(requete: string): Promise<Collegue[]> {
  const reponse = await apiRequest<ReponseCollegues>(
    `/api/collegues?q=${encodeURIComponent(requete)}`,
  )
  return reponse.collegues ?? []
}
