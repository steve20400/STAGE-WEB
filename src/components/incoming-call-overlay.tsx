import { useEffect, useState } from "react"

interface IncomingCaller {
  id: string
  name: string
  initials: string
  color: { bg: string; fg: string }
}

interface IncomingCallOverlayProps {
  caller: IncomingCaller
  type: "audio" | "video"
  onAccept: () => void
  onDecline: () => void
  /** Expiration locale : ne refuse pas l'appel pour les autres appareils du compte. */
  onTimeout: () => void
}

export default function IncomingCallOverlay({
  caller,
  type,
  onAccept,
  onDecline,
  onTimeout,
}: IncomingCallOverlayProps) {
  const [remaining, setRemaining] = useState(30)

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
      `}</style>

      <div className="ical-overlay" role="dialog" aria-modal="true" aria-label="Appel entrant">
        <div className="ical-card">
          <div className="ical-avatar-wrap">
            <div
              className="ical-avatar"
              style={{ background: caller.color.bg, color: caller.color.fg }}
            >
              <div className="ical-ring" style={{ color: caller.color.fg }} />
              <div className="ical-ring" style={{ color: caller.color.fg }} />
              <div className="ical-ring" style={{ color: caller.color.fg }} />
              {caller.initials}
            </div>
          </div>

          <div className="ical-type">Appel {type === "video" ? "video" : "audio"} entrant</div>
          <div className="ical-name">{caller.name}</div>
          <div className="ical-sub">
            {type === "video" ? "Souhaite un appel video" : "Vous appelle"}
          </div>

          <div className="ical-actions">
            <button className="ical-action decline" onClick={onDecline}>
              <div className="ical-action-icon">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path
                    d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 18.92v3a2 2 0 01-2 2A17 17 0 013 5a2 2 0 012-2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L9.49 10a16 16 0 001.19 3.31z"
                    style={{ transform: "rotate(135deg)", transformOrigin: "center" }}
                  />
                </svg>
              </div>
              <span className="ical-action-label">Refuser</span>
            </button>

            <button className="ical-action accept" onClick={onAccept}>
              <div className="ical-action-icon">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                </svg>
              </div>
              <span className="ical-action-label">Accepter</span>
            </button>
          </div>

          <div className="ical-timer">Decline automatiquement dans {remaining}s</div>
        </div>
      </div>
    </>
  )
}
