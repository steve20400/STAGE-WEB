import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useCallState } from "../hooks/use-call"
import { useHasLiveVideo } from "../hooks/use-remote-video"
import {
  hangUp,
  restoreActiveCall,
  setCallDisplayMode,
  toggleMicrophone,
  type CallDisplayMode,
} from "../services/call-manager"
import { toInitials } from "../data/session-user"
import { avatarDisplaySrc } from "../lib/avatar"

/**
 * Fenetre d'appel reduite — lecteur persistant qui conserve les sorties
 * audio/video WebRTC quand l'ecran d'appel est demonte (clic sur « Chat »).
 *
 * Une seule presentation, identique sur grand et petit ecran : une carte
 * flottante deplacable. En audio, elle reprend le fond motif des discussions
 * avec la photo et le pseudo de l'interlocuteur ; en video, le flux distant.
 *
 * Reduite, la fenetre n'affiche QUE la camera du correspondant plus les trois
 * commandes. L'apercu de sa propre camera (PIP) est volontairement absent : il
 * se superposait au flux distant et apparaissait comme un rectangle noir.
 * L'apercu local reste disponible sur l'ecran d'appel plein format.
 */
export function ActiveCallFloating() {
  const call = useCallState()
  const navigate = useNavigate()

  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [menuOuvert, setMenuOuvert] = useState(false)
  const drag = useRef({ x: 0, y: 0, ox: 0, oy: 0, on: false })

  const remoteEntries = Object.entries(call.remoteStreams)
  const remote = remoteEntries[0]?.[1]
  // Hook appele avant tout retour anticipe : l'ordre des hooks doit rester stable.
  const remoteHasVideo = useHasLiveVideo(remote)

  // La fenetre flottante sert les deux tailles reduites ; « full » est rendu par
  // l'ecran d'appel entier.
  if (!call.activeCallId || call.displayMode === "full") return null
  const reduite = call.displayMode === "small"

  // Video affichee seulement si une image arrive vraiment. Sinon (audio seul,
  // piste video pas encore recue, camera du correspondant coupee) on montre sa
  // photo : c'est ce qui remplace l'ancien rectangle noir.
  const showRemoteVideo = call.callType === "video" && remoteHasVideo
  const peerName = call.peerName || "Appel"
  const peerAvatar = avatarDisplaySrc(call.peerAvatarUrl)

  const restore = () => {
    const id = call.activeCallId
    restoreActiveCall()
    requestAnimationFrame(() => navigate(`/calls/${id}?type=${call.callType}`, { replace: true }))
  }

  return (
    <div
      className={`active-call-floating ${reduite ? "taille-petite" : "taille-moyenne"}`}
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
          <video
            ref={(el) => {
              if (el && remote && el.srcObject !== remote) {
                el.srcObject = remote
                void el.play().catch(() => undefined)
              }
            }}
            autoPlay
            playsInline
            muted
          />
        ) : (
          <div className="active-call-audio">
            <div className="active-call-avatar">
              {peerAvatar ? <img src={peerAvatar} alt="" /> : toInitials(peerName)}
            </div>
            <b>{peerName}</b>
            <span>
              {call.callType !== "video"
                ? "Appel en cours"
                : remote
                  ? "Camera desactivee"
                  : "Connexion…"}
            </span>
          </div>
        )}
      </div>

      {menuOuvert && (
        <div className="active-call-menu" onPointerDown={(e) => e.stopPropagation()}>
          <div className="acm-section">Taille de la fenetre</div>
          {(
            [
              ["small", "Petit ecran"],
              ["medium", "Ecran moyen"],
              ["full", "Grand ecran"],
            ] as Array<[CallDisplayMode, string]>
          ).map(([mode, libelle]) => (
            <button
              key={mode}
              className={call.displayMode === mode ? "acm-item on" : "acm-item"}
              aria-pressed={call.displayMode === mode}
              onClick={() => {
                setMenuOuvert(false)
                // Le grand ecran est un ecran a part entiere : il faut y naviguer.
                if (mode === "full") restore()
                else setCallDisplayMode(mode)
              }}
            >
              {libelle}
            </button>
          ))}
        </div>
      )}

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
        {/* Quatrieme bouton, prevu pour accueillir d'autres entrees : inviter des
            participants et transferer l'appel viendront s'y ajouter. */}
        <button
          className="more"
          onClick={() => setMenuOuvert((ouvert) => !ouvert)}
          aria-expanded={menuOuvert}
          aria-label="Autres actions"
          title="Autres actions"
        >
          ⋮
        </button>
      </div>
    </div>
  )
}
