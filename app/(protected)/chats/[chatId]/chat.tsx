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
  deleteChatMessage,
  fetchMessages,
  fetchMessagesCacheFirst,
  forwardChatMessage,
  markChatAsRead,
  persistIncomingWsMessage,
  removeMessageFromDB,
  sendChatMessage,
  toFrontMessage,
} from "../../../../src/services/messages-service"
import {
  fetchChatConversations,
  fetchConversationById,
} from "../../../../src/services/chats-service"
import {
  formatAudioDuration,
  resolveMediaUrl,
  uploadMedia,
} from "../../../../src/services/media-service"
import {
  publishTyping,
  subscribeToConversation,
  subscribeToMessageDeleted,
  subscribeToStatus,
  subscribeToTyping,
  subscribeToWsConnected,
} from "../../../../src/services/websocket-service"
import { getMyUserId } from "../../../../src/data/session-user"
import { startOutgoingCall } from "../../../../src/services/call-manager"
import { fetchCallsForConversation, type CallRecord } from "../../../../src/services/calls-service"
import { avatarDisplaySrc } from "../../../../src/lib/avatar"
import "./chat-room-page.css"

type Message = ChatMessageMock

// Realtime : WebSocket natif du backend Alanya (evenements { type: "message" | "typing" | "read" })

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

/** Coche simple (envoye) / double blanche (recu) / double bleue (lu), comme sur WhatsApp.
    Affichee uniquement sur la bulle terracotta de l'expediteur -> teintes claires. */
function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === "sending") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(255, 255, 255, 0.6)"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
    )
  }

  // Bleu vif quand lu, blanc translucide sinon (lisible sur le terracotta).
  const color = status === "read" ? "#6fd0f5" : "rgba(255, 255, 255, 0.8)"
  const doubleCheck = status === "delivered" || status === "read"

  return (
    <svg
      width="16"
      height="12"
      viewBox="0 0 28 16"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 8.5l4 4L14 4" />
      {doubleCheck && <path d="M10 8.5l4 4L22 4" />}
    </svg>
  )
}

/** Extrait les URLs d'un texte. */
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi

/** Detecte des coordonnees GPS (lat,lng) ou un lien Google Maps. */
const GPS_REGEX = /(-?\d+\.\d{4,})\s*,\s*(-?\d+\.\d{4,})/
const GMAPS_REGEX = /(?:google\.\w+\/maps|maps\.google\.\w+|goo\.gl\/maps).*?[/@](-?\d+\.\d+),(-?\d+\.\d+)/

function extractGpsCoords(text: string): { lat: number; lng: number } | null {
  const gm = text.match(GMAPS_REGEX)
  if (gm) return { lat: parseFloat(gm[1]), lng: parseFloat(gm[2]) }
  const gps = text.match(GPS_REGEX)
  if (gps) return { lat: parseFloat(gps[1]), lng: parseFloat(gps[2]) }
  return null
}

/** Couleurs distinctes pour les noms d'envoyeurs en groupe. */
const SENDER_NAME_COLORS = ["#E8B84B", "#60a5fa", "#a78bfa", "#34d399", "#f87171", "#fb923c", "#38bdf8", "#c084fc"]
function senderNameColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
  return SENDER_NAME_COLORS[Math.abs(h) % SENDER_NAME_COLORS.length]
}

/** Icone + couleur par extension de fichier. */
function fileTypeInfo(filename?: string, mime?: string): { color: string; label: string } {
  const ext = (filename ?? "").split(".").pop()?.toLowerCase() ?? ""
  const m = (mime ?? "").toLowerCase()
  if (ext === "pdf" || m === "application/pdf") return { color: "#ef4444", label: "PDF" }
  if (["doc", "docx"].includes(ext) || m.includes("word")) return { color: "#3b82f6", label: "DOC" }
  if (["xls", "xlsx"].includes(ext) || m.includes("spreadsheet") || m.includes("excel")) return { color: "#22c55e", label: "XLS" }
  if (["ppt", "pptx"].includes(ext) || m.includes("presentation")) return { color: "#f97316", label: "PPT" }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return { color: "#a855f7", label: "ZIP" }
  if (["txt", "csv", "log", "md"].includes(ext)) return { color: "#6b7280", label: "TXT" }
  if (m.startsWith("audio/")) return { color: "#22c55e", label: "AUDIO" }
  if (m.startsWith("video/")) return { color: "#8b5cf6", label: "VIDEO" }
  if (m.startsWith("image/")) return { color: "#ec4899", label: "IMG" }
  if (ext === "apk") return { color: "#34d399", label: "APK" }
  return { color: "var(--text-secondary)", label: ext.toUpperCase() || "FILE" }
}

/** Rend le texte avec les URLs cliquables et un preview du premier lien. */
function RichText({ text, isMe }: { text: string; isMe: boolean }) {
  const urls = text.match(URL_REGEX) || []
  if (urls.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0
  for (const url of urls) {
    const idx = remaining.indexOf(url)
    if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>)
    parts.push(
      <a key={key++} href={url} target="_blank" rel="noreferrer"
        style={{ color: isMe ? "#93c5fd" : "var(--accent)", textDecoration: "underline", wordBreak: "break-all" }}>
        {url}
      </a>
    )
    remaining = remaining.slice(idx + url.length)
  }
  if (remaining) parts.push(<span key={key++}>{remaining}</span>)

  let domain = ""
  try { if (urls[0]) domain = new URL(urls[0]).hostname.replace("www.", "") } catch { /* ignore */ }

  return (
    <>
      {parts}
      {domain && (
        <a href={urls[0]} target="_blank" rel="noreferrer"
          style={{
            display: "flex", alignItems: "center", gap: 8, marginTop: 6,
            padding: "8px 10px", background: isMe ? "#ffffff12" : "var(--bg-elevated)",
            border: `1px solid ${isMe ? "#ffffff18" : "var(--border-subtle)"}`,
            borderRadius: 8, textDecoration: "none", color: "inherit",
          }}>
          <img src={`https://www.google.com/s2/favicons?sz=32&domain=${domain}`} alt="" width={20} height={20}
            style={{ borderRadius: 4, flexShrink: 0 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{domain}</div>
            <div style={{ fontSize: 10, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{urls[0]}</div>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </a>
      )}
    </>
  )
}

/** Preview de coordonnees GPS avec mini-carte OpenStreetMap. */
function GpsPreview({ lat, lng, isMe }: { lat: number; lng: number; isMe: boolean }) {
  return (
    <div style={{ marginTop: 6 }}>
      <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`}
        target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
        <div style={{
          width: "100%", maxWidth: 260, height: 140, borderRadius: 8, overflow: "hidden",
          border: `1px solid ${isMe ? "#ffffff18" : "var(--border-subtle)"}`,
          background: isMe ? "#ffffff08" : "var(--bg-elevated)",
          position: "relative",
        }}>
          <iframe title="Position GPS" loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}&layer=mapnik&marker=${lat},${lng}`}
            style={{ width: "100%", height: "130%", border: "none", pointerEvents: "none", display: "block" }} />
          {/* Masque tout message d'erreur ou texte intégré en bas du preview */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 55,
            background: `linear-gradient(to top, ${isMe ? "rgba(255,255,255,0.25)" : "var(--bg-elevated)"}, transparent 10%)`,
            pointerEvents: "none",
          }} />
          {/* Overlay supplémentaire au centre-bas pour cacher tout texte résiduel */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 35,
            background: isMe ? "rgba(255,255,255,0.15)" : "var(--bg-elevated)",
            opacity: 0.9,
            pointerEvents: "none",
          }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 10, opacity: 0.75 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
          </svg>
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </div>
      </a>
    </div>
  )
}

/**
 * Evenement d'appel affiche dans le fil de discussion :
 * aligne a gauche (entrant) ou a droite (sortant), avec couleurs directionnelles.
 */
function CallEventChip({ call }: { call: CallRecord }) {
  const missed = call.direction === "missed" || call.status === "no_answer"
  const declined = call.status === "declined"
  const isOutgoing = call.direction === "out"
  const failed = missed || declined

  const label =
    (call.type === "video" ? "Appel video" : "Appel vocal") +
    (missed ? " manque" : declined ? " refuse" : "")

  // Couleurs : rouge si manque/refuse, vert si sortant reussi, bleu si entrant reussi
  const tint = failed ? "var(--danger)" : isOutgoing ? "#22c55e" : "#3b82f6"
  const bgTint = failed ? "#ef444412" : isOutgoing ? "#22c55e12" : "#3b82f612"

  return (
    <div style={{ display: "flex", justifyContent: isOutgoing ? "flex-end" : "flex-start", margin: "4px 0" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, background: bgTint,
          border: `1px solid ${tint}22`,
          borderRadius: isOutgoing ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
          padding: "8px 14px", fontSize: 12, color: tint, maxWidth: "min(70%, 340px)",
        }}
      >
        <span style={{
          width: 28, height: 28, borderRadius: "50%", background: bgTint,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {call.type === "video" ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            {/* Fleche de direction */}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              {isOutgoing
                ? <><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></>
                : <><line x1="17" y1="7" x2="7" y2="17" /><polyline points="17 17 7 17 7 7" /></>}
            </svg>
            {label}
          </div>
          <div style={{ fontSize: 10, opacity: 0.75, marginTop: 1 }}>
            {formatTime(call.ts)}{call.duration ? ` — ${call.duration}` : ""}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Lecteur audio compact style WhatsApp (vocaux et fichiers audio). */
function AudioPlayer({
  src,
  durationMs,
  isMe,
}: {
  src: string
  durationMs?: number
  isMe: boolean
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      void audio.play()
    }
  }

  const fg = isMe ? "var(--bubble-me-text)" : "var(--text-primary)"

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 190, padding: "2px 0" }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setProgress(0)
          setElapsedSec(0)
        }}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget
          const total =
            Number.isFinite(audio.duration) && audio.duration > 0
              ? audio.duration
              : (durationMs ?? 0) / 1000
          setElapsedSec(audio.currentTime)
          setProgress(total > 0 ? audio.currentTime / total : 0)
        }}
      />
      <button
        onClick={toggle}
        aria-label={playing ? "Pause" : "Lecture"}
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "none",
          background: isMe ? "#ffffff30" : "var(--accent-dim)",
          color: isMe ? fg : "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {playing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 3 21 12 6 21 6 3" />
          </svg>
        )}
      </button>
      <div style={{ flex: 1, minWidth: 110 }}>
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: isMe ? "#ffffff35" : "var(--border-default)",
            position: "relative",
            cursor: "pointer",
          }}
          onClick={(e) => {
            const audio = audioRef.current
            if (!audio || !Number.isFinite(audio.duration)) return
            const rect = e.currentTarget.getBoundingClientRect()
            audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${Math.min(100, progress * 100)}%`,
              borderRadius: 2,
              background: isMe ? fg : "var(--accent)",
            }}
          />
        </div>
        <div style={{ fontSize: 10, opacity: 0.75, marginTop: 4 }}>
          {playing || elapsedSec > 0
            ? formatAudioDuration(elapsedSec * 1000)
            : formatAudioDuration(durationMs)}
        </div>
      </div>
    </div>
  )
}

const SWIPE_REPLY_THRESHOLD = 56

function MessageBubble({
  msg,
  isMe,
  replyMsg,
  onReply,
  onOpenImage,
  onDelete,
  onForward,
  onCopy,
  chatColor,
  isGroup,
  senderName,
}: {
  msg: Message
  isMe: boolean
  replyMsg?: Message
  onReply: (m: Message) => void
  onOpenImage: (url: string, name?: string) => void
  onDelete: (m: Message, scope: "me" | "everyone") => void
  onForward: (m: Message) => void
  onCopy: (m: Message) => void
  chatColor: { bg: string; text: string }
  isGroup?: boolean
  senderName?: string
}) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragX, setDragX] = useState(0)
  const dragStart = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false })

  // Apercu du message cite : snapshot backend en priorite, sinon lookup local.
  const quote = msg.replySnapshot
    ? {
        content: msg.replySnapshot.isDeleted
          ? "Message supprime"
          : msg.replySnapshot.content || "[media]",
      }
    : replyMsg
      ? { content: replyMsg.content || "[media]" }
      : undefined

  const mediaSrc = msg.mediaUrl ? resolveMediaUrl(msg.mediaUrl) : ""
  const isVideoFile = (msg.mediaMime ?? "").startsWith("video/")

  // --- Swipe-to-reply (pointeur / tactile) ---
  const onPointerDown = (e: React.PointerEvent) => {
    if (msg.isDeleted) return
    dragStart.current = { x: e.clientX, y: e.clientY, active: true }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current.active) return
    const dx = e.clientX - dragStart.current.x
    const dy = Math.abs(e.clientY - dragStart.current.y)
    if (dy > 40) {
      dragStart.current.active = false
      setDragX(0)
      return
    }
    // On glisse vers la droite (messages recus) ou la gauche (mes messages).
    const directional = isMe ? Math.min(0, dx) : Math.max(0, dx)
    setDragX(Math.max(-90, Math.min(90, directional)))
  }
  const endDrag = () => {
    if (!dragStart.current.active) return
    dragStart.current.active = false
    if (Math.abs(dragX) >= SWIPE_REPLY_THRESHOLD) onReply(msg)
    setDragX(0)
  }

  const menuItem = (label: string, onClick: () => void, danger = false) => (
    <button
      key={label}
      onClick={() => {
        setMenuOpen(false)
        onClick()
      }}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 14px",
        background: "none",
        border: "none",
        color: danger ? "var(--danger)" : "var(--text-primary)",
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "'DM Sans', sans-serif",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  )

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isMe ? "flex-end" : "flex-start",
        marginBottom: 2,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setMenuOpen(false)
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          flexDirection: isMe ? "row-reverse" : "row",
          // La limite de largeur vit ICI (le parent fait 100% de la colonne) :
          // un % sur un enfant d'une rangee auto-dimensionnee ecrase la bulle
          // a sa largeur minimale (une lettre par ligne).
          maxWidth: "min(78%, 560px)",
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          transition: dragStart.current.active ? "none" : "transform 0.18s ease",
          touchAction: "pan-y",
          position: "relative",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(e) => {
          if (msg.isDeleted) return
          e.preventDefault()
          setMenuOpen((v) => !v)
        }}
      >
        {/* Indicateur de swipe */}
        {Math.abs(dragX) > 16 && (
          <div
            style={{
              position: "absolute",
              [isMe ? "right" : "left"]: -34,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--accent)",
              opacity: Math.min(1, Math.abs(dragX) / SWIPE_REPLY_THRESHOLD),
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polyline points="9 17 4 12 9 7" />
              <path d="M20 18v-2a4 4 0 00-4-4H4" />
            </svg>
          </div>
        )}

        {/* Menu actions */}
        {hovered && !msg.isDeleted && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Actions du message"
              style={{
                background: "var(--border-subtle)",
                border: "1px solid var(--border-default)",
                borderRadius: 6,
                padding: "4px 7px",
                color: "var(--text-secondary)",
                fontSize: 12,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ⋮
            </button>
            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  bottom: "110%",
                  [isMe ? "right" : "left"]: 0,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 10,
                  boxShadow: "0 12px 32px #00000060",
                  zIndex: 50,
                  padding: "4px 0",
                  minWidth: 170,
                }}
              >
                {menuItem("Repondre", () => onReply(msg))}
                {msg.content ? menuItem("Copier", () => onCopy(msg)) : null}
                {menuItem("Transferer", () => onForward(msg))}
                {menuItem("Supprimer pour moi", () => onDelete(msg, "me"), true)}
                {isMe
                  ? menuItem("Supprimer pour tous", () => onDelete(msg, "everyone"), true)
                  : null}
              </div>
            )}
          </div>
        )}

        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Nom de l'envoyeur en groupe (pas pour soi-meme) */}
          {isGroup && !isMe && senderName && !msg.isDeleted && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: senderNameColor(msg.senderId),
                marginBottom: 2,
                padding: "2px 4px 0",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {senderName}
            </div>
          )}
          {/* Citation */}
          {quote && !msg.isDeleted && (
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
              {replyMsg ? (() => {
                if (replyMsg.type === "image" && replyMsg.mediaUrl) {
                  const src = resolveMediaUrl(replyMsg.mediaUrl)
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <img src={src} alt={replyMsg.fileName ?? "image"} style={{ width: 30, height: 30, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {replyMsg.fileName ?? "Image"}
                      </span>
                    </div>
                  )
                }
                if (replyMsg.type === "video" && replyMsg.fileName) {
                  const fti = fileTypeInfo(replyMsg.fileName, replyMsg.mediaMime)
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: `${fti.color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={fti.color} strokeWidth="2" strokeLinecap="round"><polygon points="6 3 20 12 6 21 6 3" /></svg>
                      </div>
                      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Vidéo : {replyMsg.fileName}</span>
                    </div>
                  )
                }
                if (replyMsg.type === "audio" && replyMsg.fileName) {
                  const fti = fileTypeInfo(replyMsg.fileName, replyMsg.mediaMime)
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: `${fti.color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={fti.color} strokeWidth="2" strokeLinecap="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path d="M19 10v2a7 7 0 01-14 0v-2" /></svg>
                      </div>
                      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Audio : {replyMsg.fileName}</span>
                    </div>
                  )
                }
                if ((replyMsg.type === "file" || replyMsg.type === "video") && replyMsg.fileName) {
                  const fti = fileTypeInfo(replyMsg.fileName, replyMsg.mediaMime)
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: `${fti.color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 8, fontWeight: 800, color: fti.color, letterSpacing: 0.5 }}>{fti.label}</span>
                      </div>
                      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{replyMsg.fileName}</span>
                    </div>
                  )
                }
                return <span>{quote.content}</span>
              })() : <span>{quote.content}</span>}
            </div>
          )}

          {/* Bulle */}
          <div
            style={{
              background: isMe ? "var(--bubble-me-bg)" : "var(--bubble-them-bg)",
              color: isMe ? "var(--bubble-me-text)" : "var(--bubble-them-text)",
              border: isMe ? "none" : "1px solid var(--bubble-them-border)",
              boxShadow: "0 1px 1px rgba(0, 0, 0, 0.06)",
              padding: msg.type === "image" && mediaSrc ? 4 : "6px 9px 5px",
              borderRadius: isMe ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
              fontSize: 13.5,
              lineHeight: 1.4,
              wordBreak: "break-word",
              // flow-root : contient l'heure flottante facon WhatsApp
              display: "flow-root",
            }}
          >
            {msg.isDeleted ? (
              <span style={{ fontStyle: "italic", opacity: 0.65, fontSize: 12 }}>
                Ce message a ete supprime
              </span>
            ) : (
              <>
                {msg.type === "image" && mediaSrc && (
                  <img
                    src={mediaSrc}
                    alt={msg.fileName ?? "image"}
                    onClick={() => onOpenImage(mediaSrc, msg.fileName)}
                    style={{
                      maxWidth: 280,
                      maxHeight: 320,
                      borderRadius: 12,
                      display: "block",
                      cursor: "zoom-in",
                    }}
                  />
                )}

                {msg.type === "audio" && mediaSrc && (
                  <AudioPlayer src={mediaSrc} durationMs={msg.durationMs} isMe={isMe} />
                )}

                {msg.type === "video" && mediaSrc && (
                  <div style={{ marginBottom: 6 }}>
                    <video
                      src={mediaSrc}
                      controls
                      preload="metadata"
                      style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 10, display: "block" }}
                    />
                  </div>
                )}

                {msg.type === "file" && mediaSrc && isVideoFile && (
                  <video
                    src={mediaSrc}
                    controls
                    preload="metadata"
                    style={{ maxWidth: 300, maxHeight: 260, borderRadius: 10, display: "block" }}
                  />
                )}

                {msg.type === "file" && (!mediaSrc || !isVideoFile) && (() => {
                  const fti = fileTypeInfo(msg.fileName, msg.mediaMime)
                  const ext = (msg.fileName ?? "").split(".").pop()?.toLowerCase() ?? ""
                  const mime = msg.mediaMime ?? ""
                  // --- Preview du fichier ---
                  const filePreview = (() => {
                    // Même sans mediaSrc : afficher la carte d'aperçu (visible sur PC et mobile)
                    // Pour les images, PDF, CSV, DOC avec URL : on affiche le preview natif
                    // Image dans un message fichier
                    if (mediaSrc && (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext))) {
                      return (
                        <img
                          src={mediaSrc}
                          alt={msg.fileName ?? "image"}
                          style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 10, display: "block", marginBottom: 6, cursor: "zoom-in" }}
                        />
                      )
                    }
                    // PDF
                    if (mediaSrc && (ext === "pdf" || mime === "application/pdf")) {
                      return (
                        <iframe
                          src={mediaSrc}
                          title={msg.fileName ?? "Aperçu PDF"}
                          style={{ width: "100%", height: 200, borderRadius: 8, border: "none", display: "block", marginBottom: 6 }}
                          loading="lazy"
                        />
                      )
                    }
                    // CSV / texte
                    if (mediaSrc && (ext === "csv" || mime === "text/csv" || ext === "txt" || mime.startsWith("text/"))) {
                      return (
                        <iframe
                          src={mediaSrc}
                          title={msg.fileName ?? "Aperçu texte"}
                          style={{ width: "100%", height: 140, borderRadius: 8, border: "none", display: "block", marginBottom: 6, background: "#fff" }}
                          loading="lazy"
                        />
                      )
                    }
                    // Document (DOC, XLS, PPT) — aperçu via Google Docs viewer
                    if (mediaSrc && (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext) || mime.includes("word") || mime.includes("spreadsheet") || mime.includes("presentation"))) {
                      const viewerUrl = `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(mediaSrc)}`
                      return (
                        <iframe
                          src={viewerUrl}
                          title={msg.fileName ?? "Aperçu document"}
                          style={{ width: "100%", height: 200, borderRadius: 8, border: "none", display: "block", marginBottom: 6 }}
                          loading="lazy"
                        />
                      )
                    }
                    // Vidéo dans un message fichier
                    if (mediaSrc && (ext === "mp4" || ext === "mov" || ext === "avi" || ext === "mkv" || ext === "webm" || mime.startsWith("video/"))) {
                      return (
                        <video
                          src={mediaSrc}
                          controls
                          preload="metadata"
                          style={{ width: "100%", maxHeight: 220, borderRadius: 10, display: "block", marginBottom: 6 }}
                        />
                      )
                    }
                    // Carte d'aperçu visible même avant le téléchargement (sans mediaSrc)
                    return (
                      <a
                        href={mediaSrc ? mediaSrc : "#"}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 12px", borderRadius: 10, marginBottom: 6,
                          background: isMe ? "#ffffff12" : "var(--bg-elevated)",
                          border: `1px solid ${isMe ? "#ffffff18" : "var(--border-subtle)"}`,
                          textDecoration: "none", color: "inherit",
                          width: "100%",
                        }}
                      >
                        <div style={{
                          width: 48, height: 48, borderRadius: 10,
                          background: `${fti.color}18`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                        }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={fti.color} strokeWidth="2" strokeLinecap="round">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {msg.fileName ?? msg.content ?? "Fichier"}
                          </div>
                          {msg.fileSize && <div style={{ fontSize: 10, opacity: 0.7 }}>{msg.fileSize}</div>}
                          <div style={{ fontSize: 9, opacity: 0.6, marginTop: 2 }}>
                            {mediaSrc ? "Aperçu disponible" : "Aperçu disponible après chargement"}
                          </div>
                        </div>
                      </a>
                    )
                  })()
                  return (
                    <>
                      {filePreview}
                      <a
                        href={msg.mediaUrl ? resolveMediaUrl(msg.mediaUrl, { download: true }) : "#"}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          minWidth: 200, color: "inherit", textDecoration: "none",
                        }}
                      >
                        <div style={{
                          width: 40, height: 40, borderRadius: 8,
                          background: `${fti.color}18`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0, flexDirection: "column", gap: 1,
                        }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={fti.color} strokeWidth="2" strokeLinecap="round">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span style={{ fontSize: 7, fontWeight: 700, color: fti.color, letterSpacing: 0.5 }}>{fti.label}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {msg.fileName ?? msg.content ?? "Fichier"}
                          </div>
                          {msg.fileSize && <div style={{ fontSize: 10, opacity: 0.7 }}>{msg.fileSize}</div>}
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                      </a>
                    </>
                  )
                })()}

                {msg.content && msg.type !== "file" && msg.type !== "audio" && (
                  <span
                    style={
                      msg.type === "image"
                        ? { display: "block", padding: "6px 8px 4px" }
                        : undefined
                    }
                  >
                    <RichText text={msg.content} isMe={isMe} />
                    {(() => {
                      const gps = extractGpsCoords(msg.content)
                      return gps ? <GpsPreview lat={gps.lat} lng={gps.lng} isMe={isMe} /> : null
                    })()}
                  </span>
                )}
              </>
            )}

            {/* Heure + coches a l'interieur de la bulle, en bas a droite (WhatsApp).
                float: right -> le texte court reste sur la meme ligne, le texte
                long passe au-dessus ; le parent en flow-root contient le flottant. */}
            {!msg.isDeleted && (
              <span
                style={{
                  float: "right",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  marginLeft: 8,
                  transform: "translateY(4px)",
                  fontSize: 10,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  color: isMe ? "rgba(255, 255, 255, 0.75)" : "var(--text-faint)",
                }}
              >
                {formatTime(msg.timestamp)}
                {isMe && <StatusIcon status={msg.status} />}
              </span>
            )}
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
  const { error, success } = useToast()

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
  // Appels passes dans cette conversation, affiches dans le fil (facon WhatsApp)
  const [callEvents, setCallEvents] = useState<CallRecord[]>([])
  const [input, setInput] = useState("")
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  // typing de l'interlocuteur (recu via WebSocket)
  const [isTyping, setIsTyping] = useState(false)
  // Presence deduite de l'activite reelle (message recu, frappe, lecture) :
  // le backend ne diffuse pas de presence, on ne peut donc jamais affirmer "hors ligne".
  const [lastPeerActivity, setLastPeerActivity] = useState<number | null>(null)
  const [presenceTick, setPresenceTick] = useState(0)
  const [sending, setSending] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  // Visionneuse d'image plein ecran
  const [lightbox, setLightbox] = useState<{ url: string; name?: string } | null>(null)
  // Message en cours de transfert (ouvre le selecteur de conversations)
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null)
  // Enregistrement vocal en cours
  const [recording, setRecording] = useState(false)
  const [recordSec, setRecordSec] = useState(0)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout>>()
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordCancelledRef = useRef(false)

  const refreshMessages = useCallback(async () => {
    await fetchMessagesCacheFirst(
      chatId,
      // onCached : affichage instantané depuis IndexedDB (~2ms)
      (cached) => {
        setMessages((prev) => {
          const pending = prev.filter(
            (m) => m.id.startsWith("tmp-") && !cached.some((saved) => saved.id === m.id)
          )
          return [...cached, ...pending]
        })
      },
      // onFresh : mise à jour silencieuse avec les données réseau
      (fresh) => {
        setMessages((prev) => {
          const pending = prev.filter(
            (m) => m.id.startsWith("tmp-") && !fresh.some((saved) => saved.id === m.id)
          )
          return [...fresh, ...pending]
        })
      }
    )
  }, [chatId])

  // Evenements d'appel de cette conversation (pastilles dans le fil).
  const refreshCallEvents = useCallback(async () => {
    try {
      setCallEvents(await fetchCallsForConversation(chatId))
    } catch {
      // non bloquant : le fil de messages reste utilisable sans l'historique d'appels
    }
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
    void refreshCallEvents()

    // Temps reel : abonnement aux nouveaux messages de la conversation
    const myId = getMyUserId()
    const unsubscribeMessages = subscribeToConversation(chatId, (message) => {
      if (cancelled) return
      const incoming = toFrontMessage(message, myId)
      // Persiste le message entrant en IndexedDB
      void persistIncomingWsMessage(message)
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev
        return [...prev, incoming]
      })
      if (incoming.senderId !== "me") {
        setLastPeerActivity(Date.now())
        void markChatAsRead(chatId)
      }
    })

    // Abonnement aux evenements "en train d'ecrire"
    let typingTimeoutId: ReturnType<typeof setTimeout> | null = null
    const unsubscribeTyping = subscribeToTyping(chatId, (event) => {
      if (cancelled) return
      // Ignore ses propres evenements
      if (myId && event.userId === myId) return
      setLastPeerActivity(Date.now())
      setIsTyping(Boolean(event.isTyping))
      if (typingTimeoutId) clearTimeout(typingTimeoutId)
      // Failsafe : si on ne recoit pas le "stopped typing", on coupe apres 4s
      if (event.isTyping) {
        typingTimeoutId = setTimeout(() => setIsTyping(false), 4000)
      }
    })

    // Abonnement aux accuses de lecture : l'autre a ouvert la conversation,
    // tous nos messages envoyes passent en "lu".
    const unsubscribeStatus = subscribeToStatus(chatId, (event) => {
      if (cancelled) return
      if (myId && event.readBy === myId) return // c'est nous qui avons lu
      setLastPeerActivity(Date.now())
      setMessages((prev) =>
        prev.map((m) => (m.senderId === "me" && m.status !== "read" ? { ...m, status: "read" } : m))
      )
    })

    // Abonnement aux suppressions de messages (pour moi / pour tous)
    const unsubscribeDeleted = subscribeToMessageDeleted(chatId, (event) => {
      if (cancelled) return
      // Supprime aussi du cache IndexedDB
      void removeMessageFromDB(event.messageId)
      setMessages((prev) =>
        event.scope === "me"
          ? prev.filter((m) => m.id !== event.messageId)
          : prev.map((m) =>
              m.id === event.messageId
                ? { ...m, isDeleted: true, content: "", mediaUrl: undefined }
                : m
            )
      )
    })

    // Apres une coupure du WebSocket, on recharge l'historique pour rattraper
    // les messages arrives pendant la deconnexion.
    // Après reconnexion WS : delta sync — on ne recharge que les messages
    // plus récents que le dernier connu (au lieu de tout recharger).
    const unsubscribeConnected = subscribeToWsConnected(() => {
      if (cancelled) return
      void refreshMessages().catch(() => undefined)
      void markChatAsRead(chatId)
    })

    // Filet de securite : si le WebSocket de L'AUTRE participant est degrade
    // (4G capricieuse), ses messages partent en REST sans diffusion temps reel.
    // On resynchronise donc la conversation ouverte toutes les 10 s (onglet
    // visible uniquement) pour que rien ne reste bloque.
    // Intervalle augmenté de 10s → 30s car le cache IndexedDB est fiable
    // et le WebSocket gère les messages temps réel
    const pollId = setInterval(() => {
      if (cancelled || document.hidden) return
      void refreshMessages().catch(() => undefined)
      void refreshCallEvents()
    }, 30_000)

    // Quand on ouvre la conv, on marque tout comme lu
    void markChatAsRead(chatId)

    return () => {
      cancelled = true
      unsubscribeMessages()
      unsubscribeTyping()
      unsubscribeStatus()
      unsubscribeDeleted()
      unsubscribeConnected()
      clearInterval(pollId)
      if (typingTimeoutId) clearTimeout(typingTimeoutId)
    }
  }, [chat, chatId, refreshMessages, refreshCallEvents, fallbackContact, fallbackGroup])

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

  // Reevalue la presence toutes les 30 s (pour faire expirer le "En ligne").
  useEffect(() => {
    if (lastPeerActivity === null) return
    const id = setInterval(() => setPresenceTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [lastPeerActivity])

  // "En ligne" si activite reelle (message, frappe, lecture) dans les 2 dernieres minutes.
  void presenceTick
  const peerOnline = lastPeerActivity !== null && Date.now() - lastPeerActivity < 2 * 60 * 1000

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
    clearTimeout(typingTimer.current)
    publishTyping(chatId, false)

    try {
      const saved = await sendChatMessage(chatId, text, "text", { replyToId: replyTo?.id })
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

    publishTyping(chatId, true)
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      publishTyping(chatId, false)
    }, 1500)
  }

  // Envoie un blob/fichier : upload vers /api/media puis message avec mediaId.
  const sendMediaMessage = useCallback(
    async (
      file: File | Blob,
      filename: string,
      mime: string,
      msgType: "image" | "audio" | "file" | "video",
      durationMs?: number
    ) => {
      const tempId = `tmp-${Date.now()}`
      const optimistic: Message = {
        id: tempId,
        senderId: "me",
        content: "",
        type: msgType,
        status: "sending",
        timestamp: new Date(),
        fileName: filename,
        fileSize: `${(file.size / 1024 / 1024).toFixed(1)} Mo`,
        mediaMime: mime,
        durationMs,
      }
      setMessages((prev) => [...prev, optimistic])

      try {
        const media = await uploadMedia(file, filename, durationMs)
        const saved = await sendChatMessage(chatId, "", msgType, {
          mediaId: media.id,
          replyToId: replyTo?.id,
        })
        setReplyTo(null)
        setMessages((prev) => {
          const alreadyReceived = prev.some((m) => m.id === saved.id)
          if (alreadyReceived) return prev.filter((m) => m.id !== tempId)
          return prev.map((m) => (m.id === tempId ? saved : m))
        })
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        const message = err instanceof Error ? err.message : "Envoi du fichier impossible."
        error("Fichier non envoye", message)
      }
    },
    [chatId, replyTo, error]
  )

  // Selection de fichier (photo, document, audio) — supporte la selection multiple
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setShowAttach(false)
    const toSend = Array.from(files)
    const oversized = toSend.filter((f) => f.size > 50 * 1024 * 1024)
    if (oversized.length > 0) {
      error("Fichier(s) trop volumineux", `${oversized.length} fichier(s) depassent 50 Mo et seront ignores.`)
    }
    const valid = toSend.filter((f) => f.size <= 50 * 1024 * 1024)
    for (const file of valid) {
      const msgType = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("audio/")
          ? "audio"
          : file.type.startsWith("video/")
            ? "video"
            : "file"
      void sendMediaMessage(file, file.name, file.type || "application/octet-stream", msgType)
    }
    e.target.value = ""
  }

  // --- Vocaux (MediaRecorder), comme sur WhatsApp ---
  const startRecording = async () => {
    if (recording) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      error("Micro inaccessible", "Autorisez le micro pour envoyer un vocal.")
      return
    }

    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : ""
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream)
    recorderRef.current = recorder
    recordChunksRef.current = []
    recordCancelledRef.current = false
    setRecordSec(0)
    setRecording(true)
    recordTimerRef.current = setInterval(() => setRecordSec((s) => s + 1), 1000)

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordChunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current)
        recordTimerRef.current = null
      }
      setRecording(false)

      if (recordCancelledRef.current) return
      // Le backend valide le MIME exact : on retire le suffixe ";codecs=..." du navigateur.
      const type = (recorder.mimeType || "audio/webm").split(";")[0]
      const blob = new Blob(recordChunksRef.current, { type })
      if (blob.size === 0) return
      const ext = type.includes("mp4") ? "m4a" : "webm"
      const durationMs = recordChunksRef.current.length > 0 ? recordSecRef.current * 1000 : 0
      void sendMediaMessage(blob, `vocal-${Date.now()}.${ext}`, type, "audio", durationMs)
    }

    recorder.start()
  }

  // La duree est lue dans onstop : on la garde dans une ref pour eviter une closure figee.
  const recordSecRef = useRef(0)
  useEffect(() => {
    recordSecRef.current = recordSec
  }, [recordSec])

  const stopRecording = (cancelled: boolean) => {
    recordCancelledRef.current = cancelled
    recorderRef.current?.stop()
    recorderRef.current = null
  }

  useEffect(() => {
    return () => {
      // Nettoyage si on quitte la page en plein enregistrement.
      recordCancelledRef.current = true
      recorderRef.current?.stop()
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    }
  }, [])

  // --- Actions sur un message ---
  const handleCopy = (msg: Message) => {
    void navigator.clipboard
      .writeText(msg.content)
      .then(() => success("Copie", "Message copie dans le presse-papiers."))
      .catch(() => error("Copie impossible", "Le presse-papiers est inaccessible."))
  }

  const handleDelete = (msg: Message, scope: "me" | "everyone") => {
    deleteChatMessage(msg.id, scope)
    // L'evenement message_deleted confirmera ; mise a jour optimiste immediate.
    setMessages((prev) =>
      scope === "me"
        ? prev.filter((m) => m.id !== msg.id)
        : prev.map((m) =>
            m.id === msg.id ? { ...m, isDeleted: true, content: "", mediaUrl: undefined } : m
          )
    )
  }

  // Demarre un appel WebRTC dans cette conversation puis ouvre la salle d'appel.
  const startCallFromChat = (callType: "audio" | "video") => {
    void startOutgoingCall(chatId, callType, chat?.name ?? "Contact")
      .then((newCallId) => {
        navigate(`/calls/${newCallId}?type=${callType}&returnTo=${encodeURIComponent(returnTo)}`)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Impossible de demarrer l'appel."
        error("Appel impossible", message)
      })
  }

  // Fil unifie : messages + evenements d'appel (facon WhatsApp), tries par date.
  type TimelineItem =
    | { kind: "msg"; ts: Date; msg: Message }
    | { kind: "call"; ts: Date; call: CallRecord }
  const timeline: TimelineItem[] = [
    ...messages.map((msg): TimelineItem => ({ kind: "msg", ts: msg.timestamp, msg })),
    ...callEvents.map((call): TimelineItem => ({ kind: "call", ts: call.ts, call })),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime())

  // Grouper par date
  const grouped = timeline.reduce<{ date: string; items: TimelineItem[] }[]>((acc, item) => {
    const dateStr = formatDateSeparator(item.ts)
    const last = acc[acc.length - 1]
    if (!last || last.date !== dateStr) acc.push({ date: dateStr, items: [item] })
    else last.items.push(item)
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

        <div
          className="room-av"
          style={{ background: color.bg, color: color.text, overflow: "hidden" }}
        >
          {avatarDisplaySrc((chat as { avatar?: string | null }).avatar) ? (
            <img
              src={avatarDisplaySrc((chat as { avatar?: string | null }).avatar)!}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
            />
          ) : (
            chat.initials
          )}
          {peerOnline && !chat.isGroup && <div className="room-av-dot" />}
        </div>

        <div className="room-info">
          <div className="room-name">{chat.name}</div>
          <div
            className="room-sub"
            style={{
              color: isTyping
                ? "var(--accent)"
                : peerOnline
                  ? "var(--success)"
                  : "var(--text-muted)",
            }}
          >
            {/* Le backend ne diffuse pas de presence : on affiche "En ligne" sur
                activite recente, et rien (plutot qu'un faux "Hors ligne") sinon. */}
            {isTyping
              ? "en train d'ecrire..."
              : chat.isGroup
                ? `${chat.members?.length ?? 0} membres`
                : peerOnline
                  ? "En ligne"
                  : " "}
          </div>
        </div>

        <div className="room-actions">
          {/* Appel audio */}
          <button
            className="action-btn"
            aria-label="Appel audio"
            title="Appel audio"
            onClick={() => startCallFromChat("audio")}
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
            onClick={() => startCallFromChat("video")}
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
        {grouped.map(({ date, items }) => (
          <div key={date}>
            <div className="date-sep">
              <div className="date-sep-line" />
              <div className="date-sep-txt">{date}</div>
              <div className="date-sep-line" />
            </div>

            {items.map((item) => {
              if (item.kind === "call") {
                return <CallEventChip key={`call-${item.call.id}`} call={item.call} />
              }
              const msg = item.msg
              const isMe = msg.senderId === "me"
              const reply = msg.replyTo ? messages.find((m) => m.id === msg.replyTo) : undefined
              // Resoudre le nom de l'envoyeur pour les groupes
              const resolvedName = !isMe && chat?.isGroup
                ? (() => {
                    const backendMember = chat.membersInfo?.find((m: { id: string; pseudo?: string | null; publicNumber?: string }) => m.id === msg.senderId)
                    if (backendMember?.pseudo) return backendMember.pseudo
                    if (backendMember?.publicNumber) return backendMember.publicNumber
                    return contacts.find((c) => c.id === msg.senderId)?.name ?? msg.senderId.slice(0, 8)
                  })()
                : undefined
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isMe={isMe}
                  replyMsg={reply}
                  onReply={setReplyTo}
                  onOpenImage={(url, name) => setLightbox({ url, name })}
                  onDelete={handleDelete}
                  onForward={setForwardMsg}
                  onCopy={handleCopy}
                  chatColor={color}
                  isGroup={chat?.isGroup}
                  senderName={resolvedName}
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
          multiple
          style={{ display: "none" }}
          onChange={handleFileSelect}
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
                  fileRef.current!.accept = ".mp4,.mov,.avi,.mkv,.webm"
                  fileRef.current!.click()
                }}
              >
                <div
                  className="attach-icon"
                  style={{ background: "#8b5cf620", color: "#8b5cf6" }}
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
                    <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
                  </svg>
                </div>
                Vidéo
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
              <button
                className="attach-opt"
                onClick={() => {
                  fileRef.current!.accept = "*/*"
                  fileRef.current!.click()
                }}
              >
                <div
                  className="attach-icon"
                  style={{ background: "#6b728020", color: "#6b7280" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                </div>
                Tout fichier
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

          {recording ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "8px 12px",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "var(--danger)",
                  animation: "pulse 1.2s ease-in-out infinite",
                }}
              />
              <span
                style={{
                  color: "var(--text-primary)",
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatAudioDuration(recordSec * 1000)}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 12, flex: 1 }}>
                Enregistrement du vocal...
              </span>
              <button
                onClick={() => stopRecording(true)}
                aria-label="Annuler le vocal"
                style={{
                  background: "none",
                  border: "1px solid var(--border-default)",
                  borderRadius: 8,
                  padding: "6px 12px",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Annuler
              </button>
              <button
                className="send-btn"
                onClick={() => stopRecording(false)}
                aria-label="Envoyer le vocal"
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
          ) : (
            <>
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

              {input.trim() ? (
                <button
                  className="send-btn"
                  onClick={sendMessage}
                  disabled={sending}
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
              ) : (
                <button
                  className="send-btn"
                  onClick={() => void startRecording()}
                  aria-label="Enregistrer un vocal"
                  title="Enregistrer un message vocal"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--bg-base)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>
        <div className="input-hint">
          Entree pour envoyer - Shift+Entree pour sauter une ligne - Max 50 Mo par fichier
        </div>
      </div>

      {/* Visionneuse d'image plein ecran */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9000,
            background: "#000000d9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            cursor: "zoom-out",
          }}
        >
          <img
            src={lightbox.url}
            alt={lightbox.name ?? "image"}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "92vw",
              maxHeight: "88vh",
              borderRadius: 8,
              boxShadow: "0 24px 80px #000000a0",
              cursor: "default",
            }}
          />
          <div style={{ position: "absolute", top: 16, right: 16, display: "flex", gap: 10 }}>
            <a
              href={lightbox.url.includes("?") ? `${lightbox.url}&download=1` : lightbox.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="Telecharger l'image"
              style={{
                background: "#ffffff20",
                border: "none",
                borderRadius: 8,
                padding: "8px 10px",
                color: "#fff",
                display: "flex",
                alignItems: "center",
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            </a>
            <button
              onClick={() => setLightbox(null)}
              aria-label="Fermer"
              style={{
                background: "#ffffff20",
                border: "none",
                borderRadius: 8,
                padding: "8px 10px",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              <svg
                width="18"
                height="18"
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
        </div>
      )}

      {/* Selecteur de conversations pour le transfert */}
      {forwardMsg && (
        <ForwardDialog
          onClose={() => setForwardMsg(null)}
          onForward={async (convIds) => {
            try {
              const count = await forwardChatMessage(forwardMsg.id, convIds)
              success("Message transfere", `Envoye dans ${count} conversation(s).`)
            } catch (err) {
              const message = err instanceof Error ? err.message : "Transfert impossible."
              error("Transfert echoue", message)
            } finally {
              setForwardMsg(null)
            }
          }}
        />
      )}
    </div>
  )
}

/** Modal de selection des conversations cibles pour transferer un message. */
function ForwardDialog({
  onClose,
  onForward,
}: {
  onClose: () => void
  onForward: (convIds: string[]) => Promise<void>
}) {
  const [conversations, setConversations] = useState<
    Array<{ id: string; name: string; initials: string }>
  >([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchChatConversations().then((list) => {
      if (cancelled) return
      setConversations(list.map((c) => ({ id: c.id, name: c.name, initials: c.initials })))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 8500,
        background: "var(--overlay)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          boxShadow: "0 24px 64px #00000080",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid var(--border-subtle)",
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 800,
            fontSize: 17,
            color: "var(--text-primary)",
          }}
        >
          Transferer vers...
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {loading && (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              Chargement...
            </div>
          )}
          {!loading && conversations.length === 0 && (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              Aucune conversation disponible.
            </div>
          )}
          {conversations.map((conv) => (
            <label
              key={conv.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                borderRadius: 10,
                cursor: "pointer",
                background: selected.has(conv.id) ? "var(--accent-dim)" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(conv.id)}
                onChange={() => toggle(conv.id)}
              />
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: "var(--accent-dim)",
                  color: "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {conv.initials}
              </span>
              <span style={{ color: "var(--text-primary)", fontSize: 13 }}>{conv.name}</span>
            </label>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            padding: 14,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              padding: "8px 14px",
              color: "var(--text-secondary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Annuler
          </button>
          <button
            disabled={selected.size === 0 || sending}
            onClick={() => {
              setSending(true)
              void onForward(Array.from(selected))
            }}
            style={{
              background: "var(--accent)",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              color: "var(--accent-text)",
              fontSize: 12,
              fontWeight: 600,
              cursor: selected.size === 0 || sending ? "not-allowed" : "pointer",
              opacity: selected.size === 0 || sending ? 0.6 : 1,
            }}
          >
            {sending ? "Transfert..." : `Transferer (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
