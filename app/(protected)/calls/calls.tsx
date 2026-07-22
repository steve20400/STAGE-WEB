import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  CALL_COLORS as COLORS,
  fetchCallsHistory,
  type CallDirection,
  type CallRecord,
} from "../../../src/services/calls-service"
import "./calls-page.css"
type FilterType = "all" | "missed" | "audio" | "video"

function formatItemTime(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  if (days === 1) return "Hier"
  if (days < 7) return date.toLocaleDateString("fr-FR", { weekday: "long" })
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
}

function formatGroupHeader(date: Date): string {
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 86400000)
  if (diff === 0) return "Aujourd'hui"
  if (diff === 1) return "Hier"
  if (diff < 7) return date.toLocaleDateString("fr-FR", { weekday: "long" })
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
}

function DirectionArrow({ direction }: { direction: CallDirection }) {
  const color = direction === "missed" ? "#ef4444" : direction === "in" ? "#4ade80" : "#60a5fa"
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      style={{ transform: direction === "out" ? "rotate(180deg)" : undefined }}
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}

export default function CallsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<FilterType>("all")
  const [search, setSearch] = useState("")
  const [callsHistory, setCallsHistory] = useState<CallRecord[]>([])

  useEffect(() => {
    let cancelled = false
    void fetchCallsHistory().then((list) => {
      if (!cancelled) setCallsHistory(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const missedCount = useMemo(
    () => callsHistory.filter((call) => call.direction === "missed").length,
    [callsHistory]
  )

  const filtered = useMemo(() => {
    return callsHistory
      .filter((call) => {
        if (filter === "missed") return call.direction === "missed"
        if (filter === "audio") return call.type === "audio"
        if (filter === "video") return call.type === "video"
        return true
      })
      .filter((call) => call.contactName.toLowerCase().includes(search.toLowerCase()))
  }, [callsHistory, filter, search])

  const grouped = useMemo(() => {
    return filtered.reduce<Array<{ header: string; calls: CallRecord[] }>>((acc, call) => {
      const header = formatGroupHeader(call.ts)
      const last = acc[acc.length - 1]
      if (!last || last.header !== header) {
        acc.push({ header, calls: [call] })
      } else {
        last.calls.push(call)
      }
      return acc
    }, [])
  }, [filtered])

  return (
    <>
      <div className="calls-root">
        <div className="calls-head">
          <div className="calls-title-row">
            <h1 className="calls-title">Appels</h1>
            <button className="new-call-btn" onClick={() => navigate("/calls/new")}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
              </svg>
              Nouvel appel
            </button>
          </div>

          <div className="stats-strip">
            {[
              {
                icon: (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#E8B84B"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                  </svg>
                ),
                iconBg: "#E8B84B15",
                val: callsHistory.length,
                lbl: "Total appels",
              },
              {
                icon: (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                  </svg>
                ),
                iconBg: "#ef444415",
                val: missedCount,
                lbl: "Appels manques",
                valColor: "#ef4444",
              },
              {
                icon: (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#60a5fa"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" />
                  </svg>
                ),
                iconBg: "#60a5fa15",
                val: callsHistory.filter((call) => call.type === "video").length,
                lbl: "Appels video",
              },
            ].map((chip) => (
              <div className="stat-chip" key={chip.lbl}>
                <div className="stat-chip-icon" style={{ background: chip.iconBg }}>
                  {chip.icon}
                </div>
                <div>
                  <div
                    className="stat-chip-val"
                    style={{ color: chip.valColor ?? "var(--text-primary)" }}
                  >
                    {chip.val}
                  </div>
                  <div className="stat-chip-lbl">{chip.lbl}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="calls-controls">
            <div className="search-wrap">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                placeholder="Rechercher un contact..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="filter-group">
              {(["all", "missed", "audio", "video"] as FilterType[]).map((current) => (
                <button
                  key={current}
                  className={`filter-btn ${filter === current ? "on" : ""}`}
                  onClick={() => setFilter(current)}
                >
                  {current === "all" ? (
                    "Tous"
                  ) : current === "missed" ? (
                    <>
                      Manques{" "}
                      {missedCount > 0 && (
                        <span
                          style={{
                            background: "#ef444425",
                            color: "#ef4444",
                            fontSize: 10,
                            padding: "1px 5px",
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          {missedCount}
                        </span>
                      )}
                    </>
                  ) : current === "audio" ? (
                    "Audio"
                  ) : (
                    "Video"
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="calls-body">
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--text-faint)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                </svg>
              </div>
              <div className="empty-txt">Aucun appel trouve</div>
            </div>
          ) : (
            grouped.map(({ header, calls }) => (
              <div key={header}>
                <div className="date-header">{header}</div>
                {calls.map((call) => {
                  const color = COLORS[call.contactColor]
                  const statusLabel = call.status === "missed" ? "Appel manqué" : call.status === "no_answer" ? "Sans réponse" : call.status === "declined" ? "Appel rejeté" : call.status === "busy" ? "Occupé" : null
                  return (
                    <div
                      className="call-item"
                      key={call.id}
                      onClick={() =>
                        navigate(`/calls/${call.id}?contact=${call.contactId}&type=${call.type}`)
                      }
                    >
                      <div className="call-av" style={{ background: color.bg, color: color.fg }}>
                        {call.contactInitials}
                      </div>

                      <div className="call-info">
                        <div className="call-name">
                          {call.contactName}
                          {statusLabel && (
                            <span className={call.status === "missed" ? "missed-badge" : undefined} style={call.status === "missed" ? undefined : { fontSize: 10, background: "var(--border-subtle)", color: "var(--text-muted)", padding: "2px 7px", borderRadius: 5, fontWeight: 500 }}>
                              {statusLabel}
                            </span>
                          )}
                        </div>
                        <div className="call-detail">
                          <DirectionArrow direction={call.direction} />

                          <div className="call-type-badge">
                            {call.type === "video" ? (
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              >
                                <polygon points="23 7 16 12 23 17 23 7" />
                                <rect x="1" y="5" width="15" height="14" rx="2" />
                              </svg>
                            ) : (
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              >
                                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                              </svg>
                            )}
                            {call.type === "video" ? "Video" : "Audio"}
                          </div>

                          {call.duration && (
                            <span style={{ color: "var(--text-muted)" }}>{call.duration}</span>
                          )}
                        </div>
                      </div>

                      <div className="call-right">
                        <div className="call-ts">{formatItemTime(call.ts)}</div>
                        <div className="call-actions">
                          <button
                            className="call-action-btn audio"
                            title="Rappeler audio"
                            onClick={(event) => {
                              event.stopPropagation()
                              navigate(`/calls/new?contact=${call.contactId}&type=audio`)
                            }}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            >
                              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                            </svg>
                          </button>
                          <button
                            className="call-action-btn video"
                            title="Rappeler video"
                            onClick={(event) => {
                              event.stopPropagation()
                              navigate(`/calls/new?contact=${call.contactId}&type=video`)
                            }}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            >
                              <polygon points="23 7 16 12 23 17 23 7" />
                              <rect x="1" y="5" width="15" height="14" rx="2" />
                            </svg>
                          </button>
                          <button
                            className="call-action-btn chat"
                            title="Ouvrir le chat"
                            onClick={(event) => {
                              event.stopPropagation()
                              navigate(`/chats/${call.contactId}`)
                            }}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            >
                              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
