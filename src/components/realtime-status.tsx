import { useEffect, useState } from "react"
import { getRealtimeState, type RealtimeState } from "../services/websocket-service"
import { useTranslation } from "../i18n"

/**
 * Indicateur d'etat du temps reel (Parametres > A propos). Trois verdicts :
 * - connecte ET confirme par le serveur ("ready")  -> tout va bien ;
 * - connecte mais jamais confirme                  -> serveur temps reel en panne ;
 * - deconnecte                                     -> reconnexion en cours.
 */
export default function RealtimeStatus() {
  const [state, setState] = useState<RealtimeState>(() => getRealtimeState())
  const { t } = useTranslation()

  useEffect(() => {
    const id = setInterval(() => setState(getRealtimeState()), 2000)
    return () => clearInterval(id)
  }, [])

  let color = "var(--danger)"
  let label = t("realtime_lost")
  if (state.connected && state.ready) {
    color = "var(--success)"
    label = t("realtime_connected")
  } else if (state.connected && !state.ready) {
    color = "#f59e0b"
    label = `${t("realtime_connected")} — ${t("realtime_connecting")}`
  }

  const secondsAgo =
    state.lastEventAt > 0 ? Math.round((Date.now() - state.lastEventAt) / 1000) : null

  return (
    <div
      className="about-row"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "11px 0",
        borderBottom: "1px solid var(--border-subtle)",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 13, color: "var(--text-muted)", flexShrink: 0 }}>
        Temps reel (messages)
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          textAlign: "right",
          color,
          display: "flex",
          alignItems: "center",
          gap: 7,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
          }}
        />
        {label}
        {secondsAgo !== null && state.connected && state.ready && (
          <span style={{ color: "var(--text-faint)" }}>
            (dernier evenement il y a {secondsAgo} s)
          </span>
        )}
      </span>
    </div>
  )
}
