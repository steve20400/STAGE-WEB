import React, { useState, useEffect } from "react"
import { apiRequest } from "../../../src/lib/api-client"
import "./developer.css"

interface ApiKeyItem {
  id: string
  prefix: string
  name: string
  type: "SANDBOX" | "LIVE"
  isActive: boolean
  lastUsedAt: string | null
  createdAt: string
}

interface DeveloperData {
  id: string
  balanceCredits: string
  holdCredits: string
  companyName: string | null
}

export default function DeveloperPage() {
  const [developer, setDeveloper] = useState<DeveloperData | null>(null)
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyName, setKeyName] = useState("")
  const [keyType, setKeyType] = useState<"SANDBOX" | "LIVE">("SANDBOX")
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null)
  const [rechargeMsg, setRechargeMsg] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetchDeveloperData()
  }, [])

  const fetchDeveloperData = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = (await apiRequest("/api/developer/keys", { method: "GET" })) as any
      if (data && data.ok) {
        setDeveloper(data.data.developer)
        setApiKeys(data.data.apiKeys || [])
      } else {
        setError(data?.error || "Erreur de chargement des données développeur")
      }
    } catch (err: any) {
      setError(err?.message || "Impossible de contacter l'API Développeur Alanya")
    } finally {
      setLoading(false)
    }
  }

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setIsSubmitting(true)
      setError(null)
      const data = (await apiRequest("/api/developer/keys", {
        method: "POST",
        body: { name: keyName || "Ma Clé API", type: keyType },
      })) as any

      if (data && data.ok) {
        setGeneratedRawKey(data.data.rawKey)
        setKeyName("")
        fetchDeveloperData()
      } else {
        setError(data?.error || "Erreur de création de la clé API")
      }
    } catch (err: any) {
      setError(err?.message || "Erreur de communication")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm("Voulez-vous vraiment révoquer cette clé API ? Elle sera désactivée immédiatement.")) return
    try {
      const data = (await apiRequest("/api/developer/keys", {
        method: "DELETE",
        body: { keyId },
      })) as any

      if (data && data.ok) {
        fetchDeveloperData()
      } else {
        alert(data?.error || "Erreur de révocation")
      }
    } catch (err: any) {
      alert(err?.message || "Erreur réseau")
    }
  }

  const handleSandboxRecharge = async (pack: "STARTER" | "PRO" | "ENTERPRISE") => {
    try {
      setRechargeMsg(null)
      const data = (await apiRequest("/api/developer/billing/sandbox", {
        method: "POST",
        body: { pack },
      })) as any

      if (data && data.ok) {
        setRechargeMsg(data.data.message)
        fetchDeveloperData()
      } else {
        alert(data?.error || "Erreur de recharge Sandbox")
      }
    } catch (err: any) {
      alert(err?.message || "Erreur de communication")
    }
  }

  if (loading) {
    return (
      <div className="dev-container">
        <h2>Chargement de la Console Développeur Alanya...</h2>
      </div>
    )
  }

  const balance = Number(developer?.balanceCredits || 0)

  return (
    <div className="dev-container">
      <header className="dev-header">
        <h1 className="dev-title">⚡ Console Développeur Alanya & Facturation API</h1>
        <p className="dev-subtitle">
          Gérez vos clés d'API, suivez votre solde de crédits et intégrez les SMS/appels WebRTC dans vos applications.
        </p>
      </header>

      {error && <div className="dev-alert-error">⚠️ {error}</div>}
      {rechargeMsg && <div className="dev-alert-success">✅ {rechargeMsg}</div>}

      {/* MODAL / BANNIÈRE AFFICHAGE UNIQUE DE LA CLÉ NOUVELLEMENT CRÉÉE */}
      {generatedRawKey && (
        <div className="dev-key-result">
          <h3 className="dev-key-result-title">🔑 Nouvelle Clé API Générée !</h3>
          <p style={{ color: "#E0E7FF", fontSize: "14px", margin: "4px 0" }}>
            <strong>ATTENTION :</strong> Conservez cette clé immédiatement. Elle n'apparaîtra <strong>QU'UNE SEULE ET UNIQUE FOIS</strong>.
          </p>
          <div className="dev-key-code">{generatedRawKey}</div>
          <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
            <button
              className="dev-btn dev-btn-primary"
              onClick={() => {
                navigator.clipboard.writeText(generatedRawKey)
                alert("Clé API copiée dans le presse-papier !")
              }}
            >
              📋 Copier la Clé
            </button>
            <button
              className="dev-btn"
              style={{ background: "#334155", color: "#FFF" }}
              onClick={() => setGeneratedRawKey(null)}
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* CARTES COMPTEUR ET SOLDE */}
      <div className="dev-cards-grid">
        <div className="dev-card">
          <div className="dev-card-label">Solde de Crédits Disponibles</div>
          <div className="dev-card-value">{balance.toLocaleString()} ALC</div>
          <p className="dev-card-sub">
            Équivalent à <strong>{balance} Messages API</strong> ou <strong>{Math.floor(balance / 10)} Min d'appels</strong>
          </p>
        </div>

        <div className="dev-card">
          <div className="dev-card-label">Crédits sous Réservation (HOLD)</div>
          <div className="dev-card-value" style={{ color: "#F59E0B" }}>
            {Number(developer?.holdCredits || 0).toLocaleString()} ALC
          </div>
          <p className="dev-card-sub">Réservés pour les sessions d'appels WebRTC en cours</p>
        </div>
      </div>

      {/* RECHARGE SANDBOX GRATUITE */}
      <div className="dev-card" style={{ marginBottom: "28px" }}>
        <h3 style={{ margin: "0 0 10px 0", fontSize: "18px", color: "#F8FAFC" }}>🎁 Recharge Gratuit / Mode Sandbox</h3>
        <p style={{ color: "#94A3B8", fontSize: "14px", margin: "0 0 16px 0" }}>
          Testez le système de facturation et de quota sans carte bancaire en créditant votre portefeuille en 1-click :
        </p>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button className="dev-btn dev-btn-primary" onClick={() => handleSandboxRecharge("STARTER")}>
            +1 000 Crédits Gratuit (Starter)
          </button>
          <button className="dev-btn" style={{ background: "#0D9488", color: "#FFF" }} onClick={() => handleSandboxRecharge("PRO")}>
            +5 750 Crédits Gratuit (+15% Bonus Pro)
          </button>
          <button className="dev-btn" style={{ background: "#7C3AED", color: "#FFF" }} onClick={() => handleSandboxRecharge("ENTERPRISE")}>
            +26 000 Crédits Gratuit (+30% Bonus Enterprise)
          </button>
        </div>
      </div>

      {/* CRÉER UNE NOUVELLE CLÉ API */}
      <div className="dev-card" style={{ marginBottom: "28px" }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: "18px", color: "#F8FAFC" }}>➕ Créer une nouvelle Clé API</h3>
        <form onSubmit={handleCreateKey} style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Nom de la clé (ex: Production App)"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            style={{
              padding: "10px 14px",
              borderRadius: "6px",
              border: "1px solid #475569",
              background: "#0F172A",
              color: "#FFF",
              flex: "1",
              minWidth: "220px",
            }}
            required
          />
          <select
            value={keyType}
            onChange={(e) => setKeyType(e.target.value as any)}
            style={{
              padding: "10px 14px",
              borderRadius: "6px",
              border: "1px solid #475569",
              background: "#0F172A",
              color: "#FFF",
            }}
          >
            <option value="SANDBOX">Sandbox (ak_test_...)</option>
            <option value="LIVE">Production (ak_live_...)</option>
          </select>
          <button type="submit" disabled={isSubmitting} className="dev-btn dev-btn-success">
            {isSubmitting ? "Génération..." : "Générer la Clé"}
          </button>
        </form>
      </div>

      {/* TABLEAU DES CLÉS API */}
      <div className="dev-card" style={{ marginBottom: "28px" }}>
        <h3 style={{ margin: "0 0 14px 0", fontSize: "18px", color: "#F8FAFC" }}>🔑 Clés API du Compte ({apiKeys.length})</h3>
        {apiKeys.length === 0 ? (
          <p style={{ color: "#64748B", margin: 0 }}>Aucune clé d'API n'a encore été générée.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="dev-table">
              <thead>
                <tr>
                  <th>NOM</th>
                  <th>PRÉFIXE</th>
                  <th>TYPE</th>
                  <th>STATUT</th>
                  <th>CRÉÉE LE</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((k) => (
                  <tr key={k.id} style={{ opacity: k.isActive ? 1 : 0.5 }}>
                    <td style={{ fontWeight: "bold" }}>{k.name}</td>
                    <td style={{ fontFamily: "monospace", color: "#38BDF8" }}>{k.prefix}_••••••••••••</td>
                    <td>
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          background: k.type === "SANDBOX" ? "#0369A1" : "#15803D",
                          color: "#FFF",
                        }}
                      >
                        {k.type}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: k.isActive ? "#4ADE80" : "#F87171" }}>
                        {k.isActive ? "● Active" : "○ Révoquée"}
                      </span>
                    </td>
                    <td style={{ color: "#94A3B8", fontSize: "13px" }}>{new Date(k.createdAt).toLocaleDateString()}</td>
                    <td>
                      {k.isActive && (
                        <button className="dev-btn dev-btn-danger" onClick={() => handleRevokeKey(k.id)}>
                          Révoquer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* EXEMPLE DE CODE CULR */}
      <div className="dev-card">
        <h3 style={{ margin: "0 0 10px 0", fontSize: "18px", color: "#F8FAFC" }}>📖 Exemple d'Intégration cURL</h3>
        <p style={{ color: "#94A3B8", fontSize: "14px", margin: "0 0 12px 0" }}>
          Passez votre clé API dans l'en-tête `X-Api-Key` ou `Authorization: Bearer` :
        </p>
        <div className="dev-code-block">
{`curl -X POST https://alanyavox.com/api/v1/messages/send \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: ak_test_votre_cle_secrete_ici" \\
  -d '{
    "recipientNumber": "600001",
    "content": "Bonjour depuis l'API Développeur Alanya !"
  }'`}
        </div>
      </div>
    </div>
  )
}
