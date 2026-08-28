import { getMyUserId, loadSessionUser } from "../data/session-user"
import { loadSessionToken } from "../data/session-auth"
import { ApiError } from "../lib/api-client"
import { isCustomRingtone, RINGTONES, ringtoneSource, ringtoneUrl } from "./ringtones"
import { sonneriePourAppelant } from "./contact-lists-service"
import { defaultAudioOutput, type AudioOutputMode } from "./audio-output"
import {
  demarrerEnregistrement,
  attacherVoixDistante,
  arreterEtDeposer,
  enregistrementEnCours,
} from "./enregistrement-appel"
import {
  acceptCallRest,
  callbackCallRest,
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
  sendIvrBack,
  subscribeToCallEvents,
  subscribeToMeetingEvents,
  sendMeetingSignal,
  sendMeetingJoin,
  sendMeetingLeave,
  sendMeetingScreen,
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
 * - offreur = celui qui est DEJA dans l'appel, envers celui qui arrive. Regle
 *   POSITIONNELLE, et non une comparaison d'UUID : voir `connectToPeer` ;
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
  /** Alanya ID du centre qui a route cet appel vers moi (agent) — voir CallManagerState.activeIvrFromId. */
  ivrFromId: string | null
}

/**
 * Etape d'un appel passe a un standard (centre d'appels). Deux seulement : des
 * que l'agent decroche, la session disparait et l'appel redevient ordinaire.
 */
/**
 * Les etapes d'un standard, les deux sortes confondues.
 *
 * `attente` n'existe que pour un centre d'APPELS (on attend un agent),
 * `lecture` que pour un centre VOCAL (un son tourne en boucle).
 */
export type IvrStep = "menu" | "attente" | "lecture" | "enregistrement"

/**
 * Une touche du menu. `disponible` vient du serveur : un service peut etre
 * ANNONCE par l'invite vocale sans qu'aucun agent ne le desserve encore.
 */
export interface IvrOption {
  digit: number
  /** `center.libelle` — nom interne de la ligne. Repli d'affichage seulement. */
  label: string
  disponible: boolean
  /**
   * `center.nom_service` — le nom du service tel qu'il doit etre MONTRE.
   *
   * Nul quand la colonne est vide ; le serveur normalise deja, mais on renormalise
   * a la lecture. Les deux regles d'affichage n'en font pas le meme usage : sur le
   * pave on retombe sur `label`, sous le nom du centre on n'affiche RIEN.
   */
  nomService: string | null
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
  /**
   * Ce standard est-il un CENTRE VOCAL ? (`mode: "vocal"` sur `ivr_menu`.)
   *
   * ⚠️ Faux par defaut : un serveur plus ancien n'envoie pas ce champ, et le
   * seul standard qu'il sache ouvrir est un centre d'appels. Le defaut inverse
   * transformerait tous les standards existants en centres vocaux le jour d'un
   * retour en arriere du serveur.
   */
  vocal: boolean
  step: IvrStep
  /**
   * Ce qui joue en ce moment, pendant `step: "lecture"` — nul hors de cet etat.
   *
   * Vient d'`ivr_play` et non d'une recherche dans `options` par la touche : un
   * retour a l'accueil peut avoir remplace la liste entre-temps.
   */
  titreEnLecture: string | null
  /** La touche dont le son joue, pour la mettre en evidence sur le pave. */
  toucheEnLecture: number | null
  /**
   * Le bip a jouer AVANT de demarrer l'enregistrement d'une plainte, ou nul.
   *
   * ⚠️ Nul est un cas NORMAL, pas une panne : la variable d'environnement du
   * serveur peut ne pas etre renseignee, ou designer un dossier. On demarre
   * alors sans annonce plutot que de ne pas demarrer.
   */
  bipEnregistrementUrl: string | null
  /**
   * Plafond de duree d'une plainte, donne par le serveur avec `ivr_record`.
   *
   * Recu et non code en dur : la borne pourra changer sans redeployer le web,
   * comme la regle de boucle d'`ivr_play`. Le defaut ne sert qu'au cas ou un
   * serveur plus ancien l'omettrait.
   */
  plainteMaxMs: number
  /** Libelle du service choisi, pendant que l'agent sonne. */
  serviceChoisi: string | null
  /**
   * `nom_service` du service choisi, ou nul si la colonne est vide.
   *
   * Affiche sous le nom du centre pendant la mise en relation, et RIEN quand il
   * est nul. Distinct de `serviceChoisi` : replier sur le libelle mettrait un nom
   * interne sous les yeux de l'appelant.
   */
  nomServiceChoisi: string | null
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
  /**
   * Centre qui a route l'appel EN COURS vers moi (agent) — voir
   * `IncomingCallInfo.ivrFromId`. Nul pour un appel ordinaire. Sert au
   * bouton "Liste d'attente" de l'ecran d'appel (demande user 15/08/2026).
   */
  activeIvrFromId: string | null
  peerName: string
  /** Photo du correspondant : affichee a la place des initiales quand elle existe. */
  peerAvatarUrl: string | null
  /**
   * Ce qui manque au media local dans une reunion : rien, la camera seule, ou
   * tout. On entre desormais dans une salle meme sans micro ni camera ; ce champ
   * permet a l'ecran de le DIRE, ce qui est la contrepartie de ne plus refuser
   * l'entree. Vaut toujours « aucun » hors reunion.
   */
  mediaManquant: "aucun" | "camera" | "tout"
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
  /**
   * `idHist` recu via `queue_rating_available`, en attente d'etre montre.
   *
   * Arrive quasi toujours APRES la remise a `initialState()` par `hangUp` :
   * notre propre raccrochage nettoie l'etat local avant que le serveur ait
   * fini de traiter l'`ended` qu'on vient de lui envoyer — c'est pour ca que
   * ce champ SURVIT a la remise a zero (voir la fonction de nettoyage), comme
   * `error`. Consomme une seule fois via `consumePendingRating`.
   */
  pendingRatingIdHist: string | null
  /**
   * MA piste video sortante est-elle un ecran, et non ma camera ?
   *
   * Verite LOCALE, posee par `demarrerPartageEcran` / `arreterPartageEcran` et
   * jamais deduite de `partageParPeerId` : a deux presentateurs simultanes, ce
   * dernier ne designe qu'une seule personne, alors que mon propre ecran, lui,
   * continue de partir chez les pairs. Deduire l'un de l'autre afficherait « vous
   * ne presentez plus » a quelqu'un qui presente encore.
   */
  partageParMoi: boolean
  /**
   * QUI a coupe son micro, parmi les pairs de la salle.
   *
   * Rien dans WebRTC ne dit qu'un correspondant s'est coupe : `track.muted`
   * decrit une piste qui n'arrive PAS (reseau, source absente), pas une piste
   * volontairement fermee — couper son micro met `enabled` a faux chez
   * l'emetteur, ce qui laisse partir des trames de silence et ne change RIEN
   * chez le recepteur. L'information ne peut donc que se DIRE.
   *
   * Le mobile la dit deja, par un `meeting_signal` portant `kind:
   * "meeting_state"`. Le web ne l'emettait ni ne la lisait : chaque camp
   * affichait l'autre micro ouvert en permanence.
   *
   * Absent d'une entree = jamais annonce = suppose ouvert. C'est le bon defaut :
   * afficher « coupe » sur un silence reseau ferait taire quelqu'un qui parle.
   */
  peersMuted: Record<string, boolean>
  /**
   * QUI presente, moi ou un autre, ou personne — l'ecran que la salle met en
   * grand.
   *
   * Vient du serveur (`meeting_screen`), y compris pour mon propre partage : une
   * piste d'ecran emprunte le meme tuyau qu'une camera, et rien dans WebRTC ne
   * dit ce qu'elle montre. Sans ce verbe, un ecran partage arriverait chez les
   * autres comme une vignette de visage.
   *
   * Un seul nom alors que le serveur accepte DEUX presentateurs : c'est au client
   * de trancher ce qu'il met en grand, et la regle retenue est « le dernier
   * annonce ». Le serveur diffusant une seule sequence d'evenements, tous les
   * participants designent la meme personne.
   */
  partageParPeerId: string | null
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
  /** Une renegociation a ete demandee pendant une negociation en vol. */
  private renegociationDemandee = false
  /** Qui cede en cas de collision d'offres. Voir le commentaire a la creation. */
  private poli = false
  private pendingSignals: WebrtcSignal[] = []
  private iceQueue: RTCIceCandidateInit[] = []
  remoteStream: MediaStream | null = null

  constructor(
    private readonly peerId: string,
    private readonly isVideo: boolean,
    private readonly isOfferer: boolean,
    /**
     * Le flux local, ou NUL — l'ecoute seule.
     *
     * Nul est une valeur legitime et non un oubli : on entre dans une reunion
     * sans micro ni camera, et une connexion sans rien a emettre RECOIT
     * parfaitement. Voir `declarerLesMedias`.
     *
     * Non `readonly` : le media peut revenir en cours de session — l'utilisateur
     * finit par accorder son micro — et la connexion existe alors deja. Voir
     * `ajouterPisteLocale`.
     */
    private localStream: MediaStream | null,
    private readonly iceServers: RTCIceServer[],
    private readonly onSendSignal: (signal: WebrtcSignal) => void,
    private readonly onUpdated: () => void
  ) {}

  async start() {
    if (this.started) return
    this.started = true

    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    // COLLISION D'OFFRES. Deux pairs qui renegocient dans le meme tour — deux
    // partages d'ecran lances ensemble — s'envoyaient chacun une offre, et
    // chacun rejetait celle de l'autre : les deux connexions restaient en
    // « have-local-offer » DEFINITIVEMENT, video morte pour le reste de la
    // reunion, sans qu'aucun geste ne puisse en sortir.
    //
    // La regle est celle du canevas standard : l'un des deux est POLI et cede,
    // l'autre tient. La politesse se decide par comparaison d'identifiants, donc
    // a l'identique des deux cotes et sans se concerter — et par une comparaison
    // qui les DEPARTAGE forcement, contrairement a un tirage au sort.
    this.poli = (myUserId() ?? "") > this.peerId
    pc.addEventListener("signalingstatechange", () => {
      if (pc.signalingState !== "stable" || !this.renegociationDemandee) return
      this.renegociationDemandee = false
      void this.renegocier()
    })
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

    /*
     * UNE PISTE QUI ARRIVE SANS FLUX NE DOIT PLUS ETRE JETEE.
     *
     * `event.streams` est VIDE des que la ligne media d'en face n'annonce aucun
     * `msid`. Ce n'est pas un cas theorique : c'est celui d'un emetteur declare
     * par `addTransceiver` — donc sans flux associe — puis rempli par
     * `replaceTrack`. Autrement dit le partage d'ecran d'un poste entre SANS
     * webcam, exactement ce que l'ecoute seule a rendu possible.
     *
     * Le `if` d'avant faisait sortir sans rien poser. La piste d'ecran passait
     * alors bel et bien sur le fil — direction et codecs negocies — mais
     * n'atteignait jamais `remoteStreams`, donc jamais l'element <video> de la
     * salle. Chacun mettait le presentateur en vedette devant un cadre NOIR, et
     * comme la vedette prend toute la scene, le spectateur ne voyait plus rien
     * du tout : ni l'ecran annonce, ni la vignette d'avant. Le presentateur,
     * lui, voyait son propre ecran et se croyait suivi.
     *
     * On reprend donc le flux deja constitue pour ce pair et on y AJOUTE la
     * piste. Reprendre le MEME objet est ce qui compte : l'element <video> de la
     * salle pointe deja dessus, et une piste ajoutee a un flux vivant s'affiche
     * sans qu'il faille rebrancher quoi que ce soit.
     *
     * Cette garde vaut aussi pour l'interoperabilite : rien n'oblige un pair —
     * l'application mobile, un client plus ancien — a annoncer un `msid`, et le
     * seul fait qu'il n'en annonce pas ne doit pas rendre son image invisible.
     */
    pc.ontrack = (event) => {
      const flux = event.streams[0] ?? this.remoteStream ?? new MediaStream()
      if (!flux.getTracks().includes(event.track)) flux.addTrack(event.track)
      this.remoteStream = flux
      this.onUpdated()
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

    this.declarerLesMedias(pc)

    if (this.isOfferer) {
      // L'emission de l'offre ne doit JAMAIS remonter jusqu'a l'appelant.
      //
      // Depuis que l'offreur se decide par comparaison d'identifiants — pour
      // s'accorder au mobile — cette branche est atteinte par `acceptIncomingCall`
      // un decrochage sur deux, ce qui n'etait pas le cas quand on y passait
      // toujours `asOfferer: false`. Or l'unique site d'appel, dans le composant
      // de mise en page, lance `acceptIncomingCall()` sans `.catch` : une pile
      // WebRTC en etat invalide laissait l'utilisateur sur sa liste, sans ecran
      // d'appel ni bouton pour raccrocher, pendant que son correspondant l'entend
      // « connecte » — l'accuse de reception etant deja parti. Seul un
      // rechargement de page en sortait.
      //
      // On note l'echec et on continue : les pairs suivants doivent etre
      // connectes, et les signaux deja recus doivent etre appliques.
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: this.isVideo,
        })
        await pc.setLocalDescription(offer)
        this.onSendSignal({ kind: "offer", sdp: offer.sdp, type: offer.type })
      } catch (err) {
        console.warn("[CallManager] offre impossible pour ce pair", err)
      }
    }

    const pending = this.pendingSignals.splice(0)
    for (const signal of pending) {
      await this.applySignal(signal)
    }
  }

  /**
   * Declare a cette connexion ce qu'elle EMET, et ce qu'elle ATTEND.
   *
   * L'ECOUTE SEULE TIENT TOUTE ENTIERE ICI. Cette methode ne se contente pas
   * d'ajouter les pistes locales : la ou il n'y en a pas, elle declare une ligne
   * media en RECEPTION SEULE. Une connexion sans rien a emettre reste
   * parfaitement capable de recevoir — encore faut-il que la negociation porte
   * la ligne correspondante.
   *
   * Sans cela, une session ouverte sans flux local negociait une connexion
   * VIDE : ni son ni image dans aucun sens. C'est ce qui rendait l'ecoute seule
   * impossible, et c'est pourquoi `connectToPeer` renoncait plutot que d'ouvrir
   * une session muette et aveugle.
   *
   * Une seule piste de chaque sorte, et l'audio d'abord : l'ordre des lignes
   * media est celui de leur declaration, et le mobile construit le meme. Le
   * `getTracks()` d'avant laissait cet ordre a la main du navigateur.
   *
   * La video n'est declaree que dans une session VIDEO : ouvrir une ligne video
   * dans une reunion audio la ferait negocier pour rien.
   */
  private declarerLesMedias(pc: RTCPeerConnection) {
    const flux = this.localStream
    const audio = flux?.getAudioTracks()[0]
    if (flux && audio) pc.addTrack(audio, flux)
    else pc.addTransceiver("audio", { direction: "recvonly" })

    if (!this.isVideo) return
    const video = flux?.getVideoTracks()[0]
    if (flux && video) pc.addTrack(video, flux)
    else pc.addTransceiver("video", { direction: "recvonly" })
  }

  /**
   * Ajoute une piste locale a une connexion DEJA OUVERTE — le retour du media.
   *
   * On est entre en ecoute seule, et le micro finit par etre accorde. La
   * mecanique de `replaceVideoTrack` ne convient pas ici : elle substitue une
   * piste a une autre sur un emetteur qui EMET deja, alors que la ligne a ete
   * negociee en reception seule. Il faut en changer le SENS, et ce changement
   * doit etre renegocie ; voir `renegocier`, que l'appelant enchaine.
   *
   * ⚠️ ON REPREND LA LIGNE EXISTANTE, ON N'EN OUVRE PAS UNE SECONDE.
   *
   * `addTrack` faisait ce travail tout seul — il reprend un transceiver en
   * reception seule et le passe en emission-reception — mais SEULEMENT tant que
   * ce transceiver n'a JAMAIS EMIS. La regle est dans la specification, et elle
   * mord ici : qui entre sans camera, partage son ecran, puis arrete ce partage,
   * laisse derriere lui une ligne video qui a deja emis. La camera reprise
   * ensuite n'y retournait pas — `addTrack` ouvrait une SECONDE ligne video.
   *
   * Ce qu'il en coutait, mesure au banc : le pair se retrouvait avec deux pistes
   * video dans le meme flux, la premiere morte et la seconde vivante. Un
   * element <video> n'affiche que la PREMIERE — le correspondant restait donc
   * noir pour toujours, camera reprise ou nouveau partage, sans que rien ne le
   * signale. Et `replaceVideoTrack`, cherchant « la » ligne video, n'avait plus
   * de reponse unique a donner.
   *
   * On substitue donc la piste sur la ligne qui existe, quitte a n'en ouvrir une
   * qu'a defaut. `setStreams` va avec : une ligne posee par `addTransceiver`
   * n'a aucun flux associe, et sans lui le pair recevrait la piste sans rien ou
   * l'accrocher — voir `replaceVideoTrack`, meme cause, meme remede.
   */
  async ajouterPisteLocale(piste: MediaStreamTrack, flux: MediaStream): Promise<boolean> {
    const pc = this.pc
    if (!pc) return false
    this.localStream = flux

    const ligne = pc
      .getTransceivers()
      .find(
        (item) =>
          item.receiver.track?.kind === piste.kind &&
          !item.sender.track &&
          item.currentDirection !== "stopped"
      )
    if (ligne) {
      try {
        await ligne.sender.replaceTrack(piste)
        if (typeof ligne.sender.setStreams === "function") ligne.sender.setStreams(flux)
        if (ligne.direction === "recvonly") ligne.direction = "sendrecv"
        else if (ligne.direction === "inactive") ligne.direction = "sendonly"
        return true
      } catch (err) {
        // La ligne existante s'est derobee : on retombe sur l'ouverture d'une
        // nouvelle, qui vaut mieux que de rester muet.
        console.warn(`[webrtc] reprise de la ligne ${piste.kind} impossible :`, err)
      }
    }

    try {
      pc.addTrack(piste, flux)
      return true
    } catch (err) {
      console.warn(`[webrtc] piste ${piste.kind} refusee par la connexion (${this.peerId}) :`, err)
      return false
    }
  }

  /**
   * Renvoie une offre sur une connexion etablie.
   *
   * Obligatoire des qu'une ligne change de sens : une piste ajoutee a une
   * connexion negociee en reception seule ne part nulle part tant que le pair
   * n'a pas accepte la nouvelle description. C'est la difference avec le
   * changement de camera et le partage d'ecran, qui substituent une piste a une
   * autre sans toucher a la negociation.
   *
   * ⚠️ Cette offre part meme quand c'est le PAIR qui avait offert le premier :
   * une renegociation n'a pas de role fixe, contrairement a l'etablissement. Si
   * les deux bouts retrouvent leur micro dans la meme fraction de seconde, les
   * deux offres se croisent et l'une des deux est refusee par le pair — il n'y a
   * pas de rattrapage ici. Le cas est rare, sans consequence sur l'existant, et
   * se repare en refaisant le geste.
   *
   * On n'offre que depuis un etat « stable » : une negociation deja en vol se
   * conclura d'elle-meme avec la piste, qui est deja attachee a la connexion.
   */
  async renegocier() {
    const pc = this.pc
    if (!pc) return
    if (pc.signalingState !== "stable") {
      // ON DIFFERE AU LIEU D'ABANDONNER. Renoncer en silence laissait la piste
      // posee sans jamais partir : la direction avait bien bascule, mais aucune
      // offre ne la portait. Le drapeau est rejoue des le retour a « stable ».
      this.renegociationDemandee = true
      return
    }
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.onSendSignal({ kind: "offer", sdp: offer.sdp, type: offer.type })
    } catch (err) {
      console.warn(`[webrtc] renegociation impossible avec ${this.peerId}`, err)
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
        if (pc.signalingState !== "stable") {
          if (!this.poli) {
            // L'impoli garde la sienne : l'autre cedera, et sa renegociation
            // differee repartira toute seule au retour a « stable ».
            return
          }
          // Le poli remballe son offre pour accepter celle d'en face. Sans ce
          // retour en arriere, `setRemoteDescription` jetterait et la connexion
          // resterait bloquee.
          await pc.setLocalDescription({ type: "rollback" })
          this.renegociationDemandee = true
        }
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

  /**
   * Substitue la piste video sortante chez ce pair, SANS renegocier.
   *
   * `null` est une valeur legitime et non un oubli : c'est ainsi qu'on cesse
   * d'emettre de la video sans fermer la connexion — le cas d'un partage d'ecran
   * arrete dans une reunion AUDIO, ou il n'y avait aucune camera a rendre.
   * Sans elle, le dernier cadre de l'ecran resterait fige chez les autres.
   */
  /**
   * Rend VRAI quand la connexion doit etre renegociee pour que la piste parte.
   *
   * `replaceTrack` reussit meme sur un transceiver en RECEPTION SEULE, et ne
   * transmet alors rien. C'est le cas de qui rejoint une reunion video sans
   * camera : la ligne video a ete negociee en `recvonly`, et un partage d'ecran
   * lance depuis ce poste s'annoncait a toute la salle sans jamais y arriver —
   * chacun mettait le presentateur en vedette devant une vignette vide pendant
   * que lui voyait son propre ecran et se croyait en presentation.
   *
   * Changer la direction ne suffit pas : elle ne prend effet qu'a la
   * renegociation, que l'appelant declenche une fois toutes les pistes posees.
   */
  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<boolean> {
    const pc = this.pc
    if (!pc) return false
    /*
     * UNE SEULE LIGNE, CHOISIE UNE SEULE FOIS — l'emetteur et le transceiver
     * doivent etre les DEUX BOUTS DU MEME m-line.
     *
     * Ils etaient cherches separement : le transceiver par la premiere ligne
     * qui touche a la video dans un sens OU DANS L'AUTRE, l'emetteur par la
     * premiere piste video posee. Tant qu'il n'y a qu'une ligne video, les deux
     * recherches tombent sur la meme et rien ne se voit. Des qu'il y en a DEUX,
     * elles divergent en silence : la piste est substituee sur une ligne
     * pendant que la direction est corrigee sur une AUTRE. Mesure au banc — la
     * piste d'ecran partait sur la ligne 2, la direction etait relue sur la
     * ligne 1, et personne ne renegociait ce qu'il fallait.
     *
     * Deux lignes video sur une meme connexion ne sont pas une vue de l'esprit :
     * `addTrack` ne REUTILISE jamais un transceiver qui a deja emis, si bien
     * qu'une camera reprise en cours de reunion — apres un partage termine — en
     * ouvre une seconde. Voir `ajouterPisteLocale`.
     *
     * On prend donc le transceiver EN PREMIER, et l'emetteur est le sien. Meme
     * ordre de preference qu'avant : une ligne qui emet deja de la video
     * l'emporte, a defaut celle qui en recoit — `sender.track` peut etre nul,
     * piste retiree ou emetteur pas encore associe, et sans ce repli le
     * correspondant resterait sur l'ancienne image apres un changement de
     * camera.
     */
    const lignes = pc.getTransceivers()
    const transceiver =
      lignes.find((item) => item.sender.track?.kind === "video") ??
      lignes.find((item) => item.receiver.track?.kind === "video")
    const sender = transceiver?.sender
    if (!sender) return false
    try {
      await sender.replaceTrack(track)
    } catch (err) {
      console.warn(`[webrtc] remplacement de la piste video refuse (${this.peerId}) :`, err)
      return false
    }
    if (!track || !transceiver) return false
    if (transceiver.direction === "recvonly" || transceiver.direction === "inactive") {
      transceiver.direction = "sendrecv"
      /*
       * ET IL FAUT AUSSI LUI DONNER UN FLUX — sans quoi la piste part et
       * n'arrive nulle part.
       *
       * Cette ligne a ete declaree par `addTransceiver` : son emetteur n'a
       * AUCUN flux associe, et `replaceTrack` ne lui en donne pas. L'offre
       * annonce alors `a=msid:-`, le pair recoit bien la piste, mais son
       * evenement `track` arrive avec `streams` VIDE — et une piste sans flux
       * n'a rien ou s'afficher. Basculer la direction faisait passer les
       * paquets ; il manquait de quoi les rattacher a l'arrivee.
       *
       * `this.localStream` est le meme objet que le flux local du module :
       * `appliquerPisteVideo` remplace les PISTES qu'il contient sans jamais
       * changer le flux lui-meme, si bien que son identifiant — le `msid` que
       * porte le SDP — reste celui deja annonce pour l'audio. Les deux pistes
       * arrivent donc dans le meme flux chez le pair, comme pour un poste qui
       * avait sa camera des l'entree.
       *
       * `setStreams` est verifiee avant d'etre appelee : elle manque aux
       * navigateurs les plus anciens, et son absence ne doit pas faire echouer
       * la bascule de direction, qui elle vaut toujours mieux que rien. Le
       * `ontrack` du pair sait desormais recoudre une piste sans flux.
       */
      if (this.localStream && typeof sender.setStreams === "function") {
        sender.setStreams(this.localStream)
      }
      return true
    }
    return false
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
    activeIvrFromId: null,
    peerName: "",
    peerAvatarUrl: null,
    mediaManquant: "aucun",
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
    pendingRatingIdHist: null,
    partageParMoi: false,
    peersMuted: {},
    partageParPeerId: null,
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
  // Lecture GARDEE, et ce n'est pas une precaution de principe : un navigateur
  // qui refuse le stockage au site leve `SecurityError` a la simple lecture, et
  // cette fonction est appelee depuis `setState()` AVANT que les abonnes soient
  // prevenus. L'exception traversait donc `setState`, la boucle des abonnes
  // n'etait jamais atteinte, et l'appel entrant restait dans l'etat interne sans
  // que rien ne s'affiche ni ne sonne : un appel perdu en silence. Le doute
  // profite a l'appel — sans reglage lisible, on sonne.
  let callsEnabled = true
  try {
    callsEnabled = localStorage.getItem("notif_calls") !== "false"
  } catch {
    callsEnabled = true
  }
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

/** Une chaine vide vaut absence : elle afficherait une ligne blanche. */
function texteOuNull(brut: unknown): string | null {
  const s = typeof brut === "string" ? brut.trim() : ""
  return s.length > 0 ? s : null
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
      // Le libelle vient du centre d'appels ; le repli, lui, est a nous, donc
      // il se traduit — c'est un bouton du menu, en toutes lettres a l'ecran.
      label: typeof o.label === "string" ? o.label : tr("v2_ivr_service", { digit }),
      // Absent = disponible : un serveur anterieur ne connait pas ce champ, et
      // tout griser serait pire que de laisser essayer.
      disponible: o.disponible !== false,
      nomService: texteOuNull(o.nomService),
    })
  }
  return options
}

/**
 * Vrai si la sonnerie designee peut donner un son jouable.
 *
 * C'est le controle que le chemin ORDINAIRE fait par `isKnownFile()` dans
 * `ringtoneFile()`, et que celui-ci n'avait pas : la chaine vient du serveur, via
 * le miroir des listes, et partait telle quelle dans `ringtoneSource()`.
 * `isKnownFile()` n'est pas exporte, et il ne conviendrait pas tel quel — la
 * distinction ci-dessous n'a de sens que pour une sonnerie de LISTE :
 *
 *  - sonnerie FOURNIE (un nom de fichier) : `RINGTONES` est le catalogue complet,
 *    fige a la compilation, identique sur tous les appareils. Un nom absent ne
 *    designe rien, ni ici ni ailleurs, ni aujourd'hui ni demain — on l'ecarte ;
 *  - sonnerie IMPORTEE (une URL `/api/media/...`) : `customRingtones()` est une
 *    liste LOCALE a cet appareil, alors que la sonnerie d'une liste appartient au
 *    COMPTE. Une sonnerie importee depuis le mobile ou depuis un autre navigateur
 *    est parfaitement jouable ici — le media vit sur le serveur, seul l'inventaire
 *    de ce qui a ete importe est local. Exiger qu'elle figure au catalogue local
 *    rendrait muettes des sonneries valides, c'est-a-dire creerait le defaut qu'on
 *    repare. On ne verifie donc que la forme, et c'est le repli du `catch` qui
 *    rattrape le media efface ou refuse.
 */
function sonnerieResoluble(sonnerie: string): boolean {
  if (isCustomRingtone(sonnerie)) return true
  return RINGTONES.some((entree) => entree.file === sonnerie)
}

/**
 * URL de la sonnerie que la liste de contacts de l'appelant impose, ou `null`
 * pour laisser le choix ordinaire de l'appareil s'appliquer.
 *
 * Tout est enveloppe, sans exception qui puisse en sortir : cette recherche est
 * un CONFORT pose sur le trajet d'un appel entrant, et `setState()` n'a pas de
 * filet. Une exception qui remonterait — miroir de listes abime, stockage refuse
 * par le navigateur, jeton de session absent au moment de resoudre un media —
 * empecherait l'ecran d'appel de s'afficher, c'est-a-dire ferait rater l'appel
 * pour une histoire de son. Au moindre doute, la sonnerie ordinaire.
 */
function sonnerieDeListe(callerId: string): string | null {
  try {
    const sonnerie = sonneriePourAppelant(callerId)
    if (!sonnerie) return null
    // Ecarte AVANT de retenir, comme `ringtoneFile()` : une sonnerie qui ne
    // designe plus rien ne doit pas meme etre tentee.
    if (!sonnerieResoluble(sonnerie)) return null
    // Une URL vide est ce que rend le resolveur de medias quand il n'a rien a
    // resoudre : injouable, donc autant garder la sonnerie ordinaire.
    return ringtoneSource(sonnerie) || null
  } catch (err) {
    console.warn("[CallManager] sonnerie de liste ignoree :", err)
    return null
  }
}

/**
 * Jeton de la sonnerie entrante en cours.
 *
 * Le repli ci-dessous s'arme dans le `catch` de `play()`, donc APRES coup : entre
 * le lancement et le rejet de la promesse, l'appel a pu etre decroche, refuse,
 * abandonne par l'appelant, ou pris sur un autre appareil. Sans ce jeton, le
 * repli rallumerait la sonnerie d'un appel deja termine — un telephone qui sonne
 * dans le vide, sans plus rien pour l'arreter. `stopIncomingRingtone()`
 * l'incremente pour cette seule raison.
 */
let jetonSonnerieEntrante = 0

/**
 * Joue `url` en boucle, et retombe sur `repli` si elle se revele injouable.
 *
 * Ce repli EST le correctif : le controle prealable ne voit ni un media efface
 * (404) ni un jeton de session perime (401), qui ne se manifestent qu'ICI, au
 * rejet de la promesse. Sans lui, une sonnerie de liste devenue inaccessible rend
 * l'appel entrant TOTALEMENT silencieux — et un appel qu'on n'entend pas est un
 * appel rate, ce qui est pire que n'importe quelle mauvaise sonnerie.
 *
 * Un seul repli, jamais en chaine : `repli` vaut `null` au second tour. La
 * sonnerie ordinaire echoue elle aussi quand le navigateur refuse la lecture
 * automatique — l'onglet n'a jamais ete clique — et il n'y a alors plus rien a
 * tenter, seulement une boucle a ne pas ouvrir.
 */
function jouerSonnerieEntrante(url: string, repli: string | null, jeton: number) {
  // L'element est conserve d'un appel a l'autre. La comparaison porte sur l'URL
  // DEJA resolue, celle qu'on va jouer : deux appelants de listes differentes
  // donnent deux URLs differentes, donc l'element est bien reconstruit au lieu
  // de rejouer la sonnerie de l'appel precedent.
  if (!incomingRingtoneAudio || incomingRingtoneAudio.dataset.source !== url) {
    incomingRingtoneAudio = new Audio(url)
    incomingRingtoneAudio.dataset.source = url
    incomingRingtoneAudio.loop = true
  }
  incomingRingtoneAudio.play().catch((err) => {
    console.warn("[CallManager] sonnerie d'appel entrant injouable :", err)
    if (repli === null) return
    // La sonnerie annoncee n'est plus celle qu'on attend : ne rien rallumer.
    if (jeton !== jetonSonnerieEntrante) return
    jouerSonnerieEntrante(repli, null, jeton)
  })
}

function startIncomingRingtone(callerId: string) {
  if (typeof window === "undefined") return
  // Lecture GARDEE, et ce n'est pas une precaution de principe : un navigateur
  // qui refuse le stockage au site leve `SecurityError` a la simple lecture, et
  // cette fonction est appelee depuis `setState()` AVANT que les abonnes soient
  // prevenus. L'exception traversait donc `setState`, la boucle des abonnes
  // n'etait jamais atteinte, et l'appel entrant restait dans l'etat interne sans
  // que rien ne s'affiche ni ne sonne : un appel perdu en silence. Le doute
  // profite a l'appel — sans reglage lisible, on sonne.
  let callsEnabled = true
  try {
    callsEnabled = localStorage.getItem("notif_calls") !== "false"
  } catch {
    callsEnabled = true
  }
  // Coupe tout AVANT meme de chercher une sonnerie de liste : le reglage general
  // prime, une liste ne rend pas la voix a des appels rendus muets.
  if (!callsEnabled) return

  // Un appel de groupe ne demande aucune regle a part : `callerId` y designe
  // toujours celui qui appelle, pas le groupe.
  const ordinaire = ringtoneUrl("incoming")
  const url = sonnerieDeListe(callerId) ?? ordinaire
  // Pas de repli quand c'est deja la sonnerie ordinaire qui joue : il n'y aurait
  // rien de plus sur en dessous.
  jouerSonnerieEntrante(url, url === ordinaire ? null : ordinaire, ++jetonSonnerieEntrante)
}

function stopIncomingRingtone() {
  // Invalide un repli encore en vol : voir `jetonSonnerieEntrante`.
  jetonSonnerieEntrante++
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
    startIncomingRingtone(state.incoming.callerId)
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

/** Lit puis efface l'evaluation en attente — a appeler au plus une fois par appel. */
export function consumePendingRating(): string | null {
  const v = state.pendingRatingIdHist
  if (v) setState({ pendingRatingIdHist: null })
  return v
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
  if (!session || session.envoiEnCours) return
  /*
   * ⚠️ UN CENTRE VOCAL ACCEPTE UNE TOUCHE PENDANT LA LECTURE (demande du user,
   * 18/08/2026) : on passe d'un son a l'autre sans repasser par l'accueil. Un
   * centre d'appels, lui, n'accepte rien pendant qu'un agent sonne.
   */
  const peutTaper =
    session.step === "menu" || (session.vocal && session.step === "lecture")
  if (!peutTaper) return
  setState({ ivr: { ...session, envoiEnCours: true, message: null } })
  /*
   * ⚠️ ON NE COUPE RIEN SUR UN CENTRE VOCAL, et c'est ce qui rend le refus
   * indolore : si la touche est acceptee, `ivr_play` rappelle `playIvrAudio`,
   * qui coupe lui-meme ce qui jouait ; si elle est refusee, l'accueil ou le son
   * en cours n'a jamais ete interrompu. Couper d'abord laisserait un silence
   * definitif derriere un simple appui a cote.
   *
   * Sur un centre d'appels le geste reste necessaire : l'invite tournerait
   * sinon sous la musique d'attente, deux sons superposes.
   */
  if (!session.vocal) stopIvrAudio()
  sendIvrDtmf(session.callId, digit)
}

/**
 * « Retour a l'accueil » d'un centre vocal.
 *
 * Ne change RIEN localement : le serveur repond par un `ivr_menu` complet, qui
 * rebatit la session et relance l'invite. Anticiper l'etat ici ferait diverger
 * les deux si le message se perdait, et laisserait surtout un ecran sans son.
 */
export function sendIvrBackToMenu() {
  const session = state.ivr
  if (!session || !session.vocal) return
  // ⚠️ `enregistrement` DOIT passer ici aussi. La garde ne laissait entrer que
  // `lecture` : pendant qu'un appelant dicte une plainte, le bouton « Accueil »
  // etait donc INERTE, et il ne lui restait que le raccrochage pour sortir.
  //
  // Le mobile portait le MEME defaut, corrige le 20/08/2026, et le serveur
  // aussi avant lui. Une regle partagee entre TROIS bouts se corrige aux trois
  // — c'est la quatrieme fois que ce projet paie cet oubli.
  if (session.step !== "lecture" && session.step !== "enregistrement") return
  sendIvrBack(session.callId)
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

/**
 * Qui partage son ecran dans la salle, dans l'ordre ou les annonces sont
 * arrivees. La vedette revient au DERNIER encore actif ; retirer quelqu'un rend
 * donc automatiquement la vedette au precedent, au lieu de la laisser vide.
 *
 * Videe en meme temps que `salleReunion` : un reste d'une reunion precedente
 * mettrait un absent en grand des l'entree dans la suivante.
 */
let presentateurs: string[] = []
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

/**
 * Nom que l'on annonce aux autres participants.
 *
 * Le repli s'affiche sur LEUR ecran, pas sur le notre : il part donc dans la
 * langue de celui qui appelle, faute de savoir celle d'en face. C'est deja
 * mieux qu'un « Utilisateur Alanya » francais pour tout le monde — dans le cas
 * courant, les deux bouts lisent la meme langue.
 */
function myDisplayName(): string {
  return loadSessionUser()?.name ?? tr("v2_alanya_user")
}

/**
 * 🔴 CETTE FONCTION A ETE RETIREE — ET IL NE FAUT PAS LA REECRIRE.
 *
 * Elle comparait les identifiants (`me < peerId`) au motif que le mobile ferait
 * de meme, en citant `webrtc_group_mesh.dart` :
 *
 *     static bool shouldOffer(String myId, String peerId) => myId.compareTo(peerId) < 0;
 *
 * ⚠️ CETTE FONCTION N'EXISTE PAS dans le depot Flutter, et n'y a jamais existe
 * sous cette forme. `webrtc_group_mesh.dart` ne DECIDE rien : il RECOIT le role
 * en parametre — `connectToPeer(String peerId, {required bool asOfferer})` — et
 * ce sont ses appelants qui tranchent, POSITIONNELLEMENT :
 *
 *  - `call_controller.dart:662` et `:760` (j'accepte, j'arrive) → asOfferer: false
 *  - `call_controller.dart:1342`  (quelqu'un arrive, j'etais la) → asOfferer: true
 *  - `meeting_controller.dart:646` (les presents, j'arrive)      → asOfferer: false
 *  - `meeting_controller.dart:671` (il entre apres moi)          → asOfferer: true
 *
 * Le raisonnement etait juste, la premisse fausse : aligner le web sur une regle
 * que le mobile n'applique pas a produit exactement la panne que ce commentaire
 * decrivait. Avec W l'identifiant du web et M celui du mobile, sur un appel
 * web → mobile (le web est deja la, le mobile arrive en decrochant) :
 *
 *  - W < M : le web offre, le mobile recoit — l'appel passe ;
 *  - W > M : le web n'offre pas (il n'est pas le plus petit) et le mobile non
 *    plus (il arrive) — AUCUNE offre, « connexion en cours » indefiniment.
 *
 * ⚠️ Le resultat est DETERMINISTE PAR PAIRE DE COMPTES : pour deux comptes
 * donnes, l'appel echoue toujours, ou reussit toujours. C'est ce qui le fait
 * passer pour un probleme de reseau. Le defaut avait deja frappe a l'identique
 * le 06/08/2026, dans l'autre sens.
 *
 * REGLE, DEFINITIVE : celui qui est DEJA dans l'appel offre a celui qui arrive.
 * Elle ne se decide pas ici mais chez l'appelant, qui SEUL sait lequel des deux
 * il est — c'est une information d'evenement, pas une propriete des identifiants.
 *
 * ⚠️ Les REUNIONS suivaient la comparaison d'UUID depuis toujours
 * (`offreReunionPour`), alors que `meeting_controller.dart` est POSITIONNEL lui
 * aussi. Elles avaient donc le meme defaut, jamais remarque faute d'avoir teste
 * la bonne paire de comptes. Elles passent a la regle positionnelle ici meme.
 *
 * On aligne le web sur le mobile et non l'inverse : le web se deploie en une
 * poussee, le parc mobile installe ne se met pas a jour sur commande.
 */

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
    // Une reunion n'est pas un appel : son identifiant n'existe pas dans
    // /api/calls, et la terminer n'aurait de toute facon pas de sens — on la
    // QUITTE, par le salon. La salle s'en charge en partant.
    if (salleReunion !== null) return
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
  // Le flux distant apparait ICI, apres le decrochage : seul moment fiable pour
  // brancher la voix du correspondant sur un enregistrement deja demarre.
  brancherVoixDistanteSiPossible()
}

/**
 * Branche la voix du correspondant sur l'enregistrement en cours, si sa piste
 * distante est deja la. Idempotent (la facade garde l'etat) : sans effet s'il
 * n'y a rien a enregistrer ou si c'est deja fait.
 */
function brancherVoixDistanteSiPossible() {
  if (!enregistrementEnCours()) return
  for (const session of peers.values()) {
    if (session.remoteStream && session.remoteStream.getAudioTracks().length > 0) {
      attacherVoixDistante(session.remoteStream)
      return
    }
  }
}

/**
 * Ce qu'on demande a la camera, et pourquoi ce n'est pas « true ».
 *
 * Demander `video: true` laisse le navigateur choisir, et il choisit du PAYSAGE
 * — 16/9, typiquement 1280 x 720. Or les vignettes sont en `object-fit: cover`,
 * qui agrandit l'image jusqu'a remplir le cadre et coupe ce qui depasse. Sur un
 * telephone tenu droit, un cadre presque carre recevait donc une image deux fois
 * plus large que haute : elle etait agrandie du double, et l'on ne voyait plus
 * qu'un visage en gros plan. Ce n'etait pas un zoom, c'etait du RECADRAGE.
 *
 * On demande donc une image dont la forme SUIT CELLE DE L'ECRAN. En portrait,
 * l'image arrive portrait, le recadrage devient marginal, et le cadrage retrouve
 * les epaules et l'arriere-plan. En paysage, rien ne change.
 *
 * `ideal` et non `exact` : une camera qui ne sait pas produire cette forme
 * repond au mieux plutot que d'echouer. Un `exact` refuse ferait retomber toute
 * l'entree en reunion sur la cascade « pas de camera », pour une question de
 * cadrage.
 *
 * 960 sur le grand cote, pas 1280 : dans un maillage, chacun encode son image
 * autant de fois qu'il a d'interlocuteurs. Les pixels qu'on economise ici sont
 * economises cinq fois a six participants — et personne ne regarde une vignette
 * de reunion en haute definition.
 */
function contraintesVideo(): MediaTrackConstraints {
  const portrait =
    typeof window !== "undefined" && window.matchMedia?.("(orientation: portrait)")?.matches
  return {
    facingMode: "user",
    width: { ideal: portrait ? 540 : 960 },
    height: { ideal: portrait ? 960 : 540 },
  }
}

async function ensureLocalStream(isVideo: boolean): Promise<MediaStream> {
  if (localStream) return localStream
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: isVideo ? contraintesVideo() : false,
  })
  // `mediaManquant` est remis a jour ICI, et pas seulement a l'entree en salle.
  //
  // Cette fonction est rappelee a CHAQUE pair : entre en ecoute seule, puis
  // autorise le micro depuis le cadenas du navigateur sans toucher au bouton
  // « Reessayer », l'appel suivant reussissait — les pistes partaient, la
  // moitie de la salle nous entendait — mais le drapeau restait fige sur
  // « tout ». Le bandeau continuait d'affirmer « personne ne vous entend » a
  // quelqu'un qui parlait, et le bouton du micro restait inerte puisque l'ecran
  // se regle sur ce drapeau : impossible de se couper.
  //
  // Ce qui manque se lit sur les PISTES obtenues, jamais sur ce qu'on esperait.
  const aVideo = localStream.getVideoTracks().length > 0
  setState({
    localStream,
    micOn: localStream.getAudioTracks().length > 0,
    camOn: aVideo,
    mediaManquant: isVideo && !aVideo ? "camera" : "aucun",
  })
  return localStream
}

async function loadIceServers(): Promise<RTCIceServer[]> {
  if (!iceServersCache) iceServersCache = await fetchIceServers()
  return iceServersCache
}

/**
 * Ouvre la connexion WebRTC avec un pair.
 *
 * `asOfferer` : celui qui est DEJA dans l'appel emet l'offre a celui qui arrive.
 * Regle POSITIONNELLE, identique a `webrtc_group_mesh.dart` du mobile, qui la
 * recoit lui aussi en parametre.
 *
 * ⚠️ CE PARAMETRE NE PEUT PAS ETRE REMPLACE PAR UN CALCUL LOCAL. « Suis-je
 * arrive avant lui ? » ne se lit ni dans mon identifiant ni dans le sien : c'est
 * l'EVENEMENT qui le dit, et lui seul. Le supprimer au nom d'un point de
 * decision unique a casse les appels web → mobile — voir le pave au-dessus de
 * `connectToPeer`.
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
  const enReunion = salleReunion !== null

  /*
   * SANS FLUX LOCAL, ON POURSUIT — DANS UNE REUNION.
   *
   * L'ECOUTE SEULE SE JOUE ICI, ET NULLE PART AILLEURS. Cette fonction posait
   * `error` et RETOURNAIT des que `getUserMedia` echouait : aucune session
   * n'etait construite, donc aucune offre, aucune reponse, et rien de recu. Le
   * participant sans micro etait pourtant inscrit dans le salon — les autres le
   * voyaient entrer — et restait dans le noir et le silence pendant que le
   * bandeau lui affirmait qu'il voyait et entendait tout le monde. Avoir leve le
   * refus d'entree sans lever ce renoncement-ci n'avait donc rien repare : ca
   * avait remplace une porte fermee par un mensonge a l'ecran.
   *
   * Une connexion sans piste a emettre RECOIT parfaitement — voir
   * `declarerLesMedias`. On construit donc la session quand meme.
   *
   * LES APPELS ORDINAIRES GARDENT L'ANCIEN COMPORTEMENT, deliberement. Leur
   * ecran ne lit pas `mediaManquant` — le champ vaut toujours « aucun » hors
   * reunion — et n'a aucun bandeau pour dire qu'on n'est pas entendu. Y ouvrir
   * l'ecoute seule installerait, dans un appel a deux ou l'autre parlerait seul
   * dans le vide, exactement le mensonge qu'on retire de la reunion. Le jour ou
   * l'ecran d'appel saura le dire, il n'y aura que cette garde a retirer.
   *
   * `error` n'est pas le signal de l'ecoute seule : c'est `mediaManquant`, pose
   * par `joinMeetingRoom`, qui le porte jusqu'a l'ecran.
   */
  let stream: MediaStream | null = null
  try {
    stream = await ensureLocalStream(isVideo)
  } catch {
    if (!enReunion) {
      setState({
        error: isVideo ? tr("call_need_mic_cam") : tr("call_need_mic"),
      })
      return
    }
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
  /*
   * Le presentateur s'en va : le serveur annonce lui-meme la fin de son partage
   * avant son depart, mais on referme aussi ici. Un serveur anterieur a ce
   * verbe, ou une trame perdue, laisserait sinon la salle en plein ecran sur un
   * flux qui n'appartient plus a personne.
   *
   * On le retire de la LISTE des presentateurs et pas seulement de la vedette.
   * L'y laisser le faisait revenir en grand cadre — absent, et sur son dernier
   * cadre fige — des que le presentateur SUIVANT s'arretait : la vedette est
   * « le dernier encore actif » de cette liste, et son depart ne l'en effacait
   * pas. Recalculer la vedette rend du meme coup le grand cadre a celui qui
   * presente encore, au lieu de le refermer sur tout le monde.
   */
  const rang = presentateurs.indexOf(peerId)
  if (rang !== -1) {
    presentateurs.splice(rang, 1)
    setState({ partageParPeerId: presentateurs[presentateurs.length - 1] ?? null })
  } else if (state.partageParPeerId === peerId) {
    setState({ partageParPeerId: null })
  }
  publishRemoteStreams()
}

function stopMesh() {
  for (const session of peers.values()) session.close()
  peers.clear()
  localStream?.getTracks().forEach((track) => track.stop())
  localStream = null
  // La piste d'ecran vit dans `localStream` et vient donc d'etre arretee ; ce
  // qu'on oublie ici, c'est la memoire du partage. Sans cette remise, la camera
  // notee avant la presentation serait rouverte au beau milieu de l'appel
  // SUIVANT, et `partageParMoi` — remis a faux par `initialState` — ne
  // correspondrait plus a ces variables restees pleines.
  pisteEcran = null
  cameraAvantPartage = null
  // Une demande d'arret mise en attente n'a plus d'objet : la laisser vraie
  // ferait avorter le PROCHAIN partage des la fin de son installation.
  arretEcranDemandePendantInstallation = false
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
  presentateurs = []
  annulerSolitude()
  attendus.clear()
  invitationsEnVol = 0
  salleAEteHabitee = false
  // ⚠️ AVANT `stopMesh()` : l'arret des `MediaRecorder` doit etre declenche
  // pendant que les pistes sont encore vivantes, sinon le dernier morceau se
  // perd. `arreterEtDeposer` appelle `.stop()` de facon synchrone avant son
  // premier `await`, donc avant que `stopMesh` ne coupe les pistes juste apres.
  // Volontairement NON attendu : le depot se poursuit seul, l'appel est fini.
  void arreterEtDeposer()
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
    pendingRatingIdHist: state.pendingRatingIdHist,
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
      [userId]: displayName?.trim() || state.participantNames[userId] || tr("participant"),
    },
    role: state.role === "outgoing" ? "ongoing" : state.role,
    progress: "ongoing",
  })
  if (ringTimeoutId) {
    clearTimeout(ringTimeoutId)
    ringTimeoutId = null
  }
  // Nous sommes DEJA dans l'appel, ce pair vient d'arriver : nous offrons.
  // En 1-a-1 cet evenement est le decrochage de l'appele, et c'est donc
  // l'appelant qui offre — le chemin direct, celui qui a toujours marche.
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
        callerName: String(event.callerName ?? tr("call")),
        callerAvatarUrl,
        isGroup: Boolean(event.isGroup),
        groupName: (event.groupName as string | null) ?? null,
        memberCount: Number(event.memberCount ?? 2),
        ivrFromId: (event.ivrFromId as string | null) ?? null,
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
      centerName: String(event.centerName ?? state.peerName ?? tr("v2_call_center")),
      centerNumber: (event.centerNumber as string | null) ?? null,
      promptUrl: (event.promptUrl as string | null) ?? null,
      holdUrl: (event.holdUrl as string | null) ?? null,
      options: parseIvrOptions(event.options),
      // ⚠️ CE MESSAGE ARRIVE AUSSI AU RETOUR A L'ACCUEIL d'un centre vocal : le
      // serveur y repond en renvoyant `ivr_menu` plutot qu'en inventant un
      // message dedie. Session neuve et invite relancee sont exactement ce
      // qu'on veut alors.
      vocal: event.mode === "vocal",
      step: "menu",
      titreEnLecture: null,
      toucheEnLecture: null,
      bipEnregistrementUrl: null,
      plainteMaxMs: 3 * 60 * 1000,
      serviceChoisi: null,
      nomServiceChoisi: null,
      message: null,
      envoiEnCours: false,
    }
    setState({
      ivr: session,
      peerName: session.centerName,
      peerAvatarUrl: (event.centerAvatarUrl as string | null) ?? state.peerAvatarUrl,
    })
    // ⚠️ `promptLoop` VIENT DU SERVEUR, il n'est plus decide ici. Il valait
    // `true` depuis toujours cote serveur, et le mobile le respectait : le web
    // etait le seul a jouer l'invite une fois. Divergence sans consequence
    // visible jusqu'ici (aucune interface web n'affiche de standard), mais un
    // centre vocal dont l'accueil s'arrete au bout d'un tour laisserait un
    // ecran muet sans rien pour l'expliquer.
    if (session.promptUrl) playIvrAudio(session.promptUrl, event.promptLoop !== false)
    return
  }

  if (event.type === "ivr_record") {
    /*
     * Touche 0 d'un centre vocal : l'appelant va dicter une plainte.
     *
     * ⚠️ ON NE DEMARRE PAS LE MICRO ICI. Le serveur donne le depart ; c'est le
     * composant d'enregistrement qui enchaine, bip d'abord et micro ensuite,
     * parce que lui seul sait quand la lecture se termine. Le serveur ne
     * connait ni la duree du fichier ni le temps de mise en cache.
     *
     * Meme decoupage que sur mobile, volontairement : les deux clients doivent
     * se comporter pareil devant le meme evenement.
     */
    const session = state.ivr
    if (!session || String(event.callId ?? "") !== session.callId) return
    const borne = typeof event.maxMs === "number" ? event.maxMs : 0
    setState({
      ivr: {
        ...session,
        step: "enregistrement",
        toucheEnLecture: null,
        titreEnLecture: null,
        bipEnregistrementUrl: (event.bipUrl as string | null) ?? null,
        plainteMaxMs: borne > 0 ? borne : session.plainteMaxMs,
        message: null,
        envoiEnCours: false,
      },
    })
    // Coupe l'invite d'accueil, qui tourne en boucle : sans cela elle
    // couvrirait le bip puis la voix de l'appelant.
    stopIvrAudio()
    return
  }

  if (event.type === "ivr_play") {
    // Centre vocal : la touche ne fait sonner personne, elle joue un son.
    const session = state.ivr
    if (!session || String(event.callId ?? "") !== session.callId) return
    const url = (event.audioUrl as string | null) ?? null
    if (!url) return
    const digit = typeof event.digit === "number" ? event.digit : null
    setState({
      ivr: {
        ...session,
        step: "lecture",
        toucheEnLecture: digit,
        // `nomService` d'abord, `label` en repli — le second est le nom du
        // centre vocal, que le serveur envoie pour les touches sans titre.
        titreEnLecture: texteOuNull(event.nomService) ?? ((event.label as string | null) ?? null),
        message: null,
        envoiEnCours: false,
      },
    })
    // EN BOUCLE, et la regle vient du SERVEUR (`loop`) plutot que d'etre ecrite
    // ici : la changer ne demandera aucun deploiement du client.
    playIvrAudio(url, event.loop !== false)
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
        nomServiceChoisi: texteOuNull(event.nomService),
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

    /*
     * ⚠️ UN REFUS QUI NE CHANGE RIEN NE DOIT RIEN COUPER (centre vocal).
     *
     * Une touche invalide ou indisponible laisse le serveur EXACTEMENT ou il
     * etait — au menu, ou en train de jouer un son. Couper l'audio et repasser
     * au menu comme pour un centre d'appels arreterait le son pour une touche
     * qui n'a rien lance, et afficherait une etape que le serveur ne partage
     * pas. `retry: false` reste une vraie fin, traitee comme partout ailleurs.
     */
    const enCours = state.ivr
    const refusSansEffet =
      enCours !== null && enCours.vocal && retry && callId === enCours.callId
    if (!refusSansEffet) stopIvrAudio()

    const session = state.ivr
    if (refusSansEffet && session) {
      const maj = parseIvrOptions(event.options)
      setState({
        ivr: {
          ...session,
          options: maj.length > 0 ? maj : session.options,
          message,
          envoiEnCours: false,
        },
      })
      return
    }
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

  if (event.type === "queue_rating_available") {
    // Envoye par le serveur a la cloture d'un appel passe par un centre (voir
    // `handleCallState` de ws-server.mjs), une fois que l'appel a reellement
    // atteint un agent. On le garde sans condition sur l'appel actif — voir
    // la doc du champ dans `CallManagerState`.
    const idHist = event.idHist ? String(event.idHist) : null
    if (idHist) setState({ pendingRatingIdHist: idHist })
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
        setState({ transferPending: false, error: tr("v2_transfer_declined") })
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
    participantNames[callee.userId] = callee.pseudo ?? callee.publicNumber ?? tr("v2_member")
    attendus.add(callee.userId)
  }

  setState({
    activeCallId: started.id,
    activeConvId: convId,
    // Un appel sortant ordinaire n'est jamais routé par un centre.
    activeIvrFromId: null,
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

/**
 * Rappelle un client SOUS LE NOM DU CENTRE (demande user 15/08/2026), depuis
 * l'ecran "Clients abandonnes". Meme deroule que [startOutgoingCall] — seule
 * la creation differe (`/api/queue/callback` au lieu de `/api/calls`) : le
 * reste (flux local, minuteur de sonnerie, renvoi du call_ring) est
 * identique, l'agent est ici aussi l'appelant reel.
 */
export async function startCallbackCall(
  centerAlanyaID: string,
  customerId: string,
  title: string
): Promise<string> {
  ensureEventSubscription()

  if (state.incoming) {
    throw new Error(tr("call_answer_incoming_first"))
  }
  if (state.activeCallId !== null || state.role !== null) {
    await hangUp()
  }

  const started = await callbackCallRest(centerAlanyaID, customerId)
  sendCallRing(started.id)

  const participantNames: Record<string, string> = {}
  attendus.clear()
  for (const callee of started.callees ?? []) {
    participantNames[callee.userId] = callee.pseudo ?? callee.publicNumber ?? tr("v2_member")
    attendus.add(callee.userId)
  }

  setState({
    activeCallId: started.id,
    activeConvId: started.convId,
    activeIvrFromId: null,
    peerName: title,
    peerAvatarUrl: started.callees?.[0]?.avatarUrl ?? null,
    callType: "audio",
    role: "outgoing",
    progress: "ringtone",
    isGroup: false,
    isInitiator: true,
    participantNames,
    audioOutput: defaultAudioOutput(),
    endedAt: null,
    error: null,
  })

  void backfillPeerAvatar(started.id, started.convId)

  ringTimeoutId = setTimeout(() => {
    if (state.role === "outgoing" && state.activeCallId === started.id) {
      void hangUp()
    }
  }, RING_TIMEOUT_MS)

  for (const delayMs of [4000, 10000]) {
    setTimeout(() => {
      if (state.role === "outgoing" && state.activeCallId === started.id) {
        sendCallRing(started.id)
      }
    }, delayMs)
  }

  try {
    await ensureLocalStream(false)
  } catch {
    setState({ error: tr("call_need_mic") })
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
    activeIvrFromId: null,
    peerName: title,
    peerAvatarUrl: null,
    mediaManquant: "aucun",
    callType: type,
    role: "ongoing",
    progress: "ongoing",
    isGroup: true,
    isInitiator: false,
    participantNames: {},
    micOn: true,
    camOn: type === "video",
    audioOutput: type === "video" ? "speaker" : defaultAudioOutput(),
    // Entrer dans une salle remet la taille a « plein » : la salle rend
    // elle-meme le media, et une taille reduite heritee d'un appel precedent y
    // superposerait la fenetre flottante — avec ses propres <audio>, donc
    // chaque voix jouee deux fois.
    displayMode: "full",
    localStream: null,
    remoteStreams: {},
    endedAt: null,
    error: null,
  })

  // Le flux local AVANT d'annoncer son arrivee : les autres offrent des
  // reception de `meeting_user_joined`, et une offre negociee sans piste
  // etablit une connexion parfaitement muette.
  //
  // ON ENTRE TOUJOURS, meme sans micro ni camera — mais on le DIT.
  //
  // Cette entree refusait l'acces quand le media manquait. Le raisonnement de
  // l'epoque etait juste et sa conclusion fausse : entrer muet sans que rien a
  // l'ecran ne le signale est mauvais, mais on ne repare pas une interface
  // muette en interdisant la porte. Un poste fixe sans webcam ne pouvait pas
  // rejoindre une reunion video, alors qu'il aurait parfaitement pu y parler.
  //
  // CASCADE, comme le font les autres services de reunion : la camera et le
  // micro d'abord ; a defaut le micro seul ; a defaut on entre en simple
  // auditeur. `mediaManquant` porte le resultat jusqu'a l'ecran, qui affiche un
  // bandeau permanent et propose de reessayer l'autorisation — c'est lui qui
  // remplace le refus, et c'est ce qui manquait.
  let mediaManquant: "aucun" | "camera" | "tout" = "aucun"
  try {
    await ensureLocalStream(type === "video")
  } catch {
    if (type === "video") {
      try {
        await ensureLocalStream(false)
        mediaManquant = "camera"
      } catch {
        mediaManquant = "tout"
      }
    } else {
      mediaManquant = "tout"
    }
  }
  /*
   * LES BOUTONS DISENT LA VERITE DES PISTES.
   *
   * `micOn` et `camOn` sont poses plus haut, AVANT la cascade, alors que
   * personne ne sait encore ce que le navigateur accordera. La branche « tout »
   * ne les corrigeait jamais : la barre montrait un micro OUVERT a quelqu'un qui
   * n'a aucune piste audio — un bouton qui promet qu'on est entendu, et qui
   * invite meme a « se couper » d'un micro inexistant. Sans piste, ces drapeaux
   * sont faux, et `toggleMicrophone` / `toggleCamera` refusent desormais de les
   * relever.
   */
  setState({
    mediaManquant,
    micOn: mediaManquant !== "tout",
    camOn: mediaManquant === "aucun" && type === "video",
  })
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

  // SALLE PLEINE : on sort, et on le DIT.
  //
  // C'est la seule barriere qui protege reellement le maillage — la route HTTP,
  // elle, compte des lignes de base qu'une coupure brutale laisse perimees. Sans
  // ce traitement, le refuse restait indefiniment seul dans une salle fantome,
  // camera et micro ouverts, sans le moindre message : rien ne ferme l'ecran
  // d'une reunion, `verifierSolitude` ne s'y applique pas.
  //
  // Le message vient du serveur, mais l'ecran le traduit a partir du CODE et des
  // deux nombres : le texte du serveur n'est jamais traduit, et l'application
  // parle neuf langues.
  if (event.type === "error" && String(event.code ?? "") === "MEETING_FULL") {
    const plafond = Number(event.plafond ?? 0)
    const actuel = Number(event.actuel ?? 0)
    setState({
      error: tr("meet_full_room", { plafond: String(plafond), actuel: String(actuel) }),
    })
    await hangUp()
    return
  }

  if (event.type === "meeting_joined") {
    // Ceux qui etaient deja la : c'est a eux d'offrir, on se contente de tenir
    // la session prete a recevoir leur offre. Meme role que
    // `meeting_controller.dart:646` cote mobile.
    const presents = Array.isArray(event.participants) ? (event.participants as string[]) : []
    for (const id of presents) await connectToPeer(id, false)
    return
  }

  if (event.type === "meeting_user_joined") {
    // L'arrivant n'etait pas la quand les autres se sont annonces : sans ce
    // rappel il verrait tous les micros ouverts, y compris les coupes.
    diffuserEtatMedia(String(event.userId ?? "") || undefined)
    const id = String(event.userId ?? "")
    if (!id) return
    const nom = String(event.displayName ?? "")
    if (nom) {
      setState({ participantNames: { ...state.participantNames, [id]: nom } })
    }
    // Il entre APRES moi : j'offre. Deux evenements distincts portent les deux
    // roles, donc deux pairs ne peuvent jamais s'offrir mutuellement.
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

  if (event.type === "meeting_screen") {
    /*
     * QUI presente. Le serveur l'envoie a TOUT LE MONDE, l'auteur compris, et
     * le rejoue a celui qui entre au milieu d'une presentation — ce dernier
     * recoit bien la piste video, mais rien d'autre ne lui dirait que c'est un
     * ecran et non un visage.
     *
     * Mon propre partage passe par ici comme les autres, mais ne touche que
     * `partageParPeerId` : `partageParMoi` reste pose localement, sans quoi une
     * trame perdue au retour eteindrait mon bouton alors que mon ecran continue
     * de partir chez les pairs.
     *
     * Le serveur accepte DEUX presentateurs a la fois ; ce champ n'en nomme
     * qu'un, et la regle est « le dernier annonce ». Comme tout le monde recoit
     * la meme sequence d'evenements, tout le monde met le meme en grand.
     */
    const auteur = String(event.fromUserId ?? "")
    if (!auteur) return
    // On tient l'ENSEMBLE des presentateurs, pas seulement le dernier annonce.
    //
    // Le serveur accepte deliberement deux partages simultanes et relaie les
    // deux. Ne garder qu'un nom faisait disparaitre la vedette des que le SECOND
    // s'arretait : le premier presentait toujours, mais plus personne ne le
    // savait, et son ecran retombait en vignette de participant — recadre au
    // format visage et retourne en miroir. Aucun evenement ne serait venu
    // reconstruire l'information.
    //
    // La vedette revient au dernier ENCORE actif, ce que tous les participants
    // calculent a l'identique puisqu'ils recoivent la meme sequence.
    if (event.partage === true) {
      if (!presentateurs.includes(auteur)) presentateurs.push(auteur)
    } else {
      const rang = presentateurs.indexOf(auteur)
      if (rang !== -1) presentateurs.splice(rang, 1)
    }
    setState({ partageParPeerId: presentateurs[presentateurs.length - 1] ?? null })
    return
  }

  if (event.type === "meeting_mute") {
    /*
     * L'ORGANISATEUR DEMANDE UNE COUPURE — et c'est ICI qu'elle a lieu.
     *
     * Personne ne coupe un micro a distance : le flux est sur MON appareil, et
     * la trame n'est qu'une demande a laquelle mon application obeit. Ce qui
     * s'eteint, ce sont mes propres pistes, exactement comme si j'avais appuye
     * sur le bouton de la barre.
     *
     * ET C'EST BIEN LE BOUTON QU'ON RAPPELLE, pas un drapeau d'affichage :
     * `toggleMicrophone` et `toggleCamera` portent chacun des cas que rien ici
     * ne saurait refaire — le refus de bouger quand il n'y a aucune piste (on
     * est entre en ecoute seule), et pour la camera l'intention mise de cote
     * pendant un partage d'ecran, ou la piste video n'est PAS la camera. Poser
     * `track.enabled = false` a la main aurait eteint la presentation chez tout
     * le monde, et fait diverger l'etat des boutons de la verite des pistes.
     *
     * COUPER, JAMAIS BASCULER : on ne rappelle le bouton que si l'on est
     * effectivement ouvert. Une trame rejouee apres une reconnexion, ou deux
     * clics de l'organisateur, rallumeraient sinon le micro qu'ils devaient
     * couper. Rien n'empeche en revanche de se rallumer soi-meme juste apres :
     * c'est une coupure, pas un verrou.
     *
     * On ne verifie pas que l'expediteur est l'organisateur : c'est au SERVEUR
     * de le faire, lui seul sait qui a cree la reunion et lui seul ne peut pas
     * etre contourne. Le refaire ici ne protegerait personne.
     */
    if (String(event.toUserId ?? "") !== myUserId()) return
    if (event.media === "audio") {
      if (state.micOn) toggleMicrophone()
    } else if (event.media === "video") {
      if (state.camOn) toggleCamera()
    }
    return
  }

  if (event.type === "meeting_signal") {
    const from = String(event.fromUserId ?? "")
    if (!from) return

    // ⚠️ AVANT TOUT TRAITEMENT WebRTC. Cette trame n'est PAS une negociation :
    // laissee passer, elle serait mise en attente dans les signaux differes, ou
    // pire, ouvrirait une session en repondeur sur ce qui n'est pas une offre.
    const charge = event.signal as { kind?: string; muted?: boolean } | null
    if (charge?.kind === "meeting_state") {
      const coupe = charge.muted === true
      if (state.peersMuted[from] !== coupe) {
        setState({ peersMuted: { ...state.peersMuted, [from]: coupe } })
      }
      return
    }

    const session = peers.get(from)
    if (session) await session.handleSignal(event.signal as WebrtcSignal)
    else {
      // Signal arrive avant que la session existe : on l'ouvre, puis on lui
      // remet la trame. Il nous PARLE, donc c'est lui l'offreur — ouvrir en
      // offreur ici produirait une seconde offre croisee.
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
    activeIvrFromId: incoming.ivrFromId,
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

  // Enregistrement de l'appel si, et seulement si, le SERVEUR l'a autorise.
  // Sans entreprise de destination, le depot ne pourrait aboutir : on ne
  // demarre pas. La voix distante n'existe pas encore (negociation en cours) ;
  // `publishRemoteStreams` la branchera des qu'elle apparait.
  if (result.enregistrer && result.enregistrementCompanyId != null && localStream) {
    if (demarrerEnregistrement(incoming.callId, result.enregistrementCompanyId, localStream)) {
      brancherVoixDistanteSiPossible()
    }
  }

  for (const participant of result.activeParticipants ?? []) {
    if (participant.userId !== me) {
      // Une offre du pair a pu arriver AVANT cette ligne — c'est meme le cas
      // ordinaire quand la regle nous designe receveur. Elle est bufferisee par
      // `call_signal` et rejouee par le `flushBufferedSignals` d'apres la boucle.
      //
      // J'ARRIVE dans l'appel : ceux qui y sont deja m'enverront leur offre.
      // Meme role que `call_controller.dart:662` cote mobile.
      await connectToPeer(participant.userId, false)
    }
  }
  await flushBufferedSignals(incoming.callId)

  return incoming.callId
}

/** Ferme seulement la sonnerie/overlay de CET appareil (timeout ou autre appareil a décroché).
    Aucun endpoint reject/end n'est appelé : l'appel déjà accepté reste vivant. */
/**
 * Ferme l'ecran d'appel entrant SANS rien dire au serveur.
 *
 * ⚠️ PLUS AUCUN APPELANT depuis que l'echeance de 30 s refuse pour de bon :
 * disparaitre en silence laissait le serveur faire sonner 95 s dans le vide,
 * et l'appelant patienter une minute de plus. Gardee pour le cas ou il
 * faudrait un jour fermer l'ecran sans decider a la place de l'utilisateur —
 * mais si ce cas ne vient pas, elle est a supprimer.
 */
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
  const jePresentais = state.partageParMoi

  // Neutralise tout de suite pour ignorer les echos pendant le nettoyage.
  setState({ activeCallId: null })

  try {
    if (callId) {
      // Dans un groupe, même l'initiateur quitte individuellement après décrochage.
      // Le backend ne termine globalement que lorsqu'il reste moins de deux personnes.
      if (salleReunion !== null) {
        /*
         * JE PRESENTAIS : LA SALLE DOIT L'APPRENDRE AVANT MON DEPART.
         *
         * La capture, elle, s'arrete toute seule — la piste d'ecran vit dans
         * `localStream`, que `stopMesh` coupe. Ce qui manquait, c'est le VERBE :
         * sans lui, les autres gardent en grand cadre l'ecran de quelqu'un qui
         * n'est plus la, sur son dernier cadre fige.
         *
         * On ne s'en remet pas au serveur, qui eteint pourtant le partage de
         * lui-meme quand un presentateur quitte le salon : ce verbe-la lui est
         * posterieur, et l'annonce explicite ne coute qu'une trame, deja
         * idempotente chez ceux qui la recoivent deux fois.
         *
         * Rien n'est restaure ici — ni camera, ni bouton : l'appel s'acheve, et
         * `clearCall` remet tout l'etat a neuf juste apres.
         */
        if (jePresentais) sendMeetingScreen(salleReunion, false)
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

/**
 * Annonce MON etat micro/camera aux pairs de la salle.
 *
 * Convention du mobile, reprise a l'identique : un `meeting_signal` de pair a
 * pair portant `kind: "meeting_state"`. Le serveur relaie sans inspecter, il
 * n'a donc rien a apprendre.
 *
 * ⚠️ La MAIN LEVEE n'entre pas ici. Elle a son propre verbe serveur
 * (`meeting_hand`) : la joindre a cette annonce donnerait DEUX sources pour un
 * meme booleen, celle du serveur et celle-ci posee sur ma seule foi, qui
 * finiraient par se contredire. Le mobile prend la meme precaution.
 *
 * `versUnSeul` sert a l'arrivant : il n'etait pas la quand les autres se sont
 * annonces, et sans ce rappel il verrait tous les micros ouverts.
 */
function diffuserEtatMedia(versUnSeul?: string): void {
  if (salleReunion === null) return
  const moi = myUserId() ?? ""
  const charge = { kind: "meeting_state", muted: !state.micOn, cameraOff: !state.camOn }
  const cibles = versUnSeul ? [versUnSeul] : [...peers.keys()]
  for (const peerId of cibles) {
    if (peerId && peerId !== moi) sendMeetingSignal(salleReunion, peerId, charge as never)
  }
}

/** Coupe/retablit le micro (pistes audio locales). */
export function toggleMicrophone(): boolean {
  const pistes = localStream?.getAudioTracks() ?? []
  /*
   * SANS PISTE, LE BOUTON NE COMMANDE RIEN — il ne doit donc pas bouger.
   *
   * En ecoute seule, la bascule affichait un micro coupe puis rouvert sur un
   * micro qui n'existe pas : le second clic laissait croire qu'on venait de se
   * rendre audible. On renvoie l'etat courant — faux — et le bandeau de la salle
   * reste la seule chose qui parle du micro, avec son bouton de reprise.
   */
  if (pistes.length === 0) return state.micOn
  const next = !state.micOn
  pistes.forEach((track) => {
    track.enabled = next
  })
  setState({ micOn: next })
  // Les autres ne peuvent pas le DEDUIRE : on le leur dit.
  diffuserEtatMedia()
  return next
}

/**
 * COUPE le micro sans le rallumer — pour la coupure demandee par l'organisateur.
 *
 * Une BASCULE ne convient pas ici : appliquee a un micro deja coupe, elle le
 * ROUVRIRAIT. L'organisateur coupe un micro parce qu'il fait du bruit ; le
 * rouvrir serait l'exact contraire du geste demande, et l'interesse verrait
 * « votre micro a ete coupe » au moment ou il se met a emettre.
 *
 * Renvoie `true` si quelque chose a reellement ete coupe. Sans piste, il n'y a
 * rien a couper et rien a promettre.
 */
export function couperMicrophone(): boolean {
  const pistes = localStream?.getAudioTracks() ?? []
  if (pistes.length === 0) return false
  pistes.forEach((track) => {
    track.enabled = false
  })
  setState({ micOn: false })
  diffuserEtatMedia()
  return true
}

/**
 * COUPE la camera sans la rallumer. Meme raisonnement que pour le micro.
 *
 * Pendant un partage d'ecran, la piste video locale est l'ECRAN et non la
 * camera : la couper eteindrait la presentation chez tout le monde. On
 * n'enregistre alors que l'intention, honoree au retour de la camera —
 * exactement ce que fait deja la bascule.
 */
export function couperCamera(): boolean {
  if (state.partageParMoi) {
    if (cameraAvantPartage) cameraAvantPartage.camOn = false
    setState({ camOn: false })
    diffuserEtatMedia()
    return true
  }
  const pistes = localStream?.getVideoTracks() ?? []
  if (pistes.length === 0) return false
  pistes.forEach((track) => {
    track.enabled = false
  })
  setState({ camOn: false })
  diffuserEtatMedia()
  return true
}

/**
 * Installe une nouvelle piste video locale, et la pousse a TOUS les pairs.
 *
 * Sans le `replaceTrack` sur chaque connexion, les correspondants gardent
 * l'ancienne camera — figee, puisqu'elle vient d'etre arretee.
 *
 * `activee` dit si la piste doit EMETTRE, et vaut par defaut l'etat du bouton
 * camera : une piste neuve arrive toujours activee, et sans cela la camera se
 * rallumerait toute seule en changeant d'objectif. Le partage d'ecran, lui,
 * passe `true` explicitement — un ecran se partage le plus souvent camera
 * coupee, et le defaut l'aurait rendu noir chez tout le monde.
 */
async function appliquerPisteVideo(piste: MediaStreamTrack, activee = state.camOn): Promise<void> {
  if (!localStream) return
  piste.enabled = activee

  for (const ancienne of localStream.getVideoTracks()) {
    ancienne.stop()
    localStream.removeTrack(ancienne)
  }
  localStream.addTrack(piste)

  // Les pairs dont la ligne video etait en reception seule ont vu leur direction
  // changer : elle ne prend effet qu'a la renegociation, et sans elle la piste
  // resterait posee sans jamais partir.
  const sessions = [...peers.values()]
  const aRenegocier = await Promise.all(sessions.map((peer) => peer.replaceVideoTrack(piste)))
  await Promise.all(
    sessions.filter((_, rang) => aRenegocier[rang]).map((peer) => peer.renegocier())
  )
  setState({ localStream })
}

/** Cesse d'emettre de la video chez tous les pairs, sans fermer les connexions. */
async function retirerLaPisteVideo(): Promise<void> {
  if (localStream) {
    for (const ancienne of localStream.getVideoTracks()) {
      ancienne.stop()
      localStream.removeTrack(ancienne)
    }
    setState({ localStream })
  }
  await Promise.all([...peers.values()].map((peer) => peer.replaceVideoTrack(null)))
}

/**
 * Reprend le media refuse a l'entree, SANS quitter la salle.
 *
 * Le pendant de l'ecoute seule : on est entre sans micro, l'autorisation est
 * accordee en cours de reunion, et les connexions existent deja — negociees en
 * reception seule. Il ne s'agit donc pas de remplacer une piste (le mecanisme du
 * changement de camera et du partage d'ecran) mais d'en AJOUTER une la ou il n'y
 * en avait pas, ce qui change le sens d'une ligne media et impose une
 * renegociation par pair. Voir `PeerSession.ajouterPisteLocale` et
 * `PeerSession.renegocier`.
 *
 * Ce que ca remplace : ressortir de la salle pour y rentrer. C'est ce que fait
 * encore le bouton « Reessayer » de l'ecran de reunion — il rappelle
 * `joinMeetingRoom`, qui raccroche tout et refait les connexions une a une. Ca
 * marche, mais tout le monde voit le revenant sortir et rentrer.
 *
 * Ce qui manque se lit sur les PISTES, jamais sur `mediaManquant` : le drapeau
 * dit ce qui manquait a l'entree, les pistes disent ce qu'on a maintenant.
 *
 * Renvoie ce qui manque ENCORE, « aucun » quand tout est revenu.
 */
export async function reprendreLeMediaLocal(): Promise<CallManagerState["mediaManquant"]> {
  if (!state.activeCallId) return state.mediaManquant
  const veutVideo = state.callType === "video"
  const aAudio = () => (localStream?.getAudioTracks().length ?? 0) > 0
  const aVideo = () => (localStream?.getVideoTracks().length ?? 0) > 0

  if (!aAudio() || (veutVideo && !aVideo())) {
    // Cascade identique a celle de l'entree : tout, puis le micro seul. On ne
    // redemande jamais ce qu'on a deja — rouvrir un objectif deja ouvert echoue
    // sur la plupart des telephones.
    const tentatives: MediaStreamConstraints[] = []
    if (!aAudio()) {
      if (veutVideo && !aVideo()) tentatives.push({ audio: true, video: contraintesVideo() })
      tentatives.push({ audio: true, video: false })
    } else {
      tentatives.push({ audio: false, video: contraintesVideo() })
    }
    for (const contraintes of tentatives) {
      try {
        await adopterLesPistes(await navigator.mediaDevices.getUserMedia(contraintes))
        break
      } catch {
        // Toujours refuse, ou peripherique absent : on tente moins, puis rien.
      }
    }
  }

  // ⚠️ DEUX QUESTIONS DIFFERENTES, ET C'EST TOUT LE DEFAUT CORRIGE ICI.
  //
  // « Ai-je une piste ? » decide de `mediaManquant` : sans piste, il n'y a rien
  // a reprendre et le bandeau doit le dire.
  //
  // « Ma piste EMET-elle ? » decide du BOUTON. `micOn` se deduisait de la
  // simple EXISTENCE de la piste : apres « Reessayer le media », un micro que
  // l'utilisateur avait lui-meme coupe rouvrait a l'ecran sans rouvrir en fait.
  // Le bouton annoncait un micro ouvert sur une piste `enabled: false` — il
  // fallait le couper puis le rouvrir pour reconcilier les deux, ce que
  // personne ne devine.
  const audioEmet = () => localStream?.getAudioTracks().some((p) => p.enabled) ?? false
  const videoEmet = () => localStream?.getVideoTracks().some((p) => p.enabled) ?? false

  const manquant = !aAudio() ? "tout" : veutVideo && !aVideo() ? "camera" : "aucun"
  const patch: Partial<CallManagerState> = { micOn: audioEmet() }
  // Pendant un partage, la piste video locale est l'ECRAN : `camOn` y note
  // l'intention de camera et ne se deduit pas des pistes. Voir `toggleCamera`.
  if (!state.partageParMoi) patch.camOn = videoEmet()
  // `mediaManquant` ne vaut que pour une reunion — hors salle il reste « aucun ».
  if (salleReunion !== null) patch.mediaManquant = manquant
  setState(patch)
  return manquant
}

/**
 * Installe des pistes fraiches dans le flux local et les pousse aux pairs.
 *
 * Le flux local peut ne pas exister du tout : en ecoute seule il n'y a jamais eu
 * de `getUserMedia` reussi, donc rien a completer — on le cree.
 *
 * Une piste dont la sorte est deja presente est ARRETEE et non ajoutee : deux
 * pistes audio dans le meme flux n'en feraient pas partir deux, et une camera
 * ouverte pour rien garderait son temoin allume.
 */
async function adopterLesPistes(flux: MediaStream): Promise<void> {
  const cible = localStream ?? new MediaStream()
  localStream = cible

  const ajoutees: MediaStreamTrack[] = []
  for (const piste of flux.getTracks()) {
    const dejaLa = piste.kind === "audio" ? cible.getAudioTracks() : cible.getVideoTracks()
    if (dejaLa.length > 0) {
      piste.stop()
      continue
    }
    cible.addTrack(piste)
    ajoutees.push(piste)
  }
  if (ajoutees.length === 0) return
  setState({ localStream: cible })

  for (const session of peers.values()) {
    let aChange = false
    for (const piste of ajoutees) {
      if (await session.ajouterPisteLocale(piste, cible)) aChange = true
    }
    if (aChange) await session.renegocier()
  }
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
  // Pendant un partage, la seule piste video du flux local est l'ECRAN. Sans
  // cette garde, changer d'objectif l'arreterait pour ouvrir une camera a sa
  // place : la presentation s'eteindrait chez tout le monde sur un bouton qui
  // ne la concerne pas.
  if (state.partageParMoi) return false
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
  // La FORME est reprise ici aussi : sans elle, changer de camera ramenerait du
  // paysage sur un ecran tenu droit, et le recadrage rendrait le gros plan qu'on
  // vient de supprimer. `contraintesVideo()` porte l'orientation ; le choix de
  // l'objectif la complete sans l'annuler.
  const forme = contraintesVideo()
  if (suivante) {
    tentatives.push({
      video: { ...forme, deviceId: { exact: suivante.deviceId } },
      audio: false,
    })
  }
  tentatives.push({
    video: { ...forme, facingMode: { exact: cibleFacing } },
    audio: false,
  })

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
  // Pendant un partage d'ecran, la piste video locale n'est PAS la camera :
  // c'est l'ecran. La couper eteindrait la presentation chez tout le monde. On
  // n'enregistre donc que l'intention — elle sera honoree telle quelle quand la
  // camera reviendra, a la fin du partage.
  if (state.partageParMoi) {
    if (cameraAvantPartage) cameraAvantPartage.camOn = next
    setState({ camOn: next })
    diffuserEtatMedia()
    return next
  }
  const pistes = localStream?.getVideoTracks() ?? []
  // Meme raison que pour le micro : sans piste video, il n'y a aucune camera a
  // rallumer, et un bouton qui s'allume promet une image qui ne partira jamais.
  // Cas courant depuis qu'on entre en reunion video sans webcam.
  if (pistes.length === 0) return state.camOn
  pistes.forEach((track) => {
    track.enabled = next
  })
  setState({ camOn: next })
  diffuserEtatMedia()
  return next
}

/* ----------------- Partage d'ecran ----------------- */

/**
 * De quoi rendre EXACTEMENT l'etat d'avant le partage.
 *
 * `contraintes` nulle veut dire « il n'y avait aucune camera » — une reunion
 * audio, ou un appel audio. C'est une valeur legitime et non un oubli : a la
 * fin du partage il faut alors cesser d'emettre de la video, et surtout pas
 * ouvrir une camera que personne n'avait demandee.
 *
 * `camOn` est le bouton camera tel qu'il etait, pas l'etat de la piste : qui
 * presentait camera eteinte ne doit pas se retrouver a l'image en arretant.
 */
interface EtatCameraAvantPartage {
  contraintes: MediaStreamConstraints | null
  camOn: boolean
}

let pisteEcran: MediaStreamTrack | null = null
let cameraAvantPartage: EtatCameraAvantPartage | null = null

/**
 * L'installation de la piste d'ecran est-elle en cours ?
 *
 * Installer, c'est substituer la piste chez CHAQUE pair, donc autant d'allers-
 * retours qu'il y a de participants. Un arret demande pendant ce temps ferait
 * courir deux substitutions en parallele — l'ecran qui s'installe et la camera
 * qu'on rend — dont l'ordre d'arrivee chez les pairs n'est garanti par rien :
 * l'ecran mort peut gagner et rester fige chez tout le monde. On met donc
 * l'arret en attente, et `demarrerPartageEcran` l'honore des qu'il a fini.
 */
let installationEcranEnCours = false
let arretEcranDemandePendantInstallation = false

/**
 * Ce navigateur sait-il capturer un ecran ?
 *
 * Capacite du NAVIGATEUR seulement, et sans jamais jeter : les navigateurs
 * mobiles, et tout contexte non securise, n'ont pas `getDisplayMedia`, et une
 * simple lecture de propriete est la seule facon de le savoir sans ouvrir de
 * fenetre.
 *
 * ⚠️ Repondre vrai ne suffit PAS a decider d'afficher le bouton : encore
 * faut-il que la session sache porter de la video. Voir `demarrerPartageEcran`.
 */
export function partageEcranSupporte(): boolean {
  if (typeof navigator === "undefined") return false
  return typeof navigator.mediaDevices?.getDisplayMedia === "function"
}

/** Est-ce MOI qui presente en ce moment ? */
export function partageEcranActif(): boolean {
  return state.partageParMoi
}

/**
 * Commence a partager son ecran.
 *
 * MECANISME : aucun. C'est celui du changement de camera, mot pour mot —
 * `appliquerPisteVideo` substitue la piste chez tous les pairs par
 * `replaceTrack`, donc SANS renegocier une seule connexion. Un ecran n'est
 * qu'une autre source de video ; seule l'annonce `meeting_screen` dit aux
 * autres ce que cette piste montre.
 *
 * NE JETTE PAS QUAND L'UTILISATEUR REFUSE. Fermer la fenetre de choix du
 * navigateur est une decision, pas une panne : une exception remonterait en
 * toast d'erreur pour quelqu'un qui a simplement change d'avis. La verite est
 * dans `partageParMoi` — c'est lui, et non la resolution de cette promesse, qui
 * doit piloter le bouton de la salle.
 *
 * ⚠️ IL FAUT UNE SESSION VIDEO. Dans une reunion AUDIO, aucun m-line video n'a
 * ete negocie : il n'existe pas d'emetteur video a substituer, la piste d'ecran
 * n'irait nulle part et la salle se croirait en presentation devant des pairs
 * qui ne voient rien. Y remedier demanderait une renegociation complete, qui
 * n'est pas de ce lot. On refuse donc AVANT d'ouvrir la fenetre de choix, pour
 * ne pas faire choisir un ecran qui ne partirait pas.
 */
export async function demarrerPartageEcran(): Promise<void> {
  if (state.partageParMoi) return
  if (!partageEcranSupporte()) {
    console.warn("[CallManager] partage d'ecran indisponible dans ce navigateur")
    return
  }
  if (!state.activeCallId || !localStream) return
  if (state.callType !== "video") {
    console.warn("[CallManager] partage d'ecran refuse : la session ne porte pas de video")
    return
  }

  /*
   * L'INTENTION SE POSE AVANT LE TRAVAIL, PAS APRES.
   *
   * `partageParMoi` etait pose une fois les pistes substituees chez tous les
   * pairs. Entre le clic et cet instant — la fenetre de choix de l'ecran, puis
   * autant de `replaceTrack` qu'il y a de participants — les DEUX gardes qui
   * protegent le partage lisaient encore « faux », et laissaient passer :
   *
   *  - un second demarrage repassait la garde d'entree : deux fenetres de
   *    choix, et la seconde memorisation de camera photographiait la piste
   *    d'ECRAN installee par la premiere. La camera d'origine etait perdue, et
   *    le retour rouvrait potentiellement un autre objectif ;
   *  - un `ended` emis dans la fenetre etait AVALE : l'ecouteur appelait
   *    `arreterPartageEcran`, qui sortait aussitot, puis `partageParMoi`
   *    passait a vrai. Bouton enfonce sur une piste deja morte, annonce
   *    `partage:true` envoyee quand meme, camera jamais rendue, et les autres
   *    figes sur le dernier cadre.
   *
   * On pose donc l'intention en premier, et `annulerIntentionDePartage` la
   * retire a chaque sortie qui n'aboutit pas.
   */
  setState({ partageParMoi: true })

  /*
   * La camera est notee AVANT d'ouvrir la fenetre de choix : c'est le dernier
   * instant ou la piste video locale est a coup sur la camera. La noter apres
   * ne redeviendrait exact que parce que la garde ci-dessus interdit desormais
   * un second demarrage — mieux vaut ne pas dependre de cela.
   *
   * C'est aussi ce qui rend un arret demande PENDANT le choix inoffensif :
   * sans cette memoire, `arreterPartageEcran` conclurait « rien a rendre » et
   * couperait une camera qui n'avait jamais ete remplacee.
   */
  cameraAvantPartage = memoriserCamera()

  let flux: MediaStream
  try {
    // `audio: false` : le son d'un onglet partirait dans une piste separee que
    // personne ne negocie ici, et couperait la voix en la remplacant.
    flux = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  } catch (err) {
    // Refus, fenetre fermee, ou capture interdite par la politique du poste.
    // Rien n'est pose dans `error` : le cas de loin le plus frequent est le
    // refus, et faire surgir un toast alarmant a qui vient de changer d'avis
    // serait pire que le silence. La trace reste en console pour les autres cas.
    console.warn("[CallManager] capture d'ecran non obtenue :", err)
    annulerIntentionDePartage()
    return
  }

  const piste = flux.getVideoTracks()[0]
  if (!piste) {
    flux.getTracks().forEach((t) => t.stop())
    annulerIntentionDePartage()
    return
  }
  // Le choix a pu prendre plusieurs secondes : l'appel peut s'etre termine
  // entre-temps. Sans ce controle on installerait une piste dans un flux mort.
  if (!state.activeCallId || !localStream) {
    flux.getTracks().forEach((t) => t.stop())
    annulerIntentionDePartage()
    return
  }
  // L'intention n'est plus la notre : un arret est passe pendant que la fenetre
  // de choix etait ouverte, et il a deja tout remis en place. Installer cet
  // ecran maintenant le ferait revenir sans que personne ne l'ait redemande.
  if (!state.partageParMoi) {
    flux.getTracks().forEach((t) => t.stop())
    return
  }

  pisteEcran = piste

  /*
   * FIN DU PARTAGE DEPUIS LA BARRE DU NAVIGATEUR. Chrome et Firefox affichent
   * leur propre bandeau « Arreter le partage », qui ne passe evidemment pas par
   * notre bouton : la piste s'eteint toute seule et `ended` est le seul signal
   * qu'on en recoive. Sans cette ecoute, l'application resterait persuadee de
   * presenter, la camera ne reviendrait jamais, et les autres garderaient le
   * dernier cadre de l'ecran fige en plein ecran.
   *
   * `stop()` appele par nous ne declenche PAS `ended` — cette ecoute ne se
   * confond donc pas avec notre propre arret. La garde reste, pour un
   * navigateur qui en deciderait autrement.
   */
  piste.addEventListener("ended", () => {
    if (pisteEcran !== piste) return
    void arreterPartageEcran()
  })

  // `true` et non `state.camOn` : c'est l'ecran qui doit emettre, meme — et
  // surtout — quand la camera etait coupee.
  installationEcranEnCours = true
  arretEcranDemandePendantInstallation = false
  try {
    await appliquerPisteVideo(piste, true)
  } finally {
    installationEcranEnCours = false
  }

  /*
   * ARRET SURVENU PENDANT L'INSTALLATION.
   *
   * Le cas concret : le bandeau « Arreter le partage » du navigateur est
   * clique avant que la piste ait fini de s'installer chez tous les pairs.
   * `arreterPartageEcran` a alors mis sa demande en attente plutot que de
   * croiser deux substitutions de piste ; c'est ici qu'on l'honore.
   *
   * `readyState` est relu en plus du drapeau : une piste peut mourir sans que
   * `ended` soit encore parvenu jusqu'a nous, et l'annoncer serait promettre un
   * ecran deja eteint.
   *
   * Rien n'est annonce a la salle dans ce cas — ni `true`, qui n'a jamais ete
   * vrai, ni un `false` qui l'annulerait : `arreterPartageEcran` s'en charge, et
   * son annonce reste sans effet chez des participants a qui aucun partage
   * n'avait ete declare.
   */
  if (arretEcranDemandePendantInstallation || piste.readyState === "ended") {
    arretEcranDemandePendantInstallation = false
    await arreterPartageEcran()
    return
  }

  /*
   * L'annonce APRES la piste : elle allume le plein ecran chez les autres, et
   * l'y allumer avant montrerait un grand cadre encore vide.
   *
   * Seule une REUNION est annoncee : le serveur n'a de verbe de partage que
   * pour le salon des reunions. Dans un appel ordinaire, l'image passe quand
   * meme — c'est le meme tuyau — mais les autres l'affichent comme une camera.
   * Le jour ou un `call_screen` existera, il se branchera ici.
   */
  if (salleReunion !== null) sendMeetingScreen(salleReunion, true)
}

/**
 * Arrete le partage et remet l'etat d'AVANT — camera coupee comprise.
 *
 * Idempotent : l'arret peut venir du bouton, du bandeau du navigateur, ou du
 * raccrochage, parfois de deux a la fois.
 */
export async function arreterPartageEcran(): Promise<void> {
  if (!state.partageParMoi) return
  // Installation en cours : la demande attend son tour. Voir
  // `installationEcranEnCours` — deux substitutions de piste menees de front
  // peuvent se croiser, et l'ecran mort arriver en dernier chez les pairs.
  if (installationEcranEnCours) {
    arretEcranDemandePendantInstallation = true
    return
  }

  const avant = cameraAvantPartage
  const piste = pisteEcran
  cameraAvantPartage = null
  pisteEcran = null
  setState({ partageParMoi: false })

  // Aucune piste d'ecran n'a jamais ete installee : l'arret est arrive pendant
  // la fenetre de choix du navigateur, alors que l'intention etait deja posee.
  // Rien n'a donc ete annonce a la salle, et la camera n'a pas ete remplacee —
  // elle tourne toujours, la rouvrir la ferait clignoter pour rien. Reposer le
  // bouton, tel que `toggleCamera` a pu le noter entre-temps, suffit.
  if (!piste) {
    if (avant) reposerBoutonCamera(avant.camOn)
    return
  }

  // Prevenir la salle AVANT de rendre la camera : les autres referment le plein
  // ecran pendant que la piste change, au lieu d'afficher un visage en grand a
  // la place de l'ecran le temps de recevoir l'annonce.
  if (salleReunion !== null) sendMeetingScreen(salleReunion, false)

  // La capture est arretee des maintenant : le bandeau du navigateur doit
  // disparaitre au clic, pas a la fin de la reouverture de la camera.
  piste.stop()

  if (!localStream) return
  if (!avant?.contraintes) {
    // Rien a rendre : on cesse d'emettre. Laisser la piste morte en place
    // figerait le dernier cadre de l'ecran chez les autres.
    await retirerLaPisteVideo()
    return
  }

  try {
    const flux = await navigator.mediaDevices.getUserMedia(avant.contraintes)
    const camera = flux.getVideoTracks()[0]
    if (camera) {
      // `avant.camOn` et non l'etat courant : c'est le bouton tel qu'il etait,
      // ou tel que l'utilisateur l'a repose pendant la presentation.
      setState({ camOn: avant.camOn })
      await appliquerPisteVideo(camera, avant.camOn)
      return
    }
    flux.getTracks().forEach((t) => t.stop())
  } catch {
    // L'objectif a pu etre pris par une autre application pendant le partage.
  }
  // Camera irrecuperable : mieux vaut ne plus rien emettre qu'un ecran fige.
  await retirerLaPisteVideo()
}

/**
 * Repose le bouton camera sur les pistes locales.
 *
 * Necessaire des que l'intention de partage a ete posee sans qu'aucun ecran ne
 * soit finalement installe : pendant cette fenetre, `toggleCamera` se contente
 * de NOTER le bouton dans `cameraAvantPartage` — couper la piste video y
 * reviendrait a eteindre la presentation. Si le partage n'a pas lieu, la camera
 * tourne toujours et personne ne lui a transmis le dernier clic.
 */
function reposerBoutonCamera(camOn: boolean): void {
  localStream?.getVideoTracks().forEach((track) => {
    track.enabled = camOn
  })
  if (state.camOn !== camOn) setState({ camOn })
}

/**
 * Retire l'intention de partage posee avant le travail, sans rien annoncer.
 *
 * Sortie sans partage : refus de la fenetre de choix, appel termine pendant le
 * choix, ou capture rendue sans piste video. Rien n'a ete dit a la salle et
 * aucune piste n'a bouge — il n'y a donc que ce qu'on avait pose a defaire.
 */
function annulerIntentionDePartage(): void {
  const avant = cameraAvantPartage
  cameraAvantPartage = null
  pisteEcran = null
  arretEcranDemandePendantInstallation = false
  setState({ partageParMoi: false })
  if (avant) reposerBoutonCamera(avant.camOn)
}

/**
 * Note la camera en cours pour pouvoir la rouvrir a l'identique.
 *
 * On retient les CONTRAINTES et non la piste : `appliquerPisteVideo` arrete
 * l'ancienne en installant l'ecran, et c'est voulu — garder la camera ouverte
 * pendant toute une presentation laisserait son temoin allume, et sur mobile
 * empecherait la capture, un seul objectif pouvant etre ouvert a la fois.
 */
function memoriserCamera(): EtatCameraAvantPartage {
  const courante = localStream?.getVideoTracks()[0]
  if (!courante) return { contraintes: null, camOn: state.camOn }
  const deviceId = courante.getSettings().deviceId
  return {
    contraintes: {
      // Par identifiant quand on l'a : sur un poste a plusieurs cameras,
      // `video: true` en rendrait une autre que celle qu'on montrait.
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    },
    camOn: state.camOn,
  }
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
