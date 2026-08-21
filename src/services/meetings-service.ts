import { ApiError, apiRequest } from "../lib/api-client"
import { resolveMediaUrl } from "./media-service"
import { langueInitiale, traduire, type Cle } from "../i18n"

/**
 * Reunions audio/video.
 *
 * Le backend parle son vocabulaire de base de donnees — `idMeeting`,
 * `IDparticipant`, `type_media`, `isEnd`, `status` numerique. Ce module le
 * traduit une fois pour toutes en un modele lisible, et les ecrans ne voient
 * plus que celui-la.
 *
 * Ce n'est pas une coquetterie : le front lisait auparavant `meeting.id` et
 * `participant.userId`, deux champs que le serveur n'envoie pas. La liste
 * s'affichait donc, mais chaque reunion menait a /meetings/undefined et les
 * participants apparaissaient sans nom. Un modele explicite rend ce genre
 * d'ecart impossible a ignorer : il se voit a la compilation.
 */

/** 0 = invite, 1 = accepte, 2 = decline. */
export type StatutParticipant = "invite" | "accepte" | "decline"

export interface Personne {
  id: string
  nom: string
  numero: string
  avatarUrl: string | null
}

export interface ParticipantReunion extends Personne {
  statut: StatutParticipant
  /** Present dans la salle a l'instant. */
  connecte: boolean
  /** Arrivee dans la salle, si la personne y est deja entree. */
  entreeA: string | null
  /** Temps passe dans la salle, en secondes. */
  dureeSecondes: number | null
}

/**
 * Combien de personnes tiennent encore dans CETTE reunion.
 *
 * Trois nombres qui viennent tous du serveur, et qu'on ne recalcule pas : le
 * plafond depend de l'entreprise de l'ORGANISATEUR (pas de celui qui regarde),
 * et « qui occupe une place » est une regle serveur — l'organisateur compte
 * meme s'il n'est pas entre, celui qui a decline ne compte plus. Deux facons de
 * compter finiraient par donner deux chiffres, et l'un des deux serait faux.
 *
 * ⚠️ Nul tant que la route de detail ne porte pas ces champs : l'ecran n'affiche
 * alors AUCUN compteur plutot qu'un compteur invente. Voir `capaciteBrute`.
 */
export interface CapaciteReunion {
  /** Nombre maximum de personnes, organisateur compris. */
  plafond: number
  /** Places deja tenues, organisateur compris. */
  occupants: number
  /** Places encore libres. Jamais negatif. */
  restantes: number
}

export interface Reunion {
  id: number
  objet: string
  type: "audio" | "video"
  /** Identifiant de salle cote serveur, porte par l'appel. */
  salle: string | null
  terminee: boolean
  invitationAuto: boolean
  /** Debut prevu. */
  debut: string | null
  /** Duree prevue, en secondes. */
  dureeSecondes: number
  organisateur: Personne
  participants: ParticipantReunion[]
  /** Vrai si le compte courant a cree la reunion : lui seul peut la terminer. */
  jeSuisOrganisateur: boolean
  /** Places, telles que le serveur les compte. Nul s'il ne les envoie pas. */
  capacite: CapaciteReunion | null
}

/* ----------------- Traduction du vocabulaire serveur ----------------- */

interface PersonneBrute {
  id?: string
  IDparticipant?: string
  pseudo?: string
  publicNumber?: string
  avatarUrl?: string | null
  status?: number
  connecte?: number
  start_time?: string | null
  duree?: number | null
}

interface ReunionBrute {
  idMeeting: number
  objet: string
  type_media: number
  room?: string | null
  isEnd?: number
  invitationAuto?: boolean
  start_time?: string | null
  duree?: number
  organiser?: PersonneBrute
  participants?: PersonneBrute[]
  isOrganiser?: boolean
  /* Places — voir `capaciteBrute`. Facultatifs : le serveur ne les envoie pas
     encore, et l'ecran doit survivre a leur absence. */
  plafond?: number
  occupants?: number
  restantes?: number
}

/**
 * Lit les trois nombres de capacite, ou rend nul.
 *
 * TOUT OU RIEN, et volontairement : un plafond sans le nombre d'occupants ne
 * permet d'afficher aucun compteur honnete, et completer le manquant reviendrait
 * a recompter cote client la regle que le serveur porte. Mieux vaut ne rien
 * montrer que montrer un chiffre a soi.
 */
function capaciteBrute(brut: ReunionBrute): CapaciteReunion | null {
  const { plafond, occupants } = brut
  if (typeof plafond !== "number" || typeof occupants !== "number") return null
  return {
    plafond,
    occupants,
    // `restantes` est calcule par le serveur ; le repli n'est qu'une soustraction
    // sur SES deux nombres, pas une regle reinventee.
    restantes:
      typeof brut.restantes === "number" ? brut.restantes : Math.max(0, plafond - occupants),
  }
}

const STATUTS: Record<number, StatutParticipant> = { 0: "invite", 1: "accepte", 2: "decline" }

function versPersonne(brut: PersonneBrute | undefined): Personne {
  return {
    id: brut?.id ?? brut?.IDparticipant ?? "",
    nom: brut?.pseudo ?? brut?.publicNumber ?? "",
    numero: brut?.publicNumber ?? "",
    avatarUrl: brut?.avatarUrl ? resolveMediaUrl(brut.avatarUrl) : null,
  }
}

function versParticipant(brut: PersonneBrute): ParticipantReunion {
  return {
    ...versPersonne(brut),
    statut: STATUTS[brut.status ?? 0] ?? "invite",
    connecte: brut.connecte === 1,
    entreeA: brut.start_time ?? null,
    dureeSecondes: brut.duree ?? null,
  }
}

function versReunion(brut: ReunionBrute, monId?: string): Reunion {
  const organisateur = versPersonne(brut.organiser)
  return {
    id: brut.idMeeting,
    objet: brut.objet,
    // Le serveur code 1 pour l'audio et 2 pour la video.
    type: brut.type_media === 2 ? "video" : "audio",
    salle: brut.room ?? null,
    terminee: brut.isEnd === 1,
    invitationAuto: brut.invitationAuto === true,
    debut: brut.start_time ?? null,
    dureeSecondes: brut.duree ?? 3600,
    organisateur,
    participants: (brut.participants ?? []).map(versParticipant),
    // La liste ne porte pas isOrganiser : on le deduit alors de l'organisateur.
    jeSuisOrganisateur: brut.isOrganiser ?? (monId ? organisateur.id === monId : false),
    capacite: capaciteBrute(brut),
  }
}

/* ----------------- Lecture ----------------- */

/** GET /api/meetings — reunions organisees par le compte ou auxquelles il est convie. */
export async function fetchMeetings(monId?: string): Promise<Reunion[]> {
  const res = await apiRequest<{ meetings?: ReunionBrute[] }>("/api/meetings")
  return (res.meetings ?? []).map((m) => versReunion(m, monId))
}

/** GET /api/meetings/:id — detail, avec la liste complete des participants. */
export async function fetchMeeting(id: number): Promise<Reunion> {
  const res = await apiRequest<ReunionBrute>(`/api/meetings/${id}`)
  return versReunion(res)
}

/* ----------------- Plafond de participants ----------------- */

/**
 * LE PLAFOND N'EST PAS ECRIT ICI, ET NE DOIT JAMAIS L'ETRE.
 *
 * Six en video, neuf en audio : ces chiffres appartiennent au serveur, qui les
 * resout entreprise par entreprise et que le superuser peut deplacer. Les
 * recopier dans le web donnerait deux sources de verite, et la seconde
 * mentirait des la premiere modification — en affichant « 3 places restantes »
 * dans une salle deja pleine, ou l'inverse.
 *
 * Le web ne fait donc que deux choses :
 *   - il DEMANDE les plafonds pour les montrer AVANT le refus ;
 *   - il RELIT les nombres que le serveur met dans son refus pour l'expliquer.
 *
 * Ni l'un ni l'autre ne suppose de valeur. Quand le serveur ne repond pas, il
 * n'y a pas de compteur : une absence se remarque, un chiffre faux non.
 */

/**
 * Le code que le serveur pose sur TOUS ses refus de plafond — creation, ajout,
 * demande d'invitation, entree dans la salle. C'est un mot de PROTOCOLE, pas
 * une regle : le recopier ici ne duplique aucune decision.
 */
export const CODE_SALLE_PLEINE = "MEETING_FULL"

/** Les deux plafonds applicables au compte courant, organisateur compris. */
export interface PlafondsReunion {
  audio: number
  video: number
}

/**
 * GET /api/meetings/limits — les plafonds qui s'appliqueront a une reunion que
 * JE cree (mon entreprise, sinon le reglage global, sinon les defauts).
 *
 * ⚠️ Sert la PREVENTION, jamais la decision : le serveur reste seul juge au
 * moment de la creation. Deux raisons, et la seconde suffit — le reglage peut
 * changer entre l'ouverture du formulaire et l'envoi, et un client n'est jamais
 * une barriere.
 *
 * REND NUL PLUTOT QUE DE DEVINER. Route absente (le serveur ne l'expose pas
 * encore), reseau coupe, reponse illisible : l'ecran se prive de son compteur
 * et laisse le serveur refuser s'il doit refuser. Poser 6 et 9 en repli serait
 * exactement la duplication qu'on evite : les defauts du code ne sont PAS les
 * plafonds d'une entreprise qui les a releves.
 */
export async function chargerPlafondsReunion(): Promise<PlafondsReunion | null> {
  try {
    const res = await apiRequest<{
      audio?: number
      video?: number
      // `effectif` est le mot qu'emploie deja l'administration des plafonds
      // pour « le plafond reellement applique » : on l'accepte tel quel plutot
      // que d'imposer une forme de plus.
      effectif?: { audio?: number; video?: number }
    }>("/api/meetings/limits")
    const audio = res.audio ?? res.effectif?.audio
    const video = res.video ?? res.effectif?.video
    if (typeof audio !== "number" || typeof video !== "number") return null
    return { audio, video }
  } catch {
    return null
  }
}

/** Places encore libres, `occupants` comptant l'organisateur (convention serveur). */
export function placesRestantes(plafond: number, occupants: number): number {
  return Math.max(0, plafond - occupants)
}

/** Ce que le serveur dit quand il refuse : les nombres, pas sa phrase. */
export interface RefusPlafond {
  /** Type de la reunion visee, deduit du `typeMedia` du serveur. */
  type: "audio" | "video"
  plafond: number
  /** Places deja tenues au moment du refus. */
  actuel: number
  /** Places demandees par le geste refuse. */
  demandes: number
  restantes: number
}

/**
 * Reconnait un refus de plafond parmi les autres erreurs, et en tire les
 * nombres.
 *
 * POURQUOI NE PAS AFFICHER LA PHRASE DU SERVEUR. Elle existe — `error.message`,
 * en francais, avec les bons chiffres — et l'`ApiError` la porte deja. Mais
 * cette application parle neuf langues : un utilisateur norvegien verrait
 * surgir une phrase francaise au milieu de son ecran. Les nombres, eux, ne se
 * traduisent pas ; on refait donc la phrase par-dessus.
 *
 * Rend nul pour toute autre erreur — y compris un 409 d'une autre nature — pour
 * que l'appelant retombe sur son traitement d'erreur habituel.
 */
export function lireRefusPlafond(erreur: unknown): RefusPlafond | null {
  if (!(erreur instanceof ApiError)) return null
  const enveloppe = erreur.payload as { error?: Record<string, unknown> } | undefined
  const corps = enveloppe?.error
  if (!corps || corps.code !== CODE_SALLE_PLEINE) return null

  const nombre = (valeur: unknown, defaut: number) =>
    typeof valeur === "number" && Number.isFinite(valeur) ? valeur : defaut

  const plafond = nombre(corps.plafond, 0)
  const actuel = nombre(corps.actuel, 0)
  return {
    // 2 = video cote serveur. Tout le reste est traite comme de l'audio, comme
    // le fait le serveur lui-meme.
    type: corps.typeMedia === 2 ? "video" : "audio",
    plafond,
    actuel,
    demandes: nombre(corps.demandes, 1),
    restantes: nombre(corps.restantes, placesRestantes(plafond, actuel)),
  }
}

/**
 * Le refus, EN MOTS, dans la langue de celui qui le lit.
 *
 * Deux phrases et pas une seule, parce qu'un refus qui n'ouvre aucune porte
 * n'aide personne : la premiere dit CE QUI est refuse et avec quels chiffres, la
 * seconde dit QUOI FAIRE.
 *
 * LE CONSEIL EST CHOISI SUR DES NOMBRES DU SERVEUR, jamais sur une intuition.
 * On ne propose l'audio que si l'on sait qu'il accueille davantage : un
 * exploitant peut avoir releve le plafond video au-dessus du plafond audio, et
 * « passez en audio » serait alors un mauvais conseil. Sans plafonds connus, on
 * garde le conseil general — vrai par construction, l'audio coutant environ dix
 * fois moins qu'une image — mais sans avancer de chiffre.
 */
export function refusPlafondEnMots(args: {
  refus: RefusPlafond
  /** Plafonds connus, s'ils ont pu etre demandes. */
  plafonds: PlafondsReunion | null
  /** Vrai si le refus est tombe A LA CREATION, ou aucune reunion n'existe encore. */
  creation?: boolean
  t: (cle: Cle, variables?: Record<string, string | number>) => string
}): { titre: string; texte: string } {
  const { refus, plafonds, creation, t } = args
  const video = refus.type === "video"

  const fait = creation
    ? t(video ? "meet_cap_create_video" : "meet_cap_create_audio", {
        plafond: refus.plafond,
        demandes: refus.demandes,
      })
    : t(video ? "meet_cap_full_video" : "meet_cap_full_audio", {
        plafond: refus.plafond,
        actuel: refus.actuel,
      })

  // L'audio est-il vraiment la sortie ? Inconnu = on le suppose sans chiffrer.
  const audioPlusGrand = plafonds ? plafonds.audio > refus.plafond : true
  const conseil: string[] =
    video && audioPlusGrand
      ? plafonds
        ? [t("meet_cap_advice_audio"), t("meet_cap_audio_max", { audio: plafonds.audio })]
        : [t("meet_cap_advice_audio")]
      : [t("meet_cap_advice_wait")]

  return { titre: t("meet_cap_full_title"), texte: enchainer([fait, ...conseil]) }
}

/**
 * Enchaine des phrases deja traduites.
 *
 * Le chinois ponctue avec des signes PLEINE CHASSE — « 。 », « ！ » — qui
 * portent deja leur propre blanc : y ajouter une espace ouvre un trou visible au
 * milieu du texte. Les alphabets latin et cyrillique, eux, l'exigent. Une simple
 * jointure par `" "` etait donc juste dans huit langues sur neuf.
 */
function enchainer(phrases: string[]): string {
  return phrases.reduce((accumule, phrase) => {
    if (!accumule) return phrase
    return `${accumule}${/[。！？]$/.test(accumule) ? "" : " "}${phrase}`
  }, "")
}

/* ----------------- Ecriture ----------------- */

export interface NouvelleReunion {
  objet: string
  type: "audio" | "video"
  /**
   * Duree prevue, en secondes. Absente, le serveur pose la sienne : mieux vaut
   * le laisser decider que d'inventer un chiffre a sa place.
   */
  dureeSecondes?: number
  /** Numeros Alanya des invites. Le serveur refuse la creation si l'un est inconnu. */
  numerosInvites?: string[]
  /** Debut prevu, au format ISO. Le serveur prend l'instant present s'il manque. */
  debut?: string
}

/** POST /api/meetings — cree la reunion et invite les participants. */
export async function createMeeting(donnees: NouvelleReunion): Promise<number> {
  const res = await apiRequest<{ idMeeting?: number; id?: number }>("/api/meetings", {
    method: "POST",
    body: {
      objet: donnees.objet,
      type_media: donnees.type === "video" ? 2 : 1,
      ...(donnees.dureeSecondes ? { duree: donnees.dureeSecondes } : {}),
      ...(donnees.debut ? { start_time: donnees.debut } : {}),
      ...(donnees.numerosInvites?.length ? { participantNumbers: donnees.numerosInvites } : {}),
    },
  })
  const id = res.idMeeting ?? res.id
  if (!id) throw new Error(traduire(langueInitiale(), "v2_meeting_no_id"))
  return id
}

/**
 * POST /api/meetings/:id/participants — convie d'autres personnes en cours de route.
 *
 * Reserve a l'organisateur cote serveur ; l'ecran ne propose donc le bouton
 * qu'a lui, plutot que de laisser les autres decouvrir un refus.
 */
export async function inviterAReunion(id: number, numeros: string[]): Promise<void> {
  await apiRequest(`/api/meetings/${id}/participants`, {
    method: "POST",
    // `publicNumbers` et non `participantNumbers` : c'est le nom que porte le
    // schema de validation du serveur. L'autre nom faisait rejeter le corps
    // AVANT toute lecture, donc echouer TOUTE invitation par numero — pas
    // seulement celle d'un exclu qu'on voulait rappeler, cas ou le defaut a fini
    // par se voir parce qu'on y insiste.
    body: { publicNumbers: numeros },
  })
}

/* ----------------- Demandes d'invitation ----------------- */

export interface DemandeInvitation {
  id: number
  /** Qui demande. */
  demandeur: Personne
  /** Qui l'on souhaite convier. */
  invite: Personne
  demandeeA: string | null
}

/**
 * Qui peut convier quelqu'un, et a quelle condition.
 *
 * L'organisateur ajoute DIRECTEMENT — le serveur refuse meme qu'il passe par
 * une demande, puisqu'il serait le sien propre destinataire. Un participant,
 * lui, ne peut que demander : c'est l'organisateur qui tranche. La reunion
 * reste ainsi celle de qui l'a convoquee, sans que personne n'y fasse entrer
 * qui il veut.
 */

/** GET — la file des demandes en attente. Organisateur seul. */
export async function listerDemandesInvitation(id: number): Promise<DemandeInvitation[]> {
  const res = await apiRequest<{ demandes?: Array<Record<string, unknown>> }>(
    `/api/meetings/${id}/invite-requests`
  )
  return (res.demandes ?? []).map((d) => ({
    id: Number(d.id),
    demandeur: versPersonne(d.demandeur as PersonneBrute),
    invite: versPersonne(d.invite as PersonneBrute),
    demandeeA: (d.createdAt as string) ?? null,
  }))
}

/** POST — demande que ce numero soit convie. Reserve aux participants. */
export async function demanderInvitation(id: number, numero: string): Promise<void> {
  await apiRequest(`/api/meetings/${id}/invite-requests`, {
    method: "POST",
    body: { publicNumber: numero },
  })
}

/** PATCH — l'organisateur accepte ou refuse une demande. */
export async function trancherDemandeInvitation(
  id: number,
  demandeId: number,
  accepter: boolean
): Promise<void> {
  await apiRequest(`/api/meetings/${id}/invite-requests/${demandeId}`, {
    method: "PATCH",
    body: { accepter },
  })
}

/**
 * DELETE /api/meetings/:id/participants — exclut quelqu'un de la reunion.
 *
 * Organisateur seul, et jamais lui-meme : la reunion se retrouverait sans
 * personne pour la fermer. L'exclusion efface la ligne plutot que de la passer
 * a « decline », faute de quoi l'exclu rentrerait par la porte du join.
 *
 * Le flux de l'exclu n'est pas coupe dans l'instant : l'API et le serveur temps
 * reel sont deux process distincts. Il reste jusqu'a ce qu'il parte ou que la
 * reunion se termine.
 */
export async function exclureDeReunion(id: number, participantId: string): Promise<void> {
  await apiRequest(`/api/meetings/${id}/participants`, {
    method: "DELETE",
    body: { participantId },
  })
}

/** POST /api/meetings/:id/join — entre dans la salle (status accepte, connecte). */
export async function joinMeeting(id: number): Promise<void> {
  await apiRequest(`/api/meetings/${id}/join`, { method: "POST", body: {} })
}

/** POST /api/meetings/:id/leave — quitte la salle sans la fermer. */
export async function leaveMeeting(id: number): Promise<void> {
  await apiRequest(`/api/meetings/${id}/leave`, { method: "POST", body: {} })
}

/**
 * La MEME sortie, mais pendant le DECHARGEMENT de la page.
 *
 * Fermeture de l'onglet, rechargement, saut vers un autre site : le navigateur
 * annule les requetes en vol du document qui disparait. Un `leaveMeeting()`
 * ordinaire lance a cet instant ne part donc jamais — le participant reste
 * « connecte » pour les autres et sa duree de presence n'est jamais close en
 * base.
 *
 * `keepalive` est la seule reponse : le navigateur prend la requete a sa charge
 * et la mene a son terme sans le document. `navigator.sendBeacon` survit lui
 * aussi, mais ne sait poser AUCUN en-tete : la route exige
 * `Authorization: Bearer`, une balise partirait anonyme et se ferait refuser en
 * 401. Passer le jeton dans l'adresse serait pire — il finirait dans les
 * journaux du serveur.
 *
 * Aucune promesse rendue : plus personne ne sera la pour l'attendre. L'echec
 * eventuel est avale ici meme, faute de quoi il remonterait en rejet non traite
 * pendant le dechargement.
 */
export function leaveMeetingAuDechargement(id: number): void {
  void apiRequest(`/api/meetings/${id}/leave`, {
    method: "POST",
    body: {},
    keepalive: true,
  }).catch(() => undefined)
}

/** POST /api/meetings/:id/decline — refuse l'invitation. */
export async function declineMeeting(id: number): Promise<void> {
  await apiRequest(`/api/meetings/${id}/decline`, { method: "POST", body: {} })
}

/** POST /api/meetings/:id/end — ferme la reunion pour tout le monde. Organisateur seul. */
export async function endMeeting(id: number): Promise<void> {
  await apiRequest(`/api/meetings/${id}/end`, { method: "POST", body: {} })
}

/** DELETE /api/meetings/:id/delete — efface la reunion terminee. */
export async function deleteMeeting(id: number): Promise<void> {
  await apiRequest(`/api/meetings/${id}/delete`, { method: "DELETE" })
}

export async function reglerInvitationAuto(id: number, automatic: boolean): Promise<void> { await apiRequest(`/api/meetings/${id}/invite-mode`, { method: "PATCH", body: { automatic } }) }

export interface ProprietaireAlanya { id: string; publicNumber: string; pseudo: string | null; avatarUrl: string | null }
export async function trouverProprietaireAlanya(numero: string): Promise<ProprietaireAlanya | null> {
  const res = await apiRequest<{ matched?: ProprietaireAlanya[] }>("/api/users/match", { method: "POST", body: { numbers: [numero] } })
  return res.matched?.[0] ?? null
}
