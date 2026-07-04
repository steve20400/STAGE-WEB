import { useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../../../src/components/auth-provider"
const alanyaLogo = "/alanya-logo.png"
import "./login-page.css"

function normalizeIdentifier(value: string) {
  return value.trim().replace(/\s+/g, "")
}

// Le backend accepte un email ou le numero Alanya a 6 chiffres.
function isValidIdentifier(value: string) {
  const normalized = normalizeIdentifier(value)
  return /^\d{6}$/.test(normalized) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [showPwd, setShowPwd] = useState(false)
  const [phone, setPhone] = useState("")
  const [pwd, setPwd] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const canSubmit = useMemo(() => {
    return isValidIdentifier(phone) && pwd.length >= 4
  }, [phone, pwd])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    const redirectTo =
      (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/dashboard"

    setError("")
    setLoading(true)

    try {
      await login({ phone, password: pwd })
      navigate(redirectTo, { replace: true })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Connexion impossible.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-root">
      <div className="left-panel">
        <div className="logo">
          <img src={alanyaLogo} alt="Logo Alanya" className="auth-school-logo" />
          <div className="auth-brand-copy">
            <span className="logo-name">Alanya</span>
            <span className="auth-brand-subtitle">Messagerie ENSPY</span>
          </div>
        </div>

        <div className="left-body">
          <h1 className="left-heading">
            Content de
            <br />
            te <em>revoir.</em>
          </h1>
          <p className="left-sub">
            Utilisez votre email ou votre numero Alanya et votre mot de passe pour reprendre vos
            conversations.
          </p>
        </div>

        <div className="stat-row">
          <div>
            <div className="stat-num">Messages</div>
            <div className="stat-lbl">texte, vocaux et fichiers</div>
          </div>
          <div>
            <div className="stat-num">Appels</div>
            <div className="stat-lbl">audio et video</div>
          </div>
          <div>
            <div className="stat-num">Statuts</div>
            <div className="stat-lbl">ephemeres 24 h</div>
          </div>
        </div>
      </div>

      <div className="right-panel">
        <form className="form-card" onSubmit={handleSubmit}>
          <div className="form-pretitle">Connexion</div>
          <h2 className="form-title">Bon retour.</h2>
          <p className="form-subtitle">Entrez vos identifiants pour acceder a votre compte.</p>

          {error ? (
            <div
              style={{
                marginBottom: 16,
                border: "1px solid var(--danger-border, #ef444430)",
                background: "var(--danger-dim, #ef444415)",
                color: "var(--danger, #ef4444)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}

          <div className="field">
            <input
              id="phone"
              type="text"
              placeholder=" "
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              required
              autoComplete="username"
            />
            <label htmlFor="phone">Email ou numero Alanya (6 chiffres)</label>
          </div>

          <div className="field">
            <input
              id="password"
              type={showPwd ? "text" : "password"}
              placeholder=" "
              value={pwd}
              onChange={(event) => setPwd(event.target.value)}
              required
              autoComplete="current-password"
              style={{ paddingRight: 52 }}
            />
            <label htmlFor="password">Mot de passe</label>
            <button
              type="button"
              className="pwd-toggle"
              onClick={() => setShowPwd((value) => !value)}
              aria-label={showPwd ? "Masquer" : "Afficher"}
            >
              {showPwd ? "Masquer" : "Afficher"}
            </button>
          </div>

          <div className="forgot-row">
            <Link to="/forgot-password" className="forgot-link">
              Mot de passe oublie ?
            </Link>
          </div>

          <button type="submit" className="btn-submit" disabled={loading || !canSubmit}>
            {loading ? (
              <>
                <div className="spinner" /> Connexion...
              </>
            ) : (
              <>Se connecter -&gt;</>
            )}
          </button>

          <p className="signup-txt">
            Pas encore de compte ?{" "}
            <Link to="/signup" className="signup-link">
              Creer un compte
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
