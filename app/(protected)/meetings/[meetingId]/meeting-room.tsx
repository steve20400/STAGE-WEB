import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useToast } from "../../../../src/components/toast"
import { fetchMeeting, joinMeeting, leaveMeeting } from "../../../../src/services/meetings-service"
import { startMeetingCall } from "../../../../src/services/call-manager"
import { useCallState } from "../../../../src/hooks/use-call"
import { useTranslation } from "../../../../src/i18n"
import type { Meeting } from "../../../../src/services/meetings-service"
import "./meeting-room.css"

export default function MeetingRoomPage() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
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

    try {
      await joinMeeting(parseInt(meetingId, 10))
      success(t("meet_joined"))

      const participantIds = meeting.participants?.map((p) => p.userId) || []
      await startMeetingCall(
        parseInt(meetingId, 10),
        participantIds,
        meeting.type_media === 2 ? "video" : "audio",
        meeting.objet
      )
    } catch (err) {
      showError(t("error"), err instanceof Error ? err.message : t("meet_join_failed"))
    }
  }

  const handleLeaveMeeting = async () => {
    if (!meetingId) return

    try {
      await leaveMeeting(parseInt(meetingId, 10))
      navigate("/meetings")
      success(t("meet_left"))
    } catch (err) {
      showError(t("error"), err instanceof Error ? err.message : t("meet_leave_failed"))
    }
  }

  if (loading) {
    return (
      <div className="meeting-room-root">
        <div className="loading">{t("loading")}</div>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="meeting-room-root">
        <div className="error">{error || t("meet_not_found")}</div>
        <button className="btn-back" onClick={() => navigate("/meetings")}>
          {t("back")}
        </button>
      </div>
    )
  }

  return (
    <div className="meeting-room-root">
      <div className="meeting-header">
        <h1>{meeting.objet}</h1>
        <button className="btn-back" onClick={() => navigate("/meetings")} aria-label={t("close")}>
          ✕
        </button>
      </div>

      <div className="meeting-info">
        <p>
          {t("meet_type")} : {meeting.type_media === 2 ? t("video_label") : t("cinfo_audio")}
        </p>
        <p>{t("meet_duration_minutes", { n: Math.floor((meeting.duree || 3600) / 60) })}</p>
        {meeting.participants && meeting.participants.length > 0 && (
          <>
            <p>{t("meet_participants", { count: meeting.participants.length })}</p>
            <div className="participants-grid">
              {meeting.participants.map((p) => (
                <div key={p.userId} className="participant-box">
                  <div className="participant-name">{p.displayName}</div>
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

      <div className="meeting-actions">
        {!callState.activeCallId && (
          <button className="btn-join" onClick={() => void handleJoinMeeting()}>
            {t("meet_join_room")}
          </button>
        )}
        {callState.activeCallId && (
          <button className="btn-leave" onClick={() => void handleLeaveMeeting()}>
            {t("meet_leave_room")}
          </button>
        )}
      </div>
    </div>
  )
}
