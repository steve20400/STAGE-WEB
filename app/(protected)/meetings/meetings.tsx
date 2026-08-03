import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useToast } from "../../../src/components/toast"
import { useTranslation } from "../../../src/i18n"
import {
  fetchMeetings,
  joinMeeting,
  declineMeeting,
  endMeeting,
  deleteMeeting,
  type Meeting,
} from "../../../src/services/meetings-service"
import { CreateMeetingModal } from "./create-meeting-modal"
import "./meetings.css"

type MeetingTab = "ongoing" | "upcoming" | "ended"

export default function MeetingsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { success, error: showError } = useToast()

  const [tab, setTab] = useState<MeetingTab>("ongoing")
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const now = useMemo(() => Date.now(), [])

  // Filtrer les réunions par onglet
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      const isEnded = m.isEnd === 1
      if (tab === "ended") return isEnded
      if (tab === "ongoing") return !isEnded && m.startTime && new Date(m.startTime).getTime() <= now
      if (tab === "upcoming") return !isEnded && m.startTime && new Date(m.startTime).getTime() > now
      return false
    })
  }, [meetings, tab, now])

  const loadMeetings = useCallback(async () => {
    try {
      const data = await fetchMeetings()
      setMeetings(data)
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement")
      showError(err instanceof Error ? err.message : "Impossible de charger les réunions")
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => {
    void loadMeetings()
    pollIntervalRef.current = setInterval(() => {
      void loadMeetings()
    }, 10000)
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [loadMeetings])

  const handleJoin = async (id: number) => {
    try {
      await joinMeeting(id)
      navigate(`/meetings/${id}`)
    } catch (err) {
      showError(err instanceof Error ? err.message : "Impossible de rejoindre la réunion")
    }
  }

  const handleDecline = async (id: number) => {
    try {
      await declineMeeting(id)
      await loadMeetings()
      success("Réunion déclinée")
    } catch (err) {
      showError(err instanceof Error ? err.message : "Impossible de décliner la réunion")
    }
  }

  const handleEnd = async (id: number) => {
    if (!confirm("Terminer cette réunion ?")) return
    try {
      await endMeeting(id)
      await loadMeetings()
      success("Réunion terminée")
    } catch (err) {
      showError(err instanceof Error ? err.message : "Impossible de terminer la réunion")
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer cette réunion ?")) return
    try {
      await deleteMeeting(id)
      await loadMeetings()
      success("Réunion supprimée")
    } catch (err) {
      showError(err instanceof Error ? err.message : "Impossible de supprimer la réunion")
    }
  }

  const getBadgeCount = (t: MeetingTab) => {
    if (t === "ongoing") return meetings.filter((m) => !m.isEnd && m.startTime && new Date(m.startTime).getTime() <= now).length
    if (t === "upcoming") return meetings.filter((m) => !m.isEnd && m.startTime && new Date(m.startTime).getTime() > now).length
    return meetings.filter((m) => m.isEnd === 1).length
  }

  return (
    <div className="meetings-root">
      <div className="meetings-head">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Réunions</h1>
            <p className="page-sub">Rejoignez vos réunions programmées et collaborez.</p>
          </div>
        </div>

        <div className="meetings-tabs">
          {(["ongoing", "upcoming", "ended"] as const).map((t) => (
            <button
              key={t}
              className={`filter-btn ${tab === t ? "on" : ""}`}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
            >
              {t === "ongoing" && "En cours"}
              {t === "upcoming" && "À venir"}
              {t === "ended" && "Terminée"}
              {getBadgeCount(t) > 0 && <span className="stat-chip">{getBadgeCount(t)}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="meetings-list">
        {loading ? (
          <div className="empty-state">
            <div className="empty-icon">⏳</div>
            <p>Chargement des réunions...</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-icon">⚠️</div>
            <p>{error}</p>
            <button className="empty-retry" onClick={() => void loadMeetings()}>
              Réessayer
            </button>
          </div>
        ) : filteredMeetings.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <p>
              {tab === "ongoing" && "Aucune réunion en cours"}
              {tab === "upcoming" && "Aucune réunion à venir"}
              {tab === "ended" && "Aucune réunion terminée"}
            </p>
          </div>
        ) : (
          filteredMeetings.map((meeting) => (
            <div key={meeting.id} className="meeting-card">
              <div className="meeting-head">
                <div className="meeting-title">{meeting.objet}</div>
                {meeting.isEnd === 1 && <span className="meeting-ended">Terminée</span>}
              </div>
              <div className="meeting-info">
                <span className="meeting-type">
                  {meeting.type_media === 1 ? "Audio" : "Vidéo"}
                </span>
                <span className="meeting-time">
                  {meeting.startTime ? new Date(meeting.startTime).toLocaleString("fr-FR") : "-"}
                </span>
              </div>
              <div className="meeting-actions">
                {meeting.isEnd !== 1 && (
                  <>
                    <button className="btn-primary" onClick={() => void handleJoin(meeting.id)}>
                      Rejoindre
                    </button>
                    <button className="btn-secondary" onClick={() => void handleDecline(meeting.id)}>
                      Décliner
                    </button>
                  </>
                )}
                {meeting.isEnd === 1 && (
                  <button className="btn-danger" onClick={() => void handleDelete(meeting.id)}>
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <button className="meetings-fab" onClick={() => setShowCreateModal(true)}>
        +
      </button>

      <CreateMeetingModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => {
          void loadMeetings()
          setShowCreateModal(false)
        }}
      />
    </div>
  )
}
