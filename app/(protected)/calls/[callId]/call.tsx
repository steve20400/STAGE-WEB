import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useCallState } from "../../../../src/hooks/use-call"
import {
  acknowledgeCallEnded,
  hangUp as hangUpCall,
  toggleCamera,
  toggleMicrophone,
} from "../../../../src/services/call-manager"
import { toInitials } from "../../../../src/data/session-user"
import "./call-room-page.css"

type CallScreenState = "ringing" | "active" | "ended"

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export default function CallRoomPage() {
  const navigate = useNavigate()
  const { callId } = useParams<{ callId?: string }>()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get("returnTo") || "/calls"

  const call = useCallState()

  const isOurCall = call.activeCallId !== null && call.activeCallId === callId
  const remoteStreamEntries = useMemo(
    () => Object.entries(call.remoteStreams),
    [call.remoteStreams]
  )
  const hasRemote = remoteStreamEntries.length > 0

  const callState: CallScreenState = !isOurCall
    ? "ended"
    : call.role === "outgoing" && !hasRemote
      ? "ringing"
      : "active"

  const isVideo = call.callType === "video"
  const peerName = call.peerName || "Contact"
  const peerInitials = toInitials(peerName)

  const [elapsed, setElapsed] = useState(0)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [showEndConfirm, setShowEndConfirm] = useState(false)

  const liveTimerRef = useRef<number | null>(null)
  const showControlsTimerRef = useRef<number | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteAudioRefs = useRef<Map<string, HTMLAudioElement>>(new Map())

  // Chronometre pendant l'appel actif
  useEffect(() => {
    if (callState !== "active") {
      if (liveTimerRef.current !== null) {
        window.clearInterval(liveTimerRef.current)
        liveTimerRef.current = null
      }
      return
    }
    liveTimerRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => {
      if (liveTimerRef.current !== null) {
        window.clearInterval(liveTimerRef.current)
        liveTimerRef.current = null
      }
    }
  }, [callState])

  // Appel termine (par nous ou a distance) : petit ecran de fin puis retour.
  useEffect(() => {
    if (callState !== "ended") return
    leaveTimerRef.current = window.setTimeout(() => {
      acknowledgeCallEnded()
      navigate(returnTo)
    }, 1600)
    return () => {
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current)
    }
  }, [callState, navigate, returnTo])

  // Branche le flux local sur l'apercu video (PiP)
  useEffect(() => {
    if (localVideoRef.current && call.localStream) {
      localVideoRef.current.srcObject = call.localStream
    }
  }, [call.localStream, callState, call.camOn])

  // Branche le premier flux distant sur la grande video
  useEffect(() => {
    if (remoteVideoRef.current && remoteStreamEntries.length > 0) {
      remoteVideoRef.current.srcObject = remoteStreamEntries[0][1]
    }
  }, [remoteStreamEntries, callState])

  // Volume des sorties audio distantes (haut-parleur on/off)
  useEffect(() => {
    for (const audio of remoteAudioRefs.current.values()) {
      audio.muted = !speakerOn
    }
    if (remoteVideoRef.current) remoteVideoRef.current.muted = !speakerOn
  }, [speakerOn, remoteStreamEntries])

  const resetHideTimer = useCallback(() => {
    setControlsVisible(true)
    if (showControlsTimerRef.current !== null) {
      window.clearTimeout(showControlsTimerRef.current)
      showControlsTimerRef.current = null
    }
    if (isVideo && callState === "active") {
      showControlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 4000)
    }
  }, [isVideo, callState])

  useEffect(() => {
    resetHideTimer()
    return () => {
      if (showControlsTimerRef.current !== null) {
        window.clearTimeout(showControlsTimerRef.current)
        showControlsTimerRef.current = null
      }
    }
  }, [resetHideTimer])

  const doHangUp = useCallback(() => {
    setShowEndConfirm(false)
    void hangUpCall()
  }, [])

  const stateLabel: Record<CallScreenState, string> = {
    ringing: "Appel en cours...",
    active: formatElapsed(elapsed),
    ended: "Appel termine",
  }

  const statusColor =
    callState === "active"
      ? "var(--success)"
      : callState === "ended"
        ? "var(--danger)"
        : "var(--accent)"

  const showRemoteVideo = isVideo && callState === "active" && hasRemote

  return (
    <>
      <div className="call-room-root" onMouseMove={resetHideTimer} onClick={resetHideTimer}>
        {/* Sorties audio des participants distants (aussi utilisees en appel video coupe) */}
        {remoteStreamEntries.map(([peerId, stream]) => (
          <audio
            key={peerId}
            autoPlay
            ref={(el) => {
              if (el) {
                if (el.srcObject !== stream) el.srcObject = stream
                el.muted = !speakerOn
                remoteAudioRefs.current.set(peerId, el)
              } else {
                remoteAudioRefs.current.delete(peerId)
              }
            }}
          />
        ))}

        <div className="bg-layer">
          {showRemoteVideo ? (
            <video ref={remoteVideoRef} className="bg-video" autoPlay playsInline muted />
          ) : (
            <div className="bg-audio-pattern" />
          )}
        </div>

        <div className="room-content">
          <div className="room-top">
            <button
              className="back-btn"
              onClick={() => {
                if (callState === "active") {
                  setShowEndConfirm(true)
                } else if (callState === "ringing") {
                  setShowEndConfirm(true)
                } else {
                  navigate(returnTo)
                }
              }}
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
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
              Retour
            </button>

            <div className="call-type-pill">
              {callState === "active" && <div className="rec-dot" />}
              {isVideo ? (
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
              ) : (
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
              )}
              Appel {isVideo ? "video" : "audio"}
              {call.isGroup ? " (groupe)" : ""}
            </div>
          </div>

          <div className="room-center">
            <div className="contact-avatar-wrap">
              <div
                className="contact-avatar"
                style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
              >
                {callState === "active" && (
                  <>
                    <div className="pulse-ring" style={{ color: "var(--accent)" }} />
                    <div className="pulse-ring" style={{ color: "var(--accent)" }} />
                    <div className="pulse-ring" style={{ color: "var(--accent)" }} />
                  </>
                )}
                {peerInitials}
              </div>
            </div>

            <div className="contact-name">{peerName}</div>
            <div className="call-status" style={{ color: statusColor }}>
              {callState === "active" && <div className="status-dot-live" />}
              {stateLabel[callState]}
              {callState === "active" && call.isGroup
                ? ` — ${remoteStreamEntries.length + 1} participants`
                : ""}
            </div>
            {call.error && (
              <div className="call-status" style={{ color: "var(--danger)", marginTop: 8 }}>
                {call.error}
              </div>
            )}
          </div>

          {/* Apercu de sa propre camera : visible aussi pendant la sonnerie */}
          {isVideo && callState !== "ended" && call.localStream && (
            <div className="local-video-pip">
              {call.camOn ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: "scaleX(-1)",
                  }}
                />
              ) : (
                <div className="pip-no-cam">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M21 21H3a2 2 0 01-2-2V8a2 2 0 012-2h3m3-3h6l2 3h4a2 2 0 012 2v9.34" />
                  </svg>
                </div>
              )}
            </div>
          )}

          <div
            className={`controls-bar ${!controlsVisible && isVideo && callState === "active" ? "hidden" : ""}`}
          >
            <div className="controls-inner">
              <button
                className="ctrl-btn"
                onClick={() => toggleMicrophone()}
                aria-label={call.micOn ? "Couper le micro" : "Activer le micro"}
              >
                <div className={`ctrl-btn-icon ${call.micOn ? "ctrl-on" : "ctrl-off"}`}>
                  {call.micOn ? (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
                    </svg>
                  ) : (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <line x1="1" y1="1" x2="23" y2="23" />
                      <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
                      <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8" />
                    </svg>
                  )}
                </div>
                <span className="ctrl-btn-label">{call.micOn ? "Micro" : "Muet"}</span>
              </button>

              {isVideo && (
                <button
                  className="ctrl-btn"
                  onClick={() => toggleCamera()}
                  aria-label={call.camOn ? "Couper la camera" : "Activer la camera"}
                >
                  <div className={`ctrl-btn-icon ${call.camOn ? "ctrl-on" : "ctrl-off"}`}>
                    {call.camOn ? (
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      >
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" />
                      </svg>
                    ) : (
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      >
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M21 21H3a2 2 0 01-2-2V8a2 2 0 012-2h3m3-3h6l2 3h4a2 2 0 012 2v9.34M23 7l-7 5 7 5V7z" />
                      </svg>
                    )}
                  </div>
                  <span className="ctrl-btn-label">{call.camOn ? "Camera" : "Camera off"}</span>
                </button>
              )}

              <button
                className="ctrl-btn"
                onClick={() => setSpeakerOn((value) => !value)}
                aria-label="Haut-parleur"
              >
                <div className={`ctrl-btn-icon ${speakerOn ? "ctrl-on" : "ctrl-off"}`}>
                  {speakerOn ? (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
                    </svg>
                  ) : (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <line x1="23" y1="9" x2="17" y2="15" />
                      <line x1="17" y1="9" x2="23" y2="15" />
                    </svg>
                  )}
                </div>
                <span className="ctrl-btn-label">{speakerOn ? "Son" : "Muet"}</span>
              </button>

              {call.activeConvId && (
                <button
                  className="ctrl-btn"
                  onClick={() => navigate(`/chats/${call.activeConvId}`)}
                  aria-label="Ouvrir le chat"
                >
                  <div className="ctrl-btn-icon ctrl-on">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                  </div>
                  <span className="ctrl-btn-label">Chat</span>
                </button>
              )}

              <button
                className="ctrl-btn"
                onClick={() => {
                  if (callState === "active") setShowEndConfirm(true)
                  else doHangUp()
                }}
                aria-label="Raccrocher"
              >
                <div className="ctrl-btn-icon ctrl-end" style={{ width: 60, height: 60 }}>
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path
                      d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 012 2V21a2 2 0 01-2 2A17 17 0 013 5a2 2 0 012-2h3.5a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L9.49 10a16 16 0 001.19 3.31z"
                      style={{ transform: "rotate(135deg)", transformOrigin: "center" }}
                    />
                  </svg>
                </div>
                <span className="ctrl-btn-label" style={{ color: "#fca5a5" }}>
                  Raccrocher
                </span>
              </button>
            </div>
          </div>
        </div>

        {callState === "ended" && (
          <div className="ended-overlay">
            <div className="ended-icon">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#4B5563"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
              </svg>
            </div>
            <div className="ended-title">Appel termine</div>
            {elapsed > 0 && <div className="ended-duration">Duree: {formatElapsed(elapsed)}</div>}
          </div>
        )}

        {showEndConfirm && (
          <div className="confirm-overlay">
            <div className="confirm-card">
              <div className="confirm-title">Raccrocher ?</div>
              <div className="confirm-sub">
                L'appel avec {peerName} sera termine.
                {elapsed > 0 && (
                  <>
                    <br />
                    Duree actuelle: {formatElapsed(elapsed)}
                  </>
                )}
              </div>
              <div className="confirm-btns">
                <button className="confirm-cancel" onClick={() => setShowEndConfirm(false)}>
                  Annuler
                </button>
                <button className="confirm-end" onClick={doHangUp}>
                  Raccrocher
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
