import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../../src/components/auth-provider"
import { ThemeToggle } from "../../../src/components/theme-toggle"
import { apiRequest } from "../../../src/lib/api-client"
import { PAYS_LIST, type Country } from "../../../src/data/countries"
import { saveRefreshToken, saveSessionToken } from "../../../src/data/session-auth"
import { saveSessionUser } from "../../../src/data/session-user"
import "./auth.css"

const alanyaLogo = `${import.meta.env.BASE_URL}alanya-logo.jpeg`

export default function DeveloperAuthPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [tab, setTab] = useState<"login" | "register">("login")

  // États Connexion
  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")

  // États Inscription Wizard (3 Écrans)
  const [screen, setScreen] = useState<1 | 2 | 3>(1)
  const [regEmail, setRegEmail] = useState("")
  const [regPassword, setRegPassword] = useState("")
  const [selectedCountry, setSelectedCountry] = useState<Country>(PAYS_LIST[0])

  // Étape 2 (OTP)
  const [otpCode, setOtpCode] = useState("")
  const [setupToken, setSetupToken] = useState("")

  // Étape 3 (Profil & Contact)
  const [nom, setNom] = useState("")
  const [phoneRaw, setPhoneRaw] = useState("")
  const [avatarUrl, setAvatarUrl] = useState("")

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // ----------------------------------------------------
  // CONNEXION DÉVELOPPEUR
  // ----------------------------------------------------
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setLoading(true)
      setError(null)
      await login({ phone: loginEmail, password: loginPassword })
      navigate("/developer/dashboard", { replace: true })
    } catch (err: any) {
      setError(err?.message || "Identifiants invalides")
    } finally {
      setLoading(false)
    }
  }

  // ----------------------------------------------------
  // INSCRIPTION ÉCRAN 1 : Identifiants & Pays -> Envoi OTP
  // ----------------------------------------------------
  const handleScreen1Submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!regEmail || !regPassword) return
    try {
      setLoading(true)
      setError(null)
      setMsg(null)

      const data = (await apiRequest("/api/auth/register", {
        method: "POST",
        body: { email: regEmail },
      })) as any

      if (data && data.ok) {
        setMsg(`Code de confirmation OTP envoyé à ${regEmail}`)
        setScreen(2)
      } else {
        setError(data?.error || "Erreur d'envoi du code OTP")
      }
    } catch (err: any) {
      setError(err?.message || "Erreur réseau")
    } finally {
      setLoading(false)
    }
  }

  // ----------------------------------------------------
  // INSCRIPTION ÉCRAN 2 : Vérification OTP (Page Dédiée)
  // ----------------------------------------------------
  const handleScreen2Submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otpCode.length < 6) {
      setError("Le code OTP doit comporter 6 chiffres")
      return
    }
    try {
      setLoading(true)
      setError(null)
      setMsg(null)

      const data = (await apiRequest("/api/auth/verify", {
        method: "POST",
        body: { email: regEmail, code: otpCode },
      })) as any

      if (data && data.ok && data.data.setupToken) {
        setSetupToken(data.data.setupToken)
        setMsg("Email vérifié avec succès !")
        setScreen(3)
      } else {
        setError(data?.error || "Code OTP incorrect ou expiré")
      }
    } catch (err: any) {
      setError(err?.message || "Erreur de vérification OTP")
    } finally {
      setLoading(false)
    }
  }

  // ----------------------------------------------------
  // INSCRIPTION ÉCRAN 3 : Profil, Contact & Finalisation
  // ----------------------------------------------------
  const handleScreen3Submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nom.trim()) {
      setError("Le nom complet est obligatoire")
      return
    }
    try {
      setLoading(true)
      setError(null)

      // Formatage du téléphone avec l'indicatif international
      const fullMobile = phoneRaw.trim()
        ? phoneRaw.startsWith("+")
          ? phoneRaw.trim()
          : `${selectedCountry.indicatif}${phoneRaw.trim()}`
        : null

      // Avatar Dicebear SVG automatique si omis
      const finalAvatar =
        avatarUrl.trim() || `https://api.dicebear.com/7.x/icons/svg?seed=dev_${encodeURIComponent(regEmail)}`

      const data = (await apiRequest("/api/auth/register-dev", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${setupToken}`,
        },
        body: {
          password: regPassword,
          nom: nom.trim(),
          idPays: selectedCountry.idPays,
          mobile: fullMobile,
          avatarUrl: finalAvatar,
        },
      })) as any

      if (data && data.ok && data.data.tokens) {
        if (data.data.tokens.accessToken) saveSessionToken(data.data.tokens.accessToken)
        if (data.data.tokens.refreshToken) saveRefreshToken(data.data.tokens.refreshToken)
        if (data.data.user) {
          saveSessionUser({
            id: data.data.user.id,
            name: data.data.user.pseudo || nom.trim(),
            email: data.data.user.email,
            phone: fullMobile || "",
            avatar: data.data.user.avatarUrl || finalAvatar,
          })
        }
        window.location.href = `${import.meta.env.BASE_URL}developer/dashboard`
      } else {
        setError(data?.error || "Erreur de finalisation du compte développeur")
      }
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la création du compte")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dev-auth-root">
      <div className="dev-auth-header">
        <ThemeToggle />
      </div>

      <div className="dev-auth-card">
        <div className="dev-auth-logo-row">
          <img src={alanyaLogo} alt="Alanya Dev" className="dev-auth-logo" />
          <h1 className="dev-auth-title">Alanya Développeur</h1>
        </div>

        {/* ONGLETS CONNEXION / INSCRIPTION */}
        <div className="dev-auth-tabs">
          <button
            className={`dev-auth-tab ${tab === "login" ? "active" : ""}`}
            onClick={() => {
              setTab("login")
              setError(null)
              setMsg(null)
            }}
          >
            Se Connecter
          </button>
          <button
            className={`dev-auth-tab ${tab === "register" ? "active" : ""}`}
            onClick={() => {
              setTab("register")
              setError(null)
              setMsg(null)
            }}
          >
            Créer un Compte Développeur
          </button>
        </div>

        {error && <div style={{ color: "#ef4444", fontSize: "14px", marginBottom: "16px" }}>⚠️ {error}</div>}
        {msg && <div style={{ color: "#10b981", fontSize: "14px", marginBottom: "16px" }}>✅ {msg}</div>}

        {/* FORMULAIRE DE CONNEXION DÉVELOPPEUR */}
        {tab === "login" && (
          <form onSubmit={handleLogin}>
            <div className="dev-input-group">
              <label className="dev-input-label">Email Développeur</label>
              <input
                type="email"
                className="dev-input-field"
                placeholder="dev@example.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>

            <div className="dev-input-group">
              <label className="dev-input-label">Mot de Passe</label>
              <input
                type="password"
                className="dev-input-field"
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" disabled={loading} className="dev-submit-btn">
              {loading ? "Connexion..." : "Accéder à l'Espace Développeur"}
            </button>
          </form>
        )}

        {/* FORMULAIRE D'INSCRIPTION EN 3 ÉCRANS */}
        {tab === "register" && (
          <div>
            {/* INDICATEUR D'ÉTAPES WIZARD */}
            <div className="dev-wizard-steps">
              <div className={`dev-step-dot ${screen >= 1 ? (screen > 1 ? "completed" : "active") : ""}`}>1</div>
              <div className={`dev-step-dot ${screen >= 2 ? (screen > 2 ? "completed" : "active") : ""}`}>2</div>
              <div className={`dev-step-dot ${screen === 3 ? "active" : ""}`}>3</div>
            </div>

            {/* ÉCRAN 1 : Identifiants & Pays */}
            {screen === 1 && (
              <form onSubmit={handleScreen1Submit}>
                <h3 style={{ fontSize: "16px", margin: "0 0 14px 0", color: "var(--accent, #38bdf8)" }}>
                  Étape 1 : Identifiants & Pays
                </h3>

                <div className="dev-input-group">
                  <label className="dev-input-label">Email professionnel</label>
                  <input
                    type="email"
                    className="dev-input-field"
                    placeholder="developpeur@entreprise.com"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="dev-input-group">
                  <label className="dev-input-label">Mot de Passe (8+ caractères)</label>
                  <input
                    type="password"
                    className="dev-input-field"
                    placeholder="••••••••"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>

                <div className="dev-input-group">
                  <label className="dev-input-label">Pays d'origine</label>
                  <select
                    className="dev-input-field"
                    value={selectedCountry.code}
                    onChange={(e) => {
                      const found = PAYS_LIST.find((p) => p.code === e.target.value)
                      if (found) setSelectedCountry(found)
                    }}
                  >
                    {PAYS_LIST.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.flag} {p.nom} ({p.indicatif})
                      </option>
                    ))}
                  </select>
                </div>

                <button type="submit" disabled={loading} className="dev-submit-btn">
                  {loading ? "Envoi du code OTP..." : "Continuer -> Envoyer le Code OTP"}
                </button>
              </form>
            )}

            {/* ÉCRAN 2 : Code OTP Email (PAGE DÉDIÉE) */}
            {screen === 2 && (
              <form onSubmit={handleScreen2Submit}>
                <h3 style={{ fontSize: "16px", margin: "0 0 10px 0", color: "var(--accent, #38bdf8)" }}>
                  Étape 2 : Vérification du Code OTP Email
                </h3>
                <p style={{ fontSize: "13px", color: "var(--text-secondary, #94a3b8)", margin: "0 0 16px 0" }}>
                  Un code à 6 chiffres a été envoyé par email à <strong>{regEmail}</strong>.
                </p>

                <div className="dev-input-group">
                  <label className="dev-input-label">Code OTP à 6 chiffres</label>
                  <input
                    type="text"
                    className="dev-input-field"
                    style={{ fontSize: "20px", letterSpacing: "6px", textAlign: "center" }}
                    placeholder="123456"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                  <button
                    type="button"
                    className="dev-submit-btn"
                    style={{ background: "#334155", flex: "1" }}
                    onClick={() => setScreen(1)}
                  >
                    &lt;- Retour
                  </button>
                  <button type="submit" disabled={loading} className="dev-submit-btn" style={{ flex: "2" }}>
                    {loading ? "Vérification..." : "Vérifier le Code OTP"}
                  </button>
                </div>
              </form>
            )}

            {/* ÉCRAN 3 : Profil, Contact & Finalisation */}
            {screen === 3 && (
              <form onSubmit={handleScreen3Submit}>
                <h3 style={{ fontSize: "16px", margin: "0 0 14px 0", color: "var(--accent, #38bdf8)" }}>
                  Étape 3 : Profil, Contact & 1 000 Crédits
                </h3>

                <div className="dev-input-group">
                  <label className="dev-input-label">Nom complet</label>
                  <input
                    type="text"
                    className="dev-input-field"
                    placeholder="Jean Dupont"
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                    required
                  />
                </div>

                <div className="dev-input-group">
                  <label className="dev-input-label">
                    Téléphone ({selectedCountry.flag} Indicatif {selectedCountry.indicatif})
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <span
                      style={{
                        padding: "12px",
                        borderRadius: "8px",
                        background: "var(--bg-primary, #0f172a)",
                        border: "1px solid var(--border-color, #334155)",
                        fontSize: "14px",
                        fontWeight: "bold",
                        color: "var(--accent, #38bdf8)",
                      }}
                    >
                      {selectedCountry.indicatif}
                    </span>
                    <input
                      type="tel"
                      className="dev-input-field"
                      style={{ flex: 1 }}
                      placeholder="690000000"
                      value={phoneRaw}
                      onChange={(e) => setPhoneRaw(e.target.value)}
                    />
                  </div>
                </div>

                <div className="dev-input-group">
                  <label className="dev-input-label">
                    Photo de Profil (URL) — <em>Générée auto par Dicebear SVG si vide</em>
                  </label>
                  <input
                    type="url"
                    className="dev-input-field"
                    placeholder="https://... (ou laissez vide)"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                  />
                </div>

                <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                  <button
                    type="button"
                    className="dev-submit-btn"
                    style={{ background: "#334155", flex: "1" }}
                    onClick={() => setScreen(2)}
                  >
                    &lt;- Retour
                  </button>
                  <button type="submit" disabled={loading} className="dev-submit-btn" style={{ flex: "2" }}>
                    {loading ? "Création..." : "⚡ Terminer & Obtenir 1 000 Crédits"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
