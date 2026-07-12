import { useState, useMemo, useEffect, useRef } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import { CHAT_COLORS, type ConversationMock } from "../../../src/mocks/chat-data"
import { fetchChatConversations, fetchChatConversationsCacheFirst } from "../../../src/services/chats-service"
import {
  subscribeToAllMessages,
  subscribeToWsConnected,
} from "../../../src/services/websocket-service"
import { useAuth } from "../../../src/components/auth-provider"
import { toInitials } from "../../../src/data/session-user"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"
import { avatarDisplaySrc } from "../../../src/lib/avatar"
import "./chats-page.css"

function lastMsgIcon(type: ConversationMock["lastMessageType"]) {
  if (type === "file") return "[fichier] "
  if (type === "audio") return "[audio] "
  if (type === "image") return "[image] "
  return ""
}

export default function ChatsPage() {
  const navigate = useNavigate()
  const { user: sessionUser } = useAuth()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "unread" | "groups">("all")

  const [conversations, setConversations] = useState<ConversationMock[]>([])
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    // Chargement initial : cache-first (IndexedDB → affichage instantané, puis réseau)
    void fetchChatConversationsCacheFirst(
      (cached) => { if (!cancelled) setConversations(cached) },
      (fresh) => { if (!cancelled) setConversations(fresh) }
    )

    // Refresh réseau pur pour les mises à jour temps réel
    // (le cache est déjà alimenté par le service sous-jacent)
    const refresh = () => {
      void fetchChatConversations().then((list) => {
        if (!cancelled) setConversations(list)
      })
    }

    // Temps reel : un nouveau message (n'importe quelle conversation) rafraichit
    // la liste (dernier message, tri, compteur non-lus). Debounce leger pour
    // eviter une rafale de requetes si plusieurs messages arrivent d'un coup.
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(refresh, 400)
    }
    const unsubscribeMessages = subscribeToAllMessages(scheduleRefresh)
    // Et on se resynchronise apres chaque (re)connexion du WebSocket.
    const unsubscribeConnected = subscribeToWsConnected(scheduleRefresh)

    // Filet de securite : un expediteur au WebSocket degrade (4G) envoie en
    // REST sans diffusion -> on resynchronise la liste toutes les 20 s.
    const pollId = setInterval(() => {
      if (!cancelled && !document.hidden) scheduleRefresh()
    }, 20_000)

    return () => {
      cancelled = true
      unsubscribeMessages()
      unsubscribeConnected()
      clearInterval(pollId)
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [])

  const filtered = useMemo(() => {
    return conversations
      .filter((c) => {
        if (filter === "unread") return c.unread > 0
        if (filter === "groups") return c.isGroup
        return true
      })
      .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
  }, [conversations, query, filter])

  const pinned = filtered.filter((c) => c.isPinned)
  const regular = filtered.filter((c) => !c.isPinned)

  return (
    <div className="chats-root">
      <div className="ch-header">
        {/* Carte profil : nom + numero Alanya, comme en tete de liste sur mobile */}
        <div
          onClick={() => navigate("/settings")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 14,
            padding: "12px 14px",
            marginBottom: 14,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              background: "var(--brand)",
              color: "var(--brand-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Bricolage Grotesque', sans-serif",
              fontWeight: 800,
              fontSize: 15,
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            {avatarDisplaySrc(sessionUser?.avatar) ? (
              <img
                src={avatarDisplaySrc(sessionUser?.avatar)!}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              toInitials(sessionUser?.name ?? "Moi")
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sessionUser?.name ?? "Mon profil"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Numero Alanya :{" "}
              <strong style={{ color: "var(--accent)" }}>
                {sessionUser?.phone ? formatAlanyaNumber(sessionUser.phone) : "—"}
              </strong>
            </div>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-faint)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        <div className="ch-title-row">
          <h1 className="ch-title">Discussions</h1>
          <button className="new-chat-btn" onClick={() => navigate("/chats/new")}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nouveau chat
          </button>
        </div>

        {/* Recherche */}
        <div className="search-wrap">
          <svg
            className="search-icon"
            width="15"
            height="15"
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
            className="search-input"
            type="search"
            placeholder="Rechercher une conversation..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Filtres */}
        <div className="filter-row">
          {(["all", "unread", "groups"] as const).map((f) => (
            <button
              key={f}
              className={`filter-btn ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "Tous"
                : f === "unread"
                  ? `Non lus (${conversations.reduce((a, c) => a + (c.unread > 0 ? 1 : 0), 0)})`
                  : "Groupes"}
            </button>
          ))}
        </div>
      </div>

      {/* Liste */}
      <div className="ch-list">
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">...</div>
            <div className="empty-txt">
              Aucune conversation trouvee
              <br />
              pour "{query}"
            </div>
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <div className="section-label">Epinglees</div>
                {pinned.map((conv) => (
                  <ConvItem key={conv.id} conv={conv} />
                ))}
              </>
            )}
            {regular.length > 0 && (
              <>
                {pinned.length > 0 && <div className="section-label">Recents</div>}
                {regular.map((conv) => (
                  <ConvItem key={conv.id} conv={conv} />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Bouton flottant orange -> repertoire des contacts (comme sur mobile).
          position en CSS (chats-split.css) pour rester dans la colonne de gauche. */}
      <button
        className="chats-fab"
        onClick={() => navigate("/contacts")}
        aria-label="Ouvrir les contacts"
        title="Contacts"
        style={{
          position: "absolute",
          right: 20,
          bottom: 20,
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "none",
          background: "#c04d29",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 10px 28px #c04d2960",
          zIndex: 100,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </button>
    </div>
  )
}

function ConvItem({ conv }: { conv: ConversationMock }) {
  const color = CHAT_COLORS[conv.colorIdx % CHAT_COLORS.length]
  return (
    <NavLink
      to={`/chats/${conv.id}`}
      className={({ isActive }) => `conv-item ${isActive ? "active" : ""}`}
    >
      <div className="av" style={{ background: color.bg, color: color.text, overflow: "hidden" }}>
        {avatarDisplaySrc(conv.avatar) ? (
          <img
            src={avatarDisplaySrc(conv.avatar)!}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
          />
        ) : (
          conv.initials
        )}
        {conv.online && !conv.isGroup && <div className="av-dot" />}
        {conv.isGroup && <div className="group-stack">{conv.members?.length ?? "+"}</div>}
      </div>
      <div className="conv-meta">
        <div className="conv-name">
          {conv.name}
          {conv.isPinned && <span className="pin-icon">epingle</span>}
          {conv.isGroup && (
            <span
              style={{
                fontSize: 9,
                background: "var(--border-subtle)",
                color: "var(--text-muted)",
                padding: "1px 5px",
                borderRadius: 3,
                fontWeight: 500,
              }}
            >
              groupe
            </span>
          )}
        </div>
        <div className={`conv-preview ${conv.unread > 0 ? "unread" : ""}`}>
          {lastMsgIcon(conv.lastMessageType)}
          {conv.lastMessage}
        </div>
      </div>
      <div className="conv-right">
        <div className={`conv-time ${conv.unread > 0 ? "unread" : ""}`}>{conv.time}</div>
        {conv.unread > 0 && <div className="unread-badge">{conv.unread}</div>}
      </div>
    </NavLink>
  )
}
