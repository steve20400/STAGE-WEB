import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useToast } from "../../../../src/components/toast"
import { fetchMeeting, joinMeeting, leaveMeeting } from "../../../../src/services/meetings-service"
import { startMeetingCall } from "../../../../src/services/call-manager"
import { useCallState } from "../../../../src/hooks/use-call"
import type { Meeting } from "../../../../src/services/meetings-service"
import "./meeting-room.css"

export default function MeetingRoomPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const { success, error: showError } = useToast()
  const callState = useCallState()

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!meetingId) return

    const loadMeeting = async () => {
      setLoading(true)
      try {
        const m = await fetchMeeting(parseInt(meetingId, 10))
        setMeeting(m)
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Impossible de charger la réunion"
        setError(msg)
        showError("Erreur", msg)
      } finally {
        setLoading(false)
      }
    }

    void loadMeeting()
  }, [meetingId, showError])

  const handleJoinMeeting = async () => {
    if (!meeting || !meetingId) return

    try {
      await joinMeeting(parseInt(meetingId, 10))
      success("Réunion rejointe!")

      const participantIds = meeting.participants?.map((p) => p.userId) || []
      await startMeetingCall(
        parseInt(meetingId, 10),
        participantIds,
        meeting.type_media === 2 ? "video" : "audio",
        meeting.objet
      )
    } catch (err) {
      showError("Erreur", err instanceof Error ? err.message : "Impossible de rejoindre")
    }
  }

  const handleLeaveMeeting = async () => {
    if (!meetingId) return

    try {
      await leaveMeeting(parseInt(meetingId, 10))
      navigate("/meetings")
      success("Réunion quittée")
    } catch (err) {
      showError("Erreur", err instanceof Error ? err.message : "Impossible de quitter")
    }
  }

  if (loading) {
    return (
      <div className="meeting-room-root">
        <div className="loading">Chargement...</div>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="meeting-room-root">
        <div className="error">{error || "Réunion introuvable"}</div>
        <button className="btn-back" onClick={() => navigate("/meetings")}>
          Retour
        </button>
      </div>
    )
  }

  return (
    <div className="meeting-room-root">
      <div className="meeting-header">
        <h1>{meeting.objet}</h1>
        <button className="btn-back" onClick={() => navigate("/meetings")}>
          ✕
        </button>
      </div>

      <div className="meeting-info">
        <p>Type: {meeting.type_media === 2 ? "Vidéo" : "Audio"}</p>
        <p>Durée: {Math.floor((meeting.duree || 3600) / 60)} minutes</p>
        {meeting.participants && meeting.participants.length > 0 && (
          <p>Participants: {meeting.participants.length}</p>
        )}
      </div>

      <div className="meeting-actions">
        {!callState.activeCallId && (
          <button className="btn-join" onClick={() => void handleJoinMeeting()}>
            Rejoindre la réunion
          </button>
        )}
        {callState.activeCallId && (
          <button className="btn-leave" onClick={() => void handleLeaveMeeting()}>
            Quitter la réunion
          </button>
        )}
      </div>
    </div>
  )
}
