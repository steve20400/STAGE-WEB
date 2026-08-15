import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { fetchAbandonedClients, type QueueHistoryEntry } from "../../../src/services/queue-service"
import { startCallbackCall } from "../../../src/services/call-manager"
import { AvatarCircle } from "../../../src/components/avatar-circle"
import { toInitials } from "../../../src/data/session-user"
import { ApiError } from "../../../src/lib/api-client"
import { useToast } from "../../../src/components/toast"
import "../calls/calls-page.css"

/**
 * « Clients abandonnés » — menu de gauche, juste au-dessus de Réglages
 * (demande user 15/08/2026).
 *
 * Réservé aux agents/centres : GET /api/queue/history répond 403 à tout
 * autre compte, affiché ici comme un message clair plutôt qu'une liste
 * vide — pas besoin de savoir « suis-je agent » avant d'ouvrir la page.
 */
export default function AbandonedClientsPage() {
  const navigate = useNavigate()
  const { error: toastError } = useToast()
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [clients, setClients] = useState<QueueHistoryEntry[]>([])
  const [callbackInFlight, setCallbackInFlight] = useState<string | null>(null)

  const charger = () => {
    setLoading(true)
    setForbidden(false)
    fetchAbandonedClients()
      .then((liste) => {
        setClients(liste)
        setLoading(false)
      })
      .catch((e) => {
        setForbidden(e instanceof ApiError && e.status === 403)
        setLoading(false)
      })
  }

  useEffect(charger, [])

  const duree = (s: number | null) => {
    const total = s ?? 0
    const m = Math.floor(total / 60)
    const sec = total % 60
    return m > 0 ? `${m} min ${sec}s` : `${sec}s`
  }

  const rappeler = async (c: QueueHistoryEntry) => {
    setCallbackInFlight(c.customerId)
    try {
      const nom = c.customerName ?? "Client"
      const callId = await startCallbackCall(c.centerId, c.customerId, nom)
      navigate(`/calls/${callId}`)
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Impossible de rappeler ce client")
    } finally {
      setCallbackInFlight(null)
    }
  }

  return (
    <div className="calls-root">
      <div className="calls-head">
        <div className="calls-title-row page-title-row">
          <h1 className="calls-title">Clients abandonnés</h1>
        </div>
      </div>

      <div className="calls-body">
        {loading ? (
          <div className="empty-state">
            <div className="empty-txt">Chargement…</div>
          </div>
        ) : forbidden ? (
          <div className="empty-state">
            <div className="empty-txt">Réservé aux agents d'un centre d'appels.</div>
          </div>
        ) : clients.length === 0 ? (
          <div className="empty-state">
            <div className="empty-txt">Aucun client abandonné pour l'instant.</div>
          </div>
        ) : (
          clients.map((c) => {
            const nom = c.customerName ?? "Client"
            const enCours = callbackInFlight === c.customerId
            return (
              <div className="call-item" key={c.idHist}>
                <AvatarCircle avatar={c.customerAvatarUrl} initials={toInitials(nom)} className="call-av" />
                <div className="call-info">
                  <div className="call-name">{nom}</div>
                  <div className="call-detail">
                    {c.statut === "TIMEOUT" ? "Expiré" : "Abandonné"} après {duree(c.attenteDureeSec)}
                    {c.serviceName ? ` · ${c.serviceName}` : ""}
                    {c.companyName ? ` · ${c.companyName}` : ""}
                  </div>
                </div>
                <button
                  className="dial-btn"
                  disabled={callbackInFlight !== null}
                  onClick={() => void rappeler(c)}
                  title="Rappeler"
                >
                  {enCours ? (
                    "…"
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                    </svg>
                  )}
                  Rappeler
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
