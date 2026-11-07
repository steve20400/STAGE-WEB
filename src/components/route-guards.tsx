import { type ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "./auth-provider"
import { useTranslation } from "../i18n"
import { restaurationEnAttente } from "../services/restauration-en-attente"

function RouteGuardFallback() {
  const { t } = useTranslation()
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg-base)",
        color: "var(--text-muted)",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: 14,
      }}
    >
      {t("loading")}
    </div>
  )
}

export function AppEntryRoute() {
  const { isAuthenticated, isReady } = useAuth()

  if (!isReady) {
    return <RouteGuardFallback />
  }

  return <Navigate to={isAuthenticated ? "/chats" : "/welcome"} replace />
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isReady } = useAuth()
  const location = useLocation()

  if (!isReady) {
    return <RouteGuardFallback />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <>{children}</>
}

/**
 * L'ESPACE DÉVELOPPEUR (07/11/2026) : alanyavox.com/developer y mène.
 *
 * Sans session, on arrive sur SA page d'entrée (« Continuer avec Alanya
 * Work » / « Créer un compte développeur »), et non sur la connexion
 * générale, qui ne propose pas de créer un compte développeur.
 */
export function EntreeDeveloppeur() {
  const { isAuthenticated, isReady } = useAuth()
  if (!isReady) return <RouteGuardFallback />
  return <Navigate to={isAuthenticated ? "/developer/dashboard" : "/developer/auth"} replace />
}

/** La console : sans session, retour à l'entrée de l'espace développeur. */
export function RouteDeveloppeur({ children }: { children: ReactNode }) {
  const { isAuthenticated, isReady } = useAuth()
  if (!isReady) return <RouteGuardFallback />
  if (!isAuthenticated) return <Navigate to="/developer/auth" replace />
  return <>{children}</>
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isReady } = useAuth()

  if (!isReady) {
    return <RouteGuardFallback />
  }

  if (isAuthenticated) {
    // ⚠️ Juste après la connexion, l'historique chiffré revient d'abord : ce
    // garde ne doit pas court-circuiter sa page. Voir `restauration-en-attente.ts`.
    return <Navigate to={restaurationEnAttente() ? "/restauration" : "/chats"} replace />
  }

  return <>{children}</>
}
