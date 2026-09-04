import { publicAsset } from "../lib/asset-url"
import { ApiError, apiRequest } from "../lib/api-client"
import { resolveMediaUrl, uploadMedia } from "./media-service"
import { langueInitiale, traduire, type Cle } from "../i18n"

/**
 * Les trois moments sonores de l'application, nommes par le sens de l'evenement
 * et non par le fichier — c'est le renommage qui avait deja evite de reinverser
 * les sonneries d'appel.
 */
export type RingtoneEvent = "incoming" | "outgoing" | "message"

export interface Ringtone {
  /** Nom du fichier dans public/sounds/. */
  file: string
  /** Libelle affiche a l'utilisateur. */
  label: string
  /** Precision affichee sous le libelle. */
  note?: Cle
}

/**
 * Catalogue des sons disponibles. Les trois premiers sont ceux du mobile, repris
 * a l'octet pres depuis `assets/sounds/` de l'application Flutter : meme
 * empreinte, donc meme son sur les deux plateformes.
 */
export const RINGTONES: Ringtone[] = [
  { file: "incoming_ring.mp3", label: "Sonnerie Alanya", note: "ring_note_mobile" },
  { file: "outgoing_ring.mp3", label: "Tonalite Alanya", note: "ring_note_mobile" },
  { file: "notification.mp3", label: "Notification Alanya", note: "ring_note_mobile" },
  { file: "ringtone.mp3", label: "Sonnerie classique" },
  { file: "message.mp3", label: "Bip message" },

  /*
   * LES QUATRE SONNERIES DES LISTES PAR DEFAUT.
   *
   * ⚠️ LIVREES AVEC LE CLIENT, et non televersees en base pour chaque compte.
   *
   * Le champ `ringtone` d'une liste accepte les deux formes — un nom de fichier
   * livre, ou une URL de media. Les poser en base aurait cree quatre lignes de
   * `userRingtone` PAR UTILISATEUR, plus quatre fichiers dans le stockage, pour
   * un contenu strictement identique chez tout le monde : le meme son duplique
   * autant de fois qu'il y a de comptes.
   *
   * Livrees avec le client, elles pesent 584 Ko une seule fois, sont mises en
   * cache par le navigateur, et n'exigent AUCUNE migration.
   */
  { file: "liste-bureau.mp3", label: "Bureau" },
  { file: "liste-amis.mp3", label: "Amis" },
  { file: "liste-confiance.mp3", label: "Confiance" },
  { file: "liste-famille.mp3", label: "Famille" },
]

/**
 * Choix par defaut, aligne sur le mobile : `ringtone_service.dart` associe
 * `incoming_ring.mp3` a l'appel entrant, `outgoing_ring.mp3` a l'appel sortant
 * et `notification.mp3` a l'arrivee d'un message.
 */
export const RINGTONE_DEFAULTS: Record<RingtoneEvent, string> = {
  incoming: "incoming_ring.mp3",
  outgoing: "outgoing_ring.mp3",
  message: "notification.mp3",
}

/* Des CLES : ce tableau est construit a l'import, un libelle deja traduit y
   resterait fige dans la langue du chargement. */
export const RINGTONE_LABELS: Record<RingtoneEvent, Cle> = {
  incoming: "ring_incoming_call",
  outgoing: "ring_outgoing_call",
  message: "new_message",
}

/**
 * Le choix est une preference d'APPAREIL, pas une donnee de compte : il survit a
 * la deconnexion, comme le theme ou le volume. C'est delibere et ca ne change
 * pas quand le catalogue, lui, passe cote serveur : on peut vouloir une sonnerie
 * discrete au bureau et forte sur son telephone. Ces trois cles restent donc
 * hors de `ACCOUNT_CACHE_KEYS` de `session-reset.ts`.
 */
const STORAGE_KEYS: Record<RingtoneEvent, string> = {
  incoming: "alanya-ringtone-incoming",
  outgoing: "alanya-ringtone-outgoing",
  message: "alanya-ringtone-message",
}

/* ----------------- Sonneries importees par l'utilisateur ----------------- */

/**
 * Une sonnerie importee est designee par l'URL relative du media televerse
 * (`/api/media/{id}`), la ou une sonnerie fournie est designee par son nom de
 * fichier. Les deux espaces de noms ne se croisent pas — un nom de fichier ne
 * commence jamais par une barre oblique — ce qui evite un champ « type » a
 * trainer partout.
 *
 * LE CATALOGUE APPARTIENT AU COMPTE, et il vit desormais cote serveur
 * (`/api/ringtones`). Le FICHIER, lui, suivait deja le compte : `importRingtone()`
 * le televerse par `POST /api/media`. Ce qui manquait, c'etait la LISTE de ce
 * qu'on avait importe. On importait donc une sonnerie sur l'ordinateur, on
 * l'attribuait a la liste « Clients » — qui sonnait bien sur le telephone,
 * puisque la reference part en base avec la liste — mais on ne pouvait pas donner
 * la MEME sonnerie a une seconde liste depuis le telephone : elle n'etait dans
 * aucun menu. Il fallait la reimporter, ce qui posait le meme son en double sur
 * le serveur.
 *
 * Ce qui ne change PAS : le CHOIX de sonnerie pour les trois evenements globaux
 * (`STORAGE_KEYS` plus haut) reste une preference d'appareil. Seul le catalogue
 * devient commun.
 */

/**
 * Miroir local du catalogue du compte.
 *
 * La cle n'est pas versionnee au-dela de `v1` bien que la forme stockee ait
 * gagne deux champs, et c'est voulu : le contenu de la `v1` n'est pas un rebut a
 * ignorer, c'est justement ce qu'il faut faire ADOPTER par le serveur. Une `v2`
 * aurait jete les sonneries deja importees a la mise a jour, et il aurait fallu
 * inscrire la nouvelle cle dans `ACCOUNT_CACHE_KEYS` de `session-reset.ts`, ou
 * `alanya-ringtones-custom-v1` figure deja. On lit donc l'ancienne forme avec
 * indulgence (voir `depuisStockage`).
 */
const CUSTOM_STORAGE_KEY = "alanya-ringtones-custom-v1"

/** Taille maximale d'une sonnerie importee. Les sonneries fournies font 15 Ko a 800 Ko. */
export const MAX_CUSTOM_RINGTONE_BYTES = 5 * 1024 * 1024

export interface CustomRingtone {
  /**
   * URL relative du media televerse. C'est l'identifiant cote APPLICATION : c'est
   * lui qu'on range dans `alanya-ringtone-incoming`, lui qui part dans le champ
   * `ringtone` d'une liste de contacts, lui que compare `isKnownFile()`.
   */
  url: string
  label: string
  /**
   * Identifiant de la LIGNE de catalogue cote serveur, le seul que
   * `DELETE /api/ringtones/{id}` accepte. `null` quand la ligne n'existe pas
   * encore : entree heritee du stockage d'avant le catalogue serveur, ou import
   * dont le televersement a reussi et l'enregistrement echoue. Ces entrees-la
   * sont proposees au serveur au prochain `rafraichirCatalogue()`.
   */
  id: string | null
  /**
   * Date de creation en ISO 8601, rendue par le serveur ; `null` tant qu'aucune
   * ligne n'existe. Ce n'est pas un ornement : c'est le champ qui porte l'ordre
   * d'affichage, et donc la garantie que l'utilisateur retrouve ses sonneries
   * dans le meme ordre d'un appareil a l'autre.
   */
  createdAt: string | null
}

/* -------- Cote serveur */

interface ReponseCatalogue {
  ringtones: unknown
}

interface ReponseSonnerie {
  ringtone: unknown
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null
}

/**
 * Un libelle vide n'est pas un libelle : il rendrait une entree invisible dans le
 * menu des sonneries. Le repli se traduit A LA LECTURE et non a l'import, sinon
 * il resterait fige dans la langue du jour ou le fichier a ete televerse.
 */
function libelleOuRepli(valeur: unknown): string {
  if (typeof valeur === "string" && valeur.trim() !== "") return valeur
  return traduire(langueInitiale(), "set_ringtone_imported")
}

/**
 * Lecture d'une entree rendue par le serveur. Tolerante comme celle des listes de
 * contacts : la reponse traverse un proxy et un deploiement decale, elle n'est pas
 * plus sure que le stockage local. Une entree mal formee est ecartee seule, elle
 * n'emporte pas le reste du catalogue.
 *
 * C'est bien le libelle DU SERVEUR qu'on retient, jamais celui qu'on a envoye :
 * il est coupe a 80 caracteres a l'enregistrement, et deux appareils doivent lire
 * la meme chose.
 */
function depuisServeur(brut: unknown): CustomRingtone | null {
  if (!estObjet(brut)) return null
  if (typeof brut.id !== "string" || brut.id === "") return null
  if (typeof brut.url !== "string" || !isCustomRingtone(brut.url)) return null
  return {
    url: brut.url,
    label: libelleOuRepli(brut.label),
    id: brut.id,
    createdAt: typeof brut.createdAt === "string" ? brut.createdAt : null,
  }
}

/**
 * Lecture NORMALISANTE du miroir, et non un simple predicat comme `estListe()` de
 * `contact-lists-service.ts`. La difference est deliberee : le stockage porte
 * aussi la forme d'AVANT le catalogue serveur, `{ url, label }` sans `id` ni
 * `createdAt`. Un predicat strict l'aurait jetee — c'est-a-dire aurait fait
 * disparaitre, a la mise a jour, les sonneries deja importees. On complete les
 * deux champs manquants par `null`, ce qui range ces entrees exactement avec les
 * imports en attente d'enregistrement : la meme reprise les remonte au serveur.
 */
function depuisStockage(brut: unknown): CustomRingtone | null {
  if (!estObjet(brut)) return null
  if (typeof brut.url !== "string" || !isCustomRingtone(brut.url)) return null
  return {
    url: brut.url,
    label: libelleOuRepli(brut.label),
    id: typeof brut.id === "string" && brut.id !== "" ? brut.id : null,
    createdAt: typeof brut.createdAt === "string" ? brut.createdAt : null,
  }
}

/* -------- Miroir local */

/**
 * A n'appeler QUE depuis l'interieur d'un `try` : sur Firefox avec le stockage
 * bloque par une politique de site, le simple acces a `window.localStorage` leve
 * une `SecurityError`. La garde elle-meme est donc une source d'exception.
 */
function stockageDisponible() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function lireMiroir(): CustomRingtone[] {
  try {
    if (!stockageDisponible()) return []
    const brut = window.localStorage.getItem(CUSTOM_STORAGE_KEY)
    if (!brut) return []
    const analyse = JSON.parse(brut) as unknown
    if (!Array.isArray(analyse)) return []
    return analyse.map(depuisStockage).filter((entree): entree is CustomRingtone => entree !== null)
  } catch {
    // Contenu illisible : un miroir vide, jamais une exception. La panne
    // remonterait sinon jusqu'a la sonnerie d'un appel entrant, qui passe par ici.
    return []
  }
}

function ecrireMiroir(catalogue: CustomRingtone[]) {
  try {
    if (!stockageDisponible()) return
    window.localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(catalogue))
  } catch {
    // Quota, navigation privee ou stockage bloque : le catalogue ne survivra pas a
    // la session, et les sonneries retomberont sur celles par defaut jusqu'au
    // prochain rafraichirCatalogue(). La garde est dans le try, meme raison qu'en
    // lecture.
  }
}

/**
 * Instant de creation en millisecondes. Une entree encore sans ligne serveur — ou
 * portant une date illisible — part en fin de tri : elle vient forcement d'etre
 * importee ici. Rendre `NaN` d'une comparaison rendrait le resultat du tri
 * dependant de l'ordre d'entree, donc instable d'une lecture a l'autre.
 */
function instantCreation(createdAt: string | null): number {
  if (!createdAt) return Number.POSITIVE_INFINITY
  const instant = Date.parse(createdAt)
  return Number.isNaN(instant) ? Number.POSITIVE_INFINITY : instant
}

function parAnciennete(a: CustomRingtone, b: CustomRingtone): number {
  const ia = instantCreation(a.createdAt)
  const ib = instantCreation(b.createdAt)
  if (ia === ib) return 0
  return ia < ib ? -1 : 1
}

/** Remplace l'entree de meme URL, ou l'ajoute. L'URL est la cle cote application. */
function fusionner(catalogue: CustomRingtone[], entree: CustomRingtone): CustomRingtone[] {
  return catalogue.some((connue) => connue.url === entree.url)
    ? catalogue.map((connue) => (connue.url === entree.url ? entree : connue))
    : [...catalogue, entree]
}

/**
 * Le catalogue connu SANS aucun appel reseau, du plus ancien au plus recent.
 *
 * SYNCHRONE, et elle doit le rester : `isKnownFile()`, `ringtoneFile()` et
 * `ringtoneUrl()` l'appellent, et ces trois-la sont sur le trajet d'un appel
 * entrant — `startIncomingRingtone()` de `call-manager.ts` ne peut pas attendre
 * une requete sans laisser le premier cycle de sonnerie muet, ou sans jouer le son
 * par defaut puis en changer en cours de route. D'ou le miroir : le reseau
 * rafraichit, la lecture ne l'attend jamais.
 *
 * Le miroir est RELU AU STOCKAGE a chaque acces, sans copie retenue en variable de
 * module. Ce n'est pas un detail de style. Une variable de module a deja rouvert
 * une fuite entre comptes dans ce depot : l'application est une page unique qui ne
 * se recharge PAS a la deconnexion, donc `purgeLocalAccountData()` efface bien la
 * cle du stockage mais ne peut rien contre une variable restee vivante. Le compte
 * suivant aurait vu, dans le meme onglet, les sonneries du precedent — et les
 * ecouter serait alle chercher les medias d'un autre. Relire est aussi la
 * convention du depot : `listesEnCache()` de `contact-lists-service.ts` et
 * `loadContacts()` de `data/contacts.ts` font de meme.
 *
 * Le tri est refait ICI alors que le contrat garantit deja l'ordre du GET : le
 * miroir n'est pas fait que de reponses du GET. Un import s'y ajoute en queue, un
 * enregistrement differe aussi. Se reposer sur la seule promesse du serveur ferait
 * dependre l'ordre affiche de l'historique local des ecritures.
 *
 * Le tableau rendu est FRAIS a chaque appel — il sort d'un `JSON.parse` — donc un
 * appelant qui le trie ou le mute ne peut rien deranger.
 */
export function customRingtones(): CustomRingtone[] {
  return lireMiroir().sort(parAnciennete)
}

/** Vrai si l'identifiant designe une sonnerie importee et non un fichier fourni. */
export function isCustomRingtone(id: string): boolean {
  return id.startsWith("/")
}

/* -------- Routes */

/**
 * POST /api/ringtones — declare au compte un media deja televerse.
 *
 * Idempotent sur (compte, url) : reimporter le meme media ne cree pas de doublon,
 * le serveur met le libelle a jour et rend la ligne existante. C'est ce qui permet
 * de rejouer un enregistrement sans precaution particuliere apres un echec.
 */
async function enregistrerAuCatalogue(url: string, label: string): Promise<CustomRingtone> {
  const reponse = await apiRequest<ReponseSonnerie>("/api/ringtones", {
    method: "POST",
    body: { url, label },
  })
  // `apiRequest` rend la charge analysee telle quelle : un corps 2xx vide donne
  // `undefined`. On garde donc le PORTEUR, pas seulement le champ — lire
  // `.ringtone` dessus leverait un TypeError brut.
  const enregistree = depuisServeur(estObjet(reponse) ? reponse.ringtone : null)
  if (!enregistree) throw new Error("catalogue de sonneries : reponse illisible")
  return enregistree
}

/**
 * GET /api/ringtones — rafraichit le miroir au passage et rend le catalogue trie.
 *
 * EN CAS D'ECHEC on garde le miroir et on rend ce qu'on avait, comme
 * `listerListes()` de `contact-lists-service.ts` rend son cache. Perdre son
 * catalogue — donc le son choisi pour les appels entrants — parce que le reseau
 * manque serait pire que le defaut qu'on corrige.
 *
 * Quand le GET aboutit, le serveur FAIT AUTORITE : une sonnerie supprimee depuis
 * un autre appareil disparait d'ici. Une seule exception, les entrees encore sans
 * `id` — elles n'ont jamais eu de ligne, ce sont des imports en attente : on les
 * propose au serveur avant de reecrire le miroir, et on les garde en attente si
 * cela echoue encore. Une entree qui a un `id` et qui manque au GET, elle, a bien
 * ete supprimee ailleurs et ne revient pas.
 */
export async function rafraichirCatalogue(): Promise<CustomRingtone[]> {
  // Photographie du miroir AVANT le premier aller-retour. Elle sert a distinguer,
  // au moment d'ecrire, ce que l'utilisateur a change pendant que la requete
  // volait de ce que le serveur nous apprend. Sans elle, la reponse ecrasait tout :
  // une sonnerie supprimee entre-temps ressuscitait, une sonnerie importee
  // entre-temps disparaissait — et si c'etait celle qui venait d'etre choisie pour
  // l'appel entrant, isKnownFile() la refusait et le choix retombait en silence sur
  // le son par defaut.
  const avant = new Set(lireMiroir().map((entree) => entree.url))
  try {
    const reponse = await apiRequest<ReponseCatalogue>("/api/ringtones")
    const charge = estObjet(reponse) ? reponse.ringtones : null
    const distantes = (Array.isArray(charge) ? charge : [])
      .map(depuisServeur)
      .filter((entree): entree is CustomRingtone => entree !== null)

    let catalogue = distantes
    for (const enAttente of lireMiroir()) {
      if (enAttente.id !== null) continue
      if (distantes.some((distante) => distante.url === enAttente.url)) continue
      try {
        const adoptee = await enregistrerAuCatalogue(enAttente.url, enAttente.label)
        catalogue = fusionner(catalogue, adoptee)
      } catch (err) {
        // Rattrapage non critique : l'entree reste en attente et sera reproposee au
        // prochain passage. La jeter ferait perdre une sonnerie dont le fichier,
        // lui, est bel et bien sur le compte.
        console.warn("[ringtones] enregistrement differe impossible", err)
        catalogue = fusionner(catalogue, enAttente)
      }
    }

    // Reconciliation avec ce que le miroir est devenu PENDANT le vol.
    const apres = lireMiroir()
    const urlsApres = new Set(apres.map((entree) => entree.url))

    // Retiree ici pendant la requete : elle etait la avant, elle n'y est plus. Le
    // serveur peut encore la rendre — sa reponse a ete emise avant le DELETE — mais
    // c'est le geste de l'utilisateur qui fait foi, pas une reponse perimee.
    const reconcilie = catalogue.filter(
      (entree) => !(avant.has(entree.url) && !urlsApres.has(entree.url))
    )

    // Arrivee ici pendant la requete : absente de la photographie, presente
    // maintenant. La reponse ne pouvait pas la connaitre ; la jeter perdrait un
    // import tout juste termine.
    let fusion = reconcilie
    for (const entree of apres) {
      if (avant.has(entree.url)) continue
      if (fusion.some((connue) => connue.url === entree.url)) continue
      fusion = fusionner(fusion, entree)
    }

    const trie = fusion.sort(parAnciennete)
    ecrireMiroir(trie)
    return trie
  } catch (err) {
    console.warn("[ringtones] catalogue indisponible", err)
    return customRingtones()
  }
}

/**
 * Televerse un fichier audio, puis l'enregistre au catalogue du compte. Le
 * televersement passe par `POST /api/media`, l'endpoint des medias de discussion
 * deja utilise pour les messages vocaux ; seule la declaration au catalogue est
 * propre aux sonneries.
 */
export async function importRingtone(file: File): Promise<CustomRingtone> {
  if (!file.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(file.name)) {
    throw new Error(traduire(langueInitiale(), "ring_not_a_sound"))
  }
  if (file.size > MAX_CUSTOM_RINGTONE_BYTES) {
    throw new Error(
      traduire(langueInitiale(), "v2_ringtone_too_heavy", {
        taille: (file.size / 1024 / 1024).toFixed(1),
        maximum: MAX_CUSTOM_RINGTONE_BYTES / 1024 / 1024,
      })
    )
  }

  const media = await uploadMedia(file, file.name)
  /*
   * Le nom du fichier sans son extension : c'est ce que l'utilisateur reconnait.
   * Il part ENTIER, la coupe a 80 caracteres appartient au serveur — lui seul sait
   * la faire sur les points de code, et c'est sa valeur relue qui fera foi.
   *
   * Le repli n'est pas cosmetique : un libelle vide se ferait probablement refuser
   * par le schema d'ecriture, et perdrait l'import pour un fichier mal nomme.
   */
  const label =
    file.name.replace(/\.[^.]+$/, "").trim() ||
    file.name.trim() ||
    traduire(langueInitiale(), "set_ringtone_imported")

  /*
   * DEUX ECRITURES pour un seul import : le media, puis la ligne de catalogue.
   *
   * Quand la PREMIERE reussit et la SECONDE echoue — reseau coupe entre les deux,
   * 500 du serveur — on ne leve pas et on ne perd rien. Le fichier est bel et bien
   * sur le compte, la sonnerie est utilisable tout de suite sur cet appareil, et
   * echouer ici la rendrait inutilisable alors que l'octet est deja passe. L'entree
   * entre donc au miroir SANS `id`, exactement comme une entree heritee, et le
   * prochain `rafraichirCatalogue()` la proposera au serveur. Le POST etant
   * idempotent sur (compte, url), ce rattrapage ne peut pas creer de doublon.
   *
   * Ce qui est degrade jusque-la, et qu'il faut assumer : la sonnerie n'est pas
   * encore visible depuis les autres appareils du compte, et
   * `removeCustomRingtone()` ne fera que la retirer d'ici, faute d'`id` a
   * supprimer cote serveur — le media, lui, restera televerse.
   */
  let entree: CustomRingtone = { url: media.url, label, id: null, createdAt: null }
  try {
    entree = await enregistrerAuCatalogue(media.url, label)
  } catch (err) {
    console.warn("[ringtones] media televerse, catalogue indisponible", err)
  }

  ecrireMiroir(fusionner(lireMiroir(), entree).sort(parAnciennete))
  return entree
}

/**
 * Retire une sonnerie du catalogue DU COMPTE, puis du miroir, et rend leur son par
 * defaut aux evenements qui l'utilisaient — sinon ils deviendraient muets.
 *
 * ASYNCHRONE depuis que le catalogue vit cote serveur, et l'ordre compte : si le
 * serveur refuse, on LEVE sans toucher au miroir. L'inverse afficherait une
 * suppression qui n'a pas eu lieu, et le prochain `rafraichirCatalogue()` ferait
 * reapparaitre la sonnerie sans explication.
 *
 * Une entree sans `id` n'a pas de ligne cote serveur : il n'y a rien a y
 * supprimer, on se contente du miroir.
 */
export async function removeCustomRingtone(url: string): Promise<void> {
  const entree = lireMiroir().find((connue) => connue.url === url)
  if (entree?.id) {
    try {
      await apiRequest<void>(`/api/ringtones/${encodeURIComponent(entree.id)}`, {
        method: "DELETE",
      })
    } catch (err) {
      // Un 404 n'est pas un echec : il dit que la ligne n'est plus la, ce qui est
      // precisement le resultat demande. Le cas arrive des qu'on supprime la meme
      // sonnerie depuis deux appareils, ou depuis un ecran ouvert avant l'autre
      // suppression. Le traiter comme une panne rendait la sonnerie INEXTRICABLE :
      // le retrait local n'avait jamais lieu, chaque nouvel essai redonnait la
      // meme erreur, et il fallait quitter puis rouvrir la section pour qu'un
      // rafraichissement la fasse disparaitre.
      if (!(err instanceof ApiError && err.status === 404)) throw err
    }
  }

  // Releve AVANT l'ecriture du miroir. Une fois la sonnerie retiree du catalogue,
  // `ringtoneFile()` rend deja le son par defaut : la comparaison ne trouverait
  // plus rien a corriger et la cle de l'appareil resterait sur une URL morte,
  // reprise telle quelle si un media du meme identifiant reapparaissait.
  const aRabattre = (Object.keys(STORAGE_KEYS) as RingtoneEvent[]).filter(
    (event) => ringtoneFile(event) === url
  )

  ecrireMiroir(lireMiroir().filter((connue) => connue.url !== url))

  for (const event of aRabattre) setRingtone(event, RINGTONE_DEFAULTS[event])
}

function isKnownFile(file: string | null): file is string {
  if (!file) return false
  if (isCustomRingtone(file)) return customRingtones().some((entree) => entree.url === file)
  return RINGTONES.some((ringtone) => ringtone.file === file)
}

/** Fichier choisi pour cet evenement, ou celui du mobile a defaut. */
export function ringtoneFile(event: RingtoneEvent): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS[event])
    // Un fichier retire du catalogue ne doit pas rendre l'application muette.
    if (isKnownFile(stored)) return stored
  } catch {
    // stockage indisponible : on retombe sur le defaut
  }
  return RINGTONE_DEFAULTS[event]
}

export function setRingtone(event: RingtoneEvent, file: string) {
  if (!isKnownFile(file)) return
  try {
    localStorage.setItem(STORAGE_KEYS[event], file)
  } catch {
    // stockage indisponible : le choix ne survivra pas a la session
  }
}

/**
 * URL jouable d'un son, quelle que soit son origine : un fichier fourni est
 * prefixe par le chemin de base du deploiement, une sonnerie importee passe par
 * le resolveur de medias, qui y ajoute le jeton de session.
 */
export function ringtoneSource(id: string): string {
  return isCustomRingtone(id) ? resolveMediaUrl(id) : publicAsset(`sounds/${id}`)
}

/** URL jouable du son choisi pour cet evenement. */
export function ringtoneUrl(event: RingtoneEvent): string {
  return ringtoneSource(ringtoneFile(event))
}

let previewAudio: HTMLAudioElement | null = null

/**
 * Ecoute d'un son depuis les reglages. Un seul extrait a la fois, et borne a
 * quelques secondes : les sonneries d'appel durent une trentaine de secondes,
 * les laisser aller au bout serait penible.
 */
export function previewRingtone(file: string, seconds = 4) {
  stopRingtonePreview()
  const audio = new Audio(ringtoneSource(file))
  previewAudio = audio
  window.setTimeout(() => {
    if (previewAudio === audio) stopRingtonePreview()
  }, seconds * 1000)
  return audio.play()
}

export function stopRingtonePreview() {
  if (!previewAudio) return
  previewAudio.pause()
  previewAudio.currentTime = 0
  previewAudio = null
}
