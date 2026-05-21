import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import {
  CHAT_COLORS,
  type ChatMessageMock,
  type ConversationMock,
  type MessageStatus,
} from "../../../../src/mocks/chat-data"
import { loadContacts } from "../../../../src/data/contacts"
import {
  ensureDirectConversation,
  ensureGroupConversation,
  syncConversationFromMessages,
} from "../../../../src/data/local-conversations"
import { findLocalGroup, toChatInfoMock } from "../../../../src/data/local-groups"
import { useToast } from "../../../../src/components/toast"
import {
  fetchMessages,
  markChatAsRead,
  sendChatMessage,
  toFrontMessage,
  type BackendMessage,
} from "../../../../src/services/messages-service"
import { fetchConversationById } from "../../../../src/services/chats-service"
import {
  publishTyping,
  subscribeToConversation,
  subscribeToStatus,
  subscribeToTyping,
} from "../../../../src/services/websocket-service"
import { loadSessionUser } from "../../../../src/data/session-user"
import "./chat-room-page.css"

type Message = ChatMessageMock

// Realtime : WebSocket STOMP sur /topic/chats/{id} (subscribeToConversation)

function formatTime(d: Date) {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
}

function formatDateSeparator(d: Date) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui"
  if (d.toDateString() === yesterday.toDateString()) return "Hier"
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
}

function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === "sending")
    return <span style={{ color: "var(--text-faint)", fontSize: 10 }}>...</span>
  if (status === "sent") return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>ok</span>
  if (status === "delivered")
    return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>vu</span>
  return <span style={{ color: "var(--info)", fontSize: 11 }}>lu</span>
}

function MessageBubble({
  msg,
  isMe,
  replyMsg,
  onReply,
  chatColor,
}: {
  msg: Message
  isMe: boolean
  replyMsg?: Message
  onReply: (m: Message) => void
  chatColor: { bg: string; text: string }
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isMe ? "flex-end" : "flex-start",
        marginBottom: 2,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          flexDirection: isMe ? "row-reverse" : "row",
        }}
      >
        {/* Bouton repondre */}
        {hovered && (
          <button
            onClick={() => onReply(msg)}
            style={{
              background: "var(--border-subtle)",
              border: "1px solid var(--border-default)",
              borderRadius: 6,
              padding: "4px 8px",
              color: "var(--text-secondary)",
              fontSize: 10,
              cursor: "pointer",
              flexShrink: 0,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Repondre
          </button>
        )}

        <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Citation */}
          {replyMsg && (
            <div
              style={{
                background: isMe ? "var(--accent-dim)" : "var(--border-subtle)",
                borderLeft: `3px solid ${isMe ? "var(--accent)" : chatColor.text}`,
                borderRadius: "0 6px 6px 0",
                padding: "6px 10px",
                fontSize: 11,
                color: "var(--text-secondary)",
                marginBottom: 2,
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {replyMsg.content}
            </div>
          )}

          {/* Bulle */}
          <div
            style={{
              background: isMe ? "var(--accent)" : "var(--border-subtle)",
              color: isMe ? "var(--bg-base)" : "var(--text-primary)",
              padding: msg.type === "file" ? "10px 14px" : "10px 14px",
              borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              fontSize: 13,
              lineHeight: 1.55,
              wordBreak: "break-word",
            }}
          >
            {msg.type === "file" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 200 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: isMe ? "var(--accent-border)" : "var(--border-default)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    color: isMe ? "var(--bg-base)" : "var(--text-secondary)",
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {msg.fileName}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.7 }}>{msg.fileSize}</div>
                </div>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
              </div>
            )}

            {msg.type === "image" && (
              <div
                style={{
                  width: 200,
                  height: 140,
                  background: isMe ? "var(--accent-border)" : "var(--border-default)",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 4,
                }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  style={{ opacity: 0.4 }}
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
            )}

            {(msg.type === "text" || msg.type === "image") && <span>{msg.content}</span>}
          </div>

          {/* Meta */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              justifyContent: isMe ? "flex-end" : "flex-start",
              padding: "0 2px",
            }}
          >
            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
              {formatTime(msg.timestamp)}
            </span>
            {isMe && <StatusIcon status={msg.status} />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ChatRoomPage() {
  const params = useParams()
  const navigate = useNavigate()
  const chatId = params.chatId as string
  const returnTo = `/chats/${chatId}`
  const { error } = useToast()

  const contacts = useMemo(() => loadContacts(), [])
  const fallbackContact = useMemo(
    () => contacts.find((contact) => contact.id === chatId),
    [contacts, chatId]
  )
  const fallbackGroup = useMemo(() => findLocalGroup(chatId), [chatId])

  // Conversation chargee depuis le backend (GET /api/chats trouve par id)
  const [backendChat, setBackendChat] = useState<ConversationMock | null>(null)
  const [chatLoading, setChatLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setChatLoading(true)
    void fetchConversationById(chatId)
      .then((conv) => {
        if (!cancelled) setBackendChat(conv)
      })
      .catch(() => {
        if (!cancelled) setBackendChat(null)
      })
      .finally(() => {
        if (!cancelled) setChatLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chatId])

  const chat = useMemo(
    () =>
      // Priorite : backend d'abord, puis contact local, puis groupe local.
      backendChat ??
      (fallbackContact
        ? {
            id: fallbackContact.id,
            name: fallbackContact.name,
            initials: fallbackContact.initials,
            colorIdx: 0,
            online: fallbackContact.online,
            isGroup: false,
          }
        : undefined) ??
      (fallbackGroup ? toChatInfoMock(fallbackGroup) : undefined),
    [backendChat, fallbackContact, fallbackGroup]
  )

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  // typing de l'interlocuteur (recu via WebSocket /topic/chats/{id}/typing)
  const [isTyping, setIsTyping] = useState(false)
  const [sending, setSending] = useState(false)
  const [showAttach, setShowAttach] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout>>()

  const refreshMessages = useCallback(async () => {
    const list = await fetchMessages(chatId)
    setMessages(list)
  }, [chatId])

  useEffect(() => {
    if (!chat) return

    if (fallbackContact) {
      ensureDirectConversation(fallbackContact)
    }
    if (fallbackGroup) {
      ensureGroupConversation(fallbackGroup)
    }

    let cancelled = false

    // Charge l'historique initial via GET /api/chats/{id}/messages
    void refreshMessages().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[chat] fetchMessages a echoue", err)
      if (!cancelled) setMessages([])
    })

    // Temps reel : abonnement STOMP sur /topic/chats/{id} (nouveaux messages)
    const myPhone = loadSessionUser()?.phone ?? null
    const unsubscribeMessages = subscribeToConversation(chatId, (data) => {
      if (cancelled) return
      const incoming = toFrontMessage(data as BackendMessage, myPhone)
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev
        return [...prev, incoming]
      })
      if (incoming.senderId !== "me") {
        void markChatAsRead(chatId)
      }
    })

    // Abonnement aux evenements "en train d'ecrire"
    let typingTimeoutId: ReturnType<typeof setTimeout> | null = null
    const unsubscribeTyping = subscribeToTyping(chatId, (event) => {
      if (cancelled) return
      // Ignore ses propres evenements
      if (myPhone && event.phone === myPhone) return
      setIsTyping(Boolean(event.isTyping))
      if (typingTimeoutId) clearTimeout(typingTimeoutId)
      // Failsafe : si on ne recoit pas le "stopped typing", on coupe apres 4s
      if (event.isTyping) {
        typingTimeoutId = setTimeout(() => setIsTyping(false), 4000)
      }
    })

    // Abonnement aux mises a jour de statut (messages lus par l'autre)
    const unsubscribeStatus = subscribeToStatus(chatId, (event) => {
      if (cancelled) return
      if (myPhone && event.readBy === myPhone) return // c'est nous qui avons lu
      const ids = new Set(event.messageIds)
      setMessages((prev) => prev.map((m) => (ids.has(m.id) ? { ...m, status: "read" } : m)))
    })

    // Quand on ouvre la conv, on marque tout comme lu
    void markChatAsRead(chatId)

    return () => {
      cancelled = true
      unsubscribeMessages()
      unsubscribeTyping()
      unsubscribeStatus()
      if (typingTimeoutId) clearTimeout(typingTimeoutId)
    }
  }, [chat, chatId, refreshMessages, fallbackContact, fallbackGroup])

  useEffect(() => {
    if (!chat || messages.length === 0) return

    syncConversationFromMessages(
      {
        id: chat.id,
        name: chat.name,
        initials: chat.initials,
        colorIdx: chat.colorIdx,
        online: chat.online,
        isGroup: chat.isGroup,
        members: chat.members,
      },
      messages
    )
  }, [chat, messages])

  // Scroll en bas a chaque nouveau message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Envoi d'un message — POST /api/chats/{chatId}/messages
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    const tempId = `tmp-${Date.now()}`
    const optimistic: Message = {
      id: tempId,
      senderId: "me",
      content: text,
      type: "text",
      status: "sending",
      timestamp: new Date(),
      replyTo: replyTo?.id,
    }

    setMessages((prev) => [...prev, optimistic])
    setInput("")
    setReplyTo(null)
    setSending(true)

    // On a envoye -> on n'ecrit plus
    const myPhone = loadSessionUser()?.phone
    if (myPhone) {
      clearTimeout(typingTimer.current)
      publishTyping(chatId, myPhone, false)
    }

    try {
      const saved = await sendChatMessage(chatId, text, "text")
      // Replace le message optimiste par celui renvoye par le backend.
      // Si le broadcast WebSocket est arrive avant (id deja present), on retire juste le tempId.
      setMessages((prev) => {
        const alreadyReceived = prev.some((m) => m.id === saved.id)
        if (alreadyReceived) return prev.filter((m) => m.id !== tempId)
        return prev.map((m) => (m.id === tempId ? saved : m))
      })
    } catch (err) {
      // En cas d'echec, on marque le message comme "non envoye" pour informer l'user
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "sending" } : m)))
      const message = err instanceof Error ? err.message : "Envoi impossible."
      error("Message non envoye", message)
    } finally {
      setSending(false)
    }
  }, [input, sending, replyTo, chatId, error])

  // Touche Entree = envoi (Shift+Entree = saut de ligne)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Auto-resize du textarea + emission typing via WebSocket
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = "auto"
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"

    const myPhone = loadSessionUser()?.phone
    if (myPhone) {
      publishTyping(chatId, myPhone, true)
      clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => {
        publishTyping(chatId, myPhone, false)
      }, 1500)
    }
  }

  // Upload fichier
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 50 * 1024 * 1024) {
      error("Fichier trop volumineux", "Maximum 50 Mo par fichier.")
      e.target.value = ""
      return
    }
    const isImage = file.type.startsWith("image/")
    const msg: Message = {
      id: `tmp-${Date.now()}`,
      senderId: "me",
      content: file.name,
      type: isImage ? "image" : "file",
      status: "sending",
      timestamp: new Date(),
      fileName: file.name,
      fileSize: `${(file.size / 1024 / 1024).toFixed(1)} Mo`,
    }
    setMessages((prev) => [...prev, msg])
    setShowAttach(false)
    // TODO : POST /api/chats/:id/files (multipart/form-data)
    setTimeout(() => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, status: "delivered" } : m)))
    }, 1200)
    e.target.value = ""
  }

  // Grouper les messages par date
  const grouped = messages.reduce<{ date: string; msgs: Message[] }[]>((acc, msg) => {
    const dateStr = formatDateSeparator(msg.timestamp)
    const last = acc[acc.length - 1]
    if (!last || last.date !== dateStr) acc.push({ date: dateStr, msgs: [msg] })
    else last.msgs.push(msg)
    return acc
  }, [])

  if (chatLoading && !chat) {
    return (
      <div style={{ padding: 24, color: "var(--text-muted)" }}>
        Chargement de la conversation...
      </div>
    )
  }

  if (!chat) {
    return <Navigate to="/chats" replace />
  }

  const color = CHAT_COLORS[chat.colorIdx % CHAT_COLORS.length]

  return (
    <div className="room-root">
      <div className="room-top">
        <button className="back-btn" onClick={() => navigate("/chats")} aria-label="Retour">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <div className="room-av" style={{ background: color.bg, color: color.text }}>
          {chat.initials}
          {chat.online && !chat.isGroup && <div className="room-av-dot" />}
        </div>

        <div className="room-info">
          <div className="room-name">{chat.name}</div>
          <div
            className="room-sub"
            style={{
              color: isTyping
                ? "var(--accent)"
                : chat.online
                  ? "var(--success)"
                  : "var(--text-muted)",
            }}
          >
            {isTyping
              ? "en train d'ecrire..."
              : chat.isGroup
                ? `${chat.members?.length ?? 0} membres`
                : chat.online
                  ? "En ligne"
                  : "Hors ligne"}
          </div>
        </div>

        <div className="room-actions">
          {/* Appel audio */}
          <button
            className="action-btn"
            aria-label="Appel audio"
            title="Appel audio"
            onClick={() =>
              navigate(
                `/calls/new?contact=${chatId}&type=audio&returnTo=${encodeURIComponent(returnTo)}`
              )
            }
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          </button>
          {/* Appel video */}
          <button
            className="action-btn"
            aria-label="Appel video"
            title="Appel video"
            onClick={() =>
              navigate(
                `/calls/new?contact=${chatId}&type=video&returnTo=${encodeURIComponent(returnTo)}`
              )
            }
          >
            <svg
              width="15"
              height="15"
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
          {/* Info */}
          <button
            className="action-btn"
            aria-label="Infos conversation"
            title="Infos"
            onClick={() => navigate(`/chats/${chatId}/info`)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>
        </div>
      </div>

      <div className="room-body">
        {grouped.map(({ date, msgs }) => (
          <div key={date}>
            <div className="date-sep">
              <div className="date-sep-line" />
              <div className="date-sep-txt">{date}</div>
              <div className="date-sep-line" />
            </div>

            {msgs.map((msg) => {
              const isMe = msg.senderId === "me"
              const reply = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) : undefined
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isMe={isMe}
                  replyMsg={reply}
                  onReply={setReplyTo}
                  chatColor={color}
                />
              )
            })}
          </div>
        ))}

        {/* Indicateur de frappe */}
        {isTyping && (
          <div className="typing-indicator">
            <div className="typing-av" style={{ background: color.bg, color: color.text }}>
              {chat.initials}
            </div>
            <div className="typing-bubble">
              <div className="td" />
              <div className="td" />
              <div className="td" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {replyTo && (
        <div className="reply-bar">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <polyline points="9 17 4 12 9 7" />
            <path d="M20 18v-2a4 4 0 00-4-4H4" />
          </svg>
          <div className="reply-bar-content">
            <div className="reply-bar-label">Repondre a</div>
            <div className="reply-bar-txt">{replyTo.content}</div>
          </div>
          <button
            className="reply-cancel"
            onClick={() => setReplyTo(null)}
            aria-label="Annuler la reponse"
          >
            <svg
              width="14"
              height="14"
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

      <div className="room-input-wrap">
        <input
          ref={fileRef}
          type="file"
          style={{ display: "none" }}
          onChange={handleFileSelect}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.mp3,.mp4,.wav"
        />

        <div className="room-input-row" style={{ position: "relative" }}>
          {/* Popup attachement */}
          {showAttach && (
            <div className="attach-menu">
              <button
                className="attach-opt"
                onClick={() => {
                  fileRef.current!.accept = "image/*"
                  fileRef.current!.click()
                }}
              >
                <div className="attach-icon" style={{ background: "#a78bfa20", color: "#a78bfa" }}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                Photo / image
              </button>
              <button
                className="attach-opt"
                onClick={() => {
                  fileRef.current!.accept = ".pdf,.doc,.docx,.xls,.xlsx,.txt"
                  fileRef.current!.click()
                }}
              >
                <div
                  className="attach-icon"
                  style={{ background: "var(--info)20", color: "var(--info)" }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                Document
              </button>
              <button
                className="attach-opt"
                onClick={() => {
                  fileRef.current!.accept = ".mp3,.wav,.ogg,.m4a"
                  fileRef.current!.click()
                }}
              >
                <div
                  className="attach-icon"
                  style={{ background: "var(--success)20", color: "var(--success)" }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
                Audio
              </button>
            </div>
          )}

          <button
            className="attach-btn"
            onClick={() => setShowAttach((v) => !v)}
            aria-label="Joindre un fichier"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <textarea
            ref={inputRef}
            className="room-textarea"
            placeholder="Message..."
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            aria-label="Saisir un message"
          />

          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={!input.trim()}
            aria-label="Envoyer"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--bg-base)"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div className="input-hint">
          Entree pour envoyer - Shift+Entree pour sauter une ligne - Max 50 Mo par fichier
        </div>
      </div>
    </div>
  )
}
