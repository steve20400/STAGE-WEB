import { getMyUserId, loadSessionUser } from "../data/session-user"
import { loadSessionToken } from "../data/session-auth"
import { ApiError } from "../lib/api-client"
import { ringtoneUrl } from "./ringtones"
import { defaultAudioOutput, type AudioOutputMode } from "./audio-output"
import {
  acceptCallRest,
  endCallRest,
  fetchIceServers,
  leaveCallRest,
  listActiveCallIds,
  rejectCallRest,
  startCallRest,
  type CallType,
} from "./calls-service"
import {
  sendCallInvite,
  sendCallRing,
  sendCallSignal,
  sendCallState,
  sendIvrDtmf,
  subscribeToCallEvents,
  subscribeToMeetingEvents,
  sendMeetingSignal,
  sendMeetingJoin,
  sendMeetingLeave,
  type CallServerEvent,
} from "./websocket-service"
import { isValidAlanyaNumber, normalizeAlanyaNumber } from "../lib/alanya-number"
import { langueInitiale, traduire, type Cle } from "../i18n"

/**
 * Traduction dans un service : la langue est relue a chaque appel, jamais
 * capturee a l'import — sinon un changement de langue en cours de session
 * laisserait les messages d'appel dans l'ancienne.
 */
const tr = (cle: Cle, variables?: Record<string, string | number>) =>
  traduire(langueInitiale(), cle, variables)

/**
 * Gestion des appels WebRTC — miroir du CallController de l'app mobile Flutter
 * pour rester interoperable :
 * - mesh : une RTCPeerConnection par participant distant ;
 * - offreur = celui qui est DEJA dans l'appel, envers celui qui arrive.
 *   Regle positionnelle, et non plus comparaison d'UUID : le mobile a change,
 *   et une divergence entre les deux clients laissait les appels Web -> Android
 *   sans offreur du tout ;
 * - signaux { kind: "offer" | "answer" | "ice" } relayes via le WebSocket ;
 * - etats via call_state ("joined", "left", "rejected", "ended", "declined").
 */

/* ----------------- Types ----------------- */

export interface IncomingCallInfo {
  callId: string
  convId: string | null
  callType: CallType
  callerId: string
  callerName: string
  /** Photo de profil de l'appelant, diffusee avec l'evenement incoming_call. */
  callerAvatarUrl: string | null
  isGroup: boolean
  groupName: string | null
  memberCount: number
}

/**
 * Etape d'un appel passe a un standard (centre d'appels). Deux seulement : des
 * que l'agent decroche, la session disparait et l'appel redevient ordinaire.
 */
export type IvrStep = "menu" | "attente"

/**
 * Une touche du menu. `disponible` vient du serveur : un service peut etre
 * ANNONCE par l'invite vocale sans qu'aucun agent ne le desserve encore.
 */
export interface IvrOption {
  digit: number
  label: string
  disponible: boolean
}

/**
 * Ce que le client sait d'un appel vers un standard.
 *
 * On n'y trouvera JAMAIS l'identite d'un agent : le serveur n'en envoie aucune,
 * et c'est la seule garantie qui tienne — un identifiant qui arrive jusqu'au
 * client est un identifiant public, meme s'il n'est pas affiche.
 */
export interface IvrSession {
  callId: string
  centerId: string
  centerName: string
  centerNumber: string | null
  /** Les deux peuvent etre nuls : l'ecran reste utilisable en silence. */
  promptUrl: string | null
  holdUrl: string | null
  options: IvrOption[]
  step: IvrStep
  /** Libelle du service choisi, pendant que l'agent sonne. */
  serviceChoisi: string | null
  /** Dernier message du serveur (« … n'est pas encore disponible »). */
  message: string | null
  /** Touche envoyee, reponse pas encore arrivee -> clavier verrouille. */
  envoiEnCours: boolean
}

export type CallRole = "outgoing" | "ongoing" | null
export type CallProgress = "ringtone" | "ringing" | "ongoing" | null

/** Les trois tailles de fenetre d'appel, commutables depuis chacune d'elles. */
export type CallDisplayMode = "small" | "medium" | "full"

export interface CallManagerState {
  incoming: IncomingCallInfo | null
  /**
   * Standard en cours, ou nul. Non nul ⇒ l'appel sortant a ete intercepte par
   * un centre d'appels et l'ecran d'appel affiche le menu a la place.
   */
  ivr: IvrSession | null
  activeCallId: string | null
  activeConvId: string | null
  peerName: string
  /** Photo du correspondant : affichee a la place des initiales quand elle existe. */
  peerAvatarUrl: string | null
  callType: CallType
  role: CallRole
  /** Etat affichable sans modifier l'interface : Sonnerie, En train de sonner, Appel en cours. */
  progress: CallProgress
  isGroup: boolean
  isInitiator: boolean
  /** userId -> nom affichable des participants connus. */
  participantNames: Record<string, string>
  localStream: MediaStream | null
  /** userId -> flux distant recu. */
  remoteStreams: Record<string, MediaStream>
  micOn: boolean
  camOn: boolean
  /**
   * Sortie audio de l'appel en cours : haut-parleur ou ecoute a l'oreille
   * (etape 3.5.5). Vit ici et non dans l'ecran d'appel : reduire l'appel
   * demonte l'ecran et confie les elements <audio> a la fenetre flottante —
   * le mode choisi doit survivre a cet aller-retour et s'appliquer aux deux
   * rendus. Toujours « speaker » sur un appel video.
   */
  audioOutput: AudioOutputMode
  /** Rempli quand l'appel se termine (par nous ou a distance). */
  endedAt: number | null
  error: string | null
  /**
   * Taille de la fenetre d'appel. « small » est l'ancien « compact » : une
   * vignette deplacable. « medium » est une fenetre flottante plus large, et
   * « full » l'ecran d'appel entier.
   */
  displayMode: CallDisplayMode
  /**
   * Transfert supervise en attente : la cible a ete invitee, on attend qu'elle
   * decroche pour partir. L'ecran d'appel le montre — sinon, entre le clic sur
   * « Transferer » et le depart, rien ne bouge et l'action parait sans effet.
   */
  transferPending: boolean
}

interface WebrtcSignal {
  kind?: string
  sdp?: string
  type?: string
  candidate?: { candidate?: string; sdpMid?: string; sdpMLineIndex?: number }
}

/* ----------------- Session WebRTC vers UN pair ----------------- */

class PeerSession {
  private pc: RTCPeerConnection | null = null
  private started = false
  private remoteReady = false
  private pendingSignals: WebrtcSignal[] = []
  private iceQueue: RTCIceCandidateInit[] = []
  remoteStream: MediaStream | null = null

  constructor(
    private readonly peerId: string,
    private readonly isVideo: boolean,
    private readonly isOfferer: boolean,
    private readonly localStream: MediaStream,
    private readonly iceServers: RTCIceServer[],
    private readonly onSendSignal: (signal: WebrtcSignal) => void,
    private readonly onUpdated: () => void
  ) {}

  async start() {
    if (this.started) return
    this.started = true

    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.pc = pc

    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      const c = event.candidate
      this.onSendSignal({
        kind: "ice",
        candidate: {
          candidate: c.candidate,
          sdpMid: c.sdpMid ?? undefined,
          sdpMLineIndex: c.sdpMLineIndex ?? undefined,
        },
      })
    }

    pc.ontrack = (event) => {
      if (event.streams.length > 0) {
        this.remoteStream = event.streams[0]
        this.onUpdated()
      }
    }

    // Diagnostic : visible dans la console (F12) si le media ne passe pas.
    pc.oniceconnectionstatechange = () => {
      // eslint-disable-next-line no-console
      console.info(`[webrtc] ICE ${this.peerId.slice(0, 8)}… : ${pc.iceConnectionState}`)
      // Aucun chemin reseau trouve (NAT stricts sans relais TURN) : on prefere
      // un message clair a deux participants qui ne se voient jamais.
      if (pc.iceConnectionState === "failed") {
        const hasTurn = this.iceServers.some((server) => {
          const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
          return urls.some((url) => typeof url === "string" && url.startsWith("turn"))
        })
        setState({
          error: hasTurn ? tr("call_turn_blocked") : tr("call_turn_missing"),
        })
      }
    }

    for (const track of this.localStream.getTracks()) {
      pc.addTrack(track, this.localStream)
    }

    if (this.isOfferer) {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: this.isVideo,
      })
      await pc.setLocalDescription(offer)
      this.onSendSignal({ kind: "offer", sdp: offer.sdp, type: offer.type })
    }

    const pending = this.pendingSignals.splice(0)
    for (const signal of pending) {
      await this.applySignal(signal)
    }
  }

  async handleSignal(signal: WebrtcSignal) {
    if (!this.started) {
      this.pendingSignals.push(signal)
      return
    }
    await this.applySignal(signal)
  }

  private async applySignal(signal: WebrtcSignal) {
    const pc = this.pc
    if (!pc) return

    try {
      if (signal.kind === "offer" && signal.sdp) {
        await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp })
        this.remoteReady = true
        await this.flushIceQueue()
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        this.onSendSignal({ kind: "answer", sdp: answer.sdp, type: answer.type })
      } else if (signal.kind === "answer" && signal.sdp) {
        await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp })
        this.remoteReady = true
        await this.flushIceQueue()
      } else if (signal.kind === "ice" && signal.candidate?.candidate) {
        const candidate: RTCIceCandidateInit = {
          candidate: signal.candidate.candidate,
          sdpMid: signal.candidate.sdpMid,
          sdpMLineIndex: signal.candidate.sdpMLineIndex,
        }
        if (this.remoteReady) {
          await pc.addIceCandidate(candidate)
        } else {
          this.iceQueue.push(candidate)
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[webrtc] signal ${signal.kind} vers ${this.peerId} a echoue`, err)
    }
  }

  private async flushIceQueue() {
    const pc = this.pc
    if (!pc) return
    for (const candidate of this.iceQueue.splice(0)) {
      try {
        await pc.addIceCandidate(candidate)
      } catch {
        // candidat obsolete : ignore
      }
    }
  }

  async replaceVideoTrack(track: MediaStreamTrack) {
    const pc = this.pc
    if (!pc) return
    // `sender.track` peut etre nul — piste retiree, ou emetteur pas encore
    // associe. On retombe alors sur le transceiver video, sinon le
    // correspondant reste sur l'ancienne image apres un changement de camera.
    const sender =
      pc.getSenders().find((item) => item.track?.kind === "video") ??
      pc.getTransceivers().find((item) => item.receiver.track?.kind === "video")?.sender
    if (!sender) return
    try {
      await sender.replaceTrack(track)
    } catch (err) {
      console.warn(`[webrtc] remplacement de la piste video refuse (${this.peerId}) :`, err)
    }
  }

  close() {
    this.remoteStream = null
    this.pc?.close()
    this.pc = null
    this.started = false
    this.remoteReady = false
    this.pendingSignals = []
    this.iceQueue = []
  }
}

/* ----------------- Etat global ----------------- */

const RING_TIMEOUT_MS = 60_000

/**
 * Photo du correspondant retrouvee cote client, a partir de la conversation
 * liee a l'appel.
 *
 * Le backend ne joint l'avatar aux evenements d'appel (callerAvatarUrl,
 * callees[].avatarUrl) que depuis son dernier commit : tant que le serveur
 * deploye est anterieur, ces champs arrivent vides. GET /api/conversations
 * porte en revanche l'avatar de l'interlocuteur d'une conversation directe
 * depuis longtemps — on s'en sert comme source de secours pour que la photo
 * s'affiche dans tous les cas.
 */
async function conversationAvatar(convId: string | null): Promise<string | null> {
  if (!convId) return null
  try {
    const { fetchChatConversations } = await import("./chats-service")
    const conversations = await fetchChatConversations()
    const conversation = conversations.find((c) => c.id === convId)
    return conversation && !conversation.isGroup ? (conversation.avatar ?? null) : null
  } catch {
    return null
  }
}

/** Complete peerAvatarUrl si l'appel courant n'en a pas recu du backend. */
async function backfillPeerAvatar(callId: string, convId: string | null) {
  if (state.peerAvatarUrl) return
  const avatar = await conversationAvatar(convId)
  if (avatar && state.activeCallId === callId && !state.peerAvatarUrl) {
    setState({ peerAvatarUrl: avatar })
  }
}

function initialState(): CallManagerState {
  return {
    incoming: null,
    ivr: null,
    activeCallId: null,
    activeConvId: null,
    peerName: "",
    peerAvatarUrl: null,
    callType: "audio",
    role: null,
    progress: null,
    isGroup: false,
    isInitiator: false,
    participantNames: {},
    localStream: null,
    remoteStreams: {},
    micOn: true,
    camOn: true,
    audioOutput: defaultAudioOutput(),
    endedAt: null,
    error: null,
    displayMode: "full",
    transferPending: false,
  }
}

let state: CallManagerState = initialState()
const stateListeners = new Set<() => void>()

/**
 * Cible d'un transfert supervise. Elle n'est connue qu'apres le `call_state`
 * "inviting" du serveur, qui nous apprend l'identifiant de l'invite : le numero
 * compose ne suffit pas a le reconnaitre parmi les participants qui arrivent.
 * L'attente elle-meme vit dans l'etat (`transferPending`), car l'ecran d'appel
 * doit la montrer.
 */
let cibleDuTransfert: string | null = null

let outgoingRingtoneAudio: HTMLAudioElement | null = null
let incomingRingtoneAudio: HTMLAudioElement | null = null

function startOutgoingRingtone() {
  if (typeof window === "undefined") return
  const callsEnabled = localStorage.getItem("notif_calls") !== "false"
  if (!callsEnabled) return

  const url = ringtoneUrl("outgoing")
  // L'element est conserve d'un appel a l'autre : on le recree si le choix de
  // sonnerie a change entre-temps, sinon il rejouerait l'ancienne.
  if (!outgoingRingtoneAudio || outgoingRingtoneAudio.dataset.source !== url) {
    outgoingRingtoneAudio = new Audio(url)
    outgoingRingtoneAudio.dataset.source = url
    outgoingRingtoneAudio.loop = true
  }
  outgoingRingtoneAudio.play().catch((err) => {
    console.warn("[CallManager] tonalite d'appel sortant injouable :", err)
  })
}

function stopOutgoingRingtone() {
  if (outgoingRingtoneAudio) {
    outgoingRingtoneAudio.pause()
    outgoingRingtoneAudio.currentTime = 0
  }
}

/* ----------------- Audio du standard (centre d'appels) ----------------- */

// Element DISTINCT des sonneries : l'invite vocale remplace le bip d'attente,
// mais partager le meme element reviendrait a couper l'un en arretant l'autre.
let ivrAudio: HTMLAudioElement | null = null

function playIvrAudio(url: string, loop: boolean) {
  stopIvrAudio()
  if (typeof window === "undefined") return
  const audio = new Audio(url)
  audio.loop = loop
  ivrAudio = audio
  // Echec silencieux, et deux raisons de s'y attendre : le fichier peut ne pas
  // exister, et un navigateur refuse la lecture automatique tant que
  // l'utilisateur n'a rien clique dans l'onglet. L'ecran du standard affiche les
  // options : il reste parfaitement utilisable sans le son.
  audio.play().catch((err) => {
    console.warn("[CallManager] audio du standard injouable :", err)
  })
}

function stopIvrAudio() {
  if (!ivrAudio) return
  ivrAudio.pause()
  ivrAudio.currentTime = 0
  ivrAudio = null
}

function parseIvrOptions(brut: unknown): IvrOption[] {
  if (!Array.isArray(brut)) return []
  const options: IvrOption[] = []
  for (const item of brut) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const digit = Number(o.digit)
    if (!Number.isFinite(digit)) continue
    options.push({
      digit,
      label: typeof o.label === "string" ? o.label : `Service ${digit}`,
      // Absent = disponible : un serveur anterieur ne connait pas ce champ, et
      // tout griser serait pire que de laisser essayer.
      disponible: o.disponible !== false,
    })
  }
  return options
}

function startIncomingRingtone() {
  if (typeof window === "undefined") return
  const callsEnabled = localStorage.getItem("notif_calls") !== "false"
  if (!callsEnabled) return

  const url = ringtoneUrl("incoming")
  if (!incomingRingtoneAudio || incomingRingtoneAudio.dataset.source !== url) {
    incomingRingtoneAudio = new Audio(url)
    incomingRingtoneAudio.dataset.source = url
    incomingRingtoneAudio.loop = true
  }
  incomingRingtoneAudio.play().catch((err) => {
    console.warn("[CallManager] sonnerie d'appel entrant injouable :", err)
  })
}

function stopIncomingRingtone() {
  if (incomingRingtoneAudio) {
    incomingRingtoneAudio.pause()
    incomingRingtoneAudio.currentTime = 0
  }
}

function setState(patch: Partial<CallManagerState>) {
  const prevIncoming = state.incoming
  const prevRole = state.role
  state = { ...state, ...patch }

  if (state.incoming && !prevIncoming) {
    startIncomingRingtone()
  } else if (!state.incoming && prevIncoming) {
    stopIncomingRingtone()
  }

  if (state.role === "outgoing" && prevRole !== "outgoing") {
    startOutgoingRingtone()
  } else if (state.role !== "outgoing" && prevRole === "outgoing") {
    stopOutgoingRingtone()
  }

  for (const listener of stateListeners) listener()
}

export function getCallState(): CallManagerState {
  return state
}

export function subscribeToCallState(listener: () => void): () => void {
  ensureEventSubscription()
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

/**
 * Envoie une touche au standard.
 *
 * Le clavier se verrouille jusqu'a la reponse du serveur : sur un reseau lent
 * l'utilisateur insiste, et deux appuis feraient sonner deux agents pour une
 * seule intention. Le serveur tient la meme garde de son cote — celle-ci n'est
 * que le confort qui evite d'en arriver la.
 *
 * On envoie meme une touche marquee indisponible : c'est le serveur qui dit
 * pourquoi, et son message est plus juste que tout ce qu'on devinerait ici.
 */
export function sendIvrChoice(digit: number) {
  const session = state.ivr
  if (!session || session.step !== "menu" || session.envoiEnCours) return
  setState({ ivr: { ...session, envoiEnCours: true, message: null } })
  // L'invite s'arrete a l'appui : la laisser courir sous la musique d'attente
  // donnerait deux sons superposes.
  stopIvrAudio()
  sendIvrDtmf(session.callId, digit)
}

/* ----------------- Mesh + signalisation ----------------- */

const peers = new Map<string, PeerSession>()

/**
 * Occupation de la salle, au-dela des connexions WebRTC.
 *
 * `peers` ne connait que les gens DEJA connectes. Pour decider si l'on est
 * seul, il faut aussi savoir qui sonne encore : sinon, inviter quelqu'un puis
 * voir partir le dernier participant raccrocherait avant meme que l'invite ait
 * eu le temps de decrocher.
 */
/** Participants dont on attend la reponse, connus par leur identifiant. */
const attendus = new Set<string>()
/**
 * Invitations lancees par NUMERO : le serveur ne nous renvoie pas d'identifiant
 * avant que la personne rejoigne, on ne peut donc que les compter. Chacune se
 * perime d'elle-meme au bout du temps de sonnerie, faute de quoi une invitation
 * restee sans reponse maintiendrait la salle ouverte indefiniment.
 */
let invitationsEnVol = 0
/**
 * Quelqu'un a-t-il rejoint depuis le debut de cet appel ?
 *
 * Sans cette memoire, un appel sortant serait raccroche des la premiere
 * verification : au moment ou il part, personne n'est encore connecte. La regle
 * « on raccroche quand il ne reste personne » ne vaut qu'une fois la salle
 * peuplee au moins une fois.
 */
let salleAEteHabitee = false
/** Un depart peut en preceder une arrivee de quelques centaines de millisecondes. */
const SOLITUDE_MS = 2000
let solitudeTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Reunion en cours, ou null pour un appel ordinaire.
 *
 * Le maillage WebRTC est le meme dans les deux cas — memes sessions, meme
 * negociation — mais les trames de signalisation NE LE SONT PAS : le serveur
 * tient un salon separe pour les reunions, avec son propre vocabulaire. Router
 * les offres d'une reunion dans les trames d'appel les envoyait dans un salon
 * que personne n'habitait : web et mobile pouvaient rejoindre la meme reunion
 * sans jamais se voir.
 */
let salleReunion: number | null = null
let desabonnementSalle: (() => void) | null = null
// callId -> (userId -> signaux recus avant que la session soit prete)
const signalBuffer = new Map<string, Map<string, WebrtcSignal[]>>()
let localStream: MediaStream | null = null
let iceServersCache: RTCIceServer[] | null = null
let ringTimeoutId: ReturnType<typeof setTimeout> | null = null
let eventsUnsubscribe: (() => void) | null = null

function myUserId(): string | null {
  return getMyUserId()
}

function myDisplayName(): string {
  return loadSessionUser()?.name ?? "Utilisateur Alanya"
}

// La regle d'offreur n'est plus une comparaison d'UUID : elle est POSITIONNELLE
// et vit desormais dans le parametre `asOfferer` de `connectToPeer`.

function ensureEventSubscription() {
  if (eventsUnsubscribe) return
  eventsUnsubscribe = subscribeToCallEvents(handleServerEvent)
  registerPageHideCleanup()
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "")
let pageHideRegistered = false

/**
 * Si l'onglet est ferme/recharge en plein appel, on previent quand meme le
 * backend (fetch keepalive survit au dechargement de la page). Sans cela,
 * l'appel reste RINGING/ONGOING en base et bloque tous les appels suivants.
 */
function registerPageHideCleanup() {
  if (pageHideRegistered || typeof window === "undefined") return
  pageHideRegistered = true
  window.addEventListener("pagehide", () => {
    const callId = state.activeCallId
    if (!callId) return
    const token = loadSessionToken()
    if (!token) return
    void fetch(`${API_BASE_URL}/api/calls/${callId}/end`, {
      method: "POST",
      keepalive: true,
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined)
  })
}

function publishRemoteStreams() {
  const streams: Record<string, MediaStream> = {}
  for (const [peerId, session] of peers) {
    if (session.remoteStream) streams[peerId] = session.remoteStream
  }
  setState({ remoteStreams: streams })
}

async function ensureLocalStream(isVideo: boolean): Promise<MediaStream> {
  if (localStream) return localStream
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo })
  setState({ localStream, micOn: true, camOn: isVideo })
  return localStream
}

async function loadIceServers(): Promise<RTCIceServer[]> {
  if (!iceServersCache) iceServersCache = await fetchIceServers()
  return iceServersCache
}

/**
 * Ouvre la connexion WebRTC avec un pair.
 *
 * `asOfferer` : celui qui est DEJA dans l appel emet l offre a celui qui
 * arrive. Regle POSITIONNELLE, qui a remplace cote mobile la comparaison
 * d UUID vivant ici aussi.
 *
 * La desynchronisation entre les deux clients cassait les appels Web ->
 * Android : le web ne s estimait pas offreur, le mobile non plus puisqu il
 * venait d arriver. Personne n emettait d offre. Le web voyait l acceptation
 * et lancait son compteur, le mobile restait sur « connexion en cours ».
 */
async function connectToPeer(peerId: string, asOfferer: boolean) {
  const me = myUserId()
  const callId = state.activeCallId
  if (!me || !callId || peerId === me || peers.has(peerId)) return

  // Quelqu'un entre : la salle a ete habitee, il ne l'attend plus, et le
  // minuteur de solitude n'a plus lieu d'etre. Ce point de passage est unique —
  // qu'on rejoigne un appel en cours ou qu'on voie arriver un nouveau venu.
  salleAEteHabitee = true
  nePlusAttendre(peerId)
  annulerSolitude()

  const isVideo = state.callType === "video"
  let stream: MediaStream
  try {
    stream = await ensureLocalStream(isVideo)
  } catch {
    setState({
      error: isVideo ? tr("call_need_mic_cam") : tr("call_need_mic"),
    })
    return
  }
  const iceServers = await loadIceServers()

  const session = new PeerSession(
    peerId,
    isVideo,
    asOfferer,
    stream,
    iceServers,
    (signal) =>
      salleReunion !== null
        ? sendMeetingSignal(salleReunion, peerId, signal)
        : sendCallSignal(callId, peerId, signal),
    publishRemoteStreams
  )
  peers.set(peerId, session)
  await session.start()

  // Rejoue les signaux arrives avant que la session existe.
  const buffered = signalBuffer.get(callId)?.get(peerId)
  if (buffered) {
    signalBuffer.get(callId)?.delete(peerId)
    for (const signal of buffered) {
      await session.handleSignal(signal)
    }
  }
}

function annulerSolitude() {
  if (solitudeTimer) {
    clearTimeout(solitudeTimer)
    solitudeTimer = null
  }
}

/** Plus personne d'autre : ni connecte, ni en train de sonner. */
function suisJeSeul(): boolean {
  return peers.size === 0 && attendus.size === 0 && invitationsEnVol === 0
}

/**
 * Raccroche des qu'il ne reste plus qu'une personne dans la salle.
 *
 * Un appel a deux se terminait deja ainsi, mais pas un appel devenu multiple
 * par invitation : les autres partis, le dernier restait seul dans un appel
 * qui continuait de tourner, micro ouvert, sans plus personne au bout.
 *
 * Le raccrochage est differe de deux secondes, et annule si quelqu'un arrive
 * entre-temps. Ce delai couvre le transfert supervise : le correspondant
 * d'origine voit parfois partir celui qui transfere avant de voir arriver la
 * cible, et raccrocherait sur cette fraction de seconde ou la salle parait
 * vide. Il laisse aussi au serveur — qui termine l'appel des qu'il reste moins
 * de deux personnes — le temps de le faire lui-meme : dans le cas normal, son
 * `ended` arrive le premier et ce minuteur ne sert jamais.
 */
function verifierSolitude() {
  annulerSolitude()
  // Une REUNION ne se ferme pas parce qu'on y reste seul : elle a une heure, un
  // objet, et des gens qui arrivent en retard. Un appel n'a que ses deux bouts —
  // sans personne en face, il n'a plus d'objet. La regle ne vaut donc que pour
  // les appels, et la salle attend son monde.
  if (salleReunion !== null) return
  if (!salleAEteHabitee || state.activeCallId === null || !suisJeSeul()) return
  solitudeTimer = setTimeout(() => {
    solitudeTimer = null
    if (state.activeCallId !== null && suisJeSeul()) void hangUp()
  }, SOLITUDE_MS)
}

/** Une personne cesse d'etre attendue : elle a rejoint, refuse, ou disparu. */
function nePlusAttendre(userId: string) {
  if (attendus.delete(userId)) return
  // Arrivee non nominative : c'est une invitation lancee par numero qui aboutit.
  if (invitationsEnVol > 0) invitationsEnVol -= 1
}

function removePeer(peerId: string) {
  peers.get(peerId)?.close()
  peers.delete(peerId)
  publishRemoteStreams()
}

function stopMesh() {
  for (const session of peers.values()) session.close()
  peers.clear()
  localStream?.getTracks().forEach((track) => track.stop())
  localStream = null
}

function clearCall(markEnded: boolean) {
  if (ringTimeoutId) {
    clearTimeout(ringTimeoutId)
    ringTimeoutId = null
  }
  // Un transfert ne survit pas a l'appel qu'il concernait : sans cette remise,
  // l'appel suivant partirait des l'arrivee du premier participant.
  // (transferPending repart a faux avec initialState.)
  cibleDuTransfert = null
  if (desabonnementSalle) {
    desabonnementSalle()
    desabonnementSalle = null
  }
  salleReunion = null
  annulerSolitude()
  attendus.clear()
  invitationsEnVol = 0
  salleAEteHabitee = false
  stopMesh()
  stopOutgoingRingtone()
  stopIncomingRingtone()
  // Le standard meurt avec l'appel. Ce nettoyage etant le point de passage de
  // TOUTES les fins d'appel, c'est le seul endroit ou l'oubli est impossible.
  stopIvrAudio()
  const ended = markEnded && (state.activeCallId !== null || state.role !== null)
  state = {
    ...initialState(),
    endedAt: ended ? Date.now() : null,
    error: state.error,
  }
  for (const listener of stateListeners) listener()
}

function bufferSignal(callId: string, from: string, signal: WebrtcSignal) {
  if (!signalBuffer.has(callId)) signalBuffer.set(callId, new Map())
  const byPeer = signalBuffer.get(callId)!
  if (!byPeer.has(from)) byPeer.set(from, [])
  byPeer.get(from)!.push(signal)
}

async function flushBufferedSignals(callId: string) {
  const byPeer = signalBuffer.get(callId)
  if (!byPeer) return
  signalBuffer.delete(callId)
  for (const [from, signals] of byPeer) {
    const session = peers.get(from)
    if (!session) {
      // Le pair n'est pas encore connecte : re-bufferise.
      for (const signal of signals) bufferSignal(callId, from, signal)
      continue
    }
    for (const signal of signals) await session.handleSignal(signal)
  }
}

/* ----------------- Evenements serveur ----------------- */

async function onPeerJoined(userId: string, displayName: string | null) {
  const me = myUserId()
  if (!userId || userId === me) return

  setState({
    participantNames: {
      ...state.participantNames,
      [userId]: displayName?.trim() || state.participantNames[userId] || "Participant",
    },
    role: state.role === "outgoing" ? "ongoing" : state.role,
    progress: "ongoing",
  })
  if (ringTimeoutId) {
    clearTimeout(ringTimeoutId)
    ringTimeoutId = null
  }
  // Nous sommes deja dans l appel, ce pair vient d arriver : nous offrons.
  await connectToPeer(userId, true)
  if (state.activeCallId) await flushBufferedSignals(state.activeCallId)
}

async function handleServerEvent(event: CallServerEvent) {
  if (event.type === "incoming_call") {
    const callId = String(event.callId ?? "")
    if (!callId) return
    // Deja en appel : on laisse sonner cote serveur sans interrompre l'appel courant.
    if (state.activeCallId || state.incoming) return

    const convId = (event.convId as string | null) ?? null
    const callerAvatarUrl = (event.callerAvatarUrl as string | null) ?? null

    setState({
      incoming: {
        callId,
        convId,
        callType: event.callType === "VIDEO" ? "video" : "audio",
        callerId: String(event.callerId ?? ""),
        callerName: String(event.callerName ?? "Appel"),
        callerAvatarUrl,
        isGroup: Boolean(event.isGroup),
        groupName: (event.groupName as string | null) ?? null,
        memberCount: Number(event.memberCount ?? 2),
      },
      endedAt: null,
      error: null,
    })
    // Le destinataire a effectivement l'application ouverte : l'appelant peut
    // passer de « Sonnerie » à « En train de sonner ».
    sendCallState(callId, "ringing", myUserId() ?? undefined, myDisplayName())

    // Photo de l'appelant absente de l'evenement (backend anterieur au commit
    // qui la propage) : on la retrouve via la conversation liee.
    if (!callerAvatarUrl) {
      void conversationAvatar(convId).then((avatar) => {
        if (!avatar) return
        const current: IncomingCallInfo | null = state.incoming
        if (!current || current.callId !== callId || current.callerAvatarUrl) return
        setState({ incoming: { ...current, callerAvatarUrl: avatar } })
      })
    }
    return
  }

  if (event.type === "ivr_menu") {
    // Le serveur repond « voici le menu » au lieu de faire sonner : ce numero
    // etait un centre d'appels. Le client ne l'avait pas demande et n'a aucun
    // controle a faire avant d'appeler — c'est le serveur qui decide.
    const callId = String(event.callId ?? "")
    if (!callId || callId !== state.activeCallId) return
    // ⚠️ COUPER LE MINUTEUR DE SONNERIE. Il est arme pour un appel que personne
    // ne decroche ; laisse en place, il raccroche l'appelant en plein milieu de
    // son choix.
    if (ringTimeoutId) {
      clearTimeout(ringTimeoutId)
      ringTimeoutId = null
    }
    // Le bip d'attente sortant n'a plus lieu d'etre : personne ne sonne.
    stopOutgoingRingtone()

    const session: IvrSession = {
      callId,
      centerId: String(event.centerId ?? ""),
      centerName: String(event.centerName ?? state.peerName ?? "Standard"),
      centerNumber: (event.centerNumber as string | null) ?? null,
      promptUrl: (event.promptUrl as string | null) ?? null,
      holdUrl: (event.holdUrl as string | null) ?? null,
      options: parseIvrOptions(event.options),
      step: "menu",
      serviceChoisi: null,
      message: null,
      envoiEnCours: false,
    }
    setState({
      ivr: session,
      peerName: session.centerName,
      peerAvatarUrl: (event.centerAvatarUrl as string | null) ?? state.peerAvatarUrl,
    })
    if (session.promptUrl) playIvrAudio(session.promptUrl, false)
    return
  }

  if (event.type === "ivr_hold") {
    const session = state.ivr
    if (!session || String(event.callId ?? "") !== session.callId) return
    setState({
      ivr: {
        ...session,
        step: "attente",
        serviceChoisi: (event.label as string | null) ?? null,
        message: null,
        envoiEnCours: false,
      },
    })
    // L'URL est arrivee des `ivr_menu` : le navigateur a eu toute la duree de
    // l'invite pour la mettre en cache, la musique demarre donc a l'instant de
    // l'appui au lieu de laisser trois secondes de silence.
    const hold = (event.holdUrl as string | null) ?? session.holdUrl
    if (hold) playIvrAudio(hold, true)
    return
  }

  if (event.type === "ivr_error") {
    const callId = String(event.callId ?? "")
    const retry = event.retry === true
    const message = String(event.message ?? tr("ivr_failed"))
    stopIvrAudio()
    const session = state.ivr
    if (!session || callId !== session.callId) {
      // Refus AVANT toute session : le centre n'a aucun service joignable.
      setState({ error: message })
      void hangUp()
      return
    }
    const options = parseIvrOptions(event.options)
    setState({
      ivr: {
        ...session,
        options: options.length > 0 ? options : session.options,
        message,
        envoiEnCours: false,
        // Un agent occupe, absent ou qui refuse ne raccroche PAS au nez de
        // l'appelant : il revient au menu et choisit un autre service.
        step: retry ? "menu" : session.step,
        serviceChoisi: retry ? null : session.serviceChoisi,
      },
    })
    if (retry) return
    // Fin sans retour possible. Le message reste affiche : le serveur n'envoie
    // volontairement AUCUN `call_ended` avec, sinon l'ecran se fermerait dans la
    // meme milliseconde et le texte serait illisible.
    setTimeout(() => {
      if (state.ivr?.callId === callId) void hangUp()
    }, 4000)
    return
  }

  if (event.type === "call_signal") {
    const callId = String(event.callId ?? "")
    const from = String(event.from ?? "")
    const signal = event.signal as WebrtcSignal | undefined
    if (!callId || !from || !signal || typeof signal !== "object") return

    if (callId !== state.activeCallId) {
      bufferSignal(callId, from, signal)
      return
    }
    const session = peers.get(from)
    if (session) {
      await session.handleSignal(signal)
    } else {
      bufferSignal(callId, from, signal)
    }
    return
  }

  if (event.type === "call_state") {
    const callId = String(event.callId ?? "")
    const callState = String(event.state ?? "")
    const fromUserId = event.from ? String(event.from) : null
    const userId = event.userId ? String(event.userId) : fromUserId
    const displayName = (event.displayName as string | null) ?? null
    const me = myUserId()
    if (!callId) return

    if (callState === "ringing") {
      if (userId !== me && callId === state.activeCallId && state.role === "outgoing") {
        setState({ progress: "ringing" })
      }
      return
    }

    if (callState === "inviting") {
      // Le serveur nous apprend QUI vient d'etre invite. Sans cela, un transfert
      // ne saurait pas reconnaitre sa cible parmi les arrivants.
      if (state.transferPending && userId && userId !== me) {
        cibleDuTransfert = userId
      }
      return
    }

    if (callState === "joined" || callState === "accepted") {
      // Un autre appareil connecté au même compte a décroché : il faut arrêter
      // la sonnerie locale, mais surtout ne jamais terminer l'appel serveur.
      if (userId === me) {
        if (callId === state.incoming?.callId) setState({ incoming: null })
        return
      }
      // Transfert supervise : la cible a rejoint, on peut partir. L'appel
      // continue entre le correspondant d'origine et elle.
      if (state.transferPending && userId && userId === cibleDuTransfert) {
        if (callId === state.activeCallId) {
          await acheverLeTransfert(callId)
          return
        }
      }
      // Standard : quelqu'un a decroche. La session n'a plus de raison d'etre,
      // l'ecran redevient un ecran d'appel ordinaire — au nom du CENTRE. Le
      // serveur a reecrit `userId` pour nous : le pair qu'on s'apprete a
      // connecter est le centre, jamais l'agent.
      if (state.ivr && callId === state.ivr.callId) {
        stopIvrAudio()
        setState({ ivr: null })
      }
      if (callId === state.activeCallId || callId === state.incoming?.callId) {
        await onPeerJoined(userId ?? "", displayName)
      }
      return
    }

    if (callState === "left" || callState === "declined") {
      // Notre identifiant : soit notre propre depart, soit un autre appareil du
      // meme compte qui vient de refuser pendant que l'on sonne ici.
      if (userId === me) {
        if (callId === state.incoming?.callId) setState({ incoming: null })
        return
      }
      // La cible du transfert refuse : on annule et on reste dans l'appel,
      // plutot que de partir en laissant le correspondant seul.
      if (callState === "declined" && state.transferPending && userId === cibleDuTransfert) {
        cibleDuTransfert = null
        setState({ transferPending: false, error: "Transfert refuse" })
        return
      }
      if (callId === state.activeCallId && userId) {
        removePeer(userId)
        nePlusAttendre(userId)
        // Meme regle a deux comme a dix : on ne reste pas seul dans une salle.
        verifierSolitude()
      }
      return
    }

    if (callState === "rejected" || callState === "ended") {
      if (fromUserId === me) {
        // Echo de notre propre raccrochage — sauf si un autre appareil du meme
        // compte a refuse l'appel qui sonne encore ici.
        if (callId === state.incoming?.callId && callId !== state.activeCallId) {
          setState({ incoming: null })
        }
        return
      }
      const isOurCall =
        callId === state.activeCallId ||
        callId === state.incoming?.callId ||
        (state.activeCallId === null && state.role !== null)
      if (isOurCall) {
        signalBuffer.delete(callId)
        clearCall(true)
      }
    }
  }
}

/* ----------------- Actions publiques ----------------- */

export function isCallBusy(): boolean {
  return state.activeCallId !== null || state.incoming !== null || state.role !== null
}

/**
 * Termine cote serveur les appels fantomes (RINGING/ONGOING) laisses par un
 * onglet ferme ou recharge en plein appel : sans cela, le backend repond
 * "Vous etes deja en appel" (409 BUSY) indefiniment.
 */
async function endStaleServerCalls(): Promise<void> {
  let staleIds: string[] = []
  try {
    staleIds = await listActiveCallIds()
  } catch {
    return
  }
  for (const callId of staleIds) {
    try {
      await endCallRest(callId)
      sendCallState(callId, "ended", myUserId() ?? undefined, myDisplayName())
    } catch {
      // deja termine cote serveur : tant mieux
    }
  }
}

/**
 * Demarre un appel sortant dans une conversation.
 * Renvoie l'id de l'appel cree (RINGING cote backend).
 */
export async function startOutgoingCall(
  convId: string,
  type: CallType,
  title: string
): Promise<string> {
  ensureEventSubscription()

  // Un appel entrant sonne a l'ecran : l'utilisateur doit d'abord repondre.
  if (state.incoming) {
    throw new Error(tr("call_answer_incoming_first"))
  }
  // Appel local residuel (ecran quitte sans raccrocher) : on le remplace.
  if (state.activeCallId !== null || state.role !== null) {
    await hangUp()
  }

  let started
  try {
    started = await startCallRest(convId, type)
  } catch (err) {
    // 409 BUSY = appel fantome cote serveur (onglet ferme en plein appel) :
    // on nettoie puis on retente une fois.
    if (err instanceof ApiError && err.status === 409) {
      await endStaleServerCalls()
      try {
        started = await startCallRest(convId, type)
      } catch (retryError) {
        if (retryError instanceof ApiError && retryError.status === 409) {
          throw new Error(tr("call_busy_detail"))
        }
        throw retryError
      }
    } else {
      throw err
    }
  }
  sendCallRing(started.id)

  const participantNames: Record<string, string> = {}
  attendus.clear()
  for (const callee of started.callees ?? []) {
    participantNames[callee.userId] = callee.pseudo ?? callee.publicNumber ?? "Membre"
    attendus.add(callee.userId)
  }

  setState({
    activeCallId: started.id,
    activeConvId: convId,
    peerName: started.isGroup ? (started.groupName ?? title) : title,
    // Appel direct : la photo de la personne appelee vient de POST /api/calls.
    peerAvatarUrl: started.isGroup ? null : (started.callees?.[0]?.avatarUrl ?? null),
    callType: type,
    role: "outgoing",
    progress: "ringtone",
    isGroup: started.isGroup,
    isInitiator: true,
    participantNames,
    // Chaque appel repart du reglage par defaut : sans cette remise, un
    // basculement fait pendant l'appel precedent collerait au suivant.
    audioOutput: type === "video" ? "speaker" : defaultAudioOutput(),
    endedAt: null,
    error: null,
  })

  void backfillPeerAvatar(started.id, convId)

  ringTimeoutId = setTimeout(() => {
    if (state.role === "outgoing" && state.activeCallId === started.id) {
      void hangUp()
    }
  }, RING_TIMEOUT_MS)

  // Le premier call_ring peut se perdre si le WebSocket etait en pleine
  // reconnexion : on le renvoie deux fois tant que ca sonne. Sans risque cote
  // destinataire (incoming_call est ignore si l'appel est deja connu).
  for (const delayMs of [4000, 10000]) {
    setTimeout(() => {
      if (state.role === "outgoing" && state.activeCallId === started.id) {
        sendCallRing(started.id)
      }
    }, delayMs)
  }

  // Prepare le flux local tout de suite pour etre pret des que l'autre accepte.
  try {
    await ensureLocalStream(type === "video")
  } catch {
    setState({
      error: type === "video" ? tr("call_need_mic_cam") : tr("call_need_mic"),
    })
  }

  return started.id
}

/** Démarre un appel de groupe pour une réunion. */
/**
 * Entre dans la salle d'une reunion.
 *
 * Passe par le salon du serveur — `meeting_join` — et non par la creation d'un
 * appel. C'est toute la difference : une reunion existe deja, on la REJOINT,
 * alors que l'ancienne version en creait un appel parallele portant son nom.
 * Le mobile, lui, a toujours parle au salon ; les deux clients pouvaient donc
 * rejoindre la meme reunion sans jamais se croiser.
 *
 * Qui offre a qui suit la meme regle que pour un appel : celui qui arrive
 * n'offre pas, ceux qui sont deja la offrent. Sans cette convention, deux
 * arrivees simultanees s'enverraient deux offres croisees.
 */
export async function joinMeetingRoom(
  meetingId: number,
  type: CallType,
  title: string
): Promise<void> {
  ensureEventSubscription()

  if (state.incoming) {
    throw new Error(tr("call_answer_incoming_first"))
  }
  if (state.activeCallId !== null || state.role !== null) {
    await hangUp()
  }

  salleReunion = meetingId
  attendus.clear()

  setState({
    // La salle tient lieu d'appel actif : le reste de l'ecran d'appel — grille
    // des participants, micro, camera, raccrochage — fonctionne sans savoir
    // qu'il s'agit d'une reunion.
    activeCallId: `meeting_${meetingId}`,
    activeConvId: `meeting_${meetingId}`,
    peerName: title,
    peerAvatarUrl: null,
    callType: type,
    role: "ongoing",
    progress: "ongoing",
    isGroup: true,
    isInitiator: false,
    participantNames: {},
    micOn: true,
    camOn: type === "video",
    audioOutput: type === "video" ? "speaker" : defaultAudioOutput(),
    localStream: null,
    remoteStreams: {},
    endedAt: null,
    error: null,
  })

  // Le flux local AVANT d'annoncer son arrivee : les autres offrent des
  // reception de `meeting_user_joined`, et une offre negociee sans piste
  // etablit une connexion parfaitement muette.
  //
  // L'echec INTERROMPT l'entree, au lieu de la poursuivre avec un message
  // d'erreur pose dans l'etat. Entrer sans micro donnait une salle ou l'on
  // entend tout le monde sans que personne ne vous entende — et rien a l'ecran
  // ne le disait, l'ecran de reunion n'affichant l'erreur que faute de charger
  // la reunion. Mieux vaut ne pas entrer et le dire.
  try {
    await ensureLocalStream(type === "video")
  } catch {
    salleReunion = null
    clearCall(false)
    throw new Error(type === "video" ? tr("call_need_mic_cam") : tr("call_need_mic"))
  }

  desabonnementSalle?.()
  desabonnementSalle = subscribeToMeetingEvents((event) => {
    if (Number(event.meetingId) !== meetingId) return
    void traiterEvenementSalle(event)
  })

  sendMeetingJoin(meetingId)
}

/** Suite des evenements du salon, une fois qu'on y est entre. */
async function traiterEvenementSalle(event: Record<string, unknown>) {
  if (salleReunion === null) return

  if (event.type === "meeting_joined") {
    // Ceux qui etaient deja la : c'est a eux d'offrir, on se contente de tenir
    // la session prete a recevoir leur offre.
    const presents = Array.isArray(event.participants) ? (event.participants as string[]) : []
    for (const id of presents) await connectToPeer(id, false)
    return
  }

  if (event.type === "meeting_user_joined") {
    const id = String(event.userId ?? "")
    if (!id) return
    const nom = String(event.displayName ?? "")
    if (nom) {
      setState({ participantNames: { ...state.participantNames, [id]: nom } })
    }
    // Nouveau venu : nous sommes deja la, donc c'est nous qui offrons.
    await connectToPeer(id, true)
    return
  }

  if (event.type === "meeting_user_left") {
    const id = String(event.userId ?? "")
    if (!id) return
    removePeer(id)
    nePlusAttendre(id)
    // Pas de fermeture automatique : rester seul dans une reunion est un cas
    // ordinaire — on arrive en avance, les autres partent avant la fin.
    return
  }

  if (event.type === "meeting_signal") {
    const from = String(event.fromUserId ?? "")
    if (!from) return
    const session = peers.get(from)
    if (session) await session.handleSignal(event.signal as WebrtcSignal)
    else {
      // Signal arrive avant que la session existe : on l'ouvre en receveur,
      // puis on lui remet la trame.
      await connectToPeer(from, false)
      await peers.get(from)?.handleSignal(event.signal as WebrtcSignal)
    }
  }
}

/** Accepte l'appel entrant courant. Renvoie l'id de l'appel rejoint. */
export async function acceptIncomingCall(): Promise<string | null> {
  const incoming = state.incoming
  const me = myUserId()
  if (!incoming || !me) return null

  const result = await acceptCallRest(incoming.callId)

  const participantNames: Record<string, string> = { ...state.participantNames }
  attendus.clear()
  for (const participant of result.activeParticipants ?? []) {
    participantNames[participant.userId] = participant.displayName
  }

  setState({
    activeCallId: incoming.callId,
    activeConvId: incoming.convId,
    peerName: incoming.isGroup ? (incoming.groupName ?? incoming.callerName) : incoming.callerName,
    // Cote destinataire : c'est la photo de l'appelant que l'on affiche.
    peerAvatarUrl: incoming.isGroup ? null : incoming.callerAvatarUrl,
    callType: incoming.callType,
    role: "ongoing",
    progress: "ongoing",
    isGroup: result.isGroup || incoming.isGroup,
    isInitiator: false,
    participantNames,
    incoming: null,
    audioOutput: incoming.callType === "video" ? "speaker" : defaultAudioOutput(),
    endedAt: null,
    error: null,
  })

  void backfillPeerAvatar(incoming.callId, incoming.convId)

  sendCallState(incoming.callId, "joined", me, myDisplayName())

  try {
    await ensureLocalStream(incoming.callType === "video")
  } catch {
    setState({
      error: incoming.callType === "video" ? tr("call_need_mic_cam") : tr("call_need_mic"),
    })
  }

  for (const participant of result.activeParticipants ?? []) {
    if (participant.userId !== me) {
      // Nous venons d accepter : les autres sont deja la, ils offriront.
      await connectToPeer(participant.userId, false)
    }
  }
  await flushBufferedSignals(incoming.callId)

  return incoming.callId
}

/** Ferme seulement la sonnerie/overlay de CET appareil (timeout ou autre appareil a décroché).
    Aucun endpoint reject/end n'est appelé : l'appel déjà accepté reste vivant. */
export function dismissIncomingCallLocally(): void {
  if (!state.incoming) return
  signalBuffer.delete(state.incoming.callId)
  setState({ incoming: null })
}

/** Refuse l'appel entrant courant. */
export async function rejectIncomingCall(): Promise<void> {
  const incoming = state.incoming
  if (!incoming) return
  try {
    await rejectCallRest(incoming.callId)
  } catch {
    // meme si le REST echoue, on notifie et on nettoie localement
  }
  sendCallState(
    incoming.callId,
    incoming.isGroup ? "declined" : "rejected",
    myUserId() ?? undefined,
    myDisplayName()
  )
  signalBuffer.delete(incoming.callId)
  setState({ incoming: null })
}

/** Raccroche l'appel en cours (ou annule la sonnerie sortante). */
export async function hangUp(): Promise<void> {
  const callId = state.activeCallId ?? state.incoming?.callId
  const wasGroup = state.isGroup
  const wasInitiator = state.isInitiator
  const wasRole = state.role

  // Neutralise tout de suite pour ignorer les echos pendant le nettoyage.
  setState({ activeCallId: null })

  try {
    if (callId) {
      // Dans un groupe, même l'initiateur quitte individuellement après décrochage.
      // Le backend ne termine globalement que lorsqu'il reste moins de deux personnes.
      if (salleReunion !== null) {
        // Une reunion se quitte : elle continue sans nous. La terminer
        // reviendrait a la fermer pour tout le monde, ce que seul
        // l'organisateur peut faire, et depuis la liste des reunions.
        sendMeetingLeave(salleReunion)
      } else if (wasGroup && wasRole === "ongoing") {
        await leaveCallRest(callId)
        sendCallState(callId, "left", myUserId() ?? undefined, myDisplayName())
      } else {
        await endCallRest(callId)
        sendCallState(callId, "ended", myUserId() ?? undefined, myDisplayName())
      }
    }
  } catch {
    // l'etat serveur sera corrige par le prochain event ; on nettoie quand meme
  } finally {
    if (callId) signalBuffer.delete(callId)
    clearCall(true)
  }
}

/** Coupe/retablit le micro (pistes audio locales). */
export function toggleMicrophone(): boolean {
  const next = !state.micOn
  localStream?.getAudioTracks().forEach((track) => {
    track.enabled = next
  })
  setState({ micOn: next })
  return next
}

/**
 * Installe une nouvelle piste video locale, et la pousse a TOUS les pairs.
 *
 * Sans le `replaceTrack` sur chaque connexion, les correspondants gardent
 * l'ancienne camera — figee, puisqu'elle vient d'etre arretee.
 */
async function appliquerPisteVideo(piste: MediaStreamTrack): Promise<void> {
  if (!localStream) return
  // Une piste neuve arrive toujours activee : si la camera etait coupee, elle
  // se rallumerait toute seule en changeant d'objectif.
  piste.enabled = state.camOn

  for (const ancienne of localStream.getVideoTracks()) {
    ancienne.stop()
    localStream.removeTrack(ancienne)
  }
  localStream.addTrack(piste)

  await Promise.all([...peers.values()].map((peer) => peer.replaceVideoTrack(piste)))
  setState({ localStream })
}

/**
 * Bascule sur l'autre camera de l'appareil, et remplace la piste chez tous les
 * pairs WebRTC.
 *
 * La camera courante est liberee AVANT d'ouvrir l'autre : beaucoup d'appareils
 * — les telephones en particulier — n'autorisent qu'un seul objectif ouvert a
 * la fois. L'ancienne version demandait la seconde camera pendant que la
 * premiere tournait encore : `getUserMedia` echouait, l'echec etait avale, et
 * rien ne bougeait a l'ecran.
 *
 * En cas d'echec on revient a la camera d'origine : mieux vaut l'image de
 * depart qu'un appel video devenu aveugle.
 */
export async function switchCamera(): Promise<boolean> {
  if (!localStream) return false
  const courante = localStream.getVideoTracks()[0]
  if (!courante) return false

  const reglages = courante.getSettings()
  const idCourant = reglages.deviceId
  const cibleFacing = reglages.facingMode === "environment" ? "user" : "environment"

  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(
    (appareil) => appareil.kind === "videoinput"
  )
  const suivante = cameras.find((appareil) => appareil.deviceId !== idCourant)
  if (!suivante && cameras.length <= 1) {
    setState({ error: tr("call_single_camera") })
    return false
  }

  // De quoi rouvrir l'objectif de depart si la bascule echoue.
  const repli: MediaStreamConstraints = {
    video: idCourant ? { deviceId: { exact: idCourant } } : true,
    audio: false,
  }
  courante.stop()
  localStream.removeTrack(courante)

  // Par identifiant d'abord — c'est le seul critere fiable sur ordinateur, ou
  // `facingMode` n'est generalement pas renseigne. La face opposee ensuite,
  // pour les mobiles qui masquent les identifiants.
  const tentatives: MediaStreamConstraints[] = []
  if (suivante) {
    tentatives.push({ video: { deviceId: { exact: suivante.deviceId } }, audio: false })
  }
  tentatives.push({ video: { facingMode: { exact: cibleFacing } }, audio: false })

  for (const contraintes of tentatives) {
    try {
      const flux = await navigator.mediaDevices.getUserMedia(contraintes)
      const piste = flux.getVideoTracks()[0]
      if (!piste) continue
      if (piste.getSettings().deviceId === idCourant) {
        // Le navigateur a rendu la meme camera : inutile, on essaie autrement.
        flux.getTracks().forEach((t) => t.stop())
        continue
      }
      await appliquerPisteVideo(piste)
      return true
    } catch {
      // objectif indisponible : on tente le critere suivant
    }
  }

  try {
    const retour = await navigator.mediaDevices.getUserMedia(repli)
    const piste = retour.getVideoTracks()[0]
    if (piste) await appliquerPisteVideo(piste)
  } catch {
    // meme la camera de depart est perdue : l'erreur ci-dessous le dira
  }
  setState({ error: tr("call_switch_camera_failed") })
  return false
}

/** Coupe/retablit la camera (pistes video locales). */
export function toggleCamera(): boolean {
  const next = !state.camOn
  localStream?.getVideoTracks().forEach((track) => {
    track.enabled = next
  })
  setState({ camOn: next })
  return next
}

/** Efface le marqueur "appel termine" (apres l'ecran de fin). */
/** Affichage persistant pendant navigation chat/application. Ne touche jamais aux flux WebRTC. */
/** Change la taille de la fenetre d'appel, depuis n'importe laquelle des trois. */
export function setCallDisplayMode(mode: CallDisplayMode): void {
  if (state.activeCallId) setState({ displayMode: mode })
}

/** Bascule haut-parleur / ecoute a l'oreille de l'appel en cours (appels audio). */
export function setCallAudioOutput(mode: AudioOutputMode): void {
  if (state.activeCallId) setState({ audioOutput: mode })
}

export function minimizeActiveCall(): void {
  setCallDisplayMode("small")
}
export function restoreActiveCall(): void {
  setCallDisplayMode("full")
}

export function acknowledgeCallEnded() {
  if (state.endedAt !== null || state.error !== null) {
    setState({ endedAt: null, error: null })
  }
}

/**
 * Verifie qu'une demande visant un tiers est realisable, et renvoie le numero
 * Alanya normalise. Inviter et transferer ont exactement les memes prerequis :
 * un appel en cours, et un numero valide qui n'est pas le sien.
 */
function cibleDeLaDemande(numeroSaisi: string, sansAppel: Cle): string {
  if (!state.activeCallId) {
    throw new Error(tr(sansAppel))
  }
  const numero = normalizeAlanyaNumber(numeroSaisi)
  if (!isValidAlanyaNumber(numero)) {
    throw new Error(tr("call_invalid_alanya_number"))
  }
  if (numero === normalizeAlanyaNumber(loadSessionUser()?.phone ?? "")) {
    throw new Error(tr("call_own_number"))
  }
  return numero
}

/**
 * Invite un tiers dans l'appel en cours, par son numero Alanya, SANS quitter.
 *
 * Seul le serveur peut faire sonner quelqu'un : `call_invite` lui demande de
 * sonner le numero et de l'ajouter aux participants. L'invite arrive ensuite
 * comme n'importe quel participant — le `call_state` "joined" qui suit monte
 * le flux WebRTC sans traitement particulier. L'appel devient multi-partie.
 */
export async function inviteToCall(publicNumber: string): Promise<void> {
  const numero = cibleDeLaDemande(publicNumber, "call_no_call_to_invite")
  setState({ isGroup: true })
  // L'invite sonne : la salle n'est plus consideree comme vide, meme si tous
  // les autres raccrochent avant qu'il decroche. La reservation se perime au
  // bout du temps de sonnerie, sans quoi une invitation sans reponse tiendrait
  // l'appel ouvert indefiniment.
  invitationsEnVol += 1
  annulerSolitude()
  const appel = state.activeCallId as string
  setTimeout(() => {
    if (state.activeCallId !== appel) return
    if (invitationsEnVol > 0) invitationsEnVol -= 1
    verifierSolitude()
  }, RING_TIMEOUT_MS)
  sendCallInvite(appel, numero)
}

/**
 * Transfert supervise : on invite la cible, et des qu'elle a REJOINT, on quitte
 * l'appel — qui continue entre le correspondant d'origine et elle.
 *
 * On ne raccroche donc pas tout de suite : partir avant que la cible ait
 * decroche couperait le correspondant, et un transfert refuse laisserait tout
 * le monde en plan. C'est le meme protocole que l'application mobile.
 */
export async function transferCall(publicNumber: string): Promise<void> {
  const numero = cibleDeLaDemande(publicNumber, "call_no_call_to_transfer")
  cibleDuTransfert = null
  setState({ transferPending: true, error: null })
  sendCallInvite(state.activeCallId as string, numero)
}

/** L'initiateur quitte SANS terminer l'appel pour les autres (transfert). */
async function acheverLeTransfert(callId: string): Promise<void> {
  cibleDuTransfert = null
  // Neutralise l'appel local avant le nettoyage, pour ignorer les echos.
  setState({ activeCallId: null, transferPending: false })
  try {
    await leaveCallRest(callId)
  } catch {
    // l'etat serveur sera corrige par le prochain evenement
  }
  sendCallState(callId, "left", myUserId() ?? undefined, myDisplayName())
  signalBuffer.delete(callId)
  clearCall(true)
}
