import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useCallState } from "../hooks/use-call"
import { hangUp, restoreActiveCall, toggleMicrophone } from "../services/call-manager"
import { toInitials } from "../data/session-user"
import { avatarDisplaySrc } from "../lib/avatar"

/**
 * Fenetre d'appel reduite — lecteur persistant qui conserve les sorties
 * audio/video WebRTC quand l'ecran d'appel est demonte (clic sur « Chat »).
 *
 * Une seule presentation, identique sur grand et petit ecran : une carte
 * flottante deplacable. En audio, elle reprend le fond motif des discussions
 * avec la photo et le pseudo de l'interlocuteur ; en video, le flux distant.
 */
export function ActiveCallFloating() {
  const call = useCallState()
  const navigate = useNavigate()
  const localVideo = useRef<HTMLVideoElement>(null)

  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [pip, setPip] = useState({ x: 0, y: 0 })
  const drag = useRef({ x: 0, y: 0, ox: 0, oy: 0, on: false })
  const pipDrag = useRef({ x: 0, y: 0, ox: 0, oy: 0, on: false })

  const remoteEntries = Object.entries(call.remoteStreams)
  const remote = remoteEntries[0]?.[1]

  useEffect(() => {
    if (localVideo.current && call.localStream) localVideo.current.srcObject = call.localStream
  }, [call.localStream])

  if (!call.activeCallId || call.displayMode !== "compact") return null

  const showRemoteVideo = call.callType === "video" && Boolean(remote)
  const peerName = call.peerName || "Appel"
  const peerAvatar = avatarDisplaySrc(call.peerAvatarUrl)

  const restore = () => {
    const id = call.activeCallId
    restoreActiveCall()
    requestAnimationFrame(() => navigate(`/calls/${id}?type=${call.callType}`, { replace: true }))
  }

  return (
    <div
      className="active-call-floating"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      role="dialog"
      aria-label={`Appel en cours avec ${peerName}`}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y, on: true }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d.on) setPos({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })
      }}
      onPointerUp={() => {
        drag.current.on = false
      }}
    >
      {/* Sorties audio des participants : conservees meme sans video affichee. */}
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
                ref={localVideo}
                style={{ transform: `translate(${pip.x}px, ${pip.y}px) scaleX(-1)` }}
                onPointerDown={(e) => {
                  pipDrag.current = { x: e.clientX, y: e.clientY, ox: pip.x, oy: pip.y, on: true }
                  e.currentTarget.setPointerCapture(e.pointerId)
                  e.stopPropagation()
                }}
                onPointerMove={(e) => {
                  const d = pipDrag.current
                  if (d.on) setPip({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })
                }}
                onPointerUp={() => {
                  pipDrag.current.on = false
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
              {peerAvatar ? <img src={peerAvatar} alt="" /> : toInitials(peerName)}
            </div>
            <b>{peerName}</b>
            <span>{call.callType === "video" ? "Appel video" : "Appel en cours"}</span>
          </div>
        )}
      </div>

      {/* Commandes toujours visibles : elles n'apparaissaient qu'apres un clic
          sur la fenetre, ce qui les rendait introuvables. */}
      <div className="active-call-controls" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={restore} title="Revenir a l'ecran d'appel">
          Retour appel
        </button>
        <button
          onClick={() => toggleMicrophone()}
          aria-pressed={!call.micOn}
          title={call.micOn ? "Couper le micro" : "Reactiver le micro"}
        >
          {call.micOn ? "Muet" : "Micro"}
        </button>
        <button className="end" onClick={() => void hangUp()} title="Raccrocher">
          Raccrocher
        </button>
      </div>
    </div>
  )
}
