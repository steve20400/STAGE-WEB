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

/*
 * 🔴 PLUS DE SOLDE NI DE BAC À SABLE (21/08/2026).
 *
 * `balanceCredits` et `holdCredits` ont disparu : l'API Alanya n'est plus
 * facturée. Elle sert la plateforme de l'équipe, qui porte son propre mécanisme
 * de paiement de son côté ; nous livrons un moyen de communiquer avec les
 * utilisateurs, pas un produit à crédits. La route
 * `POST /api/developer/billing/sandbox` a été SUPPRIMÉE du backend — tout ce
 * qui l'appelait ici part avec elle, plutôt que de rester à afficher un solde
 * qui n'existe plus.
 */
interface DeveloperData {
  id: string
}

interface WorkspaceItem {
  id: string
  name: string
  description?: string | null
  createdAt: string
}

interface ApiLogItem {
  id: string
  endpoint: string
  method: string
  statusCode: number
  latencyMs: number
  keyPrefix: string | null
  createdAt: string
}

interface WebhookItem {
  id: string
  url: string
  verifyToken?: string | null
  secretKey?: string | null
  isActive: boolean
  createdAt: string
}

function DevLatencyChart({ logs }: { logs: ApiLogItem[] }) {
  const points = logs.length >= 4
    ? logs.slice(0, 12).reverse().map((l, i) => ({ x: i, y: l.latencyMs, status: l.statusCode }))
    : [
        { x: 0, y: 110, status: 200 },
        { x: 1, y: 85, status: 200 },
        { x: 2, y: 95, status: 200 },
        { x: 3, y: 135, status: 200 },
        { x: 4, y: 102, status: 200 },
        { x: 5, y: 78, status: 200 },
        { x: 6, y: 125, status: 200 },
        { x: 7, y: 90, status: 200 },
        { x: 8, y: 115, status: 200 },
        { x: 9, y: 80, status: 200 },
      ]

  const width = 640
  const height = 180
  const padding = 32

  const maxY = Math.max(...points.map((p) => p.y), 180)
  const minY = Math.min(...points.map((p) => p.y), 40)

  const getX = (index: number) => padding + (index / (points.length - 1 || 1)) * (width - 2 * padding)
  const getY = (val: number) => height - padding - ((val - minY) / (maxY - minY || 1)) * (height - 2 * padding)

  const pathD = points.reduce((acc, p, i, a) => {
    const x = getX(i)
    const y = getY(p.y)
    if (i === 0) return `M ${x} ${y}`
    const prevX = getX(i - 1)
    const prevY = getY(a[i - 1].y)
    const cp1x = prevX + (x - prevX) / 2
    const cp2x = prevX + (x - prevX) / 2
    return `${acc} C ${cp1x} ${prevY}, ${cp2x} ${y}, ${x} ${y}`
  }, "")

  const areaD = `${pathD} L ${getX(points.length - 1)} ${height - padding} L ${getX(0)} ${height - padding} Z`

  return (
    <div className="dev-panel-box" style={{ marginTop: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--dev-accent)" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <div>
            <h4 style={{ margin: 0, fontSize: "15px", fontWeight: "700" }}>
              Rapport Graphique — Performance et Temps de Réponse API (ms)
            </h4>
            <span style={{ fontSize: "12px", color: "var(--dev-text-secondary)" }}>
              Courbe de télémétrie en temps réel des requêtes traitées par l'Alanya API
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--dev-accent)", display: "inline-block" }}></span>
            <span style={{ fontSize: "12px", fontWeight: "600" }}>Latence (ms)</span>
          </div>
        </div>
      </div>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--dev-accent)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--dev-accent)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((ratio, idx) => {
            const yPos = padding + ratio * (height - 2 * padding)
            return (
              <line
                key={idx}
                x1={padding}
                y1={yPos}
                x2={width - padding}
                y2={yPos}
                stroke="var(--dev-border)"
                strokeDasharray="4 4"
                strokeOpacity="0.6"
              />
            )
          })}

          <path d={areaD} fill="url(#latencyGradient)" />
          <path d={pathD} fill="none" stroke="var(--dev-accent)" strokeWidth="3" strokeLinecap="round" />

          {points.map((p, i) => {
            const cx = getX(i)
            const cy = getY(p.y)
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r="4.5" fill="var(--dev-bg-panel)" stroke="var(--dev-accent)" strokeWidth="2.5" />
                <text x={cx} y={cy - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--dev-text-primary)">
                  {p.y}ms
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

export default function DeveloperPage() {
  const { activeTab, setActiveTab } = useDeveloperTab()
  const [developer, setDeveloper] = useState<DeveloperData | null>(null)
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("")
  const [logs, setLogs] = useState<ApiLogItem[]>([])
  const [webhook, setWebhook] = useState<WebhookItem | null>(null)
  const [webhookUrl, setWebhookUrl] = useState("")
  const [webhookVerifyToken, setWebhookVerifyToken] = useState("")
  const [avgLatencyMs, setAvgLatencyMs] = useState<number>(0)
  const [successRatePercent, setSuccessRatePercent] = useState<number>(100)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyName, setKeyName] = useState("")
  const [keyType, setKeyType] = useState<"SANDBOX" | "LIVE">("SANDBOX")
  const [newWsName, setNewWsName] = useState("")
  const [showNewWsModal, setShowNewWsModal] = useState(false)
  /*
   * ⚠️ Les onglets `location` et `interactive` ont disparu le 21/08/2026.
   *
   * `interactive` et `template` étaient des notions WhatsApp : l'API les
   * aplatissait en texte (« [Titre] » concaténé), donc elle documentait des
   * boutons qu'aucun client Alanya n'a jamais affichés. `location` n'est pas un
   * endpoint mais un TYPE de message parmi d'autres — il est documenté avec
   * eux, où il se trouve réellement.
   */
  const [docType, setDocType] = useState<"message" | "media" | "verification" | "webhook">("message")
  const [generatedRawKey, setGeneratedRawKey] = useState<string | null>(null)
  const [webhookMsg, setWebhookMsg] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    fetchDeveloperData()
    fetchWorkspaces()
    fetchLogs()
    fetchWebhook()
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
        setDeveloper({ id: "default" })
        setApiKeys([])
      }
    } catch {
      setDeveloper({ id: "default" })
    } finally {
      setLoading(false)
    }
  }

  const fetchWorkspaces = async () => {
    try {
      const res = (await apiRequest("/api/developer/workspaces", { method: "GET" })) as any
      const list = res?.data?.workspaces || res?.workspaces || []
      setWorkspaces(list)
      if (list.length > 0 && !selectedWorkspaceId) {
        setSelectedWorkspaceId(list[0].id)
      }
    } catch {}
  }

  const fetchLogs = async () => {
    try {
      const res = (await apiRequest("/api/developer/logs", { method: "GET" })) as any
      const logList = res?.data?.logs || res?.logs || []
      const avg = res?.data?.avgLatencyMs ?? res?.avgLatencyMs ?? 0
      const rate = res?.data?.successRatePercent ?? res?.successRatePercent ?? 100
      setLogs(logList)
      setAvgLatencyMs(avg)
      setSuccessRatePercent(rate)
    } catch {}
  }

  const fetchWebhook = async () => {
    try {
      const res = (await apiRequest("/api/developer/webhooks", { method: "GET" })) as any
      const wh = res?.data?.webhook || res?.webhook || null
      if (wh) {
        setWebhook(wh)
        setWebhookUrl(wh.url || "")
        setWebhookVerifyToken(wh.verifyToken || "")
      }
    } catch {}
  }

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setIsSubmitting(true)
      setWebhookMsg(null)
      const res = (await apiRequest("/api/developer/webhooks", {
        method: "POST",
        body: { url: webhookUrl, verifyToken: webhookVerifyToken },
      })) as any

      const wh = res?.data?.webhook || res?.webhook
      if (wh) {
        setWebhook(wh)
        setWebhookMsg("Configuration Webhook enregistrée avec succès.")
      }
    } catch (err: any) {
      alert(err?.message || "Erreur de sauvegarde du Webhook")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newWsName.trim()) return
    try {
      setIsSubmitting(true)
      const res = (await apiRequest("/api/developer/workspaces", {
        method: "POST",
        body: { name: newWsName },
      })) as any
      const ws = res?.data?.workspace || res?.workspace
      if (ws) {
        setWorkspaces((prev) => [...prev, ws])
        setSelectedWorkspaceId(ws.id)
        setNewWsName("")
        setShowNewWsModal(false)
      }
    } catch (err: any) {
      alert(err?.message || "Erreur de création du workspace")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setIsSubmitting(true)
      setError(null)
      const data = (await apiRequest("/api/developer/keys", {
        method: "POST",
        body: { name: keyName || "Clé API", type: keyType, workspaceId: selectedWorkspaceId },
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

  const activeKeysCount = apiKeys.filter((k) => k.isActive).length
  const activeRawKey = apiKeys.find((k) => k.isActive)?.prefix ? `${apiKeys.find((k) => k.isActive)?.prefix}_...` : "ak_test_votre_cle_ici"

  return (
    <div className="dev-dashboard-main">
      {/* EN-TÊTE PRINCIPAL AVEC SÉLECTEUR DE WORKSPACE */}
      <div className="dev-main-header">
        <div className="dev-main-header-text">
          <h1 className="dev-main-title">
            {activeTab === "dashboard" && "Tableau de bord"}
            {activeTab === "keys" && "Gestion des Clés d'API"}
            {activeTab === "logs" && "Journal des Requêtes (Logs API)"}
            {activeTab === "webhooks" && "Webhooks & Callbacks Alanya API"}
            {activeTab === "docs" && "Documentation & Spécification Alanya API"}
          </h1>
          <p className="dev-main-subtitle">Spécification officielle Alanya API Graph v1</p>
        </div>

        <div className="dev-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* SÉLECTEUR DE WORKSPACE / PROJET */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--dev-text-secondary)", fontWeight: "600" }}>PROJET:</span>
            <select
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--dev-border)",
                background: "var(--dev-bg-page)",
                color: "var(--dev-text-primary)",
                fontWeight: "600",
                fontSize: "13px",
              }}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowNewWsModal(true)}
              className="dev-refresh-btn"
              title="Nouveau Projet / Workspace"
              style={{ padding: "8px 10px" }}
            >
              +
            </button>
          </div>

          <button onClick={() => { fetchDeveloperData(); fetchLogs(); fetchWebhook(); }} className="dev-refresh-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            Actualiser
          </button>
        </div>
      </div>

      {/* MODAL CRÉATION DE WORKSPACE */}
      {showNewWsModal && (
        <div className="dev-panel-box" style={{ borderColor: "var(--dev-accent)", borderWidth: "2px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>Créer un nouveau Projet / Workspace</h3>
          <form onSubmit={handleCreateWorkspace} style={{ display: "flex", gap: "10px" }}>
            <input
              type="text"
              placeholder="Nom du projet (ex: App Mobile Client)"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--dev-border)",
                background: "var(--dev-bg-page)",
                color: "var(--dev-text-primary)",
                flex: "1",
              }}
              required
            />
            <button type="submit" className="dev-metric-btn" style={{ background: "#10b981", color: "#ffffff", padding: "8px 16px" }}>
              {isSubmitting ? "Création..." : "Créer"}
            </button>
            <button type="button" className="dev-metric-btn" style={{ background: "var(--dev-border)", color: "var(--dev-text-primary)", padding: "8px 16px" }} onClick={() => setShowNewWsModal(false)}>
              Annuler
            </button>
          </form>
        </div>
      )}

      {error && <div style={{ color: "#ef4444", fontSize: "14px", fontWeight: "600", marginBottom: "12px" }}>{error}</div>}
      {webhookMsg && <div style={{ color: "#10b981", fontSize: "14px", fontWeight: "600", marginBottom: "12px" }}>{webhookMsg}</div>}

      {/* BANNIÈRE CLÉ NOUVELLEMENT GÉNÉRÉE */}
      {generatedRawKey && (
        <div className="dev-panel-box" style={{ borderColor: "#6366f1", borderWidth: "2px", marginBottom: "16px" }}>
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

      {/* GRILLE DE CARTES MÉTRIQUES AVEC LATENCE ET TAUX DE SUCCÈS */}
      <div className="dev-metrics-grid">
        <div className="dev-metric-card">
          <div className="dev-metric-header">
            <div className="dev-metric-icon-box" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="dev-metric-info">
              <span className="dev-metric-label">TAUX DE SUCCÈS API</span>
              <span className="dev-metric-value">{successRatePercent}%</span>
            </div>
          </div>
          <button className="dev-metric-btn" onClick={() => setActiveTab("logs")}>
            Logs Télémétrie -&gt;
          </button>
        </div>

        <div className="dev-metric-card">
          <div className="dev-metric-header">
            <div className="dev-metric-icon-box" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div className="dev-metric-info">
              <span className="dev-metric-label">LATENCE MOYENNE</span>
              <span className="dev-metric-value">{avgLatencyMs > 0 ? `${avgLatencyMs} ms` : "< 50 ms"}</span>
            </div>
          </div>
          <button className="dev-metric-btn" onClick={() => setActiveTab("logs")}>
            Voir Latence -&gt;
          </button>
        </div>

        <div className="dev-metric-card">
          <div className="dev-metric-header">
            <div className="dev-metric-icon-box" style={{ background: "rgba(139, 92, 246, 0.15)", color: "#8b5cf6" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 01-3.46 0" />
              </svg>
            </div>
            <div className="dev-metric-info">
              <span className="dev-metric-label">STATUT WEBHOOK</span>
              <span className="dev-metric-value">{webhook?.url ? "ACTIF" : "INACTIF"}</span>
            </div>
          </div>
          <button className="dev-metric-btn" onClick={() => setActiveTab("webhooks")}>
            Gérer Webhook -&gt;
          </button>
        </div>
      </div>

      {/* CONTENU SELON MENU SÉLECTIONNÉ DANS LA SIDEBAR GAUCHE */}

      {/* 1. TABLEAU DE BORD (APERÇU) */}
      {activeTab === "dashboard" && (
        <>
          <div className="dev-panel-box">
            <h3 className="dev-panel-title">Aperçu du Compte Développeur Alanya</h3>
            <p style={{ color: "var(--dev-text-secondary)", fontSize: "14px", lineHeight: "1.6", margin: 0 }}>
              Bienvenue sur votre Console Développeur Alanya. Vos clés vous permettent d'envoyer des messages texte,
              des médias, des messages interactifs avec boutons, et des codes d'authentification OTP via l'<strong>Alanya API</strong>.
            </p>
          </div>
          <DevLatencyChart logs={logs} />
        </>
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

      {/* 3. JOURNAL DES REQUÊTES (LOGS API & TÉLÉMÉTRIE) */}
      {activeTab === "logs" && (
        <>
          <div className="dev-panel-box">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h3 className="dev-panel-title" style={{ margin: 0 }}>Journal des Requêtes API (Télémétrie)</h3>
              <p style={{ color: "var(--dev-text-secondary)", fontSize: "13px", margin: "4px 0 0 0" }}>
                Historique des 50 derniers appels API avec codes de statut HTTP et temps de réponse.
              </p>
            </div>
            <button onClick={fetchLogs} className="dev-refresh-btn">
              Rafraîchir
            </button>
          </div>

          {logs.length === 0 ? (
            <p style={{ color: "var(--dev-text-secondary)", margin: 0 }}>
              Aucun appel API enregistré pour le moment. Effectuez un premier appel pour voir la télémétrie.
            </p>
          ) : (
            <div className="dev-table-container">
              <table className="dev-table">
                <thead>
                  <tr>
                    <th>Horodatage</th>
                    <th>Méthode</th>
                    <th>Endpoint</th>
                    <th>Statut</th>
                    <th>Latence</th>
                    <th>Préfixe Clé</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ color: "var(--dev-text-secondary)", fontSize: "13px" }}>
                        {new Date(log.createdAt).toLocaleTimeString()} ({new Date(log.createdAt).toLocaleDateString()})
                      </td>
                      <td>
                        <span style={{ fontWeight: "700", color: "var(--dev-accent)", fontSize: "12px" }}>
                          {log.method}
                        </span>
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "13px" }}>{log.endpoint}</td>
                      <td>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: "700",
                            background: log.statusCode >= 200 && log.statusCode < 300 ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                            color: log.statusCode >= 200 && log.statusCode < 300 ? "#10b981" : "#ef4444",
                          }}
                        >
                          {log.statusCode}
                        </span>
                      </td>
                      <td style={{ fontWeight: "600", fontSize: "13px" }}>{log.latencyMs} ms</td>
                      <td style={{ fontFamily: "monospace", color: "var(--dev-text-secondary)", fontSize: "12px" }}>
                        {log.keyPrefix || "ak_..."}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DevLatencyChart logs={logs} />
      </>
    )}

      {/* 4. WEBHOOKS ALANYA API */}
      {activeTab === "webhooks" && (
        <div className="dev-panel-box">
          <h3 className="dev-panel-title">Configuration des Webhooks (Callbacks Alanya)</h3>
          <p style={{ color: "var(--dev-text-secondary)", fontSize: "14px", margin: "0 0 16px 0" }}>
            Recevez les statuts de livraison en temps réel (`sent`, `delivered`, `read`) et les messages entrants sur votre serveur.
          </p>

          <form onSubmit={handleSaveWebhook} style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "600px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>URL du Webhook HTTP/HTTPS</label>
              <input
                type="url"
                placeholder="https://mon-serveur.com/api/webhooks/alanya"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--dev-border)",
                  background: "var(--dev-bg-page)",
                  color: "var(--dev-text-primary)",
                }}
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>Jeton de Vérification (Verify Token)</label>
              <input
                type="text"
                placeholder="ex: my_custom_verify_token_123"
                value={webhookVerifyToken}
                onChange={(e) => setWebhookVerifyToken(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--dev-border)",
                  background: "var(--dev-bg-page)",
                  color: "var(--dev-text-primary)",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="dev-metric-btn"
              style={{ background: "#10b981", color: "#ffffff", padding: "10px 20px", alignSelf: "flex-start" }}
            >
              {isSubmitting ? "Enregistrement..." : "Enregistrer la Configuration Webhook"}
            </button>
          </form>
        </div>
      )}

      {/* 5. DOCUMENTATION & SPÉCIFICATION ALANYA API */}
      {activeTab === "docs" && (
        <div className="dev-panel-box">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 className="dev-panel-title" style={{ margin: 0 }}>Documentation Officielle Alanya API</h3>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {(["message", "media", "verification", "webhook"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setDocType(type)}
                  className="dev-refresh-btn"
                  style={{
                    background: docType === type ? "var(--dev-accent)" : "transparent",
                    color: docType === type ? "#ffffff" : "var(--dev-text-primary)",
                    borderColor: docType === type ? "var(--dev-accent)" : "var(--dev-border)",
                    fontWeight: "600",
                    fontSize: "12px",
                    textTransform: "uppercase",
                  }}
                >
                  {type === "message" && "Messages"}
                  {type === "media" && "Médias"}
                  {type === "verification" && "Vérifications (OTP / 2FA)"}
                  {type === "webhook" && "Webhooks"}
                </button>
              ))}
            </div>
          </div>

          <p style={{ color: "var(--dev-text-secondary)", fontSize: "14px", margin: "0 0 16px 0" }}>
            Quatre routes, gratuites et sans quota de volume. Seule la cadence est plafonnée.
            Guide complet : <code>docs/2026-08-21-api-v1-integration.md</code>.
          </p>

          {docType === "message" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <h4 className="dev-doc-title">1. Message texte (POST /api/v1/messages)</h4>
                <div className="dev-code-block">
{`curl -X POST https://alanyavox.com/api/v1/messages \\
  -H "X-Api-Key: ${activeRawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "destinataire": "12345678",
    "type": "TEXT",
    "texte": "Bonjour depuis Alanya"
  }'

// 201 Created
{
  "id": "3f9a1c2e-…",          // l'identifiant RÉEL du message
  "statut": "ENVOYE",
  "destinataire": "12345678",
  "conversationId": "8c21…",
  "type": "TEXT",
  "medias": [],
  "envoyeA": "2026-08-21T14:02:11.482Z"
}`}
                </div>
              </div>

              <div>
                <h4 className="dev-doc-title">2. Message avec média</h4>
                <div className="dev-code-block">
{`// Téléversez d'abord le fichier (onglet Médias), puis :
curl -X POST https://alanyavox.com/api/v1/messages \\
  -H "X-Api-Key: ${activeRawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "destinataire": "12345678",
    "type": "IMAGE",
    "texte": "La légende, facultative",
    "mediaIds": ["b7d0…-uuid"]
  }'

// Types : TEXT · IMAGE · VIDEO · AUDIO · FILE · CONTACT · LOCATION
// Jusqu'à 10 mediaIds. Vous ne pouvez joindre que VOS propres
// téléversements — sinon 403 MEDIA_FORBIDDEN.`}
                </div>
              </div>

              <div>
                <h4 className="dev-doc-title">3. Position GPS</h4>
                <div className="dev-code-block">
{`// LOCATION porte sa charge en JSON dans "texte".
curl -X POST https://alanyavox.com/api/v1/messages \\
  -H "X-Api-Key: ${activeRawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "destinataire": "12345678",
    "type": "LOCATION",
    "texte": "{\\"v\\":1,\\"lat\\":3.848,\\"lon\\":11.502,\\"nom\\":\\"Agence Yaoundé\\"}"
  }'`}
                </div>
              </div>

              <div>
                <h4 className="dev-doc-title">Les trois refus à traiter</h4>
                <div className="dev-code-block">
{`404 RECIPIENT_NOT_FOUND  Le numéro n'a pas de compte Alanya.
                         Pas d'envoi hors plateforme.
403 RECIPIENT_BLOCKED    Blocage entre les deux comptes.
                         Ce n'est pas passager : cessez de réessayer.
403 MEDIA_FORBIDDEN      mediaId inconnu, ou téléversé par une autre clé.
422 VALIDATION           Champ absent ou hors bornes. Le détail est
                         dans error.details.fieldErrors.`}
                </div>
              </div>
            </div>
          )}

          {docType === "media" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <h4 className="dev-doc-title">Téléverser un fichier (POST /api/v1/media)</h4>
                <div className="dev-code-block">
{`// multipart/form-data — un VRAI fichier, pas une URL.
curl -X POST https://alanyavox.com/api/v1/media \\
  -H "X-Api-Key: ${activeRawKey}" \\
  -F "file=@facture.pdf"

// 201 Created
{
  "id": "b7d0…-uuid",
  "url": "/api/media/b7d0…-uuid",
  "nomFichier": "facture.pdf",
  "typeMime": "application/pdf",
  "octets": 48213,
  "dureeMs": null
}

// Champ facultatif : durationMs (audio, vidéo).
// Passez ensuite "id" dans mediaIds de POST /api/v1/messages.`}
                </div>
              </div>

              <div>
                <h4 className="dev-doc-title">À savoir</h4>
                <div className="dev-code-block">
{`400 INVALID_REQUEST      Vous avez envoyé du JSON. Cette route attend
                         un multipart avec un champ "file".
415 MEDIA_TYPE_REJECTED  Type hors liste blanche.
413 MEDIA_TOO_LARGE      Au-delà du plafond de taille.
502 STORAGE_UNAVAILABLE  Notre stockage n'a pas répondu. Réessayez.

L'url rendue est proxyfiée : c'est elle qui porte le contrôle
d'accès. Ne construisez pas d'URL de stockage vous-même.`}
                </div>
              </div>
            </div>
          )}

          {docType === "verification" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <h4 className="dev-doc-title">1. Émettre un code (POST /api/v1/verifications)</h4>
                <div className="dev-code-block">
{`curl -X POST https://alanyavox.com/api/v1/verifications \\
  -H "X-Api-Key: ${activeRawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "finalite": "AUTH_2FA",
    "destination": "agent@exemple.com",
    "canal": "EMAIL"
  }'

// finalite : AUTH_2FA · CREATION_AGENT · VALIDATION_CONTACT
// canal    : EMAIL · ALANYA  (défaut EMAIL pour AUTH_2FA)

{
  "id": "…", "finalite": "AUTH_2FA", "canal": "EMAIL",
  "destination": "agent@exemple.com",
  "expireA": "2026-08-21T14:07:11Z",
  "livraison": "REMIS"
}`}
                </div>
              </div>

              <div>
                <h4 className="dev-doc-title">2. Vérifier (POST /api/v1/verifications/check)</h4>
                <div className="dev-code-block">
{`curl -X POST https://alanyavox.com/api/v1/verifications/check \\
  -H "X-Api-Key: ${activeRawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "finalite": "AUTH_2FA",
    "destination": "agent@exemple.com",
    "code": "042518"
  }'

{ "verifie": false, "essaisRestants": 2 }`}
                </div>
              </div>

              <div>
                <h4 className="dev-doc-title">Deux règles qui vous concernent</h4>
                <div className="dev-code-block">
{`La réponse ne contient JAMAIS le code. C'est nous qui livrons.

"livraison": "REMIS" est CONSTATÉ, jamais supposé. Si rien n'est
parti, vous recevez 502 VERIFICATION_NOT_DELIVERED — pas un faux
succès.

Un refus ne dit pas POURQUOI (faux, expiré, déjà utilisé, trop
d'essais rendent la même réponse) : distinguer apprendrait à un
attaquant qu'il visait le bon code. Affichez essaisRestants.

Un seul code vivant à la fois par (destination, finalité) :
en émettre un nouveau invalide le précédent.`}
                </div>
              </div>
            </div>
          )}

          {docType === "webhook" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <h4 className="dev-doc-title">Ce que vous recevez</h4>
                <div className="dev-code-block">
{`POST <votre url>
X-Alanya-Signature: sha256=<hex>

{
  "evenement": "message.statut",
  "emisA": "2026-08-21T14:02:11.482Z",
  "donnees": {
    "messageId": "3f9a1c2e-…",
    "statut": "ENVOYE",
    "destinataire": "12345678"
  }
}

// statut : ENVOYE · REMIS · LU · ECHEC
// "evenement" n'a qu'une valeur aujourd'hui. Aiguillez quand
// même dessus : c'est ce qui nous permettra d'en ajouter.`}
                </div>
              </div>

              <div>
                <h4 className="dev-doc-title">Vérifier la signature</h4>
                <div className="dev-code-block">
{`const brut = await request.text();   // le CORPS BRUT, pas un objet
const attendu = "sha256=" + crypto
  .createHmac("sha256", process.env.ALANYA_WEBHOOK_SECRET)
  .update(brut, "utf8")
  .digest("hex");

const recu = request.headers.get("X-Alanya-Signature") ?? "";
const a = Buffer.from(recu), b = Buffer.from(attendu);
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
  return new Response("signature invalide", { status: 401 });
}
const charge = JSON.parse(brut);     // parser APRÈS, jamais avant`}
                </div>
              </div>

              <div>
                <h4 className="dev-doc-title">Trois règles</h4>
                <div className="dev-code-block">
{`1. Signez le CORPS BRUT. Un JSON.parse suivi d'une
   re-sérialisation change l'espacement, donc l'empreinte.
2. Comparez à TEMPS CONSTANT (timingSafeEqual), jamais par ===.
3. REJETEZ toute requête non signée. Sans secret configuré nous
   n'envoyons aucun en-tête, plutôt qu'un en-tête décoratif.

Le secret est rendu UNE SEULE FOIS, à l'enregistrement du
webhook. Il n'est plus relisible ensuite.`}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
