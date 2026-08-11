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
  type Reunion,
} from "../../../src/services/meetings-service"
import { getMyUserId } from "../../../src/data/session-user"
import { CreateMeetingModal } from "./create-meeting-modal"
import "./meetings.css"

type MeetingTab = "ongoing" | "upcoming" | "ended"

/**
 * Une reunion sans heure de debut a demarre a sa creation : le serveur pose
 * l'instant courant quand le champ manque. La traiter comme « pas encore
 * commencee » la faisait disparaitre des trois onglets a la fois.
 */
function aCommence(reunion: Reunion, maintenant: number): boolean {
  return !reunion.debut || new Date(reunion.debut).getTime() <= maintenant
}

export default function MeetingsPage() {
  const { t, language } = useTranslation()
  const navigate = useNavigate()
  const { success, error: showError } = useToast()

  const [tab, setTab] = useState<MeetingTab>("ongoing")
  const [meetings, setMeetings] = useState<Reunion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showCreateModal, setShowCreateModal] = useState(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const now = useMemo(() => Date.now(), [])

  // Filtrer les réunions par onglet
  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      if (tab === "ended") return m.terminee
      if (tab === "ongoing") return !m.terminee && aCommence(m, now)
      if (tab === "upcoming") return !m.terminee && !aCommence(m, now)
      return false
    })
  }, [meetings, tab, now])

  const loadMeetings = useCallback(async () => {
    try {
      const data = await fetchMeetings(getMyUserId() ?? undefined)
      setMeetings(data)
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : t("meet_load_error"))
      showError(err instanceof Error ? err.message : t("meet_load_failed"))
    } finally {
      setLoading(false)
    }
  }, [showError, t])

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
      showError(err instanceof Error ? err.message : t("meet_join_failed"))
    }
  }

  const handleDecline = async (id: number) => {
    try {
      await declineMeeting(id)
      await loadMeetings()
      success(t("meet_declined"))
    } catch (err) {
      showError(err instanceof Error ? err.message : t("meet_decline_failed"))
    }
  }

  const handleEnd = async (id: number) => {
    if (!confirm(t("meet_end_confirm"))) return
    try {
      await endMeeting(id)
      await loadMeetings()
      success(t("meet_ended_toast"))
    } catch (err) {
      showError(err instanceof Error ? err.message : t("meet_end_failed"))
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm(t("meet_delete_confirm"))) return
    try {
      await deleteMeeting(id)
      await loadMeetings()
      success(t("meet_deleted_toast"))
    } catch (err) {
      showError(err instanceof Error ? err.message : t("meet_delete_failed"))
    }
  }

  // `onglet` et non `t` : le parametre masquait la fonction de traduction, et
  // aucun libelle de cette portee n'aurait pu suivre la langue choisie.
  const getBadgeCount = (onglet: MeetingTab) => {
    if (onglet === "ongoing") return meetings.filter((m) => !m.terminee && aCommence(m, now)).length
    if (onglet === "upcoming")
      return meetings.filter((m) => !m.terminee && !aCommence(m, now)).length
    return meetings.filter((m) => m.terminee).length
  }

  return (
    <div className="meetings-root">
      <div className="meetings-head">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">{t("meetings")}</h1>
            <p className="page-sub">{t("meet_page_sub")}</p>
          </div>
        </div>

        <div className="meetings-tabs">
          {(["ongoing", "upcoming", "ended"] as const).map((onglet) => (
            <button
              key={onglet}
              className={`filter-btn ${tab === onglet ? "on" : ""}`}
              onClick={() => setTab(onglet)}
              aria-pressed={tab === onglet}
            >
              {onglet === "ongoing" && t("meet_tab_ongoing")}
              {onglet === "upcoming" && t("meet_tab_upcoming")}
              {onglet === "ended" && t("meet_tab_ended")}
              {getBadgeCount(onglet) > 0 && (
                <span className="stat-chip">{getBadgeCount(onglet)}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="meetings-list">
        {loading ? (
          <div className="empty-state">
            <div className="empty-icon">⏳</div>
            <p>{t("meet_loading")}</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-icon">⚠️</div>
            <p>{error}</p>
            <button className="empty-retry" onClick={() => void loadMeetings()}>
              {t("retry")}
            </button>
          </div>
        ) : filteredMeetings.length === 0 ? (
          <div className="empty-state">
            {/* L'emoji 📅 portait un « 17 » grave dans la police : impossible a
                dater, et faux 364 jours sur 365. Un vrai calendrier, lui, sait
                quel jour on est. */}
            <div className="empty-icon" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="16"
                  rx="3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M8 3v4M16 3v4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <text
                  x="12"
                  y="18"
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize="7"
                  fontWeight="700"
                >
                  {new Date().getDate()}
                </text>
              </svg>
            </div>
            <p>
              {tab === "ongoing" && t("meet_none_ongoing")}
              {tab === "upcoming" && t("meet_none_upcoming")}
              {tab === "ended" && t("meet_none_ended")}
            </p>
          </div>
        ) : (
          filteredMeetings.map((meeting) => (
            <div key={meeting.id} className="meeting-card">
              <div className="meeting-head">
                <div className="meeting-title">{meeting.objet}</div>
                {meeting.terminee && <span className="meeting-ended">{t("meet_tab_ended")}</span>}
              </div>
              <div className="meeting-info">
                <span className="meeting-type">
                  {meeting.type === "audio" ? t("cinfo_audio") : t("video_label")}
                </span>
                <span className="meeting-time">
                  {/* La date se lit : elle suit la langue choisie, pas un fr-FR fige. */}
                  {meeting.debut ? new Date(meeting.debut).toLocaleString(language) : "-"}
                </span>
              </div>
              <div className="meeting-actions">
                {/* Organisateur et invite n'ont pas les memes gestes : l'un
                    ferme la reunion pour tout le monde, l'autre decline une
                    invitation. Le serveur refuse deja le premier aux invites —
                    montrer le bouton ne ferait que promettre un refus. Et on ne
                    decline pas sa propre reunion. */}
                {!meeting.terminee && (
                  <>
                    <button className="btn-primary" onClick={() => void handleJoin(meeting.id)}>
                      {t("meet_join")}
                    </button>
                  </>
                )}

              </div>
            </div>
          ))
        )}
      </div>

      <button
        className="meetings-fab"
        onClick={() => setShowCreateModal(true)}
        aria-label={t("meet_create")}
        title={t("meet_create")}
      >
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
