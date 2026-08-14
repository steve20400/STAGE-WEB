import React from "react"
import { useAuth } from "../../../src/components/auth-provider"
import { ThemeToggle } from "../../../src/components/theme-toggle"
import { useNavigate } from "react-router-dom"
import "./developer-layout.css"

const alanyaLogo = `${import.meta.env.BASE_URL}alanya-logo.jpeg`

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate("/developer/auth", { replace: true })
  }

  const avatar =
    user?.avatar || `https://api.dicebear.com/7.x/icons/svg?seed=dev_${encodeURIComponent(user?.email || "dev")}`

  return (
    <div className="dev-layout-root">
      <header className="dev-nav-header">
        <div className="dev-brand-container">
          <img src={alanyaLogo} alt="Alanya Dev Logo" className="dev-brand-logo" />
          <span className="dev-brand-title">Alanya Developer Console</span>
          <span className="dev-type-badge">Type 4 - Développeur</span>
        </div>

        <div className="dev-nav-actions">
          <div className="dev-user-profile">
            <img src={avatar} alt={user?.name || "Dev"} className="dev-user-avatar" />
            <span className="dev-user-name">{user?.name || user?.email || "Développeur"}</span>
          </div>

          <ThemeToggle />

          <button
            onClick={handleLogout}
            style={{
              padding: "7px 14px",
              borderRadius: "6px",
              border: "1px solid #ef4444",
              background: "transparent",
              color: "#ef4444",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Déconnexion
          </button>
        </div>
      </header>

      <main className="dev-content-body">{children}</main>
    </div>
  )
}
