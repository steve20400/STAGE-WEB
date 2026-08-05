import { useEffect, useRef, useState } from "react"
import type { CallDisplayMode } from "../services/call-manager"
import { toInitials } from "../data/session-user"
import "./participant-grid.css"

/**
 * Grille des participants d'un appel de groupe.
 *
 * Jusqu'ici l'ecran d'appel ne branchait que `remoteStreams[0]` : les flux des
 * autres participants etaient recus mais jamais affiches. Cette grille les rend
 * tous, avec une disposition qui suit la taille de la fenetre :
 *
 * - grand ecran : autant de colonnes que la largeur en permet, defilement
 *   vertical au-dela ;
 * - ecran moyen : la meme grille, avec des tuiles de la taille du petit ecran ;
 * - petit ecran : une seule tuile visible, celle du premier participant arrive
 *   apres nous, et un defilement vertical par tuile pour parcourir les autres un
 *   par un.
 *
 * Le son ne passe PAS par ces tuiles : les elements `<video>` restent muets, et
 * l'ecran d'appel garde un `<audio>` par participant. C'est ce qui permet a
 * plusieurs voix de se superposer sans qu'aucune ne coupe les autres, et cela
 * evite qu'un meme flux soit joue deux fois.
 */
export interface Participant {
  id: string
  stream: MediaStream
  name: string
}

/**
 * Un flux distant peut etre `live` sans transporter d'image — camera coupee, ou
 * premiere frame pas encore arrivee. On surveille donc l'etat reel de la piste
 * pour retomber sur la photo plutot que d'afficher un rectangle noir.
 */
function usePisteVideoVivante(stream: MediaStream): boolean {
  const [vivante, setVivante] = useState(false)

  useEffect(() => {
    const evaluer = () =>
      setVivante(
        stream.getVideoTracks().some((piste) => piste.readyState === "live" && !piste.muted)
      )
    evaluer()

    const pistes = stream.getVideoTracks()
    for (const piste of pistes) {
      piste.addEventListener("mute", evaluer)
      piste.addEventListener("unmute", evaluer)
      piste.addEventListener("ended", evaluer)
    }
    stream.addEventListener("addtrack", evaluer)
    stream.addEventListener("removetrack", evaluer)
    return () => {
      for (const piste of pistes) {
        piste.removeEventListener("mute", evaluer)
        piste.removeEventListener("unmute", evaluer)
        piste.removeEventListener("ended", evaluer)
      }
      stream.removeEventListener("addtrack", evaluer)
      stream.removeEventListener("removetrack", evaluer)
    }
  }, [stream])

  return vivante
}

/** Meme principe pour le micro : une piste audio coupee passe en `muted`. */
function usePisteAudioVivante(stream: MediaStream): boolean {
  const [vivante, setVivante] = useState(true)

  useEffect(() => {
    const evaluer = () =>
      setVivante(
        stream.getAudioTracks().some((piste) => piste.readyState === "live" && !piste.muted)
      )
    evaluer()

    const pistes = stream.getAudioTracks()
    for (const piste of pistes) {
      piste.addEventListener("mute", evaluer)
      piste.addEventListener("unmute", evaluer)
    }
    return () => {
      for (const piste of pistes) {
        piste.removeEventListener("mute", evaluer)
        piste.removeEventListener("unmute", evaluer)
      }
    }
  }, [stream])

  return vivante
}

function TuileParticipant({
  participant,
  isVideo,
}: {
  participant: Participant
  isVideo: boolean
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const imageVivante = usePisteVideoVivante(participant.stream)
  const microVivant = usePisteAudioVivante(participant.stream)
  const montrerVideo = isVideo && imageVivante

  useEffect(() => {
    const element = videoRef.current
    if (element && element.srcObject !== participant.stream) {
      element.srcObject = participant.stream
      // La lecture peut etre refusee : sans image on retombe sur la photo, ce qui
      // vaut mieux qu'une tuile noire.
      void element.play().catch(() => undefined)
    }
  }, [participant.stream, montrerVideo])

  return (
    <div className="pg-tile">
      {montrerVideo ? (
        // Muet volontairement : le son passe par les <audio> de l'ecran d'appel.
        <video ref={videoRef} autoPlay playsInline muted className="pg-video" />
      ) : (
        <div className="pg-avatar" aria-hidden>
          {toInitials(participant.name)}
        </div>
      )}

      <div className="pg-footer">
        <span className="pg-name">{participant.name}</span>
        <span
          className={microVivant ? "pg-mic on" : "pg-mic off"}
          title={microVivant ? "Micro actif" : "Micro coupe"}
          aria-label={
            microVivant ? `${participant.name} : micro actif` : `${participant.name} : micro coupe`
          }
        >
          {microVivant ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M12 1a3 3 0 00-3 3v7a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v1a7 7 0 01-14 0v-1M12 19v4" />
            </svg>
          ) : (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <line x1="3" y1="3" x2="21" y2="21" />
              <path d="M9 5a3 3 0 016 0v6M12 19v4M5 10v1a7 7 0 0011 5.7" />
            </svg>
          )}
        </span>
      </div>
    </div>
  )
}

export function ParticipantGrid({
  participants,
  isVideo,
  size,
}: {
  participants: Participant[]
  isVideo: boolean
  size: CallDisplayMode
}) {
  if (participants.length === 0) return null

  return (
    <div className={`pgrid pgrid-${size} ${isVideo ? "pgrid-video" : "pgrid-audio"}`} role="list">
      {participants.map((participant) => (
        <div role="listitem" key={participant.id} className="pg-cell">
          <TuileParticipant participant={participant} isVideo={isVideo} />
        </div>
      ))}
    </div>
  )
}
