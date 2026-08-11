import { useEffect, useState, useMemo, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useToast } from "../../../../src/components/toast"
import {
  endMeeting,
  exclureDeReunion,
  fetchMeeting,
  joinMeeting,
  leaveMeeting,
  listerDemandesInvitation,
  trancherDemandeInvitation,
  reglerInvitationAuto,
  inviterAReunion,
  type DemandeInvitation,
} from "../../../../src/services/meetings-service"
import {
  joinMeetingRoom,
  hangUp,
  setCallAudioOutput,
  toggleCamera,
  toggleMicrophone,
} from "../../../../src/services/call-manager"
import { useCallState } from "../../../../src/hooks/use-call"
import { getMyUserId, toInitials } from "../../../../src/data/session-user"
import {
  sendMeetingHand,
  subscribeToMeetingEvents,
} from "../../../../src/services/websocket-service"
import { useTranslation } from "../../../../src/i18n"
import { MeetingChat } from "../../../../src/components/meeting-chat"
import type { Reunion } from "../../../../src/services/meetings-service"
import "./meeting-room.css"

function MeetingControlIcon({ kind }: { kind: "mic" | "micOff" | "camera" | "cameraOff" | "hand" | "speaker" | "earpiece" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  if (kind === "camera" || kind === "cameraOff") return <svg {...common}>{kind === "cameraOff" && <line x1="3" y1="3" x2="21" y2="21"/>}<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>
  if (kind === "hand") return <svg {...common}><path d="M7 11V5a1.5 1.5 0 0 1 3 0v5V3a1.5 1.5 0 0 1 3 0v7V5a1.5 1.5 0 0 1 3 0v7V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-14 0v-3Z"/></svg>
  if (kind === "speaker" || kind === "earpiece") return <svg {...common}><path d="m5 9 4-4v14l-4-4H2V9h3Z"/><path d={kind === "speaker" ? "M13 9a4 4 0 0 1 0 6M16 6a8 8 0 0 1 0 12" : "M13 12h.01"}/></svg>
  return <svg {...common}>{kind === "micOff" && <line x1="3" y1="3" x2="21" y2="21"/>}<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/></svg>
}

function MeetingRemoteVideo({ stream, name }: { stream?: MediaStream; name: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current && stream && ref.current.srcObject !== stream) { ref.current.srcObject = stream; void ref.current.play().catch(() => undefined) } }, [stream])
  return stream ? <video ref={ref} autoPlay playsInline className="meeting-remote-video" aria-label={`Vidéo de ${name}`} /> : null
}

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

  // Ouvrir le fil solde ce qui a ete rate pendant qu'il etait ferme.
  useEffect(() => {
    if (filOuvert) setNonLus(0)
  }, [filOuvert])

  useEffect(() => {
    if (!meetingId) return

    const loadMeeting = async () => {
      setLoading(true)
      try {
        const m = await fetchMeeting(parseInt(meetingId, 10))
        setMeeting(m)
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

  const handleJoinMeeting = async () => {
    if (!meeting || !meetingId) return
    if (meeting.terminee) return showError(t("error"), "Cette réunion est terminée.")

    try {
      await joinMeeting(parseInt(meetingId, 10))

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
    const charger = () => void listerDemandesInvitation(Number(meetingId)).then(setDemandes).catch(() => undefined)
    charger()
    const id = window.setInterval(charger, 10000)
    return () => window.clearInterval(id)
  }, [meeting?.jeSuisOrganisateur, meetingId])

  const traiterDemande = async (demandeId: number, accepter: boolean) => {
    if (!meetingId) return
    try {
      await trancherDemandeInvitation(Number(meetingId), demandeId, accepter)
      setDemandes((liste) => liste.filter((d) => d.id !== demandeId))
    } catch (err) { showError(t("error"), err instanceof Error ? err.message : "Demande impossible") }
  }

  const changerModeInvitation = async (automatic: boolean) => {
    if (!meetingId || !meeting) return
    try { await reglerInvitationAuto(Number(meetingId), automatic); setMeeting({ ...meeting, invitationAuto: automatic }) }
    catch (err) { showError(t("error"), err instanceof Error ? err.message : "Réglage impossible") }
  }

  const inviterDirectement = async () => {
    if (!meetingId) return
    const numero = numeroDirect.replace(/\D/g, "")
    if (!/^(\d{6}|\d{8})$/.test(numero)) return showError(t("error"), "Saisissez un Alanya ID valide.")
    try { await inviterAReunion(Number(meetingId), [numero]); setNumeroDirect(""); setMeeting(await fetchMeeting(Number(meetingId))) }
    catch (err) { showError(t("error"), err instanceof Error ? err.message : "Invitation impossible") }
  }

  const maMain = mainsLevees.has(getMyUserId() ?? "")

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
      await hangUp()
      navigate("/meetings")
    } catch (err) {
      showError(t("error"), err instanceof Error ? err.message : t("meet_end_failed"))
    }
  }

  const handleLeaveMeeting = async () => {
    if (!meetingId) return

    try {
      await leaveMeeting(parseInt(meetingId, 10))
      // Arrête WebRTC et toutes les pistes caméra/micro locales avant navigation.
      await hangUp()
      navigate("/meetings")
    } catch (err) {
      showError(t("error"), err instanceof Error ? err.message : t("meet_leave_failed"))
    }
  }

  if (loading) {
    return (
      <div className={`meeting-room-root${filOuvert ? " fil-ouvert" : ""}`}>
      {Object.entries(remoteStreams).map(([id, stream]) => <audio key={id} autoPlay ref={(el) => { if (el && el.srcObject !== stream) { el.srcObject = stream; void el.play().catch(() => undefined) } }} />)}
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
    <div className={`meeting-room-root${filOuvert ? " fil-ouvert" : ""}`}>
      <div className="meeting-header">
        <h1>{meeting.objet}</h1>
        <button className="btn-back" onClick={() => navigate("/meetings")} aria-label={t("close")}>
          ✕
        </button>
      </div>

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
            <div className="meeting-settings-title">Paramètres de la réunion</div>
            <label className="meeting-auto-invite"><input type="checkbox" checked={meeting.invitationAuto} onChange={(e) => void changerModeInvitation(e.target.checked)} /><span><strong>Accepter automatiquement les demandes</strong><small>Quand vous êtes absent, les demandes sont toujours acceptées automatiquement.</small></span></label>
            <div className="meeting-direct-invite"><input value={numeroDirect} readOnly inputMode="numeric" placeholder="Alanya ID" /><button onClick={() => void inviterDirectement()}>Ajouter</button></div>
            <div className="meeting-id-dialer" aria-label="Pavé Alanya ID">
              {["1","2","3","4","5","6","7","8","9","←","0"].map((key) => <button key={key} type="button" onClick={() => setNumeroDirect((current) => key === "←" ? current.slice(0, -1) : current.length < 8 ? `${current}${key}` : current)}>{key}</button>)}
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
                    {!remoteStreams[p.id] && (p.avatarUrl ? (
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
        {callState.activeCallId && (
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

      {meeting.jeSuisOrganisateur && demandes.length > 0 && (
        <section className="meeting-invite-requests" aria-label="Demandes d'invitation">
          <div className="meeting-invite-head"><strong>Demandes d'invitation</strong></div>
          {demandes.map((d) => <div key={d.id} className="meeting-invite-request"><span>{d.demandeur.nom} souhaite inviter {d.invite.nom}</span><div><button onClick={() => void traiterDemande(d.id, true)}>Accepter</button><button onClick={() => void traiterDemande(d.id, false)}>Refuser</button></div></div>)}
        </section>
      )}

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

      {/* Commandes de la salle. Elles n'existent qu'une fois dedans : proposer
          de couper un micro qui n'est pas ouvert n'aurait aucun sens. La camera
          n'apparait qu'en video, et la sortie audio qu'en audio — au haut-parleur
          de toute facon des qu'il y a de l'image. */}
      {callState.activeCallId && (
        <div className="meeting-controles">
          <button
            className={`meeting-controle${callState.micOn ? "" : " coupe"}`}
            onClick={() => toggleMicrophone()}
            aria-pressed={!callState.micOn}
            title={callState.micOn ? t("mute_mic") : t("unmute_mic")}
            aria-label={callState.micOn ? t("mute_mic") : t("unmute_mic")}
          >
            {callState.micOn ? <MeetingControlIcon kind="mic" /> : <MeetingControlIcon kind="micOff" />}
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
              {callState.camOn ? <MeetingControlIcon kind="camera" /> : <MeetingControlIcon kind="cameraOff" />}
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
              {callState.audioOutput === "speaker" ? <MeetingControlIcon kind="speaker" /> : <MeetingControlIcon kind="earpiece" />}
            </button>
          )}
        </div>
      )}

      {meeting.terminee && <div className="meeting-ended">Réunion terminée</div>}
      <div className="meeting-actions">
        {!callState.activeCallId && !meeting.terminee && (
          <button className="btn-join" onClick={() => void handleJoinMeeting()}>
            {t("meet_join_room")}
          </button>
        )}
        {callState.activeCallId && (
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
  )
}
