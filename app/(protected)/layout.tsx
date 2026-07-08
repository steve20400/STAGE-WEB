import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../../src/components/auth-provider"
import { ThemeToggle } from "../../src/components/theme-toggle"
import IncomingCallOverlay from "../../src/components/incoming-call-overlay"
import { useCallState } from "../../src/hooks/use-call"
import { acceptIncomingCall, rejectIncomingCall } from "../../src/services/call-manager"
import { toInitials } from "../../src/data/session-user"
import { avatarDisplaySrc } from "../../src/lib/avatar"
const alanyaLogo = "/alanya-logo.jpeg"
import "./layout.css"

// TYPES

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
}

// ICONES SVG

const Icons = {
  Dashboard: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  Chat: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  Call: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  Contacts: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  Status: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="10" strokeDasharray="4 3" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </svg>
  ),
  Sparkle: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
    </svg>
  ),
  Settings: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  Logout: () => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
  Close: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Menu: () => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
}

// DONNEES DE NAVIGATION

// Les memes sections que la barre d'onglets du mobile :
// Discussions / Statuts / Appels / IA. Les contacts s'ouvrent via le
// bouton flottant orange de la liste des discussions (comme sur mobile).
const NAV_ITEMS: NavItem[] = [
  { href: "/chats", label: "Discussions", icon: <Icons.Chat /> },
  { href: "/status", label: "Statuts", icon: <Icons.Status /> },
  { href: "/calls", label: "Appels", icon: <Icons.Call /> },
  { href: "/ai", label: "Assistant IA", icon: <Icons.Sparkle /> },
  { href: "/contacts", label: "Contacts", icon: <Icons.Contacts /> },
]

const UNREAD_COUNTS: Record<string, number> = {}

// COMPOSANT Sidebar

interface SidebarProps {
  onClose?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

function Sidebar({ onClose, collapsed = false, onToggleCollapse }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { logout, user: sessionUser } = useAuth()
  const pathname = location.pathname

  const user = {
    name: sessionUser?.name ?? "Utilisateur Alanya",
    email: sessionUser?.email ?? "",
    initials: toInitials(sessionUser?.name ?? "Utilisateur Alanya"),
    status: "En ligne",
  }

  async function handleLogout() {
    await logout()
    navigate("/login", { replace: true })
  }

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      {/* Logo + bouton fermeture (mobile) / repli (desktop) */}
      <div className="sb-logo">
        <img src={alanyaLogo} alt="Logo Alanya" className="sb-school-logo" />
        <div className="sb-brand-copy">
          <span className="sb-logo-txt">Alanya</span>
          <span className="sb-logo-subtitle">Messagerie ENSPY</span>
        </div>
        {onToggleCollapse && (
          <button
            className="sb-collapse"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Deplier le menu" : "Replier le menu"}
            title={collapsed ? "Deplier" : "Replier"}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        {onClose && (
          <button className="sb-close" onClick={onClose} aria-label="Fermer le menu">
            <Icons.Close />
          </button>
        )}
      </div>

      {/* Navigation principale */}
      <nav className="sb-nav">
        <div className="sb-nav-section">Navigation</div>

        {NAV_ITEMS.map(({ href, label, icon }) => {
          const isActive = pathname.startsWith(href)
          const unreadCount = UNREAD_COUNTS[href]

          return (
            <Link
              key={href}
              to={href}
              className={`sb-link ${isActive ? "active" : ""}`}
              onClick={onClose}
              title={label}
            >
              {icon}
              <span className="sb-link-label">{label}</span>
              {unreadCount && <span className="sb-badge">{unreadCount}</span>}
            </Link>
          )
        })}

        <div className="sb-nav-section">Compte</div>

        <Link
          to="/settings"
          className={`sb-link ${pathname === "/settings" ? "active" : ""}`}
          onClick={onClose}
          title="Parametres"
        >
          <Icons.Settings />
          <span className="sb-link-label">Parametres</span>
        </Link>
      </nav>

      {/* Profil + deconnexion */}
      <div className="sb-footer">
        <div className="sb-theme-row">
          <span className="sb-theme-label">Theme</span>
          <ThemeToggle />
        </div>
        <div className="sb-profile" onClick={() => navigate("/settings")}>
          <div className="sb-avatar" style={{ overflow: "hidden" }}>
            {avatarDisplaySrc(sessionUser?.avatar) ? (
              <img
                src={avatarDisplaySrc(sessionUser?.avatar)!}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              user.initials
            )}
            <div className="sb-avatar-dot" />
          </div>
          <div className="sb-user-info">
            <div className="sb-user-name">{user.name}</div>
            <div className="sb-user-status">{user.status}</div>
          </div>
          <button
            className="sb-logout"
            onClick={(e) => {
              e.stopPropagation()
              handleLogout()
            }}
            aria-label="Se deconnecter"
            title="Se deconnecter"
          >
            <Icons.Logout />
          </button>
        </div>
      </div>
    </aside>
  )
}

// LAYOUT PROTEGE

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  // Navigation repliee par defaut (plus de place pour les discussions).
  const [collapsed, setCollapsed] = useState(() => {
    const stored =
      typeof window !== "undefined" ? localStorage.getItem("alanya-nav-collapsed") : null
    return stored === null ? true : stored === "1"
  })
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem("alanya-nav-collapsed", next ? "1" : "0")
      } catch {
        // stockage indisponible : pas grave
      }
      return next
    })
  }

  return (
    <div className={`layout-root ${collapsed ? "nav-collapsed" : ""}`}>
      <div className="layout-sidebar-static">
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </div>

      <div
        className={`mobile-overlay ${mobileOpen ? "open" : ""}`}
        onClick={() => setMobileOpen(false)}
      />

      <div className={`sidebar-mobile-wrap ${mobileOpen ? "open" : ""}`}>
        <Sidebar onClose={() => setMobileOpen(false)} />
      </div>

      {/* Zone de contenu principale */}
      <div className="layout-main">
        {/* Topbar mobile (cache la sidebar sur petit ecran) */}
        <header className="topbar">
          <button
            className="topbar-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
          >
            <Icons.Menu />
          </button>
          <div className="topbar-brand">
            <img src={alanyaLogo} alt="Logo Alanya" className="topbar-school-logo" />
            <div className="topbar-brand-copy">
              <span className="topbar-title">Alanya</span>
              <span className="topbar-subtitle">Messagerie ENSPY</span>
            </div>
          </div>
          <ThemeToggle />
        </header>

        {children}
      </div>

      {/* Overlay global d'appel entrant (WebSocket incoming_call) */}
      <GlobalIncomingCall />
    </div>
  )
}

// Ecoute les appels entrants du backend et affiche l'overlay d'acceptation.
function GlobalIncomingCall() {
  const navigate = useNavigate()
  const { incoming } = useCallState()

  if (!incoming) return null

  const displayName = incoming.isGroup
    ? (incoming.groupName ?? incoming.callerName)
    : incoming.callerName

  return (
    <IncomingCallOverlay
      caller={{
        id: incoming.callerId,
        name: displayName,
        initials: toInitials(displayName),
        color: { bg: "var(--accent-dim)", fg: "var(--accent)" },
      }}
      type={incoming.callType}
      onAccept={() => {
        void acceptIncomingCall().then((callId) => {
          if (callId) {
            navigate(`/calls/${callId}?type=${incoming.callType}&returnTo=/calls`)
          }
        })
      }}
      onDecline={() => {
        void rejectIncomingCall()
      }}
    />
  )
}
