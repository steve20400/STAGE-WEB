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
  hangUp,
  joinMeetingRoom,
  setCallAudioOutput,
  toggleCamera,
  toggleMicrophone,
} from "../../../../src/services/call-manager"
import { OUTPUT_VOLUME } from "../../../../src/services/audio-output"
import { useCallState } from "../../../../src/hooks/use-call"
import { useContacts } from "../../../../src/hooks/use-contacts"
import { getMyUserId, loadSessionUser, toInitials } from "../../../../src/data/session-user"
import {
  sendMeetingHand,
  subscribeToMeetingEvents,
} from "../../../../src/services/websocket-service"
import { useTranslation } from "../../../../src/i18n"
import { MeetingChat } from "../../../../src/components/meeting-chat"
import { ParticipantGrid } from "../../../../src/components/participant-grid"
import { PaveNumerique } from "../../../../src/components/pave-numerique"
import type { CompteTrouve } from "../../../../src/services/contact-lists-service"
import {
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../../../../src/lib/alanya-number"
import type { Reunion } from "../../../../src/services/meetings-service"
import "./meeting-room.css"

function MeetingControlIcon({
  kind,
}: {
  kind: "mic" | "micOff" | "camera" | "cameraOff" | "hand" | "speaker" | "earpiece"
}) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  }
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
  /** Identifiants dont la main est levee, tels que le serveur les diffuse. */
  const [mainsLevees, setMainsLevees] = useState<Set<string>>(new Set())
  const [nonLus, setNonLus] = useState(0)
  const [demandes, setDemandes] = useState<DemandeInvitation[]>([])
  const [numeroDirect, setNumeroDirect] = useState("")
  /**
   * Ce que le pave a trouve sous les chiffres composes, ET les chiffres auxquels
   * sa reponse se rapporte.
   *
   * Le numero accompagne le compte parce que le pave ne previent qu'a
   * l'aboutissement de SA recherche : entre la frappe d'un chiffre de plus et la
   * reponse suivante, le compte du numero PRECEDENT serait encore en main, et le
   * bouton « Ajouter » resterait allume au-dessus d'un numero qui n'est plus le
   * sien. Compare aux chiffres affiches, il s'eteint des la frappe.
   */
  const [titulaireDirect, setTitulaireDirect] = useState<{
    numero: string
    compte: CompteTrouve | null
  }>({ numero: "", compte: null })
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
  useEffect(() => {
    const element = apercuLocalRef.current
    if (!element || !callState.localStream) return
    if (element.srcObject !== callState.localStream) {
      element.srcObject = callState.localStream
      void element.play().catch(() => undefined)
    }
  }, [callState.localStream, idPisteLocale, callState.camOn, participantsDistants.length])

  // Ouvrir le fil solde ce qui a ete rate pendant qu'il etait ferme.
  useEffect(() => {
    if (filOuvert) setNonLus(0)
  }, [filOuvert])

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
   * Deux choses a faire, et il en manquait toujours une : couper le media, et
   * fermer la participation EN BASE. `hangUp()` arrete les pistes — camera et
   * micro s'eteignent pour de bon —, ferme les connexions et emet
   * `meeting_leave` sur la socket deja ouverte. Mais lui seul ne dit RIEN a la
   * base : sans l'appel a `/leave`, le participant y reste « connecte » et sa
   * duree de presence n'est jamais close. C'est exactement ce qui arrivait par
   * tout chemin autre que le bouton.
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
        if (aPrevenir) leaveMeetingAuDechargement(id)
        if (enAppelIci) void hangUp()
        return
      }

      // Le media D'ABORD, la base ensuite : sans ce passage, on sortait de la
      // reunion cote serveur en continuant a filmer et a etre vu.
      if (enAppelIci) await hangUp()
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
   * PLUS AUCUNE RECHERCHE DE TITULAIRE N'EST MENEE DEPUIS CET ECRAN, ni pour le
   * panneau d'ajout ni pour l'invitation directe de l'organisateur : le pave
   * partage la mene une fois (`afficherTitulaire`) et rend le compte trouve
   * (`onTitulaire`).
   *
   * Il y en avait deux, pour la MEME question et a deux rythmes differents : le
   * pave peignait le nom du titulaire a 350 ms pendant qu'une seconde requete,
   * ici, decidait a 250 ms si le bouton « Ajouter » s'allumait. L'ecran se
   * contredisait a chaque frappe — le nom complet lisible sous les chiffres, le
   * bouton eteint dessous, et rien pour expliquer pourquoi on ne pouvait pas
   * inviter quelqu'un de manifestement identifie. Une seule source de verite
   * supprime la contradiction en meme temps que la requete.
   */

  /** Chiffres composes, sans les espaces d'affichage. */
  const chiffresDirects = normalizeAlanyaNumber(numeroDirect)

  /** Le compte trouve, mais seulement s'il parle bien des chiffres AFFICHES. */
  const compteDirect = titulaireDirect.numero === chiffresDirects ? titulaireDirect.compte : null

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

  const inviterDirectement = async () => {
    if (!meetingId) return
    // Garde de derniere ligne : le bouton est deja eteint sans compte trouve, et
    // la validation au clavier applique la meme condition.
    if (!compteDirect) return showError(t("error"), t("dial_unknown_number"))
    try {
      await inviterAReunion(Number(meetingId), [chiffresDirects])
      setNumeroDirect("")
      setMeeting(await fetchMeeting(Number(meetingId)))
    } catch (err) {
      showError(t("error"), err instanceof Error ? err.message : t("a2_invite_failed"))
    }
  }

  const maMain = mainsLevees.has(getMyUserId() ?? "")
  /** Notre propre nom, pour l'initiale affichee quand on est seul dans la salle. */
  const monNom = loadSessionUser()?.name ?? t("l2_me")

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
      showError(t("error"), err instanceof Error ? err.message : t("meet_leave_failed"))
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

  return (
    <div
      className={`meeting-room-root${filOuvert ? " fil-ouvert" : ""}${enSalle ? " en-salle" : ""}`}
    >
      <div className="meeting-header">
        <h1>{meeting.objet}</h1>
        <button className="btn-back" onClick={() => navigate("/meetings")} aria-label={t("close")}>
          ✕
        </button>
      </div>

      {/* NOTIFICATIONS D'INVITATION — positionnées AU-DESSUS du media, pas dans la barre du bas

          EN DUR FAUTE DE CLE : « Demandes d'invitation » et « X souhaite inviter
          Y » n'existent nulle part au catalogue, ici comme dans le repli de la
          barre du bas. A reprendre des que les cles existent. */}
      {meeting.jeSuisOrganisateur && demandes.length > 0 && enSalle && (
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
        <div className="meeting-media">
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

          {participantsDistants.length > 0 ? (
            <>
              <ParticipantGrid participants={participantsDistants} isVideo={estVideo} size="room" />
              {/* Sa propre image, en petit : on verifie d'un coup d'oeil ce que
                  les autres recoivent, sans prendre la place de leurs cadres.
                  Retournee comme un miroir — c'est ainsi qu'on se voit. */}
              {estVideo && callState.localStream && (
                <div className="meeting-apercu">
                  {callState.camOn ? (
                    <video ref={apercuLocalRef} autoPlay playsInline muted />
                  ) : (
                    <div className="meeting-apercu-coupee">{t("camera_off")}</div>
                  )}
                  <span className="meeting-apercu-nom">{t("l2_me")}</span>
                </div>
              )}
            </>
          ) : (
            /* Seul dans la salle : sa propre image occupe le cadre, faute
               d'autre chose a montrer. Une reunion ou l'on arrive en avance ne
               doit pas ressembler a une reunion en panne. */
            <div className="meeting-seul">
              {estVideo && callState.localStream && callState.camOn ? (
                <video
                  ref={apercuLocalRef}
                  className="meeting-seul-video"
                  autoPlay
                  playsInline
                  muted
                />
              ) : (
                <div className="meeting-seul-avatar">{toInitials(monNom)}</div>
              )}
              <span className="meeting-seul-mention">{t("meet_pending")}</span>
            </div>
          )}
        </div>
      )}

      <div className="meeting-info">
        {/* Le deux-points est DANS la traduction : l'espace qui le precede est
            une regle francaise, l'anglais colle le signe au mot et le chinois
            emploie le sien. Le coder ici les imposait a tout le monde. */}
        <p>
          {t("r2_meet_type_value", {
            value: meeting.type === "video" ? t("video_label") : t("cinfo_audio"),
          })}
        </p>
        <p>{t("meet_duration_minutes", { n: Math.floor(meeting.dureeSecondes / 60) })}</p>
        {meeting.jeSuisOrganisateur && !meeting.terminee && (
          <section className="meeting-settings-panel">
            {/* Le meme intitule et le meme libelle que le panneau « Menu » de la
                barre du bas, qui porte deja la meme case : deux ecritures du
                meme reglage ne doivent pas se dire autrement. */}
            <div className="meeting-settings-title">{t("meet_settings")}</div>
            <label className="meeting-auto-invite">
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
            {/* LE PAVE DE LA PAGE DES APPELS, et non plus un clavier maison.
                Celui d'ici formatait le numero par groupes de deux quand le
                reste de l'application le groupe autrement, s'arretait a huit
                chiffres quand le backend en emet jusqu'a dix, ignorait le
                clavier physique, et annoncait un PSEUDO la ou l'on attend le nom
                complet du titulaire. Un seul clavier partout, c'est un seul
                endroit ou corriger tout cela.

                Pas d'`autoFocus` : ce bloc est pose dans la page, pas dans une
                fenetre qui vient de s'ouvrir. Lui donner le focus a l'arrivee
                sauterait au clavier au lieu de laisser lire la reunion. */}
            <div className="meeting-id-keypad">
              <PaveNumerique
                valeur={numeroDirect}
                onChange={setNumeroDirect}
                onValider={() => {
                  // Entree fait ce que ferait le bouton, et rien de plus : sans
                  // cette condition, valider au clavier sur un numero sans compte
                  // afficherait une erreur la ou le bouton, eteint, ne propose
                  // rien.
                  if (compteDirect) void inviterDirectement()
                }}
                compact
                afficherTitulaire
                /* Le compte que le pave vient de trouver, celui-la meme dont il
                   ecrit le nom sous les chiffres. C'est ce rappel qui remplace
                   la seconde requete : le nom affiche et le bouton allume
                   repondent desormais a la meme reponse, au meme instant.

                   Les chiffres sont pris dans la fermeture et non dans une
                   reference : le rappel qui parle est celui du rendu qui a
                   lance la recherche, donc `chiffresDirects` designe le numero
                   CHERCHE et non le dernier tape. */
                onTitulaire={(compte) => setTitulaireDirect({ numero: chiffresDirects, compte })}
              />
              {/* L'etat de la SAISIE. Le nom du titulaire, lui, se lit sous les
                  chiffres, dans le pave. */}
              <div className="meeting-id-help" aria-live="polite">
                {numeroDirect.length === 0
                  ? t("dial_hint_number")
                  : isValidAlanyaNumber(numeroDirect)
                    ? t("number_complete")
                    : t("digits_too_short", { n: numeroDirect.length })}
              </div>
              <div className="meeting-id-actions">
                <button
                  type="button"
                  onClick={() => void inviterDirectement()}
                  disabled={!compteDirect}
                >
                  {t("l2_add")}
                </button>
              </div>
            </div>
          </section>
        )}
        {meeting.participants.length > 0 && (
          <>
            <p>{t("meet_participants", { count: meeting.participants.length })}</p>
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
          </>
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
      <MeetingChat
        meetingId={Number(meetingId)}
        visible={!etroit || filOuvert}
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

        {/* Commandes de la salle. Elles n'existent qu'une fois dedans : proposer
            de couper un micro qui n'est pas ouvert n'aurait aucun sens. La camera
            n'apparait qu'en video, et la sortie audio qu'en audio — au haut-parleur
            de toute facon des qu'il y a de l'image. */}
        {enSalle && (
          <div className="meeting-controles">
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
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

      {/* PANNEAU D'AJOUT DE PERSONNE — sous la barre, au-dessus du chat */}
      {panneauOuvert === "ajouter" && enSalle && (
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

      {/* PANNEAU DE PARAMÈTRES — organisateur seulement */}
      {panneauOuvert === "menu" && enSalle && meeting.jeSuisOrganisateur && (
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
    </div>
  )
}
