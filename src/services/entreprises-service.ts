import { apiRequest } from "../lib/api-client"

/**
 * L'ANNUAIRE DES ENTREPRISES — miroir web de
 * `alanya-integration/lib/features/entreprises/entreprises_repository.dart`.
 *
 * ⚠️ LE CONTRAT VIT CÔTÉ SERVEUR (`src/lib/annuaire-entreprises.ts`). Ce fichier
 * ne fait que le traduire en TypeScript ; en particulier ce n'est pas lui qui
 * décide quelles entreprises sont visibles — le filtre par pays est appliqué au
 * serveur, qui lit le pays du compte plutôt que de le croire sur parole.
 *
 * ⚠️ MÊMES NOMS DE CHAMPS QUE LE MOBILE, volontairement. Les deux clients lisent
 * la même route ; les nommer autrement d'un côté rendrait toute comparaison
 * pénible le jour où l'un des deux affichera autre chose que l'autre.
 */

/** Un type d'entreprise — « Télécommunications », « Banques ». */
export interface TypeEntreprise {
  id: number
  libelle: string
  /** Combien d'entreprises de ce type sont visibles DANS MON PAYS. */
  nbEntreprises: number
}

/** Une entreprise de l'annuaire. */
export interface Entreprise {
  id: number
  libelle: string
  description: string | null
  adresse: string | null
  pays: string | null
  ville: string | null
}

/** Un service, derrière une touche du menu du standard. */
export interface ServiceTouche {
  /** Le chiffre à composer une fois le standard décroché. */
  touche: number
  /**
   * Le nom du service, ou `null` s'il n'est pas renseigné.
   *
   * 🔴 L'ÉCRAN AFFICHE ALORS « Sans nom », traduit — jamais un libellé fabriqué.
   * Le serveur ne renvoie volontairement rien : « Touche 2 » ressemblerait à un
   * vrai intitulé, et serait du français servi aux neuf langues.
   */
  nom: string | null
}

/** Un standard : centre d'appel (humain) ou centre vocal (serveur). */
export interface CentreEntreprise {
  /** `appel` ou `vocal`. */
  type: string
  nom: string
  /**
   * 🔴 L'ALANYA ID À COMPOSER. C'est lui qu'on appelle pour tomber sur le
   * standard, jamais le numéro court de l'entreprise — qui ne distingue pas les
   * centres entre eux.
   */
  alanyaId: string
  services: ServiceTouche[]
}

export interface FicheEntreprise {
  entreprise: Entreprise
  centres: CentreEntreprise[]
}

interface ReponseTypes {
  types?: TypeEntreprise[]
}
interface ReponseEntreprises {
  entreprises?: Entreprise[]
}
interface ReponseFiche {
  entreprise?: Entreprise
  centres?: CentreEntreprise[]
}

/** Les types d'entreprise, avec leur effectif dans mon pays. */
export async function listerTypes(): Promise<TypeEntreprise[]> {
  const reponse = await apiRequest<ReponseTypes>("/api/entreprises")
  return reponse.types ?? []
}

/** Les entreprises d'un type, DANS MON PAYS. */
export async function entreprisesDuType(idType: number): Promise<Entreprise[]> {
  const reponse = await apiRequest<ReponseEntreprises>(
    `/api/entreprises?type=${idType}`,
  )
  return reponse.entreprises ?? []
}

/**
 * Recherche — TOUS PAYS confondus.
 *
 * 🔴 C'est le seul chemin vers une entreprise dont le pays n'est pas renseigné :
 * la navigation par type ne peut pas l'atteindre. Ne pas y ajouter le filtre par
 * pays « pour être cohérent » — ce serait rendre ces entreprises introuvables.
 */
export async function chercherEntreprises(
  requete: string,
): Promise<Entreprise[]> {
  const reponse = await apiRequest<ReponseEntreprises>(
    `/api/entreprises?q=${encodeURIComponent(requete)}`,
  )
  return reponse.entreprises ?? []
}

/** La fiche d'une entreprise : ses standards et leurs services. */
export async function ficheEntreprise(
  idEntreprise: number,
): Promise<FicheEntreprise> {
  const reponse = await apiRequest<ReponseFiche>(
    `/api/entreprises?entreprise=${idEntreprise}`,
  )
  return {
    entreprise: reponse.entreprise ?? {
      id: idEntreprise,
      libelle: "",
      description: null,
      adresse: null,
      pays: null,
      ville: null,
    },
    centres: reponse.centres ?? [],
  }
}

/** Le centre est-il un serveur vocal, plutôt qu'un standard humain ? */
export function estVocal(centre: CentreEntreprise): boolean {
  return centre.type === "vocal"
}
