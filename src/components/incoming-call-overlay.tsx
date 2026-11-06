import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "../i18n"
import {
  basculerCameraEntrante,
  fermerApercuEntrant,
  ouvrirApercuEntrant,
} from "../services/call-manager"

interface IncomingCaller {
  id: string
  name: string
  initials: string
  color: { bg: string; fg: string }
  /** Photo de profil de l'appelant ; initiales utilisees si absente. */
  avatar?: string | null
}

interface IncomingCallOverlayProps {
  caller: IncomingCaller
  type: "audio" | "video"
  onAccept: () => void
  onDecline: () => void
  /** Expiration locale : ne refuse pas l'appel pour les autres appareils du compte. */
  onTimeout: () => void
  /** Appel video : refuser en ecrivant a l'appelant (« Message », comme WhatsApp). */
  onMessage?: (texte: string) => void
}

const REPONSES_RAPIDES = ["call_quick_busy", "call_quick_later", "call_quick_on_way"] as const

const ICONE_TELEPHONE =
  "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"

function Icone({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/**
 * L'ECRAN D'APPEL ENTRANT.
 *
 * Appel audio : la carte avec l'avatar, Refuser et Accepter.
 *
 * Appel video (06/11/2026), comme WhatsApp : notre camera en plein ecran
 * derriere les boutons — si ce site y a deja acces, voir
 * `ouvrirApercuEntrant` —, et deux actions de plus au-dessus de Refuser et
 * Decrocher : « Message », qui refuse en envoyant une reponse rapide a
 * l'appelant, et « Desactiver la video », qui coupe la camera avant de
 * decrocher : l'appel commence alors camera coupee.
 */
export default function IncomingCallOverlay({
  caller,
  type,
  onAccept,
  onDecline,
  onTimeout,
  onMessage,
}: IncomingCallOverlayProps) {
  const { t } = useTranslation()
  const [remaining, setRemaining] = useState(30)
  const [apercu, setApercu] = useState<MediaStream | null>(null)
  const [cameraActive, setCameraActive] = useState(true)
  const [feuille, setFeuille] = useState(false)
  const [texteLibre, setTexteLibre] = useState("")
  const videoRef = useRef<HTMLVideoElement>(null)
  const estVideo = type === "video"

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          window.clearInterval(intervalId)
          onTimeout()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [onTimeout])

  // L'apercu vit avec l'ecran. Apres un decroche, la fermeture ne l'arrete
  // pas : l'appel l'a deja repris comme camera.
  useEffect(() => {
    if (!estVideo) return
    let vivant = true
    void ouvrirApercuEntrant().then((flux) => {
      if (vivant) setApercu(flux)
    })
    return () => {
      vivant = false
      fermerApercuEntrant()
    }
  }, [estVideo])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = apercu
  }, [apercu])

  const envoyer = (texte: string) => {
    const propre = texte.trim()
    if (!propre || !onMessage) return
    setFeuille(false)
    onMessage(propre)
  }

  const avatar = (
    <div className="ical-avatar-wrap">
      <div className="ical-avatar" style={{ background: caller.color.bg, color: caller.color.fg }}>
        <div className="ical-ring" style={{ color: caller.color.fg }} />
        <div className="ical-ring" style={{ color: caller.color.fg }} />
        <div className="ical-ring" style={{ color: caller.color.fg }} />
        {caller.avatar ? (
          <img className="ical-avatar-photo" src={caller.avatar} alt="" />
        ) : (
          caller.initials
        )}
      </div>
    </div>
  )

  const identite = (
    <>
      <div className="ical-type">
        {estVideo ? t("incoming_video_call") : t("incoming_audio_call")}
      </div>
      <div className="ical-name">{caller.name}</div>
      <div className="ical-sub">{estVideo ? t("wants_a_video_call") : t("is_calling_you")}</div>
    </>
  )

  const principaux = (
    <div className="ical-actions">
      <button className="ical-action decline" onClick={onDecline}>
        <div className="ical-action-icon">
          <Icone>
            <path
              d={ICONE_TELEPHONE}
              style={{ transform: "rotate(135deg)", transformOrigin: "center" }}
            />
          </Icone>
        </div>
        <span className="ical-action-label">{t("decline")}</span>
      </button>

      <button className="ical-action accept" onClick={onAccept}>
        <div className="ical-action-icon">
          {estVideo ? (
            <Icone>
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </Icone>
          ) : (
            <Icone>
              <path d={ICONE_TELEPHONE} />
            </Icone>
          )}
        </div>
        <span className="ical-action-label">{t("accept")}</span>
      </button>
    </div>
  )

  const minuteur = <div className="ical-timer">{t("a2_auto_decline_in", { n: remaining })}</div>

  const imageVisible = apercu !== null && cameraActive

  return (
    <>
      <style>{`
        .ical-overlay {
          position: fixed;
          inset: 0;
          z-index: 9500;
          background: var(--overlay);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          font-family: 'DM Sans', sans-serif;
        }

        .ical-card {
          width: min(360px, 100%);
          border-radius: 18px;
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          box-shadow: 0 24px 64px #00000080;
          padding: 28px 20px;
          text-align: center;
        }

        .ical-avatar-wrap {
          position: relative;
          display: inline-flex;
          margin-bottom: 18px;
        }

        .ical-avatar {
          width: 86px;
          height: 86px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Bricolage Grotesque', sans-serif;
          font-weight: 800;
          font-size: 28px;
          position: relative;
        }

        .ical-avatar-photo {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
          display: block;
        }

        .ical-ring {
          position: absolute;
          inset: -10px;
          border-radius: 50%;
          border: 2px solid currentColor;
          opacity: 0;
          animation: ical-ring 2s ease-out infinite;
        }

        .ical-ring:nth-child(2) { animation-delay: .6s; }
        .ical-ring:nth-child(3) { animation-delay: 1.2s; }

        @keyframes ical-ring {
          0% { opacity: .35; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.7); }
        }

        .ical-type {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          color: var(--accent);
          margin-bottom: 8px;
          font-weight: 600;
        }

        .ical-name {
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -.6px;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .ical-sub {
          color: var(--text-muted);
          font-size: 13px;
          margin-bottom: 24px;
        }

        .ical-actions {
          display: flex;
          justify-content: center;
          gap: 26px;
        }

        .ical-action {
          border: none;
          background: none;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          font-family: 'DM Sans', sans-serif;
        }

        .ical-action-icon {
          width: 58px;
          height: 58px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          transition: transform .12s ease;
        }

        .ical-action:hover .ical-action-icon { transform: scale(1.06); }

        .ical-action.accept .ical-action-icon { background: var(--success); }
        .ical-action.decline .ical-action-icon { background: var(--danger); }

        .ical-action-label {
          color: var(--text-muted);
          font-size: 12px;
        }

        .ical-timer {
          margin-top: 16px;
          color: var(--text-faint);
          font-size: 11px;
        }

        /* Appel video : plein ecran, notre camera derriere. */
        .ical-plein {
          padding: 0;
          background: #0b0f14;
          backdrop-filter: none;
          align-items: stretch;
          overflow: hidden;
        }

        .ical-apercu {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          transform: scaleX(-1);
        }

        .ical-voile {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(
            to bottom,
            #000000b3 0%,
            #00000000 32%,
            #00000000 52%,
            #000000cc 100%
          );
        }

        .ical-plein-contenu {
          position: relative;
          width: 100%;
          max-width: 480px;
          margin: 0 auto;
          padding: 48px 20px 28px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          text-align: center;
        }

        .ical-plein .ical-type { color: #ffffffcc; }
        .ical-plein .ical-name { color: #fff; }
        .ical-plein .ical-sub { color: #ffffffb3; margin-bottom: 0; }
        .ical-plein .ical-action-label { color: #ffffffd9; }
        .ical-plein .ical-timer { color: #ffffff80; }

        .ical-secondaires {
          display: flex;
          justify-content: center;
          gap: 48px;
          margin-bottom: 28px;
        }

        .ical-action.secondaire .ical-action-icon {
          width: 50px;
          height: 50px;
          background: #ffffff2e;
        }

        .ical-action.secondaire.actif .ical-action-icon {
          background: #fff;
          color: #111;
        }

        .ical-feuille-fond {
          position: absolute;
          inset: 0;
          background: #00000066;
          z-index: 2;
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }

        .ical-feuille {
          width: min(480px, 100%);
          background: var(--bg-surface);
          color: var(--text-primary);
          border-radius: 18px 18px 0 0;
          padding: 8px 16px 20px;
          text-align: left;
        }

        .ical-choix {
          display: block;
          width: 100%;
          text-align: left;
          padding: 14px 4px;
          border: none;
          border-bottom: 1px solid var(--border-subtle);
          background: none;
          color: var(--text-primary);
          font: inherit;
          font-size: 14px;
          cursor: pointer;
        }

        .ical-choix:hover { color: var(--accent); }

        .ical-saisie {
          display: flex;
          gap: 8px;
          margin-top: 14px;
        }

        .ical-saisie input {
          flex: 1;
          min-width: 0;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--border-subtle);
          background: transparent;
          color: var(--text-primary);
          font: inherit;
          font-size: 14px;
        }

        .ical-bouton {
          border: none;
          border-radius: 10px;
          padding: 10px 14px;
          font: inherit;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          background: var(--accent);
          color: #fff;
        }

        .ical-bouton:disabled { opacity: .5; cursor: default; }

        .ical-bouton.discret {
          background: none;
          color: var(--text-muted);
          margin-top: 10px;
          width: 100%;
        }
      `}</style>

      {estVideo ? (
        <div
          className="ical-overlay ical-plein"
          role="dialog"
          aria-modal="true"
          aria-label={t("ring_incoming_call")}
        >
          <video
            ref={videoRef}
            className="ical-apercu"
            autoPlay
            muted
            playsInline
            style={{ visibility: imageVisible ? "visible" : "hidden" }}
          />
          {imageVisible && <div className="ical-voile" />}

          <div className="ical-plein-contenu">
            <div>{identite}</div>

            {!imageVisible && <div>{avatar}</div>}

            <div>
              <div className="ical-secondaires">
                {onMessage && (
                  <button className="ical-action secondaire" onClick={() => setFeuille(true)}>
                    <div className="ical-action-icon">
                      <Icone>
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                      </Icone>
                    </div>
                    <span className="ical-action-label">{t("call_message")}</span>
                  </button>
                )}
                <button
                  className={`ical-action secondaire ${cameraActive ? "" : "actif"}`}
                  aria-pressed={!cameraActive}
                  onClick={() => setCameraActive(basculerCameraEntrante())}
                >
                  <div className="ical-action-icon">
                    {cameraActive ? (
                      <Icone>
                        <path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </Icone>
                    ) : (
                      <Icone>
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </Icone>
                    )}
                  </div>
                  <span className="ical-action-label">
                    {cameraActive ? t("call_video_off") : t("call_video_on")}
                  </span>
                </button>
              </div>
              {principaux}
              {minuteur}
            </div>
          </div>

          {feuille && (
            <div className="ical-feuille-fond" onClick={() => setFeuille(false)}>
              <div className="ical-feuille" onClick={(e) => e.stopPropagation()}>
                {REPONSES_RAPIDES.map((cle) => (
                  <button key={cle} className="ical-choix" onClick={() => envoyer(t(cle))}>
                    {t(cle)}
                  </button>
                ))}
                <form
                  className="ical-saisie"
                  onSubmit={(e) => {
                    e.preventDefault()
                    envoyer(texteLibre)
                  }}
                >
                  <input
                    value={texteLibre}
                    onChange={(e) => setTexteLibre(e.target.value)}
                    placeholder={t("call_quick_custom")}
                    maxLength={500}
                    autoFocus
                  />
                  <button className="ical-bouton" type="submit" disabled={!texteLibre.trim()}>
                    {t("send")}
                  </button>
                </form>
                <button className="ical-bouton discret" onClick={() => setFeuille(false)}>
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          className="ical-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t("ring_incoming_call")}
        >
          <div className="ical-card">
            {avatar}
            {identite}
            {principaux}
            {minuteur}
          </div>
        </div>
      )}
    </>
  )
}
