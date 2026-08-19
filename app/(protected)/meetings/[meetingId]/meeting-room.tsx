import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useToast } from "../../../../src/components/toast"
import {
  endMeeting,
  exclureDeReunion,
  fetchMeeting,
  joinMeeting,
  leaveMeeting,
  leaveMeetingAuDechargement,
  listerDemandesInvitation,
  trancherDemandeInvitation,
  reglerInvitationAuto,
  inviterAReunion,
  demanderInvitation,
  type DemandeInvitation,
} from "../../../../src/services/meetings-service"
import {
  arreterPartageEcran,
  demarrerPartageEcran,
  hangUp,
  joinMeetingRoom,
  partageEcranSupporte,
  setCallAudioOutput,
  toggleCamera,
  toggleMicrophone,
} from "../../../../src/services/call-manager"
import { OUTPUT_VOLUME } from "../../../../src/services/audio-output"
import { useCallState } from "../../../../src/hooks/use-call"
import { useContacts } from "../../../../src/hooks/use-contacts"
import { usePleinEcran } from "../../../../src/hooks/use-plein-ecran"
import { getMyUserId, loadSessionUser, toInitials } from "../../../../src/data/session-user"
import {
  getRealtimeState,
  sendMeetingHand,
  subscribeToMeetingEvents,
} from "../../../../src/services/websocket-service"
import { useTranslation, type Cle } from "../../../../src/i18n"
import { ApiError } from "../../../../src/lib/api-client"
import { MeetingChat } from "../../../../src/components/meeting-chat"
import { ParticipantGrid } from "../../../../src/components/participant-grid"
import { PaveNumerique } from "../../../../src/components/pave-numerique"
import {
  FenetreReduite,
  fenetreReduiteSupportee,
} from "../../../../src/components/fenetre-reduite"
import {
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../../../../src/lib/alanya-number"
import type { Reunion } from "../../../../src/services/meetings-service"
import "./meeting-room.css"

/**
 * INTITULES QUE LE CATALOGUE NE PORTE PAS ENCORE. Voir le compte-rendu du lot :
 * `meet_share_screen` (« Partager l'ecran ») et `meet_screen_shared`
 * (« Ecran partage », le bandeau du grand cadre) n'existent dans aucune des
 * neuf langues.
 *
 * Rien n'est ecrit en francais dans le JSX pour autant : la cle est passee
 * telle quelle a `t`, dont le repli DOCUMENTE est « la cle elle-meme ». L'ecran
 * degrade donc en un intitule technique, visible et signalable, au lieu de
 * figer le francais pour les huit autres langues. Le jour ou les cles entrent
 * au catalogue, ce type disparait et les appels redeviennent des `t` ordinaires
 * sans autre changement.
 */
type CleAVenir = "meet_share_screen" | "meet_screen_shared"

function MeetingControlIcon({
  kind,
  taille = 18,
}: {
  kind:
    | "mic"
    | "micOff"
    | "camera"
    | "cameraOff"
    | "hand"
    | "speaker"
    | "earpiece"
    | "ecran"
    | "chat"
    | "agrandir"
    | "reduire"
    | "fenetre"
    | "points"
    | "sortir"
  /** La fenetre reduite est etroite : ses boutons portent des icones plus
      petites, sans qu'il faille un second jeu de dessins. */
  taille?: number
}) {
  const common = {
    width: taille,
    height: taille,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  }
  /* Un moniteur sur pied : la forme dit « ecran » et non « camera », ce que la
     seule presence d'une image ne dirait pas. La fleche montante distingue
     l'emission du simple affichage. */
  if (kind === "ecran")
    return (
      <svg {...common}>
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <path d="m12 13-3-3 3-3 3 3-3 3" />
      </svg>
    )
  if (kind === "chat")
    return (
      <svg {...common}>
        <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
      </svg>
    )
  if (kind === "agrandir")
    return (
      <svg {...common}>
        <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      </svg>
    )
  if (kind === "reduire")
    return (
      <svg {...common}>
        <path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" />
      </svg>
    )
  /* Une grande fenetre et, dans son coin, la petite qui s'en detache : le dessin
     dit le geste, la ou deux fleches diraient seulement « plus petit ». */
  if (kind === "fenetre")
    return (
      <svg {...common}>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <rect x="12" y="12" width="8" height="6" rx="1" />
      </svg>
    )
  if (kind === "points")
    return (
      <svg {...common} fill="currentColor" stroke="none">
        <circle cx="12" cy="5" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
      </svg>
    )
  if (kind === "sortir")
    return (
      <svg {...common}>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5M21 12H9" />
      </svg>
    )
  if (kind === "camera" || kind === "cameraOff")
    return (
      <svg {...common}>
        {kind === "cameraOff" && <line x1="3" y1="3" x2="21" y2="21" />}
        <rect x="2" y="6" width="14" height="12" rx="2" />
        <path d="m16 10 5-3v10l-5-3" />
      </svg>
    )
  if (kind === "hand")
    return (
      <svg {...common}>
        <path d="M7 11V5a1.5 1.5 0 0 1 3 0v5V3a1.5 1.5 0 0 1 3 0v7V5a1.5 1.5 0 0 1 3 0v7V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-14 0v-3Z" />
      </svg>
    )
  if (kind === "speaker" || kind === "earpiece")
    return (
      <svg {...common}>
        <path d="m5 9 4-4v14l-4-4H2V9h3Z" />
        <path d={kind === "speaker" ? "M13 9a4 4 0 0 1 0 6M16 6a8 8 0 0 1 0 12" : "M13 12h.01"} />
      </svg>
    )
  return (
    <svg {...common}>
      {kind === "micOff" && <line x1="3" y1="3" x2="21" y2="21" />}
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" />
    </svg>
  )
}

/**
 * Vignette vivante d'un participant, dans la LISTE des invites.
 *
 * Muette, et il le faut : le son de la salle sort des `<audio>` dedies, un par
 * participant. Un `<video>` sonore rejouerait ici chaque voix une seconde fois.
 */
function MeetingRemoteVideo({ stream, name }: { stream?: MediaStream; name: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && stream && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream
      void ref.current.play().catch(() => undefined)
    }
  }, [stream])
  return stream ? (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className="meeting-remote-video"
      /* EN DUR FAUTE DE CLE : aucune entree du catalogue ne dit « Video de
         {name} », et en inventer une pendant qu'il est ecrit ailleurs
         ferait deux cles pour la meme phrase. A reprendre des qu'elle existe. */
      aria-label={`Vidéo de ${name}`}
    />
  ) : null
}

/**
 * LE GRAND CADRE : ce que la salle met en avant, ecran partage ou visage.
 *
 * `object-fit: contain` et non `cover` — c'est la difference de fond avec une
 * tuile de participant. Un visage recadre reste un visage ; un ECRAN recadre
 * perd la barre d'outils, la ligne de code ou la colonne du tableau qu'on
 * partageait justement. La vignette de sa propre camera, elle, se retourne en
 * miroir ; un ecran JAMAIS, on y lit du texte.
 *
 * Le `srcObject` est repose au montage : la fenetre reduite recree ce noeud
 * dans un AUTRE document, ou l'element arrive vierge.
 */
function VideoGrande({
  stream,
  miroir = false,
  classe = "salle-grand-video",
}: {
  stream: MediaStream | null
  miroir?: boolean
  classe?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || !stream) return
    if (element.srcObject !== stream) {
      element.srcObject = stream
      void element.play().catch(() => undefined)
    }
  }, [stream])
  if (!stream) return null
  return (
    <video
      ref={ref}
      className={`${classe}${miroir ? " miroir" : ""}`}
      autoPlay
      playsInline
      /* Muet, comme toutes les images de la salle : le son sort des `<audio>`
         dedies, restes dans la page. Le rejouer ici doublerait chaque voix. */
      muted
    />
  )
}

/**
 * L'echec de la sortie dit-il seulement que le depart avait DEJA eu lieu ?
 *
 * `ALREADY_LEFT` — la participation est close — et 404 — il n'y a plus rien a
 * fermer, la reunion ou la ligne a disparu — ne sont pas des pannes : ils
 * decrivent l'etat VOULU. Les annoncer ferait surgir une erreur au moment
 * precis ou tout s'est bien passe.
 */
function departDejaEffectue(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.status === 404) return true
  const code = (err.payload as { error?: { code?: unknown } } | null | undefined)?.error?.code
  return code === "ALREADY_LEFT"
}

/**
 * Sortie programmee par le demontage de la salle, en attente d'echeance — et LA
 * SALLE qu'elle concerne.
 *
 * Elle vit HORS du composant, et c'est tout l'interet : quand elle se declenche,
 * le composant n'existe plus. Voir le nettoyage de demontage, plus bas, pour ce
 * qu'elle protege — le double montage de React 18 en mode strict.
 *
 * L'identifiant l'accompagne parce qu'un montage n'a le droit d'annuler que la
 * sortie de SA PROPRE salle. Sans lui, passer d'une reunion a une autre sans
 * repasser par la liste — react-router garde alors le meme composant et change
 * seulement le parametre — voyait le montage de la seconde annuler la sortie de
 * la premiere : on restait « connecte » a une salle qu'on avait pourtant
 * quittee, et pour toujours.
 */
let sortieProgrammee: { salle: string; minuteur: ReturnType<typeof setTimeout> } | null = null

/** Vrai sous 900 px, la largeur ou la colonne du fil cesse d'etre lisible. */
function useEcranEtroit(): boolean {
  const [etroit, setEtroit] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches
  )
  useEffect(() => {
    const requete = window.matchMedia("(max-width: 900px)")
    const suivre = () => setEtroit(requete.matches)
    requete.addEventListener("change", suivre)
    return () => requete.removeEventListener("change", suivre)
  }, [])
  return etroit
}

export default function MeetingRoomPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { success, error: showError } = useToast()
  const callState = useCallState()
  const remoteStreams = useMemo(() => callState.remoteStreams, [callState.remoteStreams])

  const [meeting, setMeeting] = useState<Reunion | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  /**
   * Le panneau n'existe que sur ecran etroit : au-dela, le fil est en colonne
   * et toujours visible. On lit la largeur plutot que de deviner l'appareil —
   * la meme fenetre peut passer d'un cas a l'autre en la redimensionnant.
   */
  const etroit = useEcranEtroit()
  const [filOuvert, setFilOuvert] = useState(false)
  /**
   * Le fil est-il deplie sur GRAND ecran ?
   *
   * Deux etats et non un seul : le panneau du telephone se referme d'un appui
   * hors de lui, la colonne du grand ecran non. Les melanger faisait qu'un
   * appui sur le voile du telephone repliait aussi la colonne, et qu'on
   * retrouvait le fil ferme en revenant sur un grand ecran.
   *
   * Deplie par defaut : c'est l'etat qu'a toujours eu la salle sur grand ecran.
   * Le bouton sert a le RENDRE a la video, pas a decouvrir le fil.
   */
  const [filLargeOuvert, setFilLargeOuvert] = useState(true)
  /** Identifiants dont la main est levee, tels que le serveur les diffuse. */
  const [mainsLevees, setMainsLevees] = useState<Set<string>>(new Set())
  const [nonLus, setNonLus] = useState(0)
  const [demandes, setDemandes] = useState<DemandeInvitation[]>([])
  /**
   * Lecture du son refusee par le navigateur. Sans cet etat, la salle est muette
   * et rien ne le dit : on n'a alors ni explication, ni moyen de reessayer.
   */
  const [sonBloque, setSonBloque] = useState(false)

  /**
   * Panneau ouvert sous la barre : soit « ajouter », soit « menu ». Un seul a
   * la fois — basculer ouvre l'un et ferme l'autre.
   */
  const [panneauOuvert, setPanneauOuvert] = useState<null | "ajouter" | "menu">(null)
  const panneauRef = useRef<HTMLDivElement | null>(null)

  /** Recherche dans la liste des contacts (panneau ajout). */
  const [rechercheContact, setRechercheContact] = useState("")
  /** Onglet actif dans le panneau d'ajout : contacts ou pavé numérique. */
  const [ongletAjout, setOngletAjout] = useState<"contacts" | "numero">("contacts")
  /** Chiffres composés dans le pavé Alanya ID du panneau d'ajout. */
  const [chiffresAjout, setChiffresAjout] = useState("")

  /** La salle est-elle repliee dans la petite fenetre plutot que dans la page ? */
  const [fenetreReduite, setFenetreReduite] = useState(false)
  /** Menu des trois points DANS la fenetre reduite, qui n'a pas de barre. */
  const [menuFenetre, setMenuFenetre] = useState(false)

  /** Racine de la page : elle sert a mesurer le panneau du fil, plus bas. */
  const racineRef = useRef<HTMLDivElement | null>(null)

  const { contacts } = useContacts()

  /**
   * Dans la salle, et dans CELLE-CI. Le gestionnaire d'appels n'en tient qu'une
   * a la fois : sans cette comparaison, la page d'une reunion afficherait les
   * flux d'une autre.
   */
  const enSalle = callState.activeCallId === `meeting_${meetingId}`
  const estVideo = callState.callType === "video"

  const fluxDistants = useMemo(
    () => Object.entries(callState.remoteStreams),
    [callState.remoteStreams]
  )

  /**
   * Noms tires de la reunion elle-meme.
   *
   * Le salon n'annonce le nom qu'a l'arrivee d'un nouveau venu ; ceux qui
   * etaient DEJA la ne sont transmis que par leur identifiant. Sans ce repli,
   * leurs tuiles portaient le nom de repli du call-manager — l'objet de la
   * reunion, recopie sous chaque visage.
   */
  const nomsConnus = useMemo(() => {
    const noms: Record<string, string> = {}
    if (meeting) {
      noms[meeting.organisateur.id] = meeting.organisateur.nom
      for (const p of meeting.participants) noms[p.id] = p.nom
    }
    return noms
  }, [meeting])

  // L'ordre d'insertion des flux est l'ordre d'arrivee des participants.
  const participantsDistants = useMemo(
    () =>
      fluxDistants.map(([id, stream]) => ({
        id,
        stream,
        name: callState.participantNames[id] ?? nomsConnus[id] ?? t("participant"),
      })),
    [fluxDistants, callState.participantNames, nomsConnus, t]
  )

  /**
   * QUI PRESENTE, et donc ce que la salle met en grand.
   *
   * `partageParPeerId` vient du serveur : c'est le seul verbe qui distingue une
   * piste d'ecran d'une piste de camera, les deux empruntant le meme tuyau
   * WebRTC. Sans lui, un ecran partage arriverait ici comme une vignette de
   * visage parmi les autres.
   *
   * La vedette peut etre nulle alors que quelqu'un presente : c'est le cas de
   * MON propre partage, mon identifiant n'etant evidemment pas dans les flux
   * DISTANTS. `partageParMoi` prend alors le relais et le grand cadre montre le
   * flux local.
   */
  const vedette = useMemo(
    () =>
      callState.partageParPeerId
        ? (participantsDistants.find((p) => p.id === callState.partageParPeerId) ?? null)
        : null,
    [callState.partageParPeerId, participantsDistants]
  )
  const jePresente = callState.partageParMoi && vedette === null

  const sortiesAudio = useRef<Map<string, HTMLAudioElement>>(new Map())

  // Niveau de sortie : on regle le VOLUME et non la coupure, pour que la bascule
  // haut-parleur / oreille ne se transforme pas en second bouton « muet ».
  useEffect(() => {
    const volume = estVideo ? OUTPUT_VOLUME.speaker : OUTPUT_VOLUME[callState.audioOutput]
    for (const sortie of sortiesAudio.current.values()) {
      sortie.muted = false
      sortie.volume = volume
    }
  }, [callState.audioOutput, estVideo, fluxDistants])

  /** Deblocage manuel : certains navigateurs n'acceptent qu'un geste dedie. */
  const debloquerLeSon = useCallback(() => {
    for (const sortie of sortiesAudio.current.values()) {
      sortie.muted = false
      void sortie
        .play()
        .then(() => setSonBloque(false))
        .catch(() => undefined)
    }
  }, [])

  /**
   * Changer de camera echange la piste DANS le meme MediaStream : ni la
   * reference du flux ni `camOn` ne bougent. Sans l'identifiant de la piste, un
   * apercu local resterait branche sur l'ancienne image.
   */
  const idPisteLocale = callState.localStream?.getVideoTracks()[0]?.id ?? null
  const apercuLocalRef = useRef<HTMLVideoElement | null>(null)
  // Miroir du flux, lisible depuis la ref de rappel sans la faire dependre de
  // l'etat : une ref de rappel qui change d'identite a chaque rendu serait
  // rappelee avec null puis avec l'element a CHAQUE rendu, ce qui rebrancherait
  // l'image en boucle.
  const fluxLocalRef = useRef<MediaStream | null>(null)
  fluxLocalRef.current = callState.localStream ?? null

  /**
   * Branche le flux depuis L'ELEMENT et non depuis un effet.
   *
   * L'apercu vit dans la branche « pas en fenetre reduite » : passer en petite
   * fenetre le demonte, en revenir le remonte en noeud DOM NEUF. Un effet dont
   * les dependances sont des DONNEES ne rejoue pas — aucune ne bouge pendant
   * l'aller-retour — et l'element neuf restait donc sans image. La vignette
   * « Moi » se vidait, et le rester jusqu'a ce qu'on coupe puis rallume la
   * camera, ou que quelqu'un entre ou sorte.
   *
   * Une ref de rappel s'execute A CHAQUE montage, par construction : c'est
   * l'element qui declenche le branchement, donc il ne peut plus etre manque.
   */
  const brancherApercuLocal = useCallback(
    (element: HTMLVideoElement | null) => {
      apercuLocalRef.current = element
      if (!element) return
      const flux = fluxLocalRef.current
      if (!flux || element.srcObject === flux) return
      element.srcObject = flux
      void element.play().catch(() => undefined)
    },
    []
  )

  // Le flux peut aussi changer SANS que l'element bouge : changement de camera,
  // retour d'un partage d'ecran. La ref de rappel ne verrait rien, d'ou cet
  // effet qui reste, mais qui n'est plus le seul chemin.
  useEffect(() => {
    const element = apercuLocalRef.current
    if (!element || !callState.localStream) return
    if (element.srcObject !== callState.localStream) {
      element.srcObject = callState.localStream
      void element.play().catch(() => undefined)
    }
  }, [callState.localStream, idPisteLocale, callState.camOn, participantsDistants.length])

  /** Le fil est-il reellement sous les yeux, sur l'un ou l'autre format ? */
  const filVisible = etroit ? filOuvert : filLargeOuvert

  // Ouvrir le fil solde ce qui a ete rate pendant qu'il etait ferme.
  useEffect(() => {
    if (filVisible) setNonLus(0)
  }, [filVisible])

  /**
   * PLEIN ECRAN du grand cadre. Le hook porte les trois orthographes de l'API
   * et, surtout, l'ecoute des sorties que l'application ne declenche pas —
   * Echap, bouton du systeme. `supporte` vaut faux la ou l'API manque ou est
   * interdite : le bouton disparait alors au lieu de promettre un refus.
   */
  const pleinEcran = usePleinEcran()

  /**
   * Ce navigateur sait-il capturer un ecran ? Lu UNE FOIS : c'est une capacite
   * du navigateur, elle ne change pas en cours de reunion.
   */
  const captureEcranPossible = useMemo(() => partageEcranSupporte(), [])
  /**
   * La VRAIE fenetre du systeme — celle qui survit a la reduction du navigateur.
   * Ailleurs, le composant retombe sur une carte flottante dans la page : utile
   * sur un bureau ou l'on veut degager la salle, sans objet sur un telephone ou
   * elle recouvrirait le peu d'ecran qui reste.
   */
  const vraieFenetreReduite = useMemo(() => fenetreReduiteSupportee(), [])

  /**
   * DIMENSIONS DE LA FENETRE REDUITE, MESUREES SUR LE PANNEAU DU FIL.
   *
   * L'utilisateur les a donnees en s'y referant — « la largeur du panneau de
   * chat, les trois quarts de sa hauteur ». Deux nombres ecrits en dur les
   * auraient trahies des la premiere retouche de `meeting-chat.css`, ou sur un
   * ecran ou le panneau ne fait pas la meme taille : on mesure donc le panneau
   * REEL, et on continue de le mesurer, la fenetre du navigateur pouvant
   * changer de taille pendant que la reunion dure.
   *
   * Une mesure nulle est IGNOREE : replier la colonne pose `display: none` sur
   * le panneau, dont la boite tombe alors a zero. Garder la derniere mesure
   * connue vaut mieux qu'ouvrir une fenetre plate.
   */
  const [tailleFil, setTailleFil] = useState<{ largeur: number; hauteur: number } | null>(null)
  useEffect(() => {
    const racine = racineRef.current
    if (!racine || typeof ResizeObserver === "undefined") return
    const panneau = racine.querySelector<HTMLElement>(".salle-fil")
    if (!panneau) return
    const mesurer = () => {
      const boite = panneau.getBoundingClientRect()
      if (boite.width < 1 || boite.height < 1) return
      setTailleFil({
        largeur: Math.round(boite.width),
        hauteur: Math.round(boite.height * 0.75),
      })
    }
    mesurer()
    const observateur = new ResizeObserver(mesurer)
    observateur.observe(panneau)
    return () => observateur.disconnect()
    // `meeting` : le panneau n'existe dans l'arbre qu'une fois la reunion lue.
  }, [meeting])

  /**
   * Sortir de la salle referme la fenetre reduite.
   *
   * Sans cela, elle resterait ouverte sur un cadre vide — le media a ete coupe,
   * mais la fenetre du systeme, elle, ne se ferme pas toute seule.
   */
  useEffect(() => {
    if (!enSalle) setFenetreReduite(false)
  }, [enSalle])

  /**
   * Etat du gestionnaire d'appels, lisible depuis un nettoyage.
   *
   * Un effet sans dependances capturerait sinon les valeurs du premier rendu —
   * c'est-a-dire une salle ou l'on n'est pas encore entre.
   */
  const etatCourant = useRef(callState)
  etatCourant.current = callState

  /**
   * Vrai tant que la BASE nous compte presents dans la salle, faux des qu'on en
   * est ressorti.
   *
   * Le media et la base ne disent pas la meme chose : on peut etre inscrit
   * comme present sans avoir le moindre flux — camera refusee au moment
   * d'entrer, ou entree faite depuis la liste des reunions, qui appelle `join`
   * avant meme d'ouvrir cet ecran. La ligne a fermer est celle de la base,
   * c'est donc elle qu'on suit, et non l'appel en cours.
   *
   * Il sert aussi de verrou : le bouton « Quitter » navigue, ce qui demonte la
   * page, ce qui rappellerait la sortie. Le second passage trouve le drapeau
   * baisse et n'envoie rien — le serveur repondrait « deja deconnecte ».
   */
  const presentEnBase = useRef(false)

  useEffect(() => {
    if (!meetingId) return

    const loadMeeting = async () => {
      setLoading(true)
      try {
        const m = await fetchMeeting(parseInt(meetingId, 10))
        setMeeting(m)
        /*
         * Le serveur peut DEJA nous compter presents en arrivant ici : la liste
         * des reunions appelle `join` puis navigue vers cette page. Sans cette
         * lecture, on quittait l'ecran sans rien fermer — le bouton
         * « Rejoindre » de la liste laissait une ligne « connectee » pour
         * toujours, et une duree jamais close.
         *
         * Une reunion terminee, elle, n'a plus rien a fermer : le serveur a
         * deconnecte tout le monde en la fermant.
         */
        const moi = getMyUserId()
        if (moi && !m.terminee && m.participants.some((p) => p.id === moi && p.connecte)) {
          presentEnBase.current = true
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("meet_room_load_failed")
        setError(msg)
        showError(t("error"), msg)
      } finally {
        setLoading(false)
      }
    }

    void loadMeeting()
  }, [meetingId, showError, t])

  /**
   * LA sortie de la salle. Tous les chemins passent par ici — le bouton, le
   * demontage de la page, la fermeture de l'onglet.
   *
   * DEUX CHOSES A FAIRE, ET UNE SEULE VOIE POUR CHACUNE : couper le media, et
   * fermer la participation EN BASE.
   *
   * `hangUp()` fait LES DEUX quand on est dans la salle. Il arrete les pistes —
   * camera et micro s'eteignent pour de bon —, ferme les connexions, ET emet
   * `meeting_leave` sur la socket deja ouverte ; le serveur temps reel repond a
   * cette trame en posant `connecte = 0` et en closant la duree de presence.
   *
   * LE COMMENTAIRE QUI TENAIT ICI AFFIRMAIT LE CONTRAIRE — que `hangUp()` « ne
   * dit RIEN a la base » — et c'est cette phrase qui a produit le defaut : on
   * ajoutait donc `/leave` derriere, la route trouvait la ligne deja close et
   * repondait 400 `ALREADY_LEFT`, dont le message brut du serveur s'affichait en
   * toast. Quitter proprement se soldait par une erreur a l'ecran.
   *
   * La route REST n'est donc appelee QUE lorsque la socket n'a rien dit : le cas
   * ou l'on est inscrit en base sans le moindre media — entree faite depuis la
   * liste des reunions, qui appelle `join` avant meme d'ouvrir cet ecran, ou
   * micro et camera refuses au moment d'entrer.
   *
   * `auDechargement` distingue le cas ou la page est en train de disparaitre :
   * plus rien d'asynchrone n'y survit, tout doit partir dans le gestionnaire
   * lui-meme.
   */
  const quitterLaSalle = useCallback(
    async (auDechargement: boolean): Promise<void> => {
      const id = Number(meetingId)
      if (!id) return

      const enAppelIci = etatCourant.current.activeCallId === `meeting_${meetingId}`
      if (!enAppelIci && !presentEnBase.current) return

      const aPrevenir = presentEnBase.current
      presentEnBase.current = false

      if (auDechargement) {
        // Rien ne doit etre remis a une microtache : apres le retour de ce
        // gestionnaire, le document peut avoir cesse d'exister. Les deux appels
        // sont synchrones — la trame part sur la socket deja ouverte, la requete
        // est remise au navigateur, qui la termine sans nous.
        //
        // SEUL CHEMIN OU LES DEUX PARTENT ENSEMBLE, et c'est delibere : rien ne
        // garantit qu'une trame confiee a la socket soit reellement emise par un
        // document qu'on est en train de detruire, la ou `keepalive` l'est par
        // contrat. Un 400 « deja deconnecte » que personne ne verra vaut mieux
        // qu'un participant reste « connecte » pour toujours.
        if (aPrevenir) leaveMeetingAuDechargement(id)
        if (enAppelIci) void hangUp()
        return
      }

      /*
       * « LA SOCKET L'A-T-ELLE FAIT ? » se lit AVANT de raccrocher.
       *
       * `sendMeetingLeave` passe par `sendRaw`, qui MET EN FILE au lieu
       * d'emettre quand la socket est fermee, et rouvre la connexion. La trame
       * partira donc... un jour, et peut-etre jamais si l'on ferme l'onglet
       * entre-temps. Socket fermee, c'est exactement le cas ou « la socket n'a
       * pas fait le travail » : la route REST reprend la main.
       */
      const socketOuverte = getRealtimeState().connected

      // Le media D'ABORD, la base ensuite : sans ce passage, on sortait de la
      // reunion cote serveur en continuant a filmer et a etre vu.
      if (enAppelIci) {
        await hangUp()
        if (socketOuverte) return
      }
      if (aPrevenir) await leaveMeeting(id)
    },
    [meetingId]
  )

  const handleJoinMeeting = async () => {
    if (!meeting || !meetingId) return
    if (meeting.terminee) return showError(t("error"), t("meet_ended_toast"))

    try {
      await joinMeeting(parseInt(meetingId, 10))
      // Des cet instant la base nous compte presents : quoi qu'il arrive
      // ensuite, meme si le media echoue, il y aura une ligne a refermer.
      presentEnBase.current = true

      // Le salon annonce lui-meme qui est deja la : inutile de lui passer la
      // liste des invites, qui ne dit pas qui est present.
      await joinMeetingRoom(parseInt(meetingId, 10), meeting.type, meeting.objet)
    } catch (err) {
      showError(t("error"), err instanceof Error ? err.message : t("meet_join_failed"))
    }
  }

  // Les mains viennent du serveur, jamais d'un etat local : sans quoi chacun
  // verrait la sienne levee et pas celle des autres.
  useEffect(() => {
    return subscribeToMeetingEvents((event) => {
      if (event.type !== "meeting_hand") return
      if (Number(event.meetingId) !== Number(meetingId)) return
      const id = String(event.fromUserId ?? "")
      if (!id) return
      setMainsLevees((precedentes) => {
        const suivantes = new Set(precedentes)
        if (event.levee === true) suivantes.add(id)
        else suivantes.delete(id)
        return suivantes
      })
    })
  }, [meetingId])

  useEffect(() => {
    if (!meeting?.jeSuisOrganisateur || !meetingId) return
    const charger = () =>
      void listerDemandesInvitation(Number(meetingId))
        .then(setDemandes)
        .catch(() => undefined)
    charger()
    const id = window.setInterval(charger, 10000)
    return () => window.clearInterval(id)
  }, [meeting?.jeSuisOrganisateur, meetingId])

  const traiterDemande = async (demandeId: number, accepter: boolean) => {
    if (!meetingId) return
    try {
      await trancherDemandeInvitation(Number(meetingId), demandeId, accepter)
      setDemandes((liste) => liste.filter((d) => d.id !== demandeId))
    } catch (err) {
      // EN DUR FAUTE DE CLE : le catalogue n'a rien pour l'echec d'un arbitrage
      // de demande d'invitation. A reprendre des que la cle existe.
      showError(t("error"), err instanceof Error ? err.message : "Demande impossible")
    }
  }

  const changerModeInvitation = async (automatic: boolean) => {
    if (!meetingId || !meeting) return
    try {
      await reglerInvitationAuto(Number(meetingId), automatic)
      setMeeting({ ...meeting, invitationAuto: automatic })
    } catch (err) {
      // « Reglage non enregistre » et non « Reglage impossible » : la case est
      // deja revenue a sa position d'avant, c'est bien l'enregistrement qui a
      // manque.
      showError(t("error"), err instanceof Error ? err.message : t("set_setting_not_saved"))
    }
  }

  /*
   * PLUS AUCUNE RECHERCHE DE TITULAIRE N'EST MENEE DEPUIS CET ECRAN : le pave
   * partage la mene une fois (`afficherTitulaire`) et rend le compte trouve
   * (`onTitulaire`).
   *
   * IL N'Y A PLUS NON PLUS QU'UN SEUL PAVE. La colonne d'informations en portait
   * un second, « invitation directe de l'organisateur », qui posait exactement
   * la meme question au meme serveur pour appeler exactement la meme route que
   * l'onglet « Alanya ID » du panneau « Ajouter ». Ce doublon coutait 577 px de
   * hauteur a une colonne plafonnee a 26 vh : c'est la video, dessous, qui les
   * payait. Le reglage « invitation automatique » qui l'accompagnait etait lui
   * aussi ecrit deux fois, mot pour mot, dans le panneau « Menu ». Les deux
   * copies de la colonne sont parties ; les panneaux qu'on ouvre restent, et
   * s'ouvrent desormais aussi AVANT d'entrer dans la salle, ou la colonne etait
   * jusqu'ici le seul acces.
   */

  /** Contacts filtrés par la recherche dans le panneau d'ajout. */
  const contactsFiltres = useMemo(() => {
    const q = rechercheContact.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q)
    )
  }, [contacts, rechercheContact])

  /** Fermeture par clic extérieur : si on clique hors du panneau, on le ferme. */
  useEffect(() => {
    if (!panneauOuvert) return
    const surClicExterieur = (e: PointerEvent) => {
      const cible = e.target as Node | null
      if (!cible) return
      if (panneauRef.current?.contains(cible)) return
      // On ne ferme pas si on clique sur un bouton de contrôle (il gère lui-même)
      if (cible instanceof Element && cible.closest(".meeting-controles")) return
      setPanneauOuvert(null)
    }
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanneauOuvert(null)
    }
    document.addEventListener("pointerdown", surClicExterieur)
    document.addEventListener("keydown", surTouche)
    return () => {
      document.removeEventListener("pointerdown", surClicExterieur)
      document.removeEventListener("keydown", surTouche)
    }
  }, [panneauOuvert])

  /** Ajouter une personne depuis le panneau — contacts ou pavé. */
  const ajouterPersonneParNumero = async (numero: string, nom: string) => {
    if (!meetingId) return
    const num = normalizeAlanyaNumber(numero) || numero
    try {
      if (meeting?.jeSuisOrganisateur) {
        await inviterAReunion(Number(meetingId), [num])
        success(t("meet_invite_sent", { name: nom }))
      } else {
        await demanderInvitation(Number(meetingId), num)
        success(t("meet_invite_requested"))
      }
      setPanneauOuvert(null)
      setRechercheContact("")
      setChiffresAjout("")
      setOngletAjout("contacts")
      // Recharger la réunion pour mettre à jour la liste
      setMeeting(await fetchMeeting(Number(meetingId)))
    } catch (err) {
      showError(t("error"), err instanceof Error ? err.message : t("a2_invite_failed"))
    }
  }

  /** Valider le numéro composé dans le panneau d'ajout. */
  const validerNumeroAjout = () => {
    if (!isValidAlanyaNumber(chiffresAjout)) return
    const contactMatch = contacts.find(
      (c) => normalizeAlanyaNumber(c.phone) === chiffresAjout
    )
    void ajouterPersonneParNumero(
      chiffresAjout,
      contactMatch?.name ?? formatAlanyaNumber(chiffresAjout)
    )
  }

  const maMain = mainsLevees.has(getMyUserId() ?? "")
  /** Notre propre nom, pour l'initiale affichee quand on est seul dans la salle. */
  const monNom = loadSessionUser()?.name ?? t("l2_me")

  /**
   * Traduction d'une cle QUI N'EST PAS ENCORE AU CATALOGUE (voir `CleAVenir`).
   * Le detour par `unknown` est volontairement voyant : c'est lui qui signale
   * qu'il reste ici une dette, et il disparaitra avec elle.
   */
  const tAVenir = useCallback((cle: CleAVenir) => t(cle as unknown as Cle), [t])

  /**
   * Commencer ou arreter de partager son ecran.
   *
   * AUCUN TOAST D'ERREUR, meme en cas d'echec : le cas de loin le plus frequent
   * est le refus de la fenetre de choix du navigateur, c'est-a-dire quelqu'un
   * qui a change d'avis. `demarrerPartageEcran` ne jette d'ailleurs pas — la
   * verite est dans `partageParMoi`, que le bouton lit directement.
   */
  const basculerPartageEcran = useCallback(() => {
    if (callState.partageParMoi) void arreterPartageEcran()
    else void demarrerPartageEcran()
  }, [callState.partageParMoi])

  const handleExclure = async (participantId: string, nom: string) => {
    if (!meetingId || !confirm(t("meet_exclude_confirm", { name: nom }))) return
    try {
      await exclureDeReunion(parseInt(meetingId, 10), participantId)
      // On relit la reunion plutot que de retirer la ligne localement : le
      // serveur est seul a savoir ce qu'il a reellement efface.
      setMeeting(await fetchMeeting(parseInt(meetingId, 10)))
      success(t("meet_excluded", { name: nom }))
    } catch (err) {
      showError(t("error"), err instanceof Error ? err.message : t("meet_exclude_failed"))
    }
  }

  const handleEndMeeting = async () => {
    if (!meetingId || !confirm(t("meet_end_confirm"))) return
    try {
      await endMeeting(parseInt(meetingId, 10))
      // Terminer deconnecte TOUT LE MONDE en base, nous compris, et clot les
      // durees : il n'y a plus de ligne a fermer, un `/leave` de plus se ferait
      // repondre « deja deconnecte ». Notre camera, elle, tourne toujours.
      presentEnBase.current = false
      if (etatCourant.current.activeCallId === `meeting_${meetingId}`) await hangUp()
      navigate("/meetings")
    } catch (err) {
      showError(t("error"), err instanceof Error ? err.message : t("meet_end_failed"))
    }
  }

  const handleLeaveMeeting = async () => {
    if (!meetingId) return

    try {
      // Coupe le media PUIS ferme la ligne en base — voir `quitterLaSalle`.
      await quitterLaSalle(false)
      navigate("/meetings")
    } catch (err) {
      // Le media est deja coupe : on ne reste pas dans une salle vide parce que
      // la requete a echoue.
      navigate("/meetings")
      // Le depart avait DEJA eu lieu : il n'y a rien a annoncer. Annoncer quoi
      // que ce soit ici transformait une sortie reussie en erreur a l'ecran.
      if (departDejaEffectue(err)) return
      // JAMAIS `err.message` : c'est le texte BRUT du serveur, ecrit dans une
      // seule langue et jamais passe par le catalogue. Un utilisateur en chinois
      // lisait une phrase francaise. Le libelle de l'echec est ici, traduit.
      showError(t("error"), t("meet_leave_failed"))
    }
  }

  /**
   * Quitter la PAGE quitte la salle.
   *
   * Un clic sur la croix, le menu lateral, le bouton « precedent » du
   * navigateur : tous demontent cet ecran sans passer par « Quitter ». Sans ce
   * nettoyage, la camera restait allumee, les autres continuaient de nous voir
   * depuis une page qu'on avait quittee, et la base nous comptait presents.
   *
   * REACT 18 EN MODE STRICT monte, demonte et remonte immediatement chaque
   * composant : un nettoyage qui partirait sur-le-champ ferait quitter la salle
   * a la premiere seconde. On ne quitte donc pas DEPUIS le nettoyage, on
   * PROGRAMME la sortie — et le montage suivant l'annule. Le faux demontage
   * enchaine nettoyage puis remontage dans la meme tache ; le minuteur, lui,
   * n'echoit qu'a la tache d'apres et n'a jamais lieu. Un vrai demontage n'est
   * suivi d'aucun remontage : rien n'annule, la sortie part.
   *
   * L'annulation ne vaut que pour LA MEME salle : c'est ce qui distingue le
   * faux demontage — on repart dans la reunion qu'on venait de quitter — d'un
   * passage direct d'une reunion a une autre, ou la sortie de la premiere doit
   * bel et bien partir.
   *
   * Le minuteur est declare hors du composant : a l'echeance, celui-ci a
   * disparu — une ref a lui ne survivrait pas au remontage suivant.
   */
  useEffect(() => {
    const salle = String(meetingId)
    if (sortieProgrammee !== null && sortieProgrammee.salle === salle) {
      clearTimeout(sortieProgrammee.minuteur)
      sortieProgrammee = null
    }
    return () => {
      const minuteur = setTimeout(() => {
        // On ne remet a zero que SA propre sortie : entre-temps, une autre
        // salle a pu programmer la sienne.
        if (sortieProgrammee?.minuteur === minuteur) sortieProgrammee = null
        // Personne n'attend cette promesse : l'echec est avale sur place, sinon
        // il remonterait en rejet non traite depuis un composant disparu.
        void quitterLaSalle(false).catch(() => undefined)
      }, 0)
      sortieProgrammee = { salle, minuteur }
    }
  }, [meetingId, quitterLaSalle])

  /**
   * Fermeture de l'onglet, rechargement, saut vers un autre site : le demontage
   * n'a pas lieu, et une requete ordinaire lancee a cet instant est annulee avec
   * le document. D'ou le chemin « au dechargement » — socket pour les autres
   * participants, `fetch` en `keepalive` pour la base.
   *
   * `pagehide` plutot que `beforeunload` : c'est le seul qui parte a coup sur
   * sur mobile, ou l'onglet est souvent balaye sans dechargement classique.
   */
  useEffect(() => {
    const partir = () => {
      void quitterLaSalle(true)
    }
    window.addEventListener("pagehide", partir)
    return () => window.removeEventListener("pagehide", partir)
  }, [quitterLaSalle])

  if (loading) {
    return (
      <div className={`meeting-room-root${filOuvert ? " fil-ouvert" : ""}`}>
        <div className="loading">{t("loading")}</div>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className={`meeting-room-root${filOuvert ? " fil-ouvert" : ""}`}>
        <div className="error">{error || t("meet_not_found")}</div>
        <button className="btn-back" onClick={() => navigate("/meetings")}>
          {t("back")}
        </button>
      </div>
    )
  }

  const bandeauVisible = meeting.jeSuisOrganisateur && demandes.length > 0 && enSalle

  /**
   * CE QUE MONTRE LE RENDU — et qui DEMENAGE.
   *
   * Le meme rendu est pose soit dans la page, soit dans la fenetre reduite, mais
   * JAMAIS dans les deux : un flux ne se branche pas sur deux `<video>` sans que
   * l'un des deux se fige. Une fonction plutot qu'une valeur, parce que les deux
   * emplacements ne veulent pas exactement la meme chose (voir `dansLaFenetre`),
   * et un seul est monte a la fois.
   *
   * Trois dispositions, dans cet ordre de priorite :
   *
   *  1. QUELQU'UN PRESENTE — c'est ce qu'on attend d'une reunion : son ecran
   *     passe en grand TOUT SEUL, sans que personne ait a le demander, et les
   *     autres se rangent dans une bande dessous. Le presentateur est designe
   *     par le serveur (`partageParPeerId`) et non devine d'une piste video :
   *     rien dans WebRTC ne distingue un ecran d'un visage.
   *  2. PERSONNE NE PRESENTE — la grille egale des appels de groupe, comme
   *     avant. Sauf dans la FENETRE REDUITE, trop etroite pour une grille : la
   *     demande y veut « le gros rendu video, les autres en plus petit avec
   *     defilement », donc un grand cadre coute que coute — a defaut de
   *     presentateur, le premier arrive.
   *  3. PERSONNE D'AUTRE N'EST LA — sa propre image occupe le cadre. Arriver en
   *     avance est ordinaire, cela ne doit pas ressembler a une panne.
   */
  const rendreScene = (dansLaFenetre: boolean) => {
    const grand = vedette ?? (dansLaFenetre && !jePresente ? (participantsDistants[0] ?? null) : null)
    const flux = grand ? grand.stream : jePresente ? callState.localStream : null
    /** Un ECRAN, et pas un visage : c'est ce que l'etiquette doit annoncer. */
    const estUnEcran = vedette !== null || jePresente

    if (!flux) {
      return participantsDistants.length > 0 ? (
        <ParticipantGrid participants={participantsDistants} isVideo={estVideo} size="room" />
      ) : (
        <div className="meeting-seul">
          {estVideo && callState.localStream && callState.camOn ? (
            /* `VideoGrande` et non un `<video>` branche par un effet de la page :
               ce bloc peut renaitre dans le document de la fenetre reduite, ou
               l'element arrive vierge et doit rebrancher son flux lui-meme. */
            <VideoGrande stream={callState.localStream} miroir classe="meeting-seul-video" />
          ) : (
            <div className="meeting-seul-avatar">{toInitials(monNom)}</div>
          )}
          <span className="meeting-seul-mention">{t("meet_pending")}</span>
        </div>
      )
    }

    const autres = grand
      ? participantsDistants.filter((p) => p.id !== grand.id)
      : participantsDistants

    return (
      <div className="salle-scene">
        <div className="salle-grand">
          {/* Jamais de miroir ici : le grand cadre montre soit l'image d'un
              autre, soit un ecran — et l'on y lit du texte. */}
          <VideoGrande stream={flux} />
          {/* CE QUI DIT « ECRAN » ET NON « CAMERA ». Sans cette etiquette, un
              ecran partage n'est qu'une image de plus, en plus grand : rien ne
              distinguerait une presentation d'un gros plan sur un visage. */}
          <span className={`salle-grand-etiquette${estUnEcran ? "" : " neutre"}`}>
            {estUnEcran && <MeetingControlIcon kind="ecran" taille={13} />}
            <b>{grand ? grand.name : t("l2_me")}</b>
            {estUnEcran && <span>{tAVenir("meet_screen_shared")}</span>}
          </span>
        </div>
        {autres.length > 0 && (
          <div className="salle-bande">
            <ParticipantGrid participants={autres} isVideo={estVideo} size="room" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={racineRef}
      className={[
        "meeting-room-root",
        filOuvert ? "fil-ouvert" : "",
        enSalle ? "en-salle" : "",
        // La rangee du bandeau n'existe que lorsqu'il y a un bandeau : declaree
        // en permanence, elle restait vide et coutait quand meme un interligne.
        bandeauVisible ? "avec-bandeau" : "",
        filLargeOuvert ? "" : "sans-fil",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="meeting-header">
        <h1>{meeting.objet}</h1>
        <div className="meeting-entete-actions">
          {/*
            LE FIL S'OUVRE ET SE FERME SUR GRAND ECRAN AUSSI.

            LE MOTIF EST CELUI DE LA FENETRE DE DISCUSSION, et c'est deja une
            regle de la maison : la discussion ouvre ses informations par un
            bouton de sa RANGEE D'ACTIONS — pas depuis la barre du bas, qui porte
            les gestes de la conversation en cours — et le panneau se GLISSE A
            COTE au lieu de recouvrir. Le fil de la salle est le meme genre de
            compagnon : il accompagne la reunion sans jamais la cacher. Il prend
            donc le meme bouton au meme endroit, et la meme colonne qui pousse la
            video au lieu de se poser dessus.

            Sur ecran etroit, le fil est un panneau glissant avec sa propre
            bascule flottante : ce bouton-ci n'y aurait rien a commander.
          */}
          {!etroit && (
            <button
              className={`meeting-entete-bouton${filLargeOuvert ? " actif" : ""}`}
              onClick={() => setFilLargeOuvert((ouvert) => !ouvert)}
              aria-expanded={filLargeOuvert}
              aria-label={t("meet_chat_title")}
              title={t("meet_chat_title")}
            >
              <MeetingControlIcon kind="chat" taille={16} />
              {!filLargeOuvert && nonLus > 0 && (
                <span className="meeting-entete-compte">{nonLus > 99 ? "99+" : nonLus}</span>
              )}
            </button>
          )}
          <button
            className="btn-back"
            onClick={() => navigate("/meetings")}
            aria-label={t("close")}
          >
            ✕
          </button>
        </div>
      </div>

      {/* NOTIFICATIONS D'INVITATION — positionnées AU-DESSUS du media, pas dans la barre du bas

          EN DUR FAUTE DE CLE : « Demandes d'invitation » et « X souhaite inviter
          Y » n'existent nulle part au catalogue, ici comme dans le repli de la
          barre du bas. A reprendre des que les cles existent. */}
      {bandeauVisible && (
        <section className="meeting-invite-banner" aria-label="Demandes d'invitation">
          {demandes.map((d) => (
            <div key={d.id} className="meeting-invite-banner-item">
              <span>
                {d.demandeur.nom} souhaite inviter {d.invite.nom}
              </span>
              <div className="meeting-invite-banner-actions">
                <button onClick={() => void traiterDemande(d.id, true)}>✓</button>
                <button onClick={() => void traiterDemande(d.id, false)}>✕</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/*
        LE MEDIA DE LA SALLE.

        Une reunion est un appel a plusieurs avec un ordre du jour : elle emploie
        donc la grille des appels de groupe, pas une copie. Ce qu'on voyait
        jusqu'ici — des vignettes d'annuaire de 52 px — venait de la liste des
        invites : elles disaient QUI est attendu, jamais ce que chacun envoie.
        Aucun `<video>`, aucun `<audio>` : la salle etait aveugle et muette.

        Le son ne passe PAS par les tuiles, qui restent muettes : un `<audio>`
        par participant, ici. C'est ce qui laisse plusieurs voix se superposer,
        et evite qu'un meme flux soit joue deux fois.
      */}
      {enSalle && (
        /* `pleinEcran.cible` sur le CADRE et non sur un `<video>` : agrandir le
           seul element video perdrait la bande des autres participants et
           l'etiquette du presentateur. C'est le rendu entier qu'on veut plein
           ecran, pas une image. */
        <div className="meeting-media" ref={pleinEcran.cible}>
          {/* LES `<audio>` NE DEMENAGENT JAMAIS. Ils restent dans la page meme
              quand l'image part dans la fenetre reduite : les recreer ailleurs
              couperait le son le temps que les flux se rebranchent, et une
              reunion qu'on replie est justement une reunion qu'on ECOUTE. */}
          {fluxDistants.map(([id, stream]) => (
            <audio
              key={id}
              autoPlay
              ref={(el) => {
                if (!el) {
                  sortiesAudio.current.delete(id)
                  return
                }
                if (el.srcObject !== stream) {
                  el.srcObject = stream
                  void el
                    .play()
                    .then(() => setSonBloque(false))
                    .catch(() => setSonBloque(true))
                }
                el.muted = false
                el.volume = estVideo ? OUTPUT_VOLUME.speaker : OUTPUT_VOLUME[callState.audioOutput]
                sortiesAudio.current.set(id, el)
              }}
            />
          ))}

          {sonBloque && (
            <button className="meeting-son-bloque" onClick={debloquerLeSon}>
              {t("audio_blocked")}
            </button>
          )}

          {fenetreReduite ? (
            /* L'image est ailleurs. On le DIT, et on offre le retour : un cadre
               vide laisserait croire que la salle a lache. */
            <div className="meeting-media-deporte">
              <MeetingControlIcon kind="fenetre" taille={22} />
              <span>{t("size_small_screen")}</span>
              <button type="button" onClick={() => setFenetreReduite(false)}>
                {t("size_large_screen")}
              </button>
            </div>
          ) : (
            <>
              {rendreScene(false)}

              {/* Sa propre image, en petit : on verifie d'un coup d'oeil ce que
                  les autres recoivent, sans prendre la place de leurs cadres.
                  Retournee comme un miroir — c'est ainsi qu'on se voit.

                  Pas pendant qu'on presente : le grand cadre montre deja notre
                  emission, et ce n'est plus un visage a se voir mais un ecran a
                  lire. */}
              {estVideo &&
                callState.localStream &&
                !jePresente &&
                participantsDistants.length > 0 && (
                  <div className="meeting-apercu">
                    {callState.camOn ? (
                      <video ref={brancherApercuLocal} autoPlay playsInline muted />
                    ) : (
                      <div className="meeting-apercu-coupee">{t("camera_off")}</div>
                    )}
                    <span className="meeting-apercu-nom">{t("l2_me")}</span>
                  </div>
                )}

              {/* LES DEUX TAILLES DU RENDU, posees SUR le rendu lui-meme et non
                  dans la barre du bas : elles ne commandent pas la reunion, elles
                  commandent ce cadre-ci. C'est la ou l'oeil les cherche, et la ou
                  elles suivent le cadre en plein ecran — dans la barre du bas,
                  elles auraient disparu au moment precis ou l'on veut en sortir. */}
              <div className="meeting-media-outils">
                {/* Le bouton n'apparait PAS la ou l'API manque ou est interdite :
                    `supporte` lit `fullscreenEnabled`, qui vaut faux dans un
                    cadre sans permission comme dans la fenetre reduite. */}
                {pleinEcran.supporte && (
                  <button
                    type="button"
                    className={`meeting-media-bouton${pleinEcran.actif ? " actif" : ""}`}
                    onClick={pleinEcran.basculer}
                    aria-pressed={pleinEcran.actif}
                    title={t("f2_fullscreen")}
                    aria-label={t("f2_fullscreen")}
                  >
                    <MeetingControlIcon
                      kind={pleinEcran.actif ? "reduire" : "agrandir"}
                      taille={16}
                    />
                  </button>
                )}
                {/* Sur telephone, la carte de repli recouvrirait le peu d'ecran
                    qui reste : on ne propose la fenetre reduite que la ou elle
                    tient sa promesse — une VRAIE fenetre du systeme, ou un
                    bureau assez large pour qu'une carte flottante ait un sens. */}
                {(vraieFenetreReduite || !etroit) && !pleinEcran.actif && (
                  <button
                    type="button"
                    className="meeting-media-bouton"
                    onClick={() => setFenetreReduite(true)}
                    title={t("size_small_screen")}
                    aria-label={t("size_small_screen")}
                  >
                    <MeetingControlIcon kind="fenetre" taille={16} />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/*
        LA COLONNE D'INFORMATIONS, DESORMAIS UNE BANDE.

        Elle a longtemps ete le vrai voleur de l'ecran : plafonnee a 26 vh, elle
        prenait 281 px pour un contenu qui en mesurait 918, dont 577 px d'un
        panneau de reglages ecrit une seconde fois dans les panneaux flottants.
        Ces 577 px sont partis (voir le commentaire des paves) ; ce qui reste —
        le type, la duree, les invites, l'etat de l'appel — tient dans une bande
        d'environ 90 px et laisse le reste a la video.

        Les mentions passent a gauche, les invites defilent a l'horizontale a
        droite : la bande garde une hauteur de ligne quel que soit le nombre
        d'invites, au lieu de grandir jusqu'a son plafond.
      */}
      <div className="meeting-info">
        <div className="meeting-info-meta">
          {/* Le deux-points est DANS la traduction : l'espace qui le precede est
              une regle francaise, l'anglais colle le signe au mot et le chinois
              emploie le sien. Le coder ici les imposait a tout le monde. */}
          <p>
            {t("r2_meet_type_value", {
              value: meeting.type === "video" ? t("video_label") : t("cinfo_audio"),
            })}
          </p>
          <p>{t("meet_duration_minutes", { n: Math.floor(meeting.dureeSecondes / 60) })}</p>
          {meeting.participants.length > 0 && (
            <p>{t("meet_participants", { count: meeting.participants.length })}</p>
          )}
          {/* « Appel en cours » ne vaut que pour CETTE salle : un appel mene
              ailleurs n'a rien a annoncer ici. */}
          {enSalle && (
            <div className="call-status">
              <div className="status-indicator active" />
              <span>{t("call_in_progress")}</span>
            </div>
          )}
        </div>
        {meeting.participants.length > 0 && (
          <div className="participants-grid">
              {meeting.participants.map((p) => (
                <div key={p.id} className="participant-box">
                  {/* Un rond a la place du nom en clair : c'est la convention
                      partout ailleurs, et une tuile se balaie du regard bien
                      plus vite qu'une liste de noms. Sans photo, l'initiale —
                      jamais un vide. */}
                  <div className="participant-vignette">
                    <MeetingRemoteVideo stream={remoteStreams[p.id]} name={p.nom} />
                    {!remoteStreams[p.id] &&
                      (p.avatarUrl ? (
                        <img src={p.avatarUrl} alt="" />
                      ) : (
                        <span>{toInitials(p.nom)}</span>
                      ))}
                    {p.connecte && <span className="participant-pastille" aria-hidden="true" />}
                    {/* Sur la vignette d'un AUTRE, la pastille constate un
                        etat — elle n'invite a rien. « Lever la main » y
                        promettait une action qu'on ne peut pas faire a sa
                        place. */}
                    {mainsLevees.has(p.id) && (
                      <span className="participant-main" title={t("r2_hand_raised")}>
                        ✋
                      </span>
                    )}
                  </div>
                  <div className="participant-ligne">
                    <div className="participant-name">{p.nom}</div>
                    {/* L'exclusion n'apparait qu'a l'organisateur, et jamais sur
                        lui-meme : le serveur refuse les deux, et un bouton qui
                        promet un refus ne vaut pas mieux que pas de bouton. */}
                    {meeting.jeSuisOrganisateur && p.id !== meeting.organisateur.id && (
                      <button
                        className="participant-exclure"
                        onClick={() => void handleExclure(p.id, p.nom)}
                        aria-label={t("meet_exclude")}
                        title={t("meet_exclude")}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className={`participant-status ${p.connecte ? "connected" : "pending"}`}>
                    {p.connecte ? t("meet_connected") : t("meet_pending")}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/*
        Le fil accompagne la salle, il ne s'y substitue jamais.

        Assez large, les deux tiennent cote a cote : rien a ouvrir, rien a
        fermer, on ecrit en regardant la reunion. Trop etroit, le fil devient un
        panneau qui glisse PAR-DESSUS — la reunion reste dessous, visible et
        active. C'est la difference avec un ecran a part : on ne quitte pas la
        reunion pour ecrire, et il n'y a donc pas de bouton de retour a chercher
        pour y revenir. Un appui hors du panneau, ou sur la poignee, le referme.
      */}
      {etroit && (
        <div
          className={`salle-voile${filOuvert ? " ouvert" : ""}`}
          onClick={() => setFilOuvert(false)}
          aria-hidden="true"
        />
      )}
      {/* TOUJOURS MONTE, meme replie : le fil est ephemere et n'existe nulle
          part ailleurs — le demonter perdrait tout ce qui s'y est dit. Replier
          la colonne se fait donc en CSS, et `visible` sert seulement a compter
          ce qui arrive pendant qu'on ne le regarde pas. */}
      <MeetingChat
        meetingId={Number(meetingId)}
        visible={filVisible}
        onMessageMasque={() => setNonLus((n) => n + 1)}
      />

      {/* Le compteur dit ce qui s'est dit pendant que le panneau etait ferme :
          sans lui, on n'ouvrirait le fil que par hasard. */}
      {etroit && (
        <button
          className={`salle-fil-bascule${filOuvert ? " ouvert" : ""}`}
          onClick={() => setFilOuvert((ouvert) => !ouvert)}
          aria-expanded={filOuvert}
          aria-label={t("meet_chat_title")}
          title={t("meet_chat_title")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {filOuvert ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.5 8.5 0 01-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z" />
            )}
          </svg>
          {!filOuvert && nonLus > 0 && (
            <span className="salle-fil-compte">{nonLus > 99 ? "99+" : nonLus}</span>
          )}
        </button>
      )}

      {/*
        LA LIGNE DU BAS, en un seul element.

        Les commandes et les actions se partageaient la meme cellule de grille,
        l'une calee a gauche et l'autre a droite. Superposees, en realite : la
        derniere declaree — les actions — etendait sa boite, transparente mais
        bien presente, sur toute la cellule, et avalait les clics destines au
        micro et a la camera. Une barre unique remet les deux groupes dans le
        meme flux, ou ils se poussent au lieu de se couvrir.

        Les demandes d'invitation et la mention « reunion terminee » visent la
        MEME cellule : elles sont donc dans la barre elles aussi. Posees en
        voisines dans la grille, elles se seraient superposees aux boutons et
        auraient avale les clics, tout comme les actions le faisaient avant.
        Dans un conteneur flex, leur `grid-area` reste sans effet.
      */}
      <div className="meeting-barre">
        {/* Invitation requests moved above the media; only show them in the old
            position when NOT in the room */}
        {meeting.jeSuisOrganisateur && demandes.length > 0 && !enSalle && (
          <section className="meeting-invite-requests" aria-label="Demandes d'invitation">
            <div className="meeting-invite-head">
              <strong>Demandes d'invitation</strong>
            </div>
            {demandes.map((d) => (
              <div key={d.id} className="meeting-invite-request">
                <span>
                  {d.demandeur.nom} souhaite inviter {d.invite.nom}
                </span>
                <div>
                  <button onClick={() => void traiterDemande(d.id, true)}>{t("accept")}</button>
                  <button onClick={() => void traiterDemande(d.id, false)}>{t("decline")}</button>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* `meet_ended_toast` porte exactement cette phrase — « Reunion
            terminee » — dans les neuf langues. Son nom vient de son premier
            emploi, une notification de la liste des reunions ; c'est le libelle
            qui compte, et il n'y en a pas d'autre pour cet etat. */}
        {meeting.terminee && <div className="meeting-ended">{t("meet_ended_toast")}</div>}

        {/* Commandes de la salle. Le micro, la camera, la main, la sortie audio
            et le partage n'existent qu'une fois DEDANS : proposer de couper un
            micro qui n'est pas ouvert n'aurait aucun sens. La camera n'apparait
            qu'en video, et la sortie audio qu'en audio — au haut-parleur de
            toute facon des qu'il y a de l'image.

            « Ajouter » et « Menu », eux, valent AUSSI AVANT d'entrer : c'est la
            colonne d'informations qui portait jusqu'ici les reglages de
            l'organisateur, et elle ne les porte plus. Les enfermer dans la salle
            aurait rendu l'invitation automatique inaccessible a qui n'a pas
            encore rejoint. */}
        {(enSalle || !meeting.terminee) && (
          <div className="meeting-controles">
            {enSalle && (
              <>
            <button
              className={`meeting-controle${callState.micOn ? "" : " coupe"}`}
              onClick={() => toggleMicrophone()}
              aria-pressed={!callState.micOn}
              title={callState.micOn ? t("mute_mic") : t("unmute_mic")}
              aria-label={callState.micOn ? t("mute_mic") : t("unmute_mic")}
            >
              {callState.micOn ? (
                <MeetingControlIcon kind="mic" />
              ) : (
                <MeetingControlIcon kind="micOff" />
              )}
            </button>

            {/* Un bouton annonce ce qu'il VA faire, comme le micro juste a cote.
              « Camera desactivee » decrivait l'etat, et une fois la camera
              coupee l'infobulle se resumait a « Video ». */}
            {meeting.type === "video" && (
              <button
                className={`meeting-controle${callState.camOn ? "" : " coupe"}`}
                onClick={() => toggleCamera()}
                aria-pressed={!callState.camOn}
                title={callState.camOn ? t("turn_off_camera") : t("turn_on_camera")}
                aria-label={callState.camOn ? t("turn_off_camera") : t("turn_on_camera")}
              >
                {callState.camOn ? (
                  <MeetingControlIcon kind="camera" />
                ) : (
                  <MeetingControlIcon kind="cameraOff" />
                )}
              </button>
            )}

            <button
              className={`meeting-controle${maMain ? " actif" : ""}`}
              onClick={() => sendMeetingHand(Number(meetingId), !maMain)}
              aria-pressed={maMain}
              title={maMain ? t("r2_lower_hand") : t("meet_raise_hand")}
              aria-label={maMain ? t("r2_lower_hand") : t("meet_raise_hand")}
            >
              <MeetingControlIcon kind="hand" />
            </button>

            {/* « Sortie audio des appels » est le libelle d'une ligne de
              Parametres : dans la salle, il nommait un reglage au lieu de dire
              vers quoi la bascule envoie le son, et ne bougeait pas d'un etat a
              l'autre. */}
            {meeting.type !== "video" && (
              <button
                className={`meeting-controle${callState.audioOutput === "speaker" ? " actif" : ""}`}
                onClick={() =>
                  setCallAudioOutput(callState.audioOutput === "speaker" ? "earpiece" : "speaker")
                }
                aria-pressed={callState.audioOutput === "speaker"}
                title={
                  callState.audioOutput === "speaker"
                    ? t("r2_switch_to_earpiece")
                    : t("r2_switch_to_speaker")
                }
                aria-label={
                  callState.audioOutput === "speaker"
                    ? t("r2_switch_to_earpiece")
                    : t("r2_switch_to_speaker")
                }
              >
                {callState.audioOutput === "speaker" ? (
                  <MeetingControlIcon kind="speaker" />
                ) : (
                  <MeetingControlIcon kind="earpiece" />
                )}
              </button>
            )}

            {/*
              LE PARTAGE D'ECRAN.

              Deux conditions, et pas une de trop. `partageEcranSupporte()` :
              `getDisplayMedia` n'existe ni sur les navigateurs mobiles ni hors
              contexte securise, et un bouton qui ne peut rien faire ne doit pas
              etre la. `estVideo` : dans une reunion AUDIO, aucune piste video
              n'a ete negociee — l'ecran n'irait nulle part et l'on se croirait
              en presentation devant des gens qui ne voient rien.

              Un seul intitule pour les deux etats, et `aria-pressed` pour dire
              lequel : c'est la convention des bascules, et elle evite d'inventer
              une seconde cle de catalogue pour l'arret.
            */}
            {captureEcranPossible && estVideo && (
              <button
                className={`meeting-controle${callState.partageParMoi ? " actif" : ""}`}
                onClick={basculerPartageEcran}
                aria-pressed={callState.partageParMoi}
                title={tAVenir("meet_share_screen")}
                aria-label={tAVenir("meet_share_screen")}
              >
                <MeetingControlIcon kind="ecran" />
              </button>
            )}
              </>
            )}

            {/* Bouton « Ajouter une personne » — visible pour tout le monde */}
            <button
              className={`meeting-controle${panneauOuvert === "ajouter" ? " actif" : ""}`}
              onClick={() =>
                setPanneauOuvert((p) => (p === "ajouter" ? null : "ajouter"))
              }
              title={t("meet_add_person")}
              aria-label={t("meet_add_person")}
              aria-expanded={panneauOuvert === "ajouter"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
            </button>

            {/* Bouton « Menu ⋮ » — organisateur seulement */}
            {meeting.jeSuisOrganisateur && (
              <button
                className={`meeting-controle${panneauOuvert === "menu" ? " actif" : ""}`}
                onClick={() =>
                  setPanneauOuvert((p) => (p === "menu" ? null : "menu"))
                }
                title={t("meet_settings")}
                aria-label={t("meet_settings")}
                aria-expanded={panneauOuvert === "menu"}
              >
                <MeetingControlIcon kind="points" />
              </button>
            )}
          </div>
        )}

        <div className="meeting-actions">
          {/* « Rejoindre » ou « Quitter » selon qu'on est dans CETTE salle : un
            appel mene ailleurs affichait « Quitter la reunion » sur une salle ou
            l'on n'etait pas entre, et cachait le bouton qui y menait. Une
            reunion terminee, elle, ne se rejoint plus du tout. */}
          {!enSalle && !meeting.terminee && (
            <button className="btn-join" onClick={() => void handleJoinMeeting()}>
              {t("meet_join_room")}
            </button>
          )}
          {enSalle && (
            <button className="btn-leave" onClick={() => void handleLeaveMeeting()}>
              {t("meet_leave_room")}
            </button>
          )}
          {/* Quitter, tout le monde le peut : la reunion continue sans nous.
            Terminer la ferme pour tous — le serveur le reserve a
            l'organisateur, l'ecran ne le propose donc qu'a lui. */}
          {meeting.jeSuisOrganisateur && !meeting.terminee && (
            <button className="btn-leave" onClick={() => void handleEndMeeting()}>
              {t("meet_end")}
            </button>
          )}
        </div>
      </div>

      {/* PANNEAU D'AJOUT DE PERSONNE — sous la barre, au-dessus du chat.
          Plus conditionne a `enSalle` : son bouton ne l'est plus non plus. */}
      {panneauOuvert === "ajouter" && (
        <div className="meeting-panneau meeting-panneau-ajout" ref={panneauRef}>
          <div className="meeting-panneau-titre">{t("meet_add_person")}</div>

          <div className="meeting-panneau-onglets">
            <button
              className={ongletAjout === "contacts" ? "on" : ""}
              onClick={() => setOngletAjout("contacts")}
            >
              {t("contacts")}
            </button>
            <button
              className={ongletAjout === "numero" ? "on" : ""}
              onClick={() => setOngletAjout("numero")}
            >
              {t("dial_an_id")}
            </button>
          </div>

          {ongletAjout === "contacts" ? (
            <>
              <input
                className="meeting-panneau-search"
                type="text"
                autoFocus
                placeholder={t("search_name_or_number")}
                value={rechercheContact}
                onChange={(e) => setRechercheContact(e.target.value)}
              />
              <div className="meeting-panneau-list">
                {contactsFiltres.length > 0 ? (
                  contactsFiltres.map((c) => (
                    <button
                      key={c.id}
                      className="meeting-panneau-contact"
                      onClick={() => void ajouterPersonneParNumero(c.phone, c.name)}
                    >
                      <b>{c.name}</b>
                      <span>{c.phone}</span>
                    </button>
                  ))
                ) : (
                  <div className="meeting-panneau-vide">{t("meet_no_contact_found")}</div>
                )}
              </div>
            </>
          ) : (
            <div className="meeting-panneau-pave">
              {/* Le meme pave que la page des appels, en variante resserree : ce
                  panneau flotte au-dessus de la salle et ne doit pas defiler.

                  `autoFocus` : le pave ecoute le clavier physique sur SA racine
                  et non sur le document — il ne recoit donc rien tant que
                  personne ne la lui donne. Sans ce prop, presser 5 en arrivant
                  sur l'onglet ne ferait rien, et il faudrait d'abord cliquer une
                  touche a la souris. */}
              <PaveNumerique
                valeur={chiffresAjout}
                onChange={setChiffresAjout}
                onValider={validerNumeroAjout}
                autoFocus
                compact
                afficherTitulaire
              />
              {/* L'etat de la SAISIE. Le nom du titulaire, lui, se lit sous les
                  chiffres, dans le pave — et c'est un NOM COMPLET, la ou cette
                  ligne n'affichait qu'un pseudo. */}
              <div className="meeting-panneau-aide" aria-live="polite">
                {chiffresAjout.length === 0
                  ? t("dial_hint_number")
                  : isValidAlanyaNumber(chiffresAjout)
                    ? t("number_complete")
                    : t("digits_too_short", { n: chiffresAjout.length })}
              </div>
              <div className="meeting-panneau-pave-actions">
                <button onClick={validerNumeroAjout} disabled={!isValidAlanyaNumber(chiffresAjout)}>
                  {meeting?.jeSuisOrganisateur
                    ? t("invite_this_number")
                    : t("meet_invite_requested")}
                </button>
              </div>
            </div>
          )}

          <button
            className="meeting-panneau-fermer"
            onClick={() => setPanneauOuvert(null)}
          >
            {t("cancel")}
          </button>
        </div>
      )}

      {/* PANNEAU DE PARAMÈTRES — organisateur seulement.
          C'EST DESORMAIS LE SEUL ENDROIT ou vit l'invitation automatique : la
          colonne d'informations en portait une copie mot pour mot. */}
      {panneauOuvert === "menu" && meeting.jeSuisOrganisateur && (
        <div className="meeting-panneau meeting-panneau-menu" ref={panneauRef}>
          <div className="meeting-panneau-titre">{t("meet_settings")}</div>
          <label className="meeting-panneau-toggle">
            <input
              type="checkbox"
              checked={meeting.invitationAuto}
              onChange={(e) => void changerModeInvitation(e.target.checked)}
            />
            <span>
              <strong>{t("meet_auto_invite")}</strong>
              <small>{t("meet_auto_invite_hint")}</small>
            </span>
          </label>
        </div>
      )}

      {/*
        LA FENETRE REDUITE.

        Ses dimensions viennent de l'utilisateur — « la largeur du panneau de
        chat, les trois quarts de sa hauteur » — et sont MESUREES sur le panneau
        reel : deux nombres ecrits ici auraient menti des la premiere retouche du
        fil. Tant qu'aucune mesure n'est disponible, la fenetre ne s'ouvre pas :
        mieux vaut ne rien ouvrir qu'ouvrir de travers.

        Le composant ne rend rien tant que `ouverte` est faux ; il est donc monte
        en permanence sans consequence.
      */}
      {tailleFil && (
        <FenetreReduite
          ouverte={fenetreReduite && enSalle}
          onFermer={() => {
            setMenuFenetre(false)
            setFenetreReduite(false)
          }}
          largeur={tailleFil.largeur}
          hauteur={tailleFil.hauteur}
        >
          {/* Le rendu, en plus petit : le grand cadre puis les autres, qui
              defilent. `.fr-scene` et `.fr-barre` sont l'habillage que la
              fenetre offre a la salle — ecrits dans SA feuille, la seule qui
              soit sure d'etre recopiee dans l'autre document. */}
          <div className="fr-scene">{rendreScene(true)}</div>

          <div className="fr-barre">
            <button
              type="button"
              className={`fr-bouton${callState.micOn ? "" : " coupe"}`}
              onClick={() => toggleMicrophone()}
              aria-pressed={!callState.micOn}
              title={callState.micOn ? t("mute_mic") : t("unmute_mic")}
              aria-label={callState.micOn ? t("mute_mic") : t("unmute_mic")}
            >
              <MeetingControlIcon kind={callState.micOn ? "mic" : "micOff"} taille={16} />
            </button>

            {meeting.type === "video" && (
              <button
                type="button"
                className={`fr-bouton${callState.camOn ? "" : " coupe"}`}
                onClick={() => toggleCamera()}
                aria-pressed={!callState.camOn}
                title={callState.camOn ? t("turn_off_camera") : t("turn_on_camera")}
                aria-label={callState.camOn ? t("turn_off_camera") : t("turn_on_camera")}
              >
                <MeetingControlIcon kind={callState.camOn ? "camera" : "cameraOff"} taille={16} />
              </button>
            )}

            {/*
              TOUT LE RESTE derriere les trois points. Une fenetre large comme la
              colonne du fil ne tient pas huit boutons de front, et couper son
              micro doit rester atteignable sans reflechir : les deux gestes
              qu'on fait vingt fois restent dehors, les autres se deplient.

              Le menu s'ouvre EN PLACE, sans ecouteur pose sur `document` : ce
              contenu vit dans un AUTRE document quand la fenetre du systeme
              existe, et un ecouteur pose sur celui de la page n'y verrait aucun
              clic.
            */}
            <div className="fr-menu-ancre">
              <button
                type="button"
                className={`fr-bouton${menuFenetre ? " actif" : ""}`}
                onClick={() => setMenuFenetre((ouvert) => !ouvert)}
                aria-expanded={menuFenetre}
                title={t("more_actions")}
                aria-label={t("more_actions")}
              >
                <MeetingControlIcon kind="points" taille={16} />
              </button>

              {menuFenetre && (
                <div className="fr-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="fr-menu-item"
                    onClick={() => {
                      setMenuFenetre(false)
                      sendMeetingHand(Number(meetingId), !maMain)
                    }}
                  >
                    <MeetingControlIcon kind="hand" taille={15} />
                    {maMain ? t("r2_lower_hand") : t("meet_raise_hand")}
                  </button>

                  {meeting.type !== "video" && (
                    <button
                      type="button"
                      role="menuitem"
                      className="fr-menu-item"
                      onClick={() => {
                        setMenuFenetre(false)
                        setCallAudioOutput(
                          callState.audioOutput === "speaker" ? "earpiece" : "speaker"
                        )
                      }}
                    >
                      <MeetingControlIcon
                        kind={callState.audioOutput === "speaker" ? "speaker" : "earpiece"}
                        taille={15}
                      />
                      {callState.audioOutput === "speaker"
                        ? t("r2_switch_to_earpiece")
                        : t("r2_switch_to_speaker")}
                    </button>
                  )}

                  {captureEcranPossible && estVideo && (
                    <button
                      type="button"
                      role="menuitem"
                      className="fr-menu-item"
                      aria-pressed={callState.partageParMoi}
                      onClick={() => {
                        setMenuFenetre(false)
                        basculerPartageEcran()
                      }}
                    >
                      <MeetingControlIcon kind="ecran" taille={15} />
                      {tAVenir("meet_share_screen")}
                    </button>
                  )}

                  {/*
                    CES TROIS-LA RAMENENT D'ABORD AU GRAND ECRAN. Le fil et les
                    panneaux vivent dans la page : les ouvrir depuis la fenetre
                    reduite les ferait apparaitre derriere elle, sur un ecran que
                    l'utilisateur ne regarde plus. Reduire la fenetre d'abord,
                    c'est montrer ce qu'on vient de demander.
                  */}
                  <button
                    type="button"
                    role="menuitem"
                    className="fr-menu-item"
                    onClick={() => {
                      setMenuFenetre(false)
                      setFenetreReduite(false)
                      if (etroit) setFilOuvert(true)
                      else setFilLargeOuvert(true)
                    }}
                  >
                    <MeetingControlIcon kind="chat" taille={15} />
                    {t("meet_chat_title")}
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className="fr-menu-item"
                    onClick={() => {
                      setMenuFenetre(false)
                      setFenetreReduite(false)
                      setPanneauOuvert("ajouter")
                    }}
                  >
                    {t("meet_add_person")}
                  </button>

                  {meeting.jeSuisOrganisateur && (
                    <button
                      type="button"
                      role="menuitem"
                      className="fr-menu-item"
                      onClick={() => {
                        setMenuFenetre(false)
                        setFenetreReduite(false)
                        setPanneauOuvert("menu")
                      }}
                    >
                      {t("meet_settings")}
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    className="fr-menu-item danger"
                    onClick={() => {
                      setMenuFenetre(false)
                      setFenetreReduite(false)
                      void handleLeaveMeeting()
                    }}
                  >
                    <MeetingControlIcon kind="sortir" taille={15} />
                    {t("meet_leave_room")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </FenetreReduite>
      )}
    </div>
  )
}
