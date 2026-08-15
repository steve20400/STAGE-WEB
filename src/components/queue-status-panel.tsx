import { useEffect, useState } from "react"
import { fetchLiveQueue, fetchAbandonedClients, type QueueLiveEntry, type QueueHistoryEntry } from "../services/queue-service"

/**
 * Tiroir "Liste d'attente" — ouvert depuis l'ecran d'appel d'un agent, pour
 * le centre qui a route l'appel EN COURS (demande user 15/08/2026). Montre
 * qui attend MAINTENANT et qui a abandonne recemment, sur ce meme centre.
 *
 * Lecture seule : rappeler un abandonne se fait depuis la page "Clients
 * abandonnes" (menu de gauche), pas d'ici — en plein appel n'est pas le moment.
 */
export function QueueStatusPanel({
  centerAlanyaID,
  onClose,
}: {
  centerAlanyaID: string
  onClose: () => void
}) {
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enAttente, setEnAttente] = useState<QueueLiveEntry[]>([])
  const [abandonnes, setAbandonnes] = useState<QueueHistoryEntry[]>([])

  const charger = () => {
    setChargement(true)
    setErreur(null)
    Promise.all([fetchLiveQueue(centerAlanyaID), fetchAbandonedClients(centerAlanyaID)])
      .then(([live, hist]) => {
        setEnAttente(live)
        setAbandonnes(hist)
        setChargement(false)
      })
      .catch(() => {
        setErreur("Impossible de charger la file d'attente")
        setChargement(false)
      })
  }

  useEffect(charger, [centerAlanyaID])

  const duree = (s: number | null) => {
    const total = s ?? 0
    const m = Math.floor(total / 60)
    const sec = total % 60
    return m > 0 ? `${m} min ${sec}s` : `${sec}s`
  }

  return (
    <div className="queue-status-overlay" onClick={onClose}>
      <div className="queue-status-panel" onClick={(e) => e.stopPropagation()}>
        <div className="queue-status-header">
          <span>Liste d'attente</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="queue-status-icon-btn" onClick={charger} title="Actualiser" disabled={chargement}>
              ⟳
            </button>
            <button className="queue-status-icon-btn" onClick={onClose} title="Fermer">
              ✕
            </button>
          </div>
        </div>

        {chargement ? (
          <div className="queue-status-empty">Chargement…</div>
        ) : erreur ? (
          <div className="queue-status-empty">{erreur}</div>
        ) : (
          <div className="queue-status-body">
            <div className="queue-status-section-title">En attente maintenant ({enAttente.length})</div>
            {enAttente.length === 0 && <div className="queue-status-empty">Personne n'attend.</div>}
            {enAttente.map((l) => (
              <div className="queue-status-row" key={l.idFile}>
                <div className="queue-status-row-main">
                  <div className="queue-status-name">{l.customerName ?? "Client"}</div>
                  <div className="queue-status-sub">
                    {l.serviceName ? `${l.serviceName} · rang ${l.rang}` : `rang ${l.rang}`}
                  </div>
                </div>
                <span className="queue-status-dot queue-status-dot-waiting" />
              </div>
            ))}

            <div className="queue-status-section-title" style={{ marginTop: 16 }}>
              Abandons récents ({abandonnes.length})
            </div>
            {abandonnes.length === 0 && <div className="queue-status-empty">Aucun abandon récent.</div>}
            {abandonnes.map((l) => (
              <div className="queue-status-row" key={l.idHist}>
                <div className="queue-status-row-main">
                  <div className="queue-status-name">{l.customerName ?? "Client"}</div>
                  <div className="queue-status-sub">
                    {l.statut === "TIMEOUT" ? "Expiré" : "Abandonné"} après {duree(l.attenteDureeSec)}
                  </div>
                </div>
                <span className="queue-status-dot queue-status-dot-gone" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
