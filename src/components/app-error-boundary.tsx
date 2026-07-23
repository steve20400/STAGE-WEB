import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Empêche une erreur isolée (preview, WebRTC, navigateur) de vider toute l'application. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Informations utiles en production sans exposer les données à l'écran.
    console.error("[Alanya] erreur d'interface interceptée", error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg-base)", color: "var(--text-primary)", fontFamily: "DM Sans, sans-serif" }}>
        <div style={{ width: "min(100%, 420px)", padding: 24, borderRadius: 16, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", textAlign: "center" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Une partie de l’application a rencontré un problème</div>
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>Vos messages ne sont pas supprimés. Rechargez la page pour reprendre la discussion.</div>
          <button onClick={() => window.location.reload()} style={{ border: "none", borderRadius: 8, padding: "9px 14px", cursor: "pointer", background: "var(--accent)", color: "var(--accent-text)", fontWeight: 600 }}>Recharger l’application</button>
        </div>
      </div>
    )
  }
}
