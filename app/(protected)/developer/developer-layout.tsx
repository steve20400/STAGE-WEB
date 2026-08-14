import React, { useState, createContext, useContext } from "react"
import { useAuth } from "../../../src/components/auth-provider"
import { ThemeToggle } from "../../../src/components/theme-toggle"
import { useNavigate } from "react-router-dom"
import "./developer-layout.css"

const logoDev = `${import.meta.env.BASE_URL}logo-alanya-dev.png`

export type DeveloperTab = "dashboard" | "keys" | "sandbox" | "docs"

interface DeveloperTabContextValue {
  activeTab: DeveloperTab
  setActiveTab: (t: DeveloperTab) => void
}

export const DeveloperTabContext = createContext<DeveloperTabContextValue>({
  activeTab: "dashboard",
  setActiveTab: () => {},
})

export function useDeveloperTab() {
  return useContext(DeveloperTabContext)
}

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<DeveloperTab>("dashboard")

  const handleLogout = async () => {
    await logout()
    navigate("/developer/auth", { replace: true })
  }

  const avatar =
    user?.avatar || `https://api.dicebear.com/7.x/icons/svg?seed=dev_${encodeURIComponent(user?.email || "dev")}`

  return (
    <DeveloperTabContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="dev-layout-root">
        {/* SIDEBAR VERTICALE À GAUCHE */}
        <aside className="dev-sidebar">
          <div className="dev-sidebar-top">
            <div className="dev-sidebar-brand">
              <img src={logoDev} alt="Alanya Dev Logo" className="dev-sidebar-logo" />
              <span className="dev-sidebar-title">Alanya Dev</span>
            </div>

            {/* MENU NAVIGATION VERTICALE DANS LA SIDEBAR */}
            <nav className="dev-sidebar-nav">
              <button
                className={`dev-nav-item ${activeTab === "dashboard" ? "active" : ""}`}
                onClick={() => setActiveTab("dashboard")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Tableau de bord
              </button>

              <button
                className={`dev-nav-item ${activeTab === "keys" ? "active" : ""}`}
                onClick={() => setActiveTab("keys")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="7.5" cy="16.5" r="3.5" />
                  <path d="M10 14l9-9" />
                  <path d="M15 8l2 2" />
                </svg>
                Clés d'API
              </button>

              <button
                className={`dev-nav-item ${activeTab === "sandbox" ? "active" : ""}`}
                onClick={() => setActiveTab("sandbox")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
                Recharge Sandbox
              </button>

              <button
                className={`dev-nav-item ${activeTab === "docs" ? "active" : ""}`}
                onClick={() => setActiveTab("docs")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                Documentation cURL
              </button>
            </nav>
          </div>

          {/* BAS DE LA SIDEBAR */}
          <div className="dev-sidebar-bottom">
            <div className="dev-user-card">
              <img src={avatar} alt={user?.name || "Dev"} className="dev-user-avatar" />
              <div className="dev-user-info">
                <span className="dev-user-name">{user?.name || user?.email || "Développeur"}</span>
                <span className="dev-user-role">Espace Développeur</span>
              </div>
            </div>

            <div className="dev-sidebar-controls">
              <ThemeToggle />
              <button onClick={handleLogout} className="dev-logout-btn">
                Déconnexion
              </button>
            </div>
          </div>
        </aside>

        {/* ZONE PRINCIPALE À DROITE */}
        <main className="dev-main-content">{children}</main>
      </div>
    </DeveloperTabContext.Provider>
  )
}
