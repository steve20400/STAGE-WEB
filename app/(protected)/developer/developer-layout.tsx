import React, { useState, createContext, useContext, useEffect } from "react"
import { useAuth } from "../../../src/components/auth-provider"
import { ThemeToggle } from "../../../src/components/theme-toggle"
import { useNavigate } from "react-router-dom"
import "./developer-layout.css"

const logoDev = `${import.meta.env.BASE_URL}logo-alanya-dev.png`

// ⚠️ `"sandbox"` retiré le 21/08/2026 avec la facturation. C'est le TYPE qui
// fait le ménage : tout `activeTab === "sandbox"` oublié ailleurs devient une
// erreur de compilation plutôt qu'un onglet mort qui ne s'affiche jamais.
// `"enseignes"` ajouté le 07/11/2026 : créer, voir et supprimer ses enseignes.
export type DeveloperTab = "dashboard" | "enseignes" | "keys" | "logs" | "webhooks" | "docs"

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
  /** Le tiroir de navigation, sous 900 px de large (20/11/2026). */
  const [menuOuvert, setMenuOuvert] = useState(false)

  // Échap referme le tiroir, comme celui de l'application.
  useEffect(() => {
    if (!menuOuvert) return
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOuvert(false)
    }
    window.addEventListener("keydown", surTouche)
    return () => window.removeEventListener("keydown", surTouche)
  }, [menuOuvert])

  /** Choisir un onglet referme le tiroir : on veut voir la page choisie. */
  const choisir = (onglet: DeveloperTab) => {
    setActiveTab(onglet)
    setMenuOuvert(false)
  }

  const handleLogout = async () => {
    await logout()
    navigate("/developer/auth", { replace: true })
  }

  const avatar =
    user?.avatar || `https://api.dicebear.com/7.x/icons/svg?seed=dev_${encodeURIComponent(user?.email || "dev")}`

  return (
    <DeveloperTabContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="dev-layout-root">
        {/* BARRE DU HAUT, sous 900 px seulement : elle porte le bouton du tiroir. */}
        <header className="dev-topbar">
          <button
            type="button"
            className="dev-menu-btn"
            aria-label="Ouvrir le menu"
            aria-expanded={menuOuvert}
            onClick={() => setMenuOuvert(true)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
          <img src={logoDev} alt="" className="dev-sidebar-logo" />
          <span className="dev-sidebar-title">Alanya Dev</span>
        </header>
        <div className={`dev-voile ${menuOuvert ? "ouvert" : ""}`} onClick={() => setMenuOuvert(false)} />

        {/* SIDEBAR VERTICALE À GAUCHE (tiroir sous 900 px) */}
        <aside className={`dev-sidebar ${menuOuvert ? "ouvert" : ""}`}>
          <div className="dev-sidebar-top">
            <div className="dev-sidebar-brand">
              <img src={logoDev} alt="Alanya Dev Logo" className="dev-sidebar-logo" />
              <span className="dev-sidebar-title">Alanya Dev</span>
              <button type="button" className="dev-fermer" aria-label="Fermer le menu" onClick={() => setMenuOuvert(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>

            {/* MENU NAVIGATION VERTICALE DANS LA SIDEBAR */}
            <nav className="dev-sidebar-nav">
              <button
                className={`dev-nav-item ${activeTab === "dashboard" ? "active" : ""}`}
                onClick={() => choisir("dashboard")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Tableau de bord
              </button>

              <button
                className={`dev-nav-item ${activeTab === "enseignes" ? "active" : ""}`}
                onClick={() => choisir("enseignes")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l1.5-5h15L21 9" />
                  <path d="M3 9h18v2a3 3 0 01-6 0 3 3 0 01-6 0 3 3 0 01-6 0z" />
                  <path d="M5 13v8h14v-8" />
                  <path d="M10 21v-5h4v5" />
                </svg>
                Mes enseignes
              </button>

              <button
                className={`dev-nav-item ${activeTab === "keys" ? "active" : ""}`}
                onClick={() => choisir("keys")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="7.5" cy="16.5" r="3.5" />
                  <path d="M10 14l9-9" />
                  <path d="M15 8l2 2" />
                </svg>
                Clés d'API
              </button>

              <button
                className={`dev-nav-item ${activeTab === "logs" ? "active" : ""}`}
                onClick={() => choisir("logs")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                Journal
              </button>

              <button
                className={`dev-nav-item ${activeTab === "webhooks" ? "active" : ""}`}
                onClick={() => choisir("webhooks")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 01-3.46 0" />
                </svg>
                Webhook
              </button>

              <button
                className={`dev-nav-item ${activeTab === "docs" ? "active" : ""}`}
                onClick={() => choisir("docs")}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                Documentation
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
