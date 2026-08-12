import { apiRequest } from "../lib/api-client"
import { resolveMediaUrl } from "./media-service"
import { langueInitiale, traduire } from "../i18n"

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
    body: { participantNumbers: numeros },
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
