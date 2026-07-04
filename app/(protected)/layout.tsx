import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../../src/components/auth-provider"
import { ThemeToggle } from "../../src/components/theme-toggle"
import IncomingCallOverlay from "../../src/components/incoming-call-overlay"
import { useCallState } from "../../src/hooks/use-call"
import { acceptIncomingCall, rejectIncomingCall } from "../../src/services/call-manager"
import { toInitials } from "../../src/data/session-user"
import polytechLogo from "../(public)/polytech.png"
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

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <Icons.Dashboard /> },
  { href: "/chats", label: "Messages", icon: <Icons.Chat /> },
  { href: "/status", label: "Statuts", icon: <Icons.Status /> },
  { href: "/calls", label: "Appels", icon: <Icons.Call /> },
  { href: "/contacts", label: "Contacts", icon: <Icons.Contacts /> },
]

const UNREAD_COUNTS: Record<string, number> = {
  "/chats": 3,
}

// COMPOSANT Sidebar

interface SidebarProps {
  onClose?: () => void
}

function Sidebar({ onClose }: SidebarProps) {
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
    <aside className="sidebar">
      {/* Logo + bouton fermeture (mobile) */}
      <div className="sb-logo">
        <img src={polytechLogo} alt="Logo Polytech Yaounde" className="sb-school-logo" />
        <div className="sb-brand-copy">
          <span className="sb-logo-txt">Alanya</span>
          <span className="sb-logo-subtitle">Messagerie ENSPY</span>
        </div>
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
            >
              {icon}
              {label}
              {unreadCount && <span className="sb-badge">{unreadCount}</span>}
            </Link>
          )
        })}

        <div className="sb-nav-section">Compte</div>

        <Link
          to="/settings"
          className={`sb-link ${pathname === "/settings" ? "active" : ""}`}
          onClick={onClose}
        >
          <Icons.Settings />
          Parametres
        </Link>
      </nav>

      {/* Profil + deconnexion */}
      <div className="sb-footer">
        <div className="sb-theme-row">
          <span className="sb-theme-label">Theme</span>
          <ThemeToggle />
        </div>
        <div className="sb-profile" onClick={() => navigate("/settings")}>
          <div className="sb-avatar">
            {user.initials}
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

  return (
    <div className="layout-root">
      <div className="layout-sidebar-static">
        <Sidebar />
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
            <img src={polytechLogo} alt="Logo Polytech Yaounde" className="topbar-school-logo" />
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
