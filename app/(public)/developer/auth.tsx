import { useNavigate } from "react-router-dom"
import { useAuth } from "../../../src/components/auth-provider"
import { ThemeToggle } from "../../../src/components/theme-toggle"
import "./auth.css"

const logoDev = `${import.meta.env.BASE_URL}logo-alanya-dev.png`

/*
 * L'ENTRÉE DE L'ESPACE DÉVELOPPEUR (07/11/2026, décisions du user).
 *
 * Deux portes, et derrière elles EXACTEMENT les pages d'Alanya :
 *  - « Créer un compte développeur » : l'inscription d'Alanya, les mêmes
 *    étapes que sur le mobile jusqu'à l'attribution du numéro. Le compte créé
 *    est un compte Alanya ordinaire ;
 *  - « Continuer avec Alanya Work » : la connexion d'Alanya, avec le code dans
 *    l'application quand le compte l'exige.
 * Les deux reviennent ensuite à la console, où l'on crée son enseigne.
 *
 * Cette page connectait par un formulaire à elle, qui ne savait pas passer
 * l'étape du code : un compte en deux étapes ne pouvait pas entrer.
 */

const CONSOLE = { from: { pathname: "/developer/dashboard" } }

export default function DeveloperAuthPage() {
  const navigate = useNavigate()
  const { user, isAuthenticated, logout } = useAuth()

  const secondaire = { background: "transparent", color: "inherit", border: "1px solid currentColor" }

  return (
    <div className="dev-auth-root">
      <div className="dev-auth-top-bar">
        <ThemeToggle />
      </div>

      <div className="dev-auth-container">
        <div className="dev-auth-brand-row">
          <img src={logoDev} alt="Alanya Dev" className="dev-auth-brand-logo" />
          <span className="dev-auth-brand-name">Alanya Dev</span>
        </div>

        <h1 className="dev-auth-heading">Espace développeur</h1>
        <p style={{ textAlign: "center", margin: "0 0 24px 0", lineHeight: 1.6, opacity: 0.8 }}>
          Envoyez des messages et des codes de vérification aux utilisateurs d'Alanya depuis votre serveur.
        </p>

        <div className="dev-auth-form">
          {isAuthenticated ? (
            <>
              <button type="button" className="dev-submit-action" onClick={() => navigate("/developer/dashboard")}>
                Continuer en tant que {user?.name || user?.email || "moi"}
              </button>
              <button
                type="button"
                className="dev-submit-action"
                style={secondaire}
                onClick={async () => {
                  await logout()
                  navigate("/login", { state: CONSOLE })
                }}
              >
                Utiliser un autre compte
              </button>
            </>
          ) : (
            <>
              <button type="button" className="dev-submit-action" onClick={() => navigate("/login", { state: CONSOLE })}>
                Continuer avec Alanya Work
              </button>
              <button
                type="button"
                className="dev-submit-action"
                style={secondaire}
                onClick={() => navigate("/signup", { state: CONSOLE })}
              >
                Créer un compte développeur
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
