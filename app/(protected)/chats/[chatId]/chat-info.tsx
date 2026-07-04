import { useEffect, useState, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useToast } from "../../../../src/components/toast"
import { loadContacts } from "../../../../src/data/contacts"
import { loadLocalConversations } from "../../../../src/data/local-conversations"
import { findLocalGroup } from "../../../../src/data/local-groups"
import { CHAT_COLORS } from "../../../../src/mocks/chat-data"
import { fetchContacts } from "../../../../src/services/contacts-service"
import { fetchConversationById } from "../../../../src/services/chats-service"
import { startOutgoingCall } from "../../../../src/services/call-manager"

interface Member {
  id: string
  name: string
  initials: string
  color: string
  role: "admin" | "member"
  online: boolean
}

interface SharedFile {
  id: string
  name: string
  size: string
  type: "pdf" | "image" | "audio" | "other"
  ts: string
  sender: string
}

interface ConvInfo {
  id: string
  name: string
  initials: string
  color: string
  isGroup: boolean
  description?: string
  members: Member[]
  createdAt: string
  files: SharedFile[]
  online?: boolean
  statusMsg?: string
}

interface PendingAction {
  title: string
  description: string
  confirmLabel: string
  tone: "warning" | "danger"
  onConfirm: () => void
}

const COLORS: Record<string, { bg: string; fg: string }> = {
  amber: { bg: "var(--av-0-bg)", fg: "var(--av-0-fg)" },
  blue: { bg: "var(--av-1-bg)", fg: "var(--av-1-fg)" },
  violet: { bg: "var(--av-2-bg)", fg: "var(--av-2-fg)" },
  teal: { bg: "var(--av-3-bg)", fg: "var(--av-3-fg)" },
  rose: { bg: "var(--av-4-bg)", fg: "var(--av-4-fg)" },
}

function FileIcon({ type }: { type: SharedFile["type"] }) {
  const paths: Record<SharedFile["type"], ReactNode> = {
    pdf: <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />,
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </>
    ),
    audio: (
      <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </>
    ),
    other: (
      <>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </>
    ),
  }

  const colors: Record<SharedFile["type"], string> = {
    pdf: "var(--danger)",
    image: "#a78bfa",
    audio: "var(--success)",
    other: "var(--text-secondary)",
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={colors[type]}
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      {paths[type]}
    </svg>
  )
}

interface ConvInfoPanelProps {
  convId?: string
  onClose?: () => void
  info: ConvInfo
}

export function ConvInfoPanel({ convId, onClose, info: propInfo }: ConvInfoPanelProps) {
  const navigate = useNavigate()
  const { success, warning, info } = useToast()
  const conv = propInfo

  const [tab, setTab] = useState<"membres" | "fichiers">("membres")
  const [muteNotifs, setMute] = useState(false)
  const [members, setMembers] = useState<Member[]>(conv.members)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)

  const color = COLORS[conv.color]
  const isAdmin = members.find((member) => member.id === "me")?.role === "admin"

  const removeMember = (id: string) => {
    const member = members.find((entry) => entry.id === id)
    if (!member) return

    setPendingAction({
      title: "Exclure ce membre ?",
      description: `${member.name} sera retire du groupe.`,
      confirmLabel: "Exclure",
      tone: "danger",
      onConfirm: () => {
        setMembers((prev) => prev.filter((entry) => entry.id !== id))
        warning(`${member.name} retire du groupe`)
        // TODO : DELETE /api/chats/:convId/members/:memberId
      },
    })
  }

  const leaveGroup = () => {
    setPendingAction({
      title: "Quitter le groupe ?",
      description: "Vous ne recevrez plus les messages de cette conversation.",
      confirmLabel: "Quitter",
      tone: "warning",
      onConfirm: () => {
        // TODO : POST /api/chats/:convId/leave
        success("Vous avez quitte le groupe")
        navigate("/chats")
      },
    })
  }

  const deleteConv = () => {
    setPendingAction({
      title: conv.isGroup ? "Supprimer ce groupe ?" : "Supprimer cette conversation ?",
      description: "Cette action est irreversible.",
      confirmLabel: conv.isGroup ? "Supprimer le groupe" : "Supprimer",
      tone: "danger",
      onConfirm: () => {
        // TODO : DELETE /api/chats/:convId
        warning("Conversation supprimee")
        navigate("/chats")
      },
    })
  }

  const promoteAdmin = (id: string) => {
    setMembers((prev) =>
      prev.map((member) => (member.id === id ? { ...member, role: "admin" } : member))
    )
    const member = members.find((entry) => entry.id === id)
    if (!member) return
    info(`${member.name} est maintenant administrateur`)
    // TODO : PATCH /api/chats/:convId/members/:memberId { role:"admin" }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=DM+Sans:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }

        .cip-root {
          font-family: 'DM Sans', sans-serif;
          width: 320px;
          height: 100vh;
          background: var(--bg-surface);
          border-left: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          color: var(--text-primary);
          flex-shrink: 0;
        }

        .cip-head {
          padding: 16px 18px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
        .cip-back {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          padding: 5px;
          border-radius: 7px;
          display: flex;
          transition: all .15s;
        }
        .cip-back:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .cip-head-title { font-family: 'Bricolage Grotesque', sans-serif; font-size: 15px; font-weight: 700; letter-spacing: -.3px; }

        .cip-hero { padding: 24px 18px 16px; text-align: center; flex-shrink: 0; }
        .cip-av {
          width: 68px;
          height: 68px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: 22px;
          font-weight: 800;
          margin: 0 auto 14px;
          position: relative;
        }
        .cip-av-dot {
          position: absolute;
          bottom: 2px;
          right: 2px;
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: var(--success);
          border: 3px solid var(--bg-surface);
        }
        .cip-name { font-family: 'Bricolage Grotesque', sans-serif; font-size: 18px; font-weight: 800; letter-spacing: -.5px; margin-bottom: 5px; }
        .cip-sub { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin-bottom: 16px; }
        .cip-actions { display: flex; justify-content: center; gap: 16px; }
        .ca-btn { display: flex; flex-direction: column; align-items: center; gap: 5px; background: none; border: none; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .ca-icon {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all .15s;
          color: var(--accent);
        }
        .ca-btn:hover .ca-icon { background: var(--accent-dim); border-color: var(--accent-border); }
        .ca-label { font-size: 10px; color: var(--text-muted); }

        .cip-body { flex: 1; overflow-y: auto; }
        .cip-body::-webkit-scrollbar { width: 3px; }
        .cip-body::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 3px; }

        .cip-section { padding: 14px 18px; border-bottom: 1px solid var(--border-subtle); }
        .cip-section-title { font-size: 10px; color: var(--text-muted); letter-spacing: 1px; text-transform: uppercase; font-weight: 500; margin-bottom: 10px; }

        .notif-row { display: flex; align-items: center; justify-content: space-between; }
        .notif-label { font-size: 13px; color: var(--text-primary); }
        .tgl { width: 38px; height: 21px; border-radius: 20px; border: none; cursor: pointer; position: relative; transition: background .2s; }
        .tgl-knob { position: absolute; top: 2.5px; width: 16px; height: 16px; border-radius: 50%; transition: left .2s; }

        .cip-tabs { display: flex; background: var(--bg-elevated); border-radius: 8px; padding: 2px; margin: 0 18px 12px; }
        .cip-tab { flex: 1; padding: 6px; border-radius: 6px; border: none; cursor: pointer; font-size: 11px; font-weight: 500; font-family: 'DM Sans', sans-serif; transition: all .2s; background: transparent; color: var(--text-muted); }
        .cip-tab.on { background: var(--bg-surface); color: var(--text-primary); }

        .member-item { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border-subtle); }
        .member-item:last-child { border-bottom: none; }
        .m-av { width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; position: relative; }
        .m-dot { position: absolute; bottom: 0; right: 0; width: 8px; height: 8px; border-radius: 50%; background: var(--success); border: 2px solid var(--bg-surface); }
        .m-info { flex: 1; min-width: 0; }
        .m-name { font-size: 12px; font-weight: 500; color: var(--text-primary); display: flex; align-items: center; gap: 5px; }
        .m-role { font-size: 9px; background: var(--accent-dim); color: var(--accent); padding: 1px 6px; border-radius: 4px; font-weight: 600; }
        .m-role.me-badge { background: var(--info-dim); color: var(--info); }
        .m-actions { display: flex; gap: 3px; }
        .m-action { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 4px; border-radius: 5px; display: flex; transition: all .15s; }
        .m-action:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .m-action.danger:hover { color: var(--danger); background: var(--danger-dim); }

        .file-item { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border-subtle); cursor: pointer; transition: opacity .15s; }
        .file-item:last-child { border-bottom: none; }
        .file-item:hover { opacity: .8; }
        .f-icon { width: 34px; height: 34px; border-radius: 8px; background: var(--bg-elevated); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .f-info { flex: 1; min-width: 0; }
        .f-name { font-size: 12px; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px; }
        .f-meta { font-size: 10px; color: var(--text-muted); }
        .f-dl { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 4px; border-radius: 5px; display: flex; transition: color .15s; flex-shrink: 0; }
        .f-dl:hover { color: var(--accent); }

        .danger-item { display: flex; align-items: center; gap: 10px; padding: 11px 0; border-bottom: 1px solid var(--border-subtle); cursor: pointer; transition: opacity .15s; }
        .danger-item:last-child { border-bottom: none; padding-bottom: 0; }
        .danger-item:hover { opacity: .75; }
        .di-icon { width: 30px; height: 30px; border-radius: 7px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .danger-label { font-size: 13px; font-weight: 500; }
        .danger-sub { font-size: 10px; margin-top: 1px; color: var(--text-muted); }

        .cip-confirm-overlay {
          position: fixed;
          inset: 0;
          background: color-mix(in srgb, var(--overlay, #00000080) 84%, transparent);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 9000;
        }
        .cip-confirm-card {
          width: min(360px, 100%);
          border-radius: 16px;
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          box-shadow: 0 24px 64px #00000080;
          padding: 18px;
        }
        .cip-confirm-title { font-family: 'Bricolage Grotesque', sans-serif; font-size: 18px; font-weight: 800; color: var(--text-primary); margin-bottom: 8px; }
        .cip-confirm-text { font-size: 13px; line-height: 1.6; color: var(--text-muted); }
        .cip-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
        .cip-confirm-btn { border-radius: 9px; padding: 10px 13px; font-size: 12px; font-weight: 600; font-family: 'DM Sans', sans-serif; cursor: pointer; transition: all .15s; }
        .cip-confirm-btn.cancel { border: 1px solid var(--border-subtle); background: var(--bg-elevated); color: var(--text-secondary); }
        .cip-confirm-btn.cancel:hover { border-color: var(--border-default); color: var(--text-primary); }
        .cip-confirm-btn.confirm { border: 1px solid transparent; color: var(--bg-base); }
        .cip-confirm-btn.confirm.warning { background: var(--warning, #fbbf24); }
        .cip-confirm-btn.confirm.danger { background: var(--danger); }
      `}</style>

      <div className="cip-root">
        <div className="cip-head">
          {onClose && (
            <button className="cip-back" onClick={onClose} aria-label="Fermer">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
          <span className="cip-head-title">Infos de la conversation</span>
        </div>

        <div className="cip-body">
          <div className="cip-hero">
            <div className="cip-av" style={{ background: color.bg, color: color.fg }}>
              {conv.initials}
              {!conv.isGroup && conv.online && <div className="cip-av-dot" />}
            </div>
            <div className="cip-name">{conv.name}</div>
            {conv.isGroup && (
              <div className="cip-sub">{conv.description ?? `${members.length} membres`}</div>
            )}
            {!conv.isGroup && conv.statusMsg && <div className="cip-sub">{conv.statusMsg}</div>}

            <div className="cip-actions">
              <button
                className="ca-btn"
                onClick={() => navigate(`/chats/${conv.id}`)}
                aria-label="Message"
              >
                <div className="ca-icon">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  </svg>
                </div>
                <span className="ca-label">Message</span>
              </button>
              <button
                className="ca-btn"
                onClick={() => {
                  void startOutgoingCall(conv.id, "audio", conv.name)
                    .then((callId) =>
                      navigate(
                        `/calls/${callId}?type=audio&returnTo=${encodeURIComponent(`/chats/${conv.id}/info`)}`
                      )
                    )
                    .catch((err) =>
                      warning(
                        "Appel impossible",
                        err instanceof Error ? err.message : "Reessayez plus tard."
                      )
                    )
                }}
                aria-label="Audio"
              >
                <div className="ca-icon">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                  </svg>
                </div>
                <span className="ca-label">Audio</span>
              </button>
              <button
                className="ca-btn"
                onClick={() => {
                  void startOutgoingCall(conv.id, "video", conv.name)
                    .then((callId) =>
                      navigate(
                        `/calls/${callId}?type=video&returnTo=${encodeURIComponent(`/chats/${conv.id}/info`)}`
                      )
                    )
                    .catch((err) =>
                      warning(
                        "Appel impossible",
                        err instanceof Error ? err.message : "Reessayez plus tard."
                      )
                    )
                }}
                aria-label="Video"
              >
                <div className="ca-icon">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" />
                  </svg>
                </div>
                <span className="ca-label">Video</span>
              </button>
              <button className="ca-btn" aria-label="Rechercher">
                <div className="ca-icon">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                </div>
                <span className="ca-label">Recherche</span>
              </button>
            </div>
          </div>

          <div className="cip-section">
            <div className="notif-row">
              <span className="notif-label">Mettre en sourdine</span>
              <button
                className="tgl"
                style={{ background: muteNotifs ? "var(--accent)" : "var(--border-default)" }}
                onClick={() => {
                  setMute((value) => !value)
                  info(muteNotifs ? "Notifications reactivees" : "Conversation mise en sourdine")
                }}
                aria-checked={muteNotifs}
                role="switch"
              >
                <div
                  className="tgl-knob"
                  style={{
                    left: muteNotifs ? "20px" : "2.5px",
                    background: muteNotifs ? "var(--accent-text)" : "var(--text-muted)",
                  }}
                />
              </button>
            </div>
          </div>

          {conv.isGroup && (
            <div className="cip-tabs" style={{ marginTop: 14 }}>
              <button
                className={`cip-tab ${tab === "membres" ? "on" : ""}`}
                onClick={() => setTab("membres")}
              >
                Membres ({members.length})
              </button>
              <button
                className={`cip-tab ${tab === "fichiers" ? "on" : ""}`}
                onClick={() => setTab("fichiers")}
              >
                Fichiers ({conv.files.length})
              </button>
            </div>
          )}

          {(tab === "membres" || !conv.isGroup) && (
            <div className="cip-section">
              {!conv.isGroup && <div className="cip-section-title">Fichiers partages</div>}
              {conv.isGroup &&
                members.map((member) => {
                  const memberColor = COLORS[member.color]
                  const isMe = member.id === "me"

                  return (
                    <div className="member-item" key={member.id}>
                      <div
                        className="m-av"
                        style={{ background: memberColor.bg, color: memberColor.fg }}
                      >
                        {member.initials}
                        {member.online && <div className="m-dot" />}
                      </div>
                      <div className="m-info">
                        <div className="m-name">
                          {member.name}
                          {member.role === "admin" && (
                            <span className={`m-role ${isMe ? "me-badge" : ""}`}>
                              {isMe ? "Vous (admin)" : "Admin"}
                            </span>
                          )}
                          {isMe && member.role !== "admin" && (
                            <span className="m-role me-badge">Vous</span>
                          )}
                        </div>
                      </div>
                      {!isMe && isAdmin && (
                        <div className="m-actions">
                          {member.role !== "admin" && (
                            <button
                              className="m-action"
                              title="Nommer administrateur"
                              onClick={() => promoteAdmin(member.id)}
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
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                              </svg>
                            </button>
                          )}
                          <button
                            className="m-action danger"
                            title="Exclure du groupe"
                            onClick={() => removeMember(member.id)}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              {conv.isGroup && isAdmin && (
                <button
                  style={{
                    width: "100%",
                    marginTop: 10,
                    background: "var(--bg-elevated)",
                    border: "1px dashed var(--border-default)",
                    borderRadius: 9,
                    padding: "9px",
                    fontSize: 12,
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    transition: "all .15s",
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.borderColor = "var(--accent-border)"
                    event.currentTarget.style.color = "var(--accent)"
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.borderColor = "var(--border-default)"
                    event.currentTarget.style.color = "var(--text-muted)"
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Ajouter un membre
                </button>
              )}
            </div>
          )}

          {(tab === "fichiers" || !conv.isGroup) && (
            <div className="cip-section">
              {!conv.isGroup && <div className="cip-section-title">Fichiers partages</div>}
              {conv.files.map((file) => (
                <div
                  className="file-item"
                  key={file.id}
                  onClick={() => info("Telechargement", file.name)}
                >
                  <div className="f-icon">
                    <FileIcon type={file.type} />
                  </div>
                  <div className="f-info">
                    <div className="f-name">{file.name}</div>
                    <div className="f-meta">
                      {file.size} · {file.sender} · {file.ts}
                    </div>
                  </div>
                  <button className="f-dl" aria-label="Telecharger">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                  </button>
                </div>
              ))}
              {conv.files.length === 0 && (
                <div
                  style={{
                    textAlign: "center",
                    color: "var(--text-ghost)",
                    fontSize: 12,
                    padding: "20px 0",
                  }}
                >
                  Aucun fichier partage
                </div>
              )}
            </div>
          )}

          {conv.isGroup && (
            <div className="cip-section">
              <div className="cip-section-title">Informations</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span style={{ color: "var(--text-ghost)" }}>Cree le</span>
                  <span>{conv.createdAt}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span style={{ color: "var(--text-ghost)" }}>Membres</span>
                  <span>{members.length} / 256</span>
                </div>
              </div>
            </div>
          )}

          <div className="cip-section">
            <div className="cip-section-title">Actions</div>
            {conv.isGroup && (
              <div className="danger-item" onClick={leaveGroup}>
                <div className="di-icon" style={{ background: "var(--warning-dim,#fbbf2415)" }}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--warning,#fbbf24)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                </div>
                <div>
                  <div className="danger-label" style={{ color: "var(--warning,#fbbf24)" }}>
                    Quitter le groupe
                  </div>
                  <div className="danger-sub">Vous ne recevrez plus les messages</div>
                </div>
              </div>
            )}
            <div className="danger-item" onClick={deleteConv}>
              <div className="di-icon" style={{ background: "var(--danger-dim)" }}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--danger)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </div>
              <div>
                <div className="danger-label" style={{ color: "var(--danger)" }}>
                  {conv.isGroup ? "Supprimer le groupe" : "Supprimer la conversation"}
                </div>
                <div className="danger-sub">Action irreversible</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {pendingAction && (
        <div className="cip-confirm-overlay" onClick={() => setPendingAction(null)}>
          <div
            className="cip-confirm-card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="cip-confirm-title">{pendingAction.title}</div>
            <div className="cip-confirm-text">{pendingAction.description}</div>
            <div className="cip-confirm-actions">
              <button className="cip-confirm-btn cancel" onClick={() => setPendingAction(null)}>
                Annuler
              </button>
              <button
                className={`cip-confirm-btn confirm ${pendingAction.tone}`}
                onClick={() => {
                  pendingAction.onConfirm()
                  setPendingAction(null)
                }}
              >
                {pendingAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const COLOR_NAMES = ["amber", "blue", "violet", "teal", "rose"] as const

/**
 * Construit le ConvInfo a partir de la conversation backend + de la liste de contacts.
 * Pour un groupe : map chaque memberId vers un contact pour avoir les vrais noms.
 * Pour un 1-to-1 : l'unique "membre" affiche est l'autre user.
 */
async function buildConvInfoFromBackend(chatId: string): Promise<ConvInfo | null> {
  const conv = await fetchConversationById(chatId)
  if (!conv) return null

  const contacts = await fetchContacts()
  const colorName = COLOR_NAMES[(conv.colorIdx ?? 0) % COLOR_NAMES.length]

  if (conv.isGroup) {
    const members: Member[] = (conv.members ?? []).map((memberId, index) => {
      const contact = contacts.find((c) => c.id === memberId)
      return {
        id: memberId,
        name: contact?.name ?? `Membre ${index + 1}`,
        initials: contact?.initials ?? memberId.slice(0, 2).toUpperCase(),
        color: contact?.color ?? COLOR_NAMES[index % COLOR_NAMES.length],
        role: index === 0 ? "admin" : "member",
        online: contact?.online ?? false,
      }
    })

    return {
      id: conv.id,
      name: conv.name,
      initials: conv.initials,
      color: colorName,
      isGroup: true,
      members,
      files: [],
      createdAt: "",
      description: `${members.length} membres`,
    }
  }

  return {
    id: conv.id,
    name: conv.name,
    initials: conv.initials,
    color: colorName,
    isGroup: false,
    online: conv.online,
    statusMsg: conv.online ? "En ligne" : "Statut inconnu",
    members: [
      {
        id: conv.id,
        name: conv.name,
        initials: conv.initials,
        color: colorName,
        role: "member",
        online: conv.online,
      },
    ],
    files: [],
    createdAt: "",
  }
}

function buildConvInfoFromLocalData(chatId: string): ConvInfo | null {
  const contacts = loadContacts()
  const localConversation = loadLocalConversations().find(
    (conversation) => conversation.id === chatId
  )
  const group = findLocalGroup(chatId)

  if (group) {
    const colorNames = ["amber", "blue", "violet", "teal", "rose"] as const

    return {
      id: group.id,
      name: localConversation?.name ?? group.name,
      initials: localConversation?.initials ?? group.initials,
      color: colorNames[(localConversation?.colorIdx ?? group.name.length) % colorNames.length],
      isGroup: true,
      members: group.memberIds.map((memberId, index) => {
        const contact = contacts.find((entry) => entry.id === memberId)

        return {
          id: memberId,
          name: contact?.name ?? `Membre ${index + 1}`,
          initials: contact?.initials ?? memberId.slice(0, 2).toUpperCase(),
          color: contact?.color ?? colorNames[index % colorNames.length],
          role: index === 0 ? "admin" : "member",
          online: contact?.online ?? false,
        }
      }),
      files: [],
      createdAt: new Date(group.createdAt).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      description: `${group.memberIds.length} membres`,
    }
  }

  const contact = contacts.find((entry) => entry.id === chatId)
  if (!contact) return null

  return {
    id: contact.id,
    name: localConversation?.name ?? contact.name,
    initials: localConversation?.initials ?? contact.initials,
    color: contact.color,
    isGroup: false,
    online: contact.online,
    statusMsg: contact.online ? "En ligne" : "Statut inconnu",
    members: [
      {
        id: contact.id,
        name: contact.name,
        initials: contact.initials,
        color: contact.color,
        role: "member",
        online: contact.online,
      },
    ],
    files: [],
    createdAt: "Date inconnue",
  }
}

export default function ConvInfoPage() {
  const navigate = useNavigate()
  const { chatId } = useParams<{ chatId: string }>()
  const [convInfo, setConvInfo] = useState<ConvInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!chatId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void buildConvInfoFromBackend(chatId)
      .then((info) => {
        if (cancelled) return
        // Fallback local : groupe cree en local ou cache contacts
        setConvInfo(info ?? buildConvInfoFromLocalData(chatId))
      })
      .catch(() => {
        if (cancelled) return
        setConvInfo(buildConvInfoFromLocalData(chatId))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chatId])

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: "var(--bg-base)",
          justifyContent: "center",
          alignItems: "center",
          color: "var(--text-muted)",
        }}
      >
        Chargement...
      </div>
    )
  }

  if (!convInfo) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: "var(--bg-base)",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>?</div>
          <div>Conversation introuvable</div>
          <button onClick={() => navigate("/chats")} style={{ marginTop: 16, padding: "8px 16px" }}>
            Retour aux chats
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--bg-base)",
        justifyContent: "center",
      }}
    >
      <ConvInfoPanel info={convInfo} onClose={() => navigate(-1)} />
    </div>
  )
}
