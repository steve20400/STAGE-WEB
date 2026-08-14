import React, { useState, useEffect } from "react"
import { apiRequest } from "../../../src/lib/api-client"
import { useDeveloperTab } from "./developer-layout"
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
}

export default function DeveloperPage() {
  const { activeTab, setActiveTab } = useDeveloperTab()
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
      const res = (await apiRequest("/api/developer/keys", { method: "GET" })) as any

      const devObj = res?.data?.developer || res?.developer || null
      const keysList = res?.data?.apiKeys || res?.apiKeys || []

      if (devObj) {
        setDeveloper(devObj)
        setApiKeys(keysList)
      } else {
        setDeveloper({ id: "default", balanceCredits: "1000", holdCredits: "0" })
        setApiKeys([])
      }
    } catch {
      setDeveloper({ id: "default", balanceCredits: "1000", holdCredits: "0" })
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
        body: { name: keyName || "Clé API", type: keyType },
      })) as any

      const raw = data?.data?.rawKey || data?.rawKey
      if (raw) {
        setGeneratedRawKey(raw)
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
    if (!confirm("Voulez-vous révoquer cette clé API ? Elle sera désactivée immédiatement.")) return
    try {
      const data = (await apiRequest("/api/developer/keys", {
        method: "DELETE",
        body: { keyId },
      })) as any

      if (data && (data.ok || data.message)) {
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

      const message = data?.data?.message || data?.message
      if (message) {
        setRechargeMsg(message)
        fetchDeveloperData()
      } else {
        alert(data?.error || "Erreur de recharge Sandbox")
      }
    } catch (err: any) {
      alert(err?.message || "Erreur de communication")
    }
  }

  const balance = Number(developer?.balanceCredits || 1000)
  const hold = Number(developer?.holdCredits || 0)
  const activeKeysCount = apiKeys.filter((k) => k.isActive).length

  return (
    <div className="dev-dashboard-main">
      {/* EN-TÊTE PRINCIPAL (Format identique au screenshot d'exemple) */}
      <div className="dev-main-header">
        <div className="dev-main-header-text">
          <h1 className="dev-main-title">
            {activeTab === "dashboard" && "Tableau de bord"}
            {activeTab === "keys" && "Gestion des Clés d'API"}
            {activeTab === "sandbox" && "Recharge Sandbox Gratuit"}
            {activeTab === "docs" && "Documentation & Exemples cURL"}
          </h1>
          <p className="dev-main-subtitle">Gérez vos crédits, clés API et intégrations — Alanya Developer</p>
        </div>

        <div className="dev-header-actions">
          <button onClick={fetchDeveloperData} className="dev-refresh-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            Actualiser
          </button>
        </div>
      </div>

      {error && <div style={{ color: "#ef4444", fontSize: "14px", fontWeight: "600" }}>{error}</div>}
      {rechargeMsg && <div style={{ color: "#10b981", fontSize: "14px", fontWeight: "600" }}>{rechargeMsg}</div>}

      {/* BANNIÈRE CLÉ NOUVELLEMENT GÉNÉRÉE */}
      {generatedRawKey && (
        <div className="dev-panel-box" style={{ borderColor: "#6366f1", borderWidth: "2px" }}>
          <h3 style={{ margin: "0 0 8px 0", color: "#6366f1", fontSize: "16px" }}>Nouvelle Clé API Générée</h3>
          <p style={{ fontSize: "14px", margin: "4px 0" }}>
            Conservez cette clé en lieu sûr. Elle ne sera plus réaffichée par la suite.
          </p>
          <div className="dev-code-block" style={{ color: "#10b981", fontSize: "15px", margin: "12px 0" }}>
            {generatedRawKey}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              className="dev-metric-btn"
              style={{ background: "var(--dev-accent)", color: "#ffffff", padding: "8px 16px" }}
              onClick={() => {
                navigator.clipboard.writeText(generatedRawKey)
                alert("Clé API copiée !")
              }}
            >
              Copier la Clé
            </button>
            <button
              className="dev-metric-btn"
              style={{ background: "var(--dev-border)", color: "var(--dev-text-primary)", padding: "8px 16px" }}
              onClick={() => setGeneratedRawKey(null)}
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* GRILLE DE 4 CARTES MÉTRIQUES SUR 1 LIGNE EN HAUT (Exactement comme dans la capture) */}
      <div className="dev-metrics-grid">
        <div className="dev-metric-card">
          <div className="dev-metric-header">
            <div className="dev-metric-icon-box" style={{ background: "rgba(14, 165, 233, 0.15)", color: "#38bdf8" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            </div>
            <div className="dev-metric-info">
              <span className="dev-metric-label">SOLDE DISPONIBLE</span>
              <span className="dev-metric-value">{balance.toLocaleString()} ALC</span>
            </div>
          </div>
          <button className="dev-metric-btn" onClick={() => setActiveTab("sandbox")}>
            Recharger -&gt;
          </button>
        </div>

        <div className="dev-metric-card">
          <div className="dev-metric-header">
            <div className="dev-metric-icon-box" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
            </div>
            <div className="dev-metric-info">
              <span className="dev-metric-label">CRÉDITS EN HOLD</span>
              <span className="dev-metric-value">{hold.toLocaleString()} ALC</span>
            </div>
          </div>
          <button className="dev-metric-btn" onClick={() => setActiveTab("dashboard")}>
            Voir Détails -&gt;
          </button>
        </div>

        <div className="dev-metric-card">
          <div className="dev-metric-header">
            <div className="dev-metric-icon-box" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="7.5" cy="16.5" r="3.5" />
                <path d="M10 14l9-9" />
                <path d="M15 8l2 2" />
              </svg>
            </div>
            <div className="dev-metric-info">
              <span className="dev-metric-label">CLÉS API ACTIVES</span>
              <span className="dev-metric-value">{activeKeysCount}</span>
            </div>
          </div>
          <button className="dev-metric-btn" onClick={() => setActiveTab("keys")}>
            Gérer les Clés -&gt;
          </button>
        </div>

        <div className="dev-metric-card">
          <div className="dev-metric-header">
            <div className="dev-metric-icon-box" style={{ background: "rgba(139, 92, 246, 0.15)", color: "#8b5cf6" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </div>
            <div className="dev-metric-info">
              <span className="dev-metric-label">MESSAGES ESTIMÉS</span>
              <span className="dev-metric-value">{balance.toLocaleString()}</span>
            </div>
          </div>
          <button className="dev-metric-btn" onClick={() => setActiveTab("docs")}>
            Documentation -&gt;
          </button>
        </div>
      </div>

      {/* CONTENU SELON MENU SÉLECTIONNÉ DANS LA SIDEBAR GAUCHE */}

      {/* 1. TABLEAU DE BORD (APERÇU) */}
      {activeTab === "dashboard" && (
        <div className="dev-panel-box">
          <h3 className="dev-panel-title">Aperçu du Compte Développeur</h3>
          <p style={{ color: "var(--dev-text-secondary)", fontSize: "14px", lineHeight: "1.6", margin: 0 }}>
            Bienvenue sur votre Console Développeur Alanya. Votre solde actuel de <strong>{balance} crédits</strong>{" "}
            vous permet d'envoyer jusqu'à <strong>{balance} messages API</strong> ou d'effectuer{" "}
            <strong>{Math.floor(balance / 10)} minutes d'appels WebRTC</strong>. Générez une clé d'API pour démarrer
            vos intégrations.
          </p>
        </div>
      )}

      {/* 2. CLÉS D'API */}
      {activeTab === "keys" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div className="dev-panel-box">
            <h3 className="dev-panel-title">Générer une nouvelle Clé API</h3>
            <form onSubmit={handleCreateKey} style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Nom de la clé (ex: Serveur Production)"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--dev-border)",
                  background: "var(--dev-bg-page)",
                  color: "var(--dev-text-primary)",
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
                  borderRadius: "8px",
                  border: "1px solid var(--dev-border)",
                  background: "var(--dev-bg-page)",
                  color: "var(--dev-text-primary)",
                }}
              >
                <option value="SANDBOX">Sandbox (ak_test_...)</option>
                <option value="LIVE">Production (ak_live_...)</option>
              </select>
              <button
                type="submit"
                disabled={isSubmitting}
                className="dev-metric-btn"
                style={{ background: "#10b981", color: "#ffffff", padding: "10px 20px" }}
              >
                {isSubmitting ? "Création..." : "Générer la Clé"}
              </button>
            </form>
          </div>

          <div className="dev-panel-box">
            <h3 className="dev-panel-title">Liste des Clés d'API</h3>
            {apiKeys.length === 0 ? (
              <p style={{ color: "var(--dev-text-secondary)", margin: 0 }}>
                Aucune clé d'API active. Générez-en une ci-dessus.
              </p>
            ) : (
              <div className="dev-table-container">
                <table className="dev-table">
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th>Préfixe</th>
                      <th>Type</th>
                      <th>Statut</th>
                      <th>Création</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.map((k) => (
                      <tr key={k.id} style={{ opacity: k.isActive ? 1 : 0.5 }}>
                        <td style={{ fontWeight: "600" }}>{k.name}</td>
                        <td style={{ fontFamily: "monospace", color: "var(--dev-accent)" }}>{k.prefix}_••••••••</td>
                        <td>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: "4px",
                              fontSize: "12px",
                              fontWeight: "600",
                              background: k.type === "SANDBOX" ? "#0369a1" : "#15803d",
                              color: "#ffffff",
                            }}
                          >
                            {k.type}
                          </span>
                        </td>
                        <td>
                          <span style={{ color: k.isActive ? "#10b981" : "#ef4444", fontWeight: "600" }}>
                            {k.isActive ? "Active" : "Révoquée"}
                          </span>
                        </td>
                        <td style={{ color: "var(--dev-text-secondary)", fontSize: "13px" }}>
                          {new Date(k.createdAt).toLocaleDateString()}
                        </td>
                        <td>
                          {k.isActive && (
                            <button
                              className="dev-metric-btn"
                              style={{ background: "#dc2626", color: "#ffffff" }}
                              onClick={() => handleRevokeKey(k.id)}
                            >
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
        </div>
      )}

      {/* 3. RECHARGE SANDBOX */}
      {activeTab === "sandbox" && (
        <div className="dev-panel-box">
          <h3 className="dev-panel-title">Recharge Gratuit / Mode Sandbox</h3>
          <p style={{ color: "var(--dev-text-secondary)", fontSize: "14px", margin: "0 0 16px 0" }}>
            Testez vos fonctionnalités sans frais en créditant instantanément votre compte Sandbox :
          </p>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              className="dev-metric-btn"
              style={{ background: "var(--dev-accent)", color: "#ffffff", padding: "10px 18px" }}
              onClick={() => handleSandboxRecharge("STARTER")}
            >
              +1 000 Crédits (Starter)
            </button>
            <button
              className="dev-metric-btn"
              style={{ background: "#0d9488", color: "#ffffff", padding: "10px 18px" }}
              onClick={() => handleSandboxRecharge("PRO")}
            >
              +5 750 Crédits (Pro)
            </button>
            <button
              className="dev-metric-btn"
              style={{ background: "#7c3aed", color: "#ffffff", padding: "10px 18px" }}
              onClick={() => handleSandboxRecharge("ENTERPRISE")}
            >
              +26 000 Crédits (Enterprise)
            </button>
          </div>
        </div>
      )}

      {/* 4. DOCUMENTATION cURL */}
      {activeTab === "docs" && (
        <div className="dev-panel-box">
          <h3 className="dev-panel-title">Exemple d'Intégration cURL</h3>
          <p style={{ color: "var(--dev-text-secondary)", fontSize: "14px", margin: "0 0 16px 0" }}>
            Transmettez votre clé d'API dans l'en-tête `X-Api-Key` ou `Authorization: Bearer` :
          </p>
          <div className="dev-code-block">
{`curl -X POST https://alanyavox.com/api/v1/messages/send \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: ak_test_votre_cle_api_ici" \\
  -d '{
    "recipientNumber": "600001",
    "content": "Bonjour depuis l'API Développeur Alanya"
  }'`}
          </div>
        </div>
      )}
    </div>
  )
}
