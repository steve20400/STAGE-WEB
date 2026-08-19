import { ApiError, apiRequest } from "../lib/api-client"
import { isValidAlanyaNumber } from "../lib/alanya-number"

/**
 * Listes de contacts : des groupes nommes, propres a un compte, qui servent
 * d'abord a donner une sonnerie particuliere a un cercle de personnes
 * (« Famille », « Astreinte »). Ce n'est pas une conversation de groupe.
 *
 * Un membre n'est PAS forcement un contact : un numero compose au clavier entre
 * dans une liste des lors qu'un compte le porte, exactement comme le resout
 * `POST /api/contacts`. La propriete de securite ne repose donc plus sur le
 * repertoire mais sur le fait qu'il faut CONNAITRE le numero ; l'ajout par
 * identifiant de compte, lui, reste reserve aux contacts, sinon la route
 * deviendrait un moyen d'enumerer les comptes par leur identifiant.
 *
 * Le serveur parle anglais (`name`, `ringtone`, `memberIds`, `memberNumbers`),
 * le reste de l'application parle francais : la conversion se fait ici et nulle
 * part ailleurs, pour qu'aucun composant n'ait a connaitre les deux vocabulaires.
 */

/* ------------------------------------------------------- Cote serveur */

/** Membre tel qu'il sort du backend. */
interface MembreServeur {
  id: string
  publicNumber: string
  name: string | null
  isContact: boolean
}

/** Liste telle qu'elle sort du backend. */
interface ListeServeur {
  id: string
  name: string
  ringtone: string | null
  color: string | null
  createdAt: string
  members: MembreServeur[]
}

interface ReponseListes {
  lists: ListeServeur[]
}

interface ReponseListe {
  list: ListeServeur
  /** Numeros composes qu'aucun compte ne porte, en chiffres seuls. */
  unknownNumbers: string[]
}

/* ------------------------------------------------------- Cote application */

export interface MembreListe {
  /** Identifiant du compte, et non de la ligne d'appartenance a la liste. */
  id: string
  /** Numero Alanya du compte, toujours renseigne par le serveur. */
  numero: string
  /** Alias du repertoire, a defaut nom du compte, a defaut rien a afficher. */
  nom: string | null
  /**
   * Faux pour un membre entre par son numero sans etre au repertoire. Sert a
   * l'affichage : ce membre n'a pas d'alias, et le proposer a l'ajout au
   * repertoire est le geste suivant naturel.
   */
  estContact: boolean
}

export interface ListeContacts {
  id: string
  nom: string
  sonnerie: string | null
  couleur: string | null
  /**
   * Date de creation en ISO 8601. Ce n'est pas un ornement d'affichage : c'est le
   * seul champ qui porte l'ordre de creation, donc la regle d'arbitrage des
   * sonneries (« la plus anciennement creee gagne »). Le jeter reviendrait a
   * dependre pour toujours de l'ordre dans lequel la reponse est arrivee.
   */
  creeLe: string
  membres: MembreListe[]
}

/** Ce qu'on met dans une liste : des contacts choisis, des numeros composes, ou les deux. */
export interface ChoixMembres {
  /** Identifiants de comptes, qui doivent etre des contacts de l'appelant. */
  identifiants?: string[]
  /** Numeros Alanya composes au clavier, contacts ou non. */
  numeros?: string[]
}

export interface PatchListe {
  nom?: string
  sonnerie?: string | null
  couleur?: string | null
  membres?: ChoixMembres
}

/** Ce que rendent la creation et la modification : la liste, et ce qui n'a pas ete trouve. */
export interface ResultatEcriture {
  liste: ListeContacts
  /**
   * Numeros composes qu'aucun compte ne porte, en chiffres seuls. Vide quand
   * tout a ete resolu. Les taire serait le vrai defaut : l'utilisateur a tape un
   * numero, il doit apprendre lequel n'existe pas.
   */
  numerosInconnus: string[]
}

/**
 * Le CONTENU de la sonnerie n'est pas validee ici : l'espace de noms est celui de
 * `ringtones.ts` — un nom de fichier fourni (`incoming_ring.mp3`) ou l'URL
 * relative d'un media importe (`/api/media/<id>`). Le serveur ne connait que la
 * longueur de la chaine, et le client ne re-verifie pas davantage : une sonnerie
 * disparue du catalogue est deja rattrapee par le repli de `ringtoneFile()`.
 *
 * Son TYPE, lui, est verifie a chaque lecture (voir `estListe`) : c'est une chaine
 * ou `null`, jamais autre chose, parce que la suite du chemin appelle
 * `String.prototype.startsWith` dessus sans filet et de facon synchrone.
 */

export type CodeErreurListe = "nom-pris" | "reponse-illisible"

/**
 * Porte un code plutot qu'un texte : le message affichable depend de la langue,
 * donc il appartient a l'interface. Le `message` ci-dessous n'est qu'une trace
 * technique, il n'est pas fait pour etre montre.
 */
export class ErreurListeContacts extends Error {
  code: CodeErreurListe

  constructor(code: CodeErreurListe) {
    super(`liste de contacts : ${code}`)
    this.name = "ErreurListeContacts"
    this.code = code
  }
}

/* ------------------------------------------------------- Lecture defensive */

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null
}

/** Une chaine ou `null`, jamais autre chose : c'est la forme du contrat. */
function estChaineOuNull(valeur: unknown): valeur is string | null {
  return typeof valeur === "string" || valeur === null
}

/** Une chaine non vide, ou `null` — un nom fait de blancs ne vaut pas un nom. */
function nomOuNull(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() !== "" ? valeur : null
}

function membreDepuisServeur(brut: unknown): MembreListe | null {
  if (!estObjet(brut)) return null
  if (typeof brut.id !== "string" || brut.id === "") return null
  return {
    id: brut.id,
    numero: typeof brut.publicNumber === "string" ? brut.publicNumber : "",
    nom: nomOuNull(brut.name),
    estContact: brut.isContact === true,
  }
}

/**
 * Conversion TOLERANTE : rend `null` quand l'objet n'a pas la forme attendue,
 * plutot que de laisser une lecture de champ lever un `TypeError` brut. La
 * reponse du serveur n'est pas plus sure que le stockage local : elle traverse un
 * proxy, un deploiement decale, une page d'erreur HTML rendue en JSON.
 *
 * Une liste dont `members` est absent devient une liste vide et non une panne :
 * pendant un deploiement decale du backend, l'ecran des listes reste utilisable.
 */
function depuisServeur(brut: unknown): ListeContacts | null {
  if (!estObjet(brut)) return null
  if (typeof brut.id !== "string" || typeof brut.name !== "string") return null

  const membresBruts = Array.isArray(brut.members) ? brut.members : []
  const membres: MembreListe[] = []
  for (const membreBrut of membresBruts) {
    const membre = membreDepuisServeur(membreBrut)
    if (membre) membres.push(membre)
  }

  return {
    id: brut.id,
    nom: brut.name,
    sonnerie: typeof brut.ringtone === "string" ? brut.ringtone : null,
    couleur: typeof brut.color === "string" ? brut.color : null,
    creeLe: typeof brut.createdAt === "string" ? brut.createdAt : "",
    membres,
  }
}

/**
 * Meme conversion, mais exigeante : la creation et la modification DOIVENT
 * rendre une liste, il n'y a pas de repli possible. On leve alors une erreur
 * portant un code, pour que l'interface affiche `clist_error` au lieu d'un
 * message technique echappe d'un acces a une propriete de `undefined`.
 */
function listeObligatoire(brut: unknown): ListeContacts {
  const liste = depuisServeur(brut)
  if (!liste) throw new ErreurListeContacts("reponse-illisible")
  return liste
}

function numerosInconnusDepuisServeur(brut: unknown): string[] {
  if (!Array.isArray(brut)) return []
  const numeros = brut
    .filter((valeur): valeur is string => typeof valeur === "string")
    // Le serveur promet la forme normalisee ; la reappliquer ne coute rien et
    // garantit a l'interface que ces numeros se comparent a ceux qu'elle a envoyes.
    .map(normaliserNumero)
    .filter((numero) => numero !== "")
  return [...new Set(numeros)]
}

/**
 * Le seul 409 documente sur ces routes est le nom deja pris, d'ou la traduction
 * directe du statut en code : inutile de dependre de la forme exacte du corps
 * d'erreur, que `apiRequest` aplatit deja en message.
 */
function traduireErreur(err: unknown): never {
  if (err instanceof ApiError && err.status === 409) throw new ErreurListeContacts("nom-pris")
  throw err
}

/* ------------------------------------------------------- Numeros composes */

/**
 * Normalisation reprise a l'identique de `addContactByPhone()` de
 * `contacts-service.ts`, qui alimente `POST /api/contacts` : chiffres seuls. Le
 * numero doit y arriver dans exactement la meme forme, sinon deux chemins qui
 * resolvent le meme compte ne le trouveraient pas de la meme facon.
 */
function normaliserNumero(brut: string): string {
  return brut.replace(/\D/g, "")
}

/**
 * Forme d'un numero Alanya, alignee sur `publicNumberSchema` du backend
 * (`ALANYA_ID_MIN_LENGTH` a `ALANYA_ID_MAX_LENGTH` chiffres). Ce n'est pas une
 * validation redondante : le schema du serveur refuse la REQUETE ENTIERE sur un
 * seul numero mal forme, ce qui ferait perdre les membres valides du meme envoi.
 * On ecarte donc ces numeros avant l'envoi — et on les rend comme introuvables,
 * ce qu'ils sont : aucun compte ne peut porter un numero de cette forme.
 */
const FORME_NUMERO = /^\d{3,10}$/

function preparerNumeros(numeros: string[] | undefined): { envoyes: string[]; rejetes: string[] } {
  const normalises = [
    ...new Set((numeros ?? []).map(normaliserNumero).filter((numero) => numero !== "")),
  ]
  return {
    envoyes: normalises.filter((numero) => FORME_NUMERO.test(numero)),
    rejetes: normalises.filter((numero) => !FORME_NUMERO.test(numero)),
  }
}

/**
 * Les identifiants partent tels quels : le serveur compare sans tenir compte de
 * la casse et rend la valeur de la base, c'est donc `membres` dans la reponse qui
 * fait foi sur ce qui est entre dans la liste — jamais ce qu'on a envoye.
 */
function preparerIdentifiants(identifiants: string[] | undefined): string[] {
  return [...new Set((identifiants ?? []).filter((id) => typeof id === "string" && id !== ""))]
}

/* ------------------------------------------------------- Miroir local */

/**
 * Le miroir existe pour une seule raison : `startIncomingRingtone()` de
 * `call-manager.ts` est SYNCHRONE. Quand un appel entre, il faut deja savoir
 * quelle sonnerie jouer — attendre une requete reviendrait a laisser le premier
 * cycle de sonnerie muet, ou a jouer le son par defaut puis a en changer en
 * cours de route.
 *
 * Cle versionnee : la forme stockee suit celle du serveur, et une v2 doit
 * pouvoir ignorer la v1 au lieu d'essayer de la lire. Elle est aussi listee dans
 * `ACCOUNT_CACHE_KEYS` de `session-reset.ts` : ces listes appartiennent a un
 * compte, pas a l'appareil.
 */
const CLE_MIROIR = "alanya-listes-contacts-v1"

/**
 * A n'appeler QUE depuis l'interieur d'un `try` : sur Firefox avec le stockage
 * bloque par une politique de site, le simple acces a `window.localStorage` leve
 * une `SecurityError`. La garde elle-meme est donc une source d'exception.
 */
function stockageDisponible() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

/**
 * Lecture defensive : ce stockage est ecrit par une version anterieure de
 * l'application autant que par celle-ci. Un contenu illisible ou d'une autre
 * forme rend un miroir vide — jamais une exception, sinon la panne remonterait
 * jusqu'a la sonnerie d'un appel entrant, qui est appelee sur ce chemin.
 */
function lireMiroir(): ListeContacts[] {
  try {
    if (!stockageDisponible()) return []
    const brut = window.localStorage.getItem(CLE_MIROIR)
    if (!brut) return []
    const analyse = JSON.parse(brut) as unknown
    if (!Array.isArray(analyse)) return []
    return analyse.filter(estListe)
  } catch {
    return []
  }
}

function estMembre(valeur: unknown): valeur is MembreListe {
  if (!estObjet(valeur)) return false
  return (
    typeof valeur.id === "string" &&
    typeof valeur.numero === "string" &&
    estChaineOuNull(valeur.nom) &&
    typeof valeur.estContact === "boolean"
  )
}

/**
 * Validation de TOUS les champs que le chemin synchrone consomme, et pas
 * seulement de ceux qui sautent aux yeux :
 *  - `sonnerie` finit dans `ringtoneSource()` puis `isCustomRingtone()`, qui fait
 *    `id.startsWith('/')`. Un stockage portant un objet la passerait sans bruit
 *    et leverait un `TypeError` a l'interieur de `startIncomingRingtone()` —
 *    synchrone, donc sans sonnerie du tout ;
 *  - `creeLe` sert au tri d'arbitrage, une valeur d'un autre type y rendrait
 *    l'ordre imprevisible.
 * `couleur` n'est que cosmetique, mais la valider coute une ligne et evite un
 * `[object Object]` dans une propriete CSS.
 */
function estListe(valeur: unknown): valeur is ListeContacts {
  if (!estObjet(valeur)) return false
  return (
    typeof valeur.id === "string" &&
    typeof valeur.nom === "string" &&
    estChaineOuNull(valeur.sonnerie) &&
    estChaineOuNull(valeur.couleur) &&
    typeof valeur.creeLe === "string" &&
    Array.isArray(valeur.membres) &&
    valeur.membres.every(estMembre)
  )
}

function ecrireMiroir(listes: ListeContacts[]) {
  try {
    if (!stockageDisponible()) return
    window.localStorage.setItem(CLE_MIROIR, JSON.stringify(listes))
  } catch {
    // Quota, navigation privee ou stockage bloque : le miroir ne survivra pas a la
    // session, et la sonnerie retombera sur celle par defaut jusqu'au prochain
    // listerListes(). La garde est dans le try pour la meme raison qu'en lecture.
  }
}

/**
 * Le miroir se relit au stockage a CHAQUE acces, sans copie retenue en memoire.
 *
 * Une variable de module aurait evite quelques `JSON.parse`, et elle a d'abord
 * ete ecrite ainsi. Elle rouvrait la fuite entre comptes que la liste blanche de
 * `session-reset.ts` venait de fermer : l'application est une page unique qui ne
 * se recharge PAS a la deconnexion, donc `purgeLocalAccountData()` efface bien la
 * cle du stockage mais ne peut rien contre une variable restee vivante dans le
 * module. Le compte suivant continuait de voir les listes du precedent dans le
 * meme onglet, `sonneriePourAppelant()` arbitrait sur ses membres, et la premiere
 * ecriture du nouveau compte RE-PERSISTAIT les donnees de l'ancien.
 *
 * Relire est aussi la convention du depot — `loadContacts()` de `data/contacts.ts`
 * et `lireAuto()` de `traduction-service.ts` font de meme, precisement pour que la
 * purge prenne effet sans crochet a maintenir. Le cout est une lecture de
 * `localStorage` par appel, en regard d'une faille de confidentialite.
 */
function miroirCourant(): ListeContacts[] {
  return lireMiroir()
}

function copieListe(liste: ListeContacts): ListeContacts {
  return { ...liste, membres: liste.membres.map((membre) => ({ ...membre })) }
}

/**
 * Les listes connues sans aucun appel reseau, dans l'ordre rendu par le serveur.
 * Vide au premier chargement d'un navigateur, le temps d'un `listerListes()`.
 *
 * Rend un tableau FRAIS, comme `loadContacts()` de `data/contacts.ts`. Rendre la
 * variable de module laisserait un appelant qui trie pour l'affichage — un
 * `listes.sort(...)`, qui trie en place — reordonner l'etat interne : la regle de
 * sonnerie changerait sous ses pieds, et la mutation suivante persisterait cet
 * ordre au stockage. Les tableaux de membres sont copies pour la meme raison,
 * leur ordre portant la date d'ajout.
 */
export function listesEnCache(): ListeContacts[] {
  return miroirCourant().map(copieListe)
}

function majMiroir(listes: ListeContacts[]) {
  ecrireMiroir(listes)
}

/**
 * Instant de creation en millisecondes. Une date illisible part en fin de tri :
 * rendre `NaN` d'une comparaison rendrait le resultat du tri dependant de l'ordre
 * d'entree, donc instable d'une lecture a l'autre.
 */
function instantCreation(creeLe: string): number {
  const instant = Date.parse(creeLe)
  return Number.isNaN(instant) ? Number.POSITIVE_INFINITY : instant
}

function parAnciennete(a: ListeContacts, b: ListeContacts): number {
  const ia = instantCreation(a.creeLe)
  const ib = instantCreation(b.creeLe)
  if (ia === ib) return 0
  return ia < ib ? -1 : 1
}

/**
 * Sonnerie a jouer pour un appel entrant, ou `null` pour laisser le choix par
 * defaut de l'appareil s'appliquer.
 *
 * SYNCHRONE, sans le moindre `await` : l'appelant est
 * `startIncomingRingtone()` de `call-manager.ts`, qui ne peut pas attendre.
 *
 * REGLE DE DEPART quand plusieurs listes contiennent l'appelant : la premiere
 * creee gagne. C'est le seul ordre que l'utilisateur peut expliquer sans qu'on
 * le lui montre — « la sonnerie de Famille, parce que je l'ai faite avant
 * Astreinte » — la ou un ordre alphabetique ou un tirage par identifiant
 * paraitrait arbitraire. Elle est stable, elle ne bouge pas quand une liste est
 * renommee.
 *
 * Le tri sur `creeLe` est fait ICI, alors que le contrat garantit deja l'ordre du
 * GET. Ce n'est pas de la defiance gratuite : le miroir n'est pas fait que de
 * reponses du GET. La creation ajoute en queue, la modification aussi quand la
 * liste manquait au miroir, et une reponse peut arriver d'un backend deploye en
 * decalage. Se reposer sur la seule promesse du serveur ferait dependre la regle
 * de sonnerie de l'historique local des ecritures.
 *
 * Une liste sans sonnerie ne bloque pas la recherche : elle sert alors juste de
 * regroupement, et c'est la liste suivante qui decide.
 *
 * L'appelant est designe par l'identifiant de son COMPTE (`callerId` de
 * l'evenement `incoming_call`). Un membre entre par son numero compose porte le
 * meme identifiant, resolu par le serveur : les deux facons d'alimenter une
 * liste se comparent donc de la meme maniere. La comparaison ignore la casse,
 * comme celle du serveur sur `memberIds`.
 */
export function sonneriePourAppelant(idAppelant: string): string | null {
  if (!idAppelant) return null
  const cible = idAppelant.toLowerCase()
  for (const liste of miroirCourant().slice().sort(parAnciennete)) {
    if (!liste.sonnerie) continue
    if (liste.membres.some((membre) => membre.id.toLowerCase() === cible)) return liste.sonnerie
  }
  return null
}

/* ------------------------------------------------------- Routes */

/**
 * GET /api/contact-lists — rafraichit le miroir au passage.
 *
 * En cas d'echec on rend le miroir plutot qu'une erreur, comme `fetchContacts()`
 * rend son cache : une panne reseau ne doit pas vider l'ecran des listes, et
 * surtout pas priver les appels entrants de leur sonnerie.
 *
 * Les listes illisibles sont ecartees une a une, la ou la creation echoue en
 * bloc : ici un enregistrement abime ne doit pas emporter les autres.
 */
export async function listerListes(): Promise<ListeContacts[]> {
  try {
    const reponse = await apiRequest<ReponseListes>("/api/contact-lists")
    // `apiRequest` rend la charge analysee telle quelle : un corps 2xx vide donne
    // `undefined`, un corps litteral `null` donne `null`. Le transtypage le masque,
    // et lire `.lists` dessus leverait un TypeError brut a la place d'une erreur que
    // l'interface sait traduire. On garde donc le PORTEUR, pas seulement le champ.
    const charge = estObjet(reponse) ? reponse.lists : null
    const listes = (Array.isArray(charge) ? charge : [])
      .map(depuisServeur)
      .filter((liste): liste is ListeContacts => liste !== null)
    majMiroir(listes)
    return listes.map(copieListe)
  } catch (err) {
    console.warn("[contact-lists] liste indisponible", err)
    return listesEnCache()
  }
}

/**
 * POST /api/contact-lists.
 *
 * Deux facons d'alimenter la liste, cumulables : des contacts choisis dans le
 * repertoire (`identifiants`) et des numeros composes au clavier (`numeros`).
 * Le serveur ecarte en silence les identifiants qui ne sont pas des contacts, et
 * son propre numero s'il figure parmi les numeros composes — un numero ainsi
 * ecarte ne sera donc ni dans `liste.membres` ni dans `numerosInconnus`, puisque
 * le compte existe. La liste rendue est la seule verite sur ce qu'elle contient,
 * et c'est elle qui entre dans le miroir.
 */
export async function creerListe(
  nom: string,
  membres: ChoixMembres = {},
  sonnerie?: string | null,
  couleur?: string | null
): Promise<ResultatEcriture> {
  const { envoyes, rejetes } = preparerNumeros(membres.numeros)

  try {
    const reponse = await apiRequest<ReponseListe>("/api/contact-lists", {
      method: "POST",
      body: {
        name: nom.trim(),
        memberIds: preparerIdentifiants(membres.identifiants),
        memberNumbers: envoyes,
        ringtone: sonnerie ?? null,
        color: couleur ?? null,
      },
    })
    const liste = listeObligatoire(estObjet(reponse) ? reponse.list : null)
    // En queue : la liste qu'on vient de creer est la plus recente, et c'est la
    // date de creation qui arbitre les sonneries.
    majMiroir([...miroirCourant(), liste])
    return {
      liste: copieListe(liste),
      numerosInconnus: [
        ...new Set([...rejetes, ...numerosInconnusDepuisServeur(reponse.unknownNumbers)]),
      ],
    }
  } catch (err) {
    traduireErreur(err)
  }
}

/**
 * PUT /api/contact-lists/{id}.
 *
 * Seuls les champs presents dans le patch sont transmis, et `membres` REMPLACE
 * l'ensemble des membres : passer `undefined` laisse la liste intacte, passer un
 * choix vide la vide. D'ou le test de presence de cle plutot qu'un test de
 * verite, qui confondrait « ne touche pas a la sonnerie » avec « enleve-la ».
 *
 * Quand `membres` est present, les DEUX champs partent, meme vides : l'ensemble
 * resultant est l'union des identifiants et des numeros resolus, et omettre l'un
 * des deux laisserait au serveur le choix entre « vide » et « inchange ».
 */
export async function modifierListe(id: string, patch: PatchListe): Promise<ResultatEcriture> {
  const corps: Record<string, unknown> = {}
  if ("nom" in patch && patch.nom !== undefined) corps.name = patch.nom.trim()
  if ("sonnerie" in patch) corps.ringtone = patch.sonnerie ?? null
  if ("couleur" in patch) corps.color = patch.couleur ?? null

  const { envoyes, rejetes } =
    patch.membres !== undefined
      ? preparerNumeros(patch.membres.numeros)
      : { envoyes: [], rejetes: [] }

  if (patch.membres !== undefined) {
    corps.memberIds = preparerIdentifiants(patch.membres.identifiants)
    corps.memberNumbers = envoyes
  }

  try {
    const reponse = await apiRequest<ReponseListe>(`/api/contact-lists/${id}`, {
      method: "PUT",
      body: corps,
    })
    const liste = listeObligatoire(estObjet(reponse) ? reponse.list : null)
    // Remplacement sur place quand la liste est deja connue : renommer ne doit pas
    // la faire changer de rang. Ajout en queue sinon — un `.map()` seul l'aurait
    // fait disparaitre du miroir, et sur un navigateur fraichement ouvert (miroir
    // encore vide) attribuer une sonnerie puis recevoir un appel aurait joue le son
    // par defaut, precisement ce que le miroir existe pour eviter. Le rang de queue
    // est provisoire : l'arbitrage trie sur `creeLe`, et le prochain GET remet
    // l'ordre du serveur.
    const connues = miroirCourant()
    const dejaLa = connues.some((existante) => existante.id === id)
    majMiroir(
      dejaLa
        ? connues.map((existante) => (existante.id === id ? liste : existante))
        : [...connues, liste]
    )
    return {
      liste: copieListe(liste),
      numerosInconnus: [
        ...new Set([...rejetes, ...numerosInconnusDepuisServeur(reponse.unknownNumbers)]),
      ],
    }
  } catch (err) {
    traduireErreur(err)
  }
}

/** DELETE /api/contact-lists/{id} — reponse sans corps. */
export async function supprimerListe(id: string): Promise<void> {
  await apiRequest<void>(`/api/contact-lists/${id}`, { method: "DELETE" })
  majMiroir(miroirCourant().filter((liste) => liste.id !== id))
}

/* ------------------------------------------------------- Recherche par numero */

/**
 * Le compte que porte un numero compose.
 *
 * Meme forme qu'un membre de liste, et ce n'est pas une coincidence : le serveur
 * rend le MEME objet des deux cotes (`{ id, publicNumber, name, isContact }`),
 * parce que c'est la meme resolution. La meme lecture defensive le relit donc,
 * `membreDepuisServeur`, et un champ ajoute un jour a l'un le sera a l'autre.
 */
export type CompteTrouve = MembreListe

/** Reponse de la recherche, telle qu'elle sort du backend. */
interface ReponseRecherche {
  found: boolean
  /** Absent quand `found` est faux. Relu par `membreDepuisServeur`, d'ou `unknown`. */
  account?: unknown
}

/**
 * GET /api/accounts/lookup?number=... — qui est le titulaire de ce numero.
 *
 * C'est la resolution que `POST /api/contact-lists` fait deja sur
 * `memberNumbers`, mais montree AVANT l'enregistrement : sous les chiffres
 * composes doit se lire le NOM du titulaire, pas un etat technique, et
 * l'utilisateur doit voir qui il ajoute avant de l'ajouter.
 *
 * Rend `null` pour « aucun compte ne porte ce numero », et LEVE quand la
 * recherche elle-meme a echoue. La distinction n'est pas cosmetique, c'est
 * exactement celle que l'appelant affiche : rendre `null` sur une panne reseau
 * ferait ecrire « aucun compte » sous un numero parfaitement valide, c'est-a-dire
 * accuser le numero d'un defaut qui est le notre. Seule une reponse ILLISIBLE
 * rend `null` sans lever — la forme est alors trop douteuse pour qu'on affirme
 * quoi que ce soit, et l'absence de compte est la conclusion prudente.
 *
 * Le numero est normalise puis mesure AVANT tout depart sur le reseau : une
 * saisie en cours ne declenche aucune requete.
 *
 * La mesure se fait par `isValidAlanyaNumber` et NON par `FORME_NUMERO`, bien que
 * les deux disent aujourd'hui la meme chose (trois a dix chiffres). Ce n'est pas
 * indifferent, car ils ne tiennent pas leur autorite du meme endroit :
 *
 *  - `FORME_NUMERO` sert les routes d'ECRITURE, ou il protege d'un defaut precis —
 *    `publicNumberSchema` refuse la REQUETE ENTIERE sur un seul numero mal forme,
 *    donc un membre invalide ferait perdre les membres valides du meme envoi. Son
 *    autorite est le schema du backend ;
 *  - ici la question est autre : ces chiffres valent-ils qu'on interroge le
 *    serveur, ou l'utilisateur tape-t-il encore ? L'autorite est alors ce que
 *    l'interface tient pour un numero complet, et c'est exactement la garde que
 *    `contact-list-modal.tsx` passe juste avant d'appeler ici.
 *
 * Les brancher sur la meme constante serait un piege silencieux : que la borne du
 * front s'elargisse un jour sans celle du backend, et l'ecran demanderait un nom
 * que cette fonction refuserait de chercher, sans requete ni erreur. Il ecrirait
 * alors « aucun compte » sous un numero parfaitement valide — precisement le
 * mensonge que le paragraphe ci-dessus interdit.
 */
export async function rechercherCompte(numero: string): Promise<CompteTrouve | null> {
  const chiffres = normaliserNumero(numero)
  if (!isValidAlanyaNumber(chiffres)) return null

  const reponse = await apiRequest<ReponseRecherche>(
    `/api/accounts/lookup?number=${encodeURIComponent(chiffres)}`
  )

  // Meme prudence qu'au reste du fichier : `apiRequest` rend la charge analysee
  // telle quelle, donc `undefined` sur un corps 2xx vide et `null` sur un corps
  // litteral `null`. Le transtypage le masque, et lire `.found` dessus leverait
  // un TypeError la ou l'appelant n'attend qu'une absence de compte.
  if (!estObjet(reponse)) return null
  if (reponse.found !== true) return null
  // `account` absent ou d'une autre forme malgre `found` : `membreDepuisServeur`
  // rend `null` plutot que de laisser passer un membre sans identifiant.
  return membreDepuisServeur(reponse.account)
}
