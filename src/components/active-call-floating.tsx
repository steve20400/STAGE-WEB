import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useCallState } from "../hooks/use-call"
import { hangUp, restoreActiveCall, toggleMicrophone } from "../services/call-manager"
import { toInitials } from "../data/session-user"
import { avatarDisplaySrc } from "../lib/avatar"

/**
 * Bulle d'appel flottante — lecteur persistant qui garde les sorties
 * audio/video WebRTC quand l'ecran d'appel est demonte.
 *
 * Comportement facon WhatsApp Web : la carte flotte au-dessus de l'espace de
 * travail, se deplace a la souris (poignee = barre de titre) et bascule entre
 * deux tailles. Elle reste toujours entierement visible : la position est
 * bornee a la fenetre, y compris apres un redimensionnement.
 */

const MARGIN = 16

const SIZES = {
  reduced: { width: 300, height: 210 },
  expanded: { width: 460, height: 320 },
} as const

type BubbleSize = keyof typeof SIZES

function clampToViewport(x: number, y: number, width: number, height: number) {
  const maxX = Math.max(MARGIN, window.innerWidth - width - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - height - MARGIN)
  return {
    x: Math.min(Math.max(MARGIN, x), maxX),
    y: Math.min(Math.max(MARGIN, y), maxY),
  }
}

export function ActiveCallFloating() {
  const call = useCallState()
  const navigate = useNavigate()

  const [size, setSize] = useState<BubbleSize>("reduced")
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [pip, setPip] = useState({ x: 0, y: 0 })

  const drag = useRef({ dx: 0, dy: 0, active: false })
  const pipDrag = useRef({ x: 0, y: 0, ox: 0, oy: 0, active: false })
  const localVideoRef = useRef<HTMLVideoElement>(null)

  const remoteEntries = Object.entries(call.remoteStreams)
  const remote = remoteEntries[0]?.[1]
  const isVisible = Boolean(call.activeCallId) && call.displayMode === "compact"
  const { width, height } = SIZES[size]

  useEffect(() => {
    if (localVideoRef.current && call.localStream) localVideoRef.current.srcObject = call.localStream
  }, [call.localStream, isVisible])

  // Position de depart : en bas a droite, comme la fenetre d'appel de WhatsApp Web.
  useLayoutEffect(() => {
    if (!isVisible) return
    setPos((current) =>
      current
        ? clampToViewport(current.x, current.y, width, height)
        : clampToViewport(window.innerWidth - width - MARGIN, window.innerHeight - height - MARGIN, width, height)
    )
  }, [isVisible, width, height])

  // La bulle ne doit jamais se retrouver hors champ apres un redimensionnement.
  useEffect(() => {
    if (!isVisible) return
    const onResize = () =>
      setPos((current) => (current ? clampToViewport(current.x, current.y, width, height) : current))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [isVisible, width, height])

  // Le handler de deplacement lit la taille courante sans se re-creer a chaque rendu.
  const sizeRef = useRef<BubbleSize>(size)
  sizeRef.current = size

  const onHeadPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!pos) return
      drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y, active: true }
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [pos]
  )

  const onHeadPointerMove = useCallback((event: React.PointerEvent) => {
    if (!drag.current.active) return
    setPos(
      clampToViewport(
        event.clientX - drag.current.dx,
        event.clientY - drag.current.dy,
        SIZES[sizeRef.current].width,
        SIZES[sizeRef.current].height
      )
    )
  }, [])

  const endDrag = useCallback(() => {
    drag.current.active = false
    setDragging(false)
  }, [])

  if (!isVisible || !pos) return null

  const videoCall = call.callType === "video"
  const showRemoteVideo = videoCall && Boolean(remote)
  const peerAvatar = avatarDisplaySrc(call.peerAvatarUrl)

  const restore = () => {
    const id = call.activeCallId
    restoreActiveCall()
    requestAnimationFrame(() => navigate(`/calls/${id}?type=${call.callType}`, { replace: true }))
  }

  return (
    <div
      className={`active-call-floating${dragging ? " dragging" : ""}`}
      style={{ left: pos.x, top: pos.y, width, height }}
      role="dialog"
      aria-label="Appel en cours"
    >
      {/* Sorties audio : conservees meme quand la video n'est pas affichee. */}
      {remoteEntries.map(([id, stream]) => (
        <audio
          key={id}
          autoPlay
          ref={(el) => {
            if (el && el.srcObject !== stream) {
              el.srcObject = stream
              void el.play().catch(() => undefined)
            }
          }}
        />
      ))}

      <div
        className="active-call-head"
        onPointerDown={onHeadPointerDown}
        onPointerMove={onHeadPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="active-call-head-title">{call.peerName || "Appel"}</span>
        <button
          className="active-call-head-btn"
          onClick={() => setSize((v) => (v === "reduced" ? "expanded" : "reduced"))}
          aria-label={size === "reduced" ? "Agrandir la fenetre d'appel" : "Reduire la fenetre d'appel"}
          title={size === "reduced" ? "Agrandir" : "Reduire"}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {size === "reduced" ? (
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            ) : (
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" />
            )}
          </svg>
        </button>
      </div>

      <div className="active-call-content">
        {showRemoteVideo ? (
          <>
            <video
              ref={(el) => {
                if (el && remote && el.srcObject !== remote) {
                  el.srcObject = remote
                  void el.play().catch(() => undefined)
                }
              }}
              autoPlay
              playsInline
            />
            {call.localStream && call.camOn && (
              <video
                className="active-call-local-pip"
                ref={localVideoRef}
                style={{ transform: `translate(${pip.x}px, ${pip.y}px) scaleX(-1)` }}
                onPointerDown={(e) => {
                  pipDrag.current = { x: e.clientX, y: e.clientY, ox: pip.x, oy: pip.y, active: true }
                  e.currentTarget.setPointerCapture(e.pointerId)
                  e.stopPropagation()
                }}
                onPointerMove={(e) => {
                  const d = pipDrag.current
                  if (d.active) setPip({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })
                }}
                onPointerUp={() => {
                  pipDrag.current.active = false
                }}
                autoPlay
                playsInline
                muted
              />
            )}
          </>
        ) : (
          <div className="active-call-audio">
            <div className="active-call-avatar">
              {/* Photo reelle si disponible ; initiales sinon. */}
              {peerAvatar ? <img src={peerAvatar} alt="" /> : toInitials(call.peerName || "Appel")}
            </div>
            <b>{call.peerName || "Appel"}</b>
            <span>{videoCall ? "Appel video" : "Appel en cours"}</span>
          </div>
        )}
      </div>

      <div className="active-call-controls">
        <button onClick={restore}>Retour appel</button>
        <button onClick={() => toggleMicrophone()}>{call.micOn ? "Muet" : "Micro"}</button>
        <button className="end" onClick={() => void hangUp()}>
          Raccrocher
        </button>
      </div>
    </div>
  )
}
