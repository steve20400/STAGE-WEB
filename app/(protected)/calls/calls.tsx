import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  CALL_COLORS as COLORS,
  fetchCallsHistory,
  type CallDirection,
  type CallRecord,
} from "../../../src/services/calls-service"
import "./calls-page.css"
import { RowActionsMenu } from "../../../src/components/row-actions-menu"
import { useToast } from "../../../src/components/toast"
import { createPrivateChat } from "../../../src/services/chats-service"
import { startOutgoingCall } from "../../../src/services/call-manager"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"
import { ApiError } from "../../../src/lib/api-client"
import { Dialer } from "./dialer"
import { AvatarCircle } from "../../../src/components/avatar-circle"
import { useTranslation, type Cle } from "../../../src/i18n"

type FilterType = "all" | "missed" | "audio" | "video"

/** Ordres de tri de l'historique. */
type SortType = "recent" | "oldest" | "name"

/** Cles de tri : le libelle se resout au rendu, la langue peut changer. */
const SORT_KEYS: Record<SortType, Cle> = {
  recent: "sort_recent",
  oldest: "sort_oldest",
  name: "sort_name",
}

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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<FilterType>("all")
  const [sort, setSort] = useState<SortType>("recent")
  const [search, setSearch] = useState("")
  const [callsHistory, setCallsHistory] = useState<CallRecord[]>([])
  const [dialerOpen, setDialerOpen] = useState(false)
  const { error } = useToast()

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

  const sorted = useMemo(() => {
    const list = [...filtered]
    if (sort === "name")
      return list.sort((a, b) => a.contactName.localeCompare(b.contactName, "fr"))
    return list.sort((a, b) =>
      sort === "oldest" ? a.ts.getTime() - b.ts.getTime() : b.ts.getTime() - a.ts.getTime()
    )
  }, [filtered, sort])

  const grouped = useMemo(() => {
    // Trie par nom, le regroupement par jour n'a plus de sens : on rend une
    // liste plate, et l'en-tete vide n'est pas affiche.
    if (sort === "name") return [{ header: "", calls: sorted }]
    return sorted.reduce<Array<{ header: string; calls: CallRecord[] }>>((acc, call) => {
      const header = formatGroupHeader(call.ts)
      const last = acc[acc.length - 1]
      if (!last || last.header !== header) {
        acc.push({ header, calls: [call] })
      } else {
        last.calls.push(call)
      }
      return acc
    }, [])
  }, [sorted, sort])

  /**
   * Appel direct d'un Alanya ID compose au clavier.
   *
   * Exactement le meme chemin que depuis la fiche d'un contact — conversation
   * privee, puis appel sortant — donc un numero qui existe dans la base de
   * l'application sonne comme un appel ordinaire. S'il n'existe pas, le backend
   * refuse la creation de la conversation et l'echec est annonce tel quel.
   */
  const callComposedNumber = async (publicNumber: string, type: "audio" | "video") => {
    try {
      const conversation = await createPrivateChat(publicNumber)
      const callId = await startOutgoingCall(
        conversation.id,
        type,
        formatAlanyaNumber(publicNumber)
      )
      setDialerOpen(false)
      navigate(`/calls/${callId}?type=${type}&returnTo=/calls`)
    } catch (err) {
      signalerEchecAppel(err, formatAlanyaNumber(publicNumber))
    }
  }

  /**
   * Rappelle le correspondant d'une ligne de l'historique.
   *
   * L'appel part d'ici et l'on va DIRECTEMENT a son ecran. Le detour precedent
   * par `/calls/new` affichait la liste des contacts en plein ecran, le temps
   * qu'un effet y retrouve le contact et lance l'appel : on voyait donc une
   * page de contacts clignoter avant l'appel qu'on venait de demander.
   *
   * La conversation de l'appel d'origine est reutilisee quand on la connait ;
   * sinon on la retrouve par le numero, comme depuis le composeur.
   */
  const rappeler = async (call: CallRecord, type: "audio" | "video") => {
    try {
      const convId = call.convId ?? (await createPrivateChat(call.contactId)).id
      const callId = await startOutgoingCall(convId, type, call.contactName)
      navigate(`/calls/${callId}?type=${type}&returnTo=/calls`)
    } catch (err) {
      signalerEchecAppel(err, call.contactName)
    }
  }

  /**
   * On distingue le correspondant inconnu du reseau injoignable : le premier est
   * une faute de frappe a corriger, le second n'a rien a voir avec le numero.
   */
  function signalerEchecAppel(err: unknown, cible: string) {
    const inconnu = err instanceof ApiError && [400, 404, 422].includes(err.status)
    const reseau = err instanceof ApiError && err.status === 0
    error(
      t("call_failed"),
      inconnu
        ? t("no_account_matches").replace("{cible}", cible)
        : reseau
          ? t("server_unreachable")
          : err instanceof Error
            ? err.message
            : t("call_failed_now")
    )
  }

  return (
    <>
      <div className="calls-root">
        <div className="calls-head">
          <div className="calls-title-row page-title-row">
            <h1 className="calls-title">{t("calls")}</h1>
          </div>

          {/* Les deux facons de lancer un appel, l'une sous l'autre : par le
              repertoire, ou en composant un Alanya ID. */}
          <div className="calls-launchers">
            <button className="new-call-btn" onClick={() => navigate("/contacts")}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
              Appeler contact
            </button>
            <button className="dial-btn" onClick={() => setDialerOpen(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="6" cy="6" r="1.9" />
                <circle cx="12" cy="6" r="1.9" />
                <circle cx="18" cy="6" r="1.9" />
                <circle cx="6" cy="12" r="1.9" />
                <circle cx="12" cy="12" r="1.9" />
                <circle cx="18" cy="12" r="1.9" />
                <circle cx="6" cy="18" r="1.9" />
                <circle cx="12" cy="18" r="1.9" />
                <circle cx="18" cy="18" r="1.9" />
              </svg>
              Composer ID
            </button>
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
                placeholder={t("search_contact")}
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
                    t("filter_all")
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
                    t("filter_audio")
                  ) : (
                    t("filter_video")
                  )}
                </button>
              ))}
            </div>

            {/* Tri de l'historique, distinct des filtres de type au-dessus. */}
            <div className="sort-group" role="group" aria-label={t("sort_history")}>
              <span className="sort-label">Trier</span>
              {(Object.keys(SORT_KEYS) as SortType[]).map((current) => (
                <button
                  key={current}
                  className={`filter-btn ${sort === current ? "on" : ""}`}
                  onClick={() => setSort(current)}
                  aria-pressed={sort === current}
                >
                  {t(SORT_KEYS[current])}
                </button>
              ))}
            </div>
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
              <div className="empty-txt">{t("no_call_found")}</div>
            </div>
          ) : (
            grouped.map(({ header, calls }) => (
              <div key={header}>
                {/* Vide quand on trie par nom : le regroupement par jour n'a plus de sens. */}
                {header && <div className="date-header">{header}</div>}
                {calls.map((call) => {
                  const color = COLORS[call.contactColor]
                  const statusLabel =
                    call.status === "missed"
                      ? t("call_missed")
                      : call.status === "no_answer"
                        ? t("call_no_answer")
                        : call.status === "declined"
                          ? t("call_declined")
                          : call.status === "busy"
                            ? t("call_busy")
                            : null
                  return (
                    <div
                      className="call-item"
                      key={call.id}
                      // `call.id` est l'identifiant de la LIGNE d'historique, pas
                      // d'un appel en cours : y naviguer ouvrait un ecran d'appel
                      // deja termine, qui rebondissait aussitot. Une ligne
                      // d'historique rappelle, du meme type que l'appel d'origine.
                      onClick={() => void rappeler(call, call.type)}
                    >
                      <AvatarCircle
                        className="call-av"
                        style={{ background: color.bg, color: color.fg }}
                        avatar={call.contactAvatar}
                        initials={call.contactInitials}
                      />

                      <div className="call-info">
                        <div className="call-name">
                          {call.contactName}
                          {statusLabel && (
                            <span
                              className={call.status === "missed" ? "missed-badge" : undefined}
                              style={
                                call.status === "missed"
                                  ? undefined
                                  : {
                                      fontSize: 10,
                                      background: "var(--border-subtle)",
                                      color: "var(--text-muted)",
                                      padding: "2px 7px",
                                      borderRadius: 5,
                                      fontWeight: 500,
                                    }
                              }
                            >
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
                            {call.type === "video" ? t("filter_video") : t("filter_audio")}
                          </div>

                          {call.duration && (
                            <span style={{ color: "var(--text-muted)" }}>{call.duration}</span>
                          )}
                        </div>
                      </div>

                      <div className="call-right">
                        <div className="call-ts">{formatItemTime(call.ts)}</div>
                        <RowActionsMenu
                          ariaLabel={`Actions pour ${call.contactName}`}
                          actions={[
                            {
                              label: t("call_back_audio"),
                              onSelect: () => void rappeler(call, "audio"),
                            },
                            {
                              label: t("call_back_video"),
                              onSelect: () => void rappeler(call, "video"),
                            },
                            {
                              label: t("open_conversation"),
                              onSelect: () => navigate(`/chats/${call.contactId}`),
                            },
                          ]}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
      {dialerOpen && (
        <Dialer
          onClose={() => setDialerOpen(false)}
          onCall={(number, type) => void callComposedNumber(number, type)}
        />
      )}
    </>
  )
}
