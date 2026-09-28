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

/*
 * ══════════════════════════════════════════════════════════════════════════
 * CE QUE LE SERVEUR ENVOIE VRAIMENT — ET POURQUOI IL FAUT LE TRADUIRE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 🐛 CLIQUER SUR UNE CATÉGORIE N'AFFICHAIT AUCUNE ENTREPRISE (signalé par le
 * user le 27/09/2026 : « je clique sur Telecom, les deux entreprises qu'on est
 * censé me montrer, je ne vois rien »).
 *
 * La cause : ce fichier DÉCLARAIT que le serveur renvoie `id`, alors qu'il
 * renvoie `idTypeCompany` et `idCompany`. `apiRequest<T>` ne vérifie RIEN — le
 * paramètre de type est une AFFIRMATION, pas un contrôle. TypeScript faisait
 * donc confiance, et `type.id` valait `undefined` à l'exécution. L'écran
 * demandait `?type=undefined`, le serveur répondait 400 « Type invalide », et le
 * `catch` affichait une liste vide. Aucune erreur visible, aucune alerte : juste
 * du vide, là où la catégorie annonçait deux entreprises.
 *
 * 🔴 ET DEUX AUTRES CHAMPS MENTAIENT DE LA MÊME FAÇON. `pays` et `ville` sont des
 * OBJETS côté serveur — `{ libelle, iso2 }` et `{ nom }` — pas des chaînes.
 *
 * ⚠️ L'APP MOBILE N'A JAMAIS EU CE DÉFAUT parce qu'elle TRADUIT, champ par champ,
 * dans des `fromJson` (`entreprises_repository.dart`). Dart n'a pas le choix : il
 * n'existe pas de conversion silencieuse depuis du JSON. TypeScript, lui, en
 * offre une — et c'est précisément le piège.
 *
 * ⚠️ LA RÈGLE À TENIR : une forme brute par réponse, et un traducteur. Le coût
 * est de quelques lignes ; le défaut qu'il évite est invisible à la compilation
 * et ne se manifeste qu'à l'écran, sous la forme d'un vide inexplicable.
 */

/** La forme brute d'un type, telle que `annuaire-entreprises.ts` la sérialise. */
interface TypeBrut {
  idTypeCompany?: number
  libelle?: string
  nbEntreprises?: number
}

/** La forme brute d'une entreprise. `pays` et `ville` sont des OBJETS. */
interface EntrepriseBrute {
  idCompany?: number
  libelle?: string
  description?: string | null
  adresse?: string | null
  pays?: { libelle?: string | null } | null
  ville?: { nom?: string | null } | null
}

/** Une chaîne utilisable, ou `null` — jamais une chaîne vide. */
function texte(valeur: unknown): string | null {
  const v = typeof valeur === "string" ? valeur.trim() : ""
  return v === "" ? null : v
}

function versType(brut: TypeBrut): TypeEntreprise {
  return {
    id: Number(brut.idTypeCompany ?? 0),
    libelle: brut.libelle ?? "",
    nbEntreprises: Number(brut.nbEntreprises ?? 0),
  }
}

function versEntreprise(brut: EntrepriseBrute): Entreprise {
  return {
    id: Number(brut.idCompany ?? 0),
    libelle: brut.libelle ?? "",
    description: texte(brut.description),
    adresse: texte(brut.adresse),
    // Les deux sont des objets côté serveur : on en extrait le libellé.
    pays: texte(brut.pays?.libelle),
    ville: texte(brut.ville?.nom),
  }
}

interface ReponseTypes {
  types?: TypeBrut[]
}
interface ReponseEntreprises {
  entreprises?: EntrepriseBrute[]
}
interface ReponseFiche {
  entreprise?: EntrepriseBrute
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
  return (reponse.types ?? []).map(versType)
}

/** Les entreprises d'un type, dans le pays retenu. */
export async function entreprisesDuType(
  idType: number,
  idPays: number | null = null,
): Promise<Entreprise[]> {
  const reponse = await apiRequest<ReponseEntreprises>(
    `/api/entreprises?type=${idType}${fragmentPays(idPays)}`,
  )
  return (reponse.entreprises ?? []).map(versEntreprise)
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
  return (reponse.entreprises ?? []).map(versEntreprise)
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
  return (reponse.entreprises ?? []).map(versEntreprise)
}

/** La fiche d'une entreprise : ses standards et leurs services. */
export async function ficheEntreprise(
  idEntreprise: number,
): Promise<FicheEntreprise> {
  const reponse = await apiRequest<ReponseFiche>(
    `/api/entreprises?entreprise=${idEntreprise}`,
  )
  return {
    entreprise: reponse.entreprise ? versEntreprise(reponse.entreprise) : {
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
