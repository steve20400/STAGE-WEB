import React, { useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useAuth } from "../../../src/components/auth-provider"
import { ThemeToggle } from "../../../src/components/theme-toggle"
import "./auth.css"

const logoDev = `${import.meta.env.BASE_URL}logo-alanya-dev.png`

export default function DeveloperAuthPage() {
  const navigate = useNavigate()
  const { login } = useAuth()

  const [loginEmail, setLoginEmail] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="dev-auth-root">
      <div className="dev-auth-top-bar">
        <ThemeToggle />
      </div>

      <div className="dev-auth-container">
        <div className="dev-auth-brand-row">
          <img src={logoDev} alt="Alanya Dev Logo" className="dev-auth-brand-logo" />
          <span className="dev-auth-brand-name">Alanya Dev</span>
        </div>

        <h1 className="dev-auth-heading">Accès Espace Développeur</h1>

        {error && <div className="dev-auth-error">{error}</div>}

        <form onSubmit={handleLogin} className="dev-auth-form">
          <div className="dev-input-wrapper">
            <input
              type="email"
              className="dev-input-control"
              placeholder="Email / Identifiant"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              required
            />
          </div>

          <div className="dev-input-wrapper">
            <input
              type={showPassword ? "text" : "password"}
              className="dev-input-control"
              placeholder="Mot de passe"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="dev-password-toggle"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Masquer" : "Afficher"}
            </button>
          </div>

          <button type="submit" disabled={loading} className="dev-submit-action">
            {loading ? "Connexion..." : "Accéder à la Console Développeur"}
          </button>
        </form>

        <div className="dev-auth-footer-link">
          Pas encore de compte Alanya ?{" "}
          <Link to="/signup" className="dev-link-accent">
            Créer un compte
          </Link>
        </div>
      </div>
    </div>
  )
}
