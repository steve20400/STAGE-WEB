import { apiRequest } from "../lib/api-client"

/**
 * L'ANNUAIRE DES ENTREPRISES — miroir web de
 * `alanya-integration/lib/features/entreprises/entreprises_repository.dart`.
 *
 * ⚠️ LE CONTRAT VIT CÔTÉ SERVEUR (`src/lib/annuaire-entreprises.ts`). Ce fichier
 * ne fait que le traduire en TypeScript.
 *
 * 🔴 LE PAYS SE CHOISIT DÉSORMAIS. Le serveur l'accepte depuis le 31/08/2026 —
 * l'annuaire est PUBLIC, le pays n'y est qu'un critère d'affichage, et rien ne
 * se protège en le refusant. Le web, lui, ne l'envoyait pas : il restait donc
 * enfermé dans le pays du compte sans que rien ne le dise.
 *
 * ⚠️ `pays` ABSENT SIGNIFIE TOUJOURS « CELUI DU COMPTE », côté serveur. Ne pas
 * envoyer `0` ou une chaîne vide pour dire « tous les pays » : le serveur les
 * refuserait, et « tous » n'existe pas — il n'y a que « le mien » ou « celui-ci ».
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

/** Un pays qui compte au moins une entreprise. */
export interface PaysAnnuaire {
  idPays: number
  libelle: string
}

/**
 * Les pays proposés par le filtre.
 *
 * 🔴 SEUL LE SERVEUR PEUT RÉPONDRE À ÇA : construire le menu depuis la table des
 * pays proposerait des pays vides, et l'écran promettrait des entreprises qui
 * n'existent pas.
 */
export async function listerPaysDisponibles(): Promise<PaysAnnuaire[]> {
  const reponse = await apiRequest<{ pays?: PaysAnnuaire[] }>(
    "/api/entreprises?pays-disponibles=1",
  )
  return reponse.pays ?? []
}

/** Le fragment `&pays=…`, ou rien quand on s'en remet au pays du compte. */
function fragmentPays(idPays: number | null): string {
  return idPays === null ? "" : `&pays=${idPays}`
}

/** Les types d'entreprise, avec leur effectif dans le pays retenu. */
export async function listerTypes(idPays: number | null = null): Promise<TypeEntreprise[]> {
  const reponse = await apiRequest<ReponseTypes>(
    `/api/entreprises?_=1${fragmentPays(idPays)}`,
  )
  return reponse.types ?? []
}

/** Les entreprises d'un type, dans le pays retenu. */
export async function entreprisesDuType(
  idType: number,
  idPays: number | null = null,
): Promise<Entreprise[]> {
  const reponse = await apiRequest<ReponseEntreprises>(
    `/api/entreprises?type=${idType}${fragmentPays(idPays)}`,
  )
  return reponse.entreprises ?? []
}

/**
 * TOUTES les entreprises d'un pays, tous types confondus.
 *
 * Ce que l'écran affiche quand on saisit un nom de pays dans la recherche : la
 * question posée est « qu'y a-t-il là-bas ? », pas « quel type ? ».
 */
export async function entreprisesDuPays(idPays: number): Promise<Entreprise[]> {
  const reponse = await apiRequest<ReponseEntreprises>(
    `/api/entreprises?toutes=1&pays=${idPays}`,
  )
  return reponse.entreprises ?? []
}

/**
 * Recherche par raison sociale ou mot-clé, DANS LE PAYS RETENU.
 *
 * ⚠️ ELLE SUIT LE FILTRE depuis le 31/08/2026, à la demande explicite du user —
 * « je pense que c'est mieux si la recherche est alignée sur le filtrage ». Elle
 * l'ignorait auparavant, à sa demande également : ne pas revenir en arrière sans
 * lui.
 *
 * ⚠️ ELLE NE TROUVE PAS LES PAYS. Le serveur fouille les raisons sociales et les
 * mots-clés ; « Cameroun » n'y ramènerait que les entreprises portant ce mot
 * dans leur nom. C'est l'écran qui reconnaît un nom de pays, avec la liste qu'il
 * a déjà chargée pour son filtre.
 */
export async function chercherEntreprises(
  requete: string,
  idPays: number | null = null,
): Promise<Entreprise[]> {
  const reponse = await apiRequest<ReponseEntreprises>(
    `/api/entreprises?q=${encodeURIComponent(requete)}${fragmentPays(idPays)}`,
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
