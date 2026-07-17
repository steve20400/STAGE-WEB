import { getMyUserId, loadSessionUser } from "../data/session-user"
import { loadSessionToken } from "../data/session-auth"
import { ApiError } from "../lib/api-client"
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
  sendCallRing,
  sendCallSignal,
  sendCallState,
  subscribeToCallEvents,
  type CallServerEvent,
} from "./websocket-service"

/**
 * Gestion des appels WebRTC — miroir du CallController de l'app mobile Flutter
 * pour rester interoperable :
 * - mesh : une RTCPeerConnection par participant distant ;
 * - offreur = celui dont l'UUID est lexicographiquement inferieur ;
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
  isGroup: boolean
  groupName: string | null
  memberCount: number
}

export type CallRole = "outgoing" | "ongoing" | null

export interface CallManagerState {
  incoming: IncomingCallInfo | null
  activeCallId: string | null
  activeConvId: string | null
  peerName: string
  callType: CallType
  role: CallRole
  isGroup: boolean
  isInitiator: boolean
  /** userId -> nom affichable des participants connus. */
  participantNames: Record<string, string>
  localStream: MediaStream | null
  /** userId -> flux distant recu. */
  remoteStreams: Record<string, MediaStream>
  micOn: boolean
  camOn: boolean
  /** Rempli quand l'appel se termine (par nous ou a distance). */
  endedAt: number | null
  error: string | null
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
          error: hasTurn
            ? "Flux audio/video bloque malgre le relais TURN : reessayez ou changez de reseau."
            : "Aucun relais TURN dans ce deploiement : ajoutez les variables VITE_TURN_* sur Vercel puis redeployez.",
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

function initialState(): CallManagerState {
  return {
    incoming: null,
    activeCallId: null,
    activeConvId: null,
    peerName: "",
    callType: "audio",
    role: null,
    isGroup: false,
    isInitiator: false,
    participantNames: {},
    localStream: null,
    remoteStreams: {},
    micOn: true,
    camOn: true,
    endedAt: null,
    error: null,
  }
}

let state: CallManagerState = initialState()
const stateListeners = new Set<() => void>()

let callerRingtoneAudio: HTMLAudioElement | null = null
let calleeRingtoneAudio: HTMLAudioElement | null = null

function startPlayingCallerRingtone() {
  if (typeof window === "undefined") return
  const callsEnabled = localStorage.getItem("notif_calls") !== "false"
  if (!callsEnabled) return

  if (!callerRingtoneAudio) {
    callerRingtoneAudio = new Audio("/sounds/incoming_ring.mp3")
    callerRingtoneAudio.loop = true
  }
  callerRingtoneAudio.play().catch((err) => {
    console.warn("[CallManager] Failed to play caller ringtone:", err)
  })
}

function stopPlayingCallerRingtone() {
  if (callerRingtoneAudio) {
    callerRingtoneAudio.pause()
    callerRingtoneAudio.currentTime = 0
  }
}

function startPlayingCalleeRingtone() {
  if (typeof window === "undefined") return
  const callsEnabled = localStorage.getItem("notif_calls") !== "false"
  if (!callsEnabled) return

  if (!calleeRingtoneAudio) {
    calleeRingtoneAudio = new Audio("/sounds/assets_sounds_outgoing_ring.mp3")
    calleeRingtoneAudio.loop = true
  }
  calleeRingtoneAudio.play().catch((err) => {
    console.warn("[CallManager] Failed to play callee ringtone:", err)
  })
}

function stopPlayingCalleeRingtone() {
  if (calleeRingtoneAudio) {
    calleeRingtoneAudio.pause()
    calleeRingtoneAudio.currentTime = 0
  }
}

function setState(patch: Partial<CallManagerState>) {
  const prevIncoming = state.incoming
  const prevRole = state.role
  state = { ...state, ...patch }
  
  if (state.incoming && !prevIncoming) {
    startPlayingCalleeRingtone()
  } else if (!state.incoming && prevIncoming) {
    stopPlayingCalleeRingtone()
  }

  if (state.role === "outgoing" && prevRole !== "outgoing") {
    startPlayingCallerRingtone()
  } else if (state.role !== "outgoing" && prevRole === "outgoing") {
    stopPlayingCallerRingtone()
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

/* ----------------- Mesh + signalisation ----------------- */

const peers = new Map<string, PeerSession>()
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

/** Regle d'offreur identique au mobile : le plus petit UUID cree l'offre. */
function shouldOffer(myId: string, peerId: string): boolean {
  return myId < peerId
}

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

async function connectToPeer(peerId: string) {
  const me = myUserId()
  const callId = state.activeCallId
  if (!me || !callId || peerId === me || peers.has(peerId)) return

  const isVideo = state.callType === "video"
  let stream: MediaStream
  try {
    stream = await ensureLocalStream(isVideo)
  } catch {
    setState({
      error: isVideo ? "Micro et camera requis pour l'appel." : "Micro requis pour l'appel.",
    })
    return
  }
  const iceServers = await loadIceServers()

  const session = new PeerSession(
    peerId,
    isVideo,
    shouldOffer(me, peerId),
    stream,
    iceServers,
    (signal) => sendCallSignal(callId, peerId, signal),
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
  stopMesh()
  stopPlayingCallerRingtone()
  stopPlayingCalleeRingtone()
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
  })
  if (ringTimeoutId) {
    clearTimeout(ringTimeoutId)
    ringTimeoutId = null
  }
  await connectToPeer(userId)
  if (state.activeCallId) await flushBufferedSignals(state.activeCallId)
}

async function handleServerEvent(event: CallServerEvent) {
  if (event.type === "incoming_call") {
    const callId = String(event.callId ?? "")
    if (!callId) return
    // Deja en appel : on laisse sonner cote serveur sans interrompre l'appel courant.
    if (state.activeCallId || state.incoming) return
    setState({
      incoming: {
        callId,
        convId: (event.convId as string | null) ?? null,
        callType: event.callType === "VIDEO" ? "video" : "audio",
        callerId: String(event.callerId ?? ""),
        callerName: String(event.callerName ?? "Appel"),
        isGroup: Boolean(event.isGroup),
        groupName: (event.groupName as string | null) ?? null,
        memberCount: Number(event.memberCount ?? 2),
      },
      endedAt: null,
      error: null,
    })
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

    if (callState === "joined" || callState === "accepted") {
      if (userId === me) return // echo de notre propre "joined"
      if (callId === state.activeCallId || callId === state.incoming?.callId) {
        await onPeerJoined(userId ?? "", displayName)
      }
      return
    }

    if (callState === "left" || callState === "declined") {
      if (userId === me) return
      if (callId === state.activeCallId && userId) {
        removePeer(userId)
        // Appel direct : si l'autre part, l'appel est fini pour nous aussi.
        if (!state.isGroup) {
          void hangUp()
        }
      }
      return
    }

    if (callState === "rejected" || callState === "ended") {
      if (fromUserId === me) return // echo de notre propre raccrochage
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
    throw new Error("Un appel entrant est en cours. Repondez-y d'abord.")
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
      started = await startCallRest(convId, type)
    } else {
      throw err
    }
  }
  sendCallRing(started.id)

  const participantNames: Record<string, string> = {}
  for (const callee of started.callees ?? []) {
    participantNames[callee.userId] = callee.pseudo ?? callee.publicNumber ?? "Membre"
  }

  setState({
    activeCallId: started.id,
    activeConvId: convId,
    peerName: started.isGroup ? (started.groupName ?? title) : title,
    callType: type,
    role: "outgoing",
    isGroup: started.isGroup,
    isInitiator: true,
    participantNames,
    endedAt: null,
    error: null,
  })

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
      error:
        type === "video" ? "Micro et camera requis pour l'appel." : "Micro requis pour l'appel.",
    })
  }

  return started.id
}

/** Accepte l'appel entrant courant. Renvoie l'id de l'appel rejoint. */
export async function acceptIncomingCall(): Promise<string | null> {
  const incoming = state.incoming
  const me = myUserId()
  if (!incoming || !me) return null

  const result = await acceptCallRest(incoming.callId)

  const participantNames: Record<string, string> = { ...state.participantNames }
  for (const participant of result.activeParticipants ?? []) {
    participantNames[participant.userId] = participant.displayName
  }

  setState({
    activeCallId: incoming.callId,
    activeConvId: incoming.convId,
    peerName: incoming.isGroup ? (incoming.groupName ?? incoming.callerName) : incoming.callerName,
    callType: incoming.callType,
    role: "ongoing",
    isGroup: result.isGroup || incoming.isGroup,
    isInitiator: false,
    participantNames,
    incoming: null,
    endedAt: null,
    error: null,
  })

  sendCallState(incoming.callId, "joined", me, myDisplayName())

  try {
    await ensureLocalStream(incoming.callType === "video")
  } catch {
    setState({
      error:
        incoming.callType === "video"
          ? "Micro et camera requis pour l'appel."
          : "Micro requis pour l'appel.",
    })
  }

  for (const participant of result.activeParticipants ?? []) {
    if (participant.userId !== me) {
      await connectToPeer(participant.userId)
    }
  }
  await flushBufferedSignals(incoming.callId)

  return incoming.callId
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
      if (wasGroup && !wasInitiator && wasRole === "ongoing") {
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
export function acknowledgeCallEnded() {
  if (state.endedAt !== null || state.error !== null) {
    setState({ endedAt: null, error: null })
  }
}
