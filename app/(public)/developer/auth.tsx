import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../../src/components/auth-provider"
import { DeuxEtapesRequises } from "../../../src/services/auth-api"
import { ThemeToggle } from "../../../src/components/theme-toggle"
import { isValidAlanyaNumber, normalizeAlanyaNumber } from "../../../src/lib/alanya-number"
import "./auth.css"

const logoDev = `${import.meta.env.BASE_URL}logo-alanya-dev.png`

/*
 * L'ENTRÉE DE L'ESPACE DÉVELOPPEUR (07/11/2026, demandes du user).
 *
 * « Continuer avec Alanya Work » ouvre NOTRE écran de connexion, ici même, et
 * non celui de la messagerie : identifiant et mot de passe, puis le code à
 * six chiffres envoyé dans l'application quand le compte l'exige. Une fois
 * authentifiée, la personne arrive dans sa console développeur — la
 * messagerie ne démarre pas (`loginDeveloppeur`).
 *
 * « Créer un compte développeur » reste l'inscription d'Alanya : les mêmes
 * étapes que sur le mobile jusqu'à l'attribution du numéro, puis retour à la
 * console pour créer l'enseigne.
 */

const CONSOLE = "/developer/dashboard"

type Etape = "choix" | "connexion" | "code"

/** Un numéro Alanya (chiffres, espaces, tirets) ou une adresse. */
function normaliserIdentifiant(valeur: string): string {
  const compact = valeur.trim().replace(/\s+/g, "")
  return /^[\d-]+$/.test(compact) ? normalizeAlanyaNumber(compact) : compact
}

function identifiantValide(valeur: string): boolean {
  const n = normaliserIdentifiant(valeur)
  return isValidAlanyaNumber(n) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n)
}

export default function DeveloperAuthPage() {
  const navigate = useNavigate()
  const { user, isAuthenticated, logout, loginDeveloppeur, loginDeveloppeurAvecCode } = useAuth()

  const [etape, setEtape] = useState<Etape>("choix")
  const [identifiant, setIdentifiant] = useState("")
  const [motDePasse, setMotDePasse] = useState("")
  const [voirMotDePasse, setVoirMotDePasse] = useState(false)
  const [defiId, setDefiId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const secondaire = { background: "transparent", color: "inherit", border: "1px solid currentColor" }

  const entrerDansLaConsole = () => navigate(CONSOLE, { replace: true })

  const seConnecter = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!identifiantValide(identifiant) || motDePasse.length < 4) return
    setErreur(null)
    setEnCours(true)
    try {
      await loginDeveloppeur({ phone: normaliserIdentifiant(identifiant), password: motDePasse })
      entrerDansLaConsole()
    } catch (err) {
      if (err instanceof DeuxEtapesRequises) {
        setDefiId(err.defiId)
        setCode("")
        setEtape("code")
        return
      }
      setErreur(err instanceof Error && err.message ? err.message : "Identifiants incorrects.")
    } finally {
      setEnCours(false)
    }
  }

  const confirmerCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!defiId || !/^\d{6}$/.test(code)) return
    setErreur(null)
    setEnCours(true)
    try {
      await loginDeveloppeurAvecCode(defiId, code)
      entrerDansLaConsole()
    } catch (err) {
      setErreur(err instanceof Error && err.message ? err.message : "Code incorrect.")
    } finally {
      setEnCours(false)
    }
  }

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

        <h1 className="dev-auth-heading">
          {etape === "choix" && "Espace développeur"}
          {etape === "connexion" && "Connexion à l'espace développeur"}
          {etape === "code" && "Confirmez que c'est vous"}
        </h1>

        {erreur && <div className="dev-auth-error" role="alert">{erreur}</div>}

        {etape === "choix" && (
          <>
            <p style={{ textAlign: "center", margin: "0 0 24px 0", lineHeight: 1.6, opacity: 0.8 }}>
              Envoyez des messages et des codes de vérification aux utilisateurs d'Alanya depuis votre serveur.
            </p>
            <div className="dev-auth-form">
              {isAuthenticated ? (
                <>
                  <button type="button" className="dev-submit-action" onClick={entrerDansLaConsole}>
                    Continuer en tant que {user?.name || user?.email || "moi"}
                  </button>
                  <button
                    type="button"
                    className="dev-submit-action"
                    style={secondaire}
                    onClick={async () => {
                      await logout()
                      setEtape("connexion")
                    }}
                  >
                    Utiliser un autre compte
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="dev-submit-action" onClick={() => setEtape("connexion")}>
                    Continuer avec Alanya Work
                  </button>
                  <button
                    type="button"
                    className="dev-submit-action"
                    style={secondaire}
                    onClick={() => navigate("/signup", { state: { from: { pathname: CONSOLE } } })}
                  >
                    Créer un compte développeur
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {etape === "connexion" && (
          <form onSubmit={seConnecter} className="dev-auth-form">
            <div className="dev-input-wrapper">
              <input
                type="text"
                className="dev-input-control"
                placeholder="Numéro Alanya ou adresse e-mail"
                autoComplete="username"
                value={identifiant}
                onChange={(e) => setIdentifiant(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="dev-input-wrapper">
              <input
                type={voirMotDePasse ? "text" : "password"}
                className="dev-input-control"
                placeholder="Mot de passe"
                autoComplete="current-password"
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
                required
              />
              <button type="button" className="dev-password-toggle" onClick={() => setVoirMotDePasse((v) => !v)}>
                {voirMotDePasse ? "Masquer" : "Afficher"}
              </button>
            </div>
            <button
              type="submit"
              className="dev-submit-action"
              disabled={enCours || !identifiantValide(identifiant) || motDePasse.length < 4}
            >
              {enCours ? "Connexion…" : "Se connecter"}
            </button>
            <div className="dev-auth-footer-link">
              <button
                type="button"
                className="dev-link-accent"
                style={{ background: "none", border: 0, cursor: "pointer", padding: 0, font: "inherit" }}
                onClick={() => {
                  setErreur(null)
                  setEtape("choix")
                }}
              >
                Retour
              </button>
            </div>
          </form>
        )}

        {etape === "code" && (
          <form onSubmit={confirmerCode} className="dev-auth-form">
            <p style={{ textAlign: "center", margin: "0 0 8px 0", lineHeight: 1.6, opacity: 0.85 }}>
              Un code à 6 chiffres vient d'être envoyé dans l'application Alanya de votre téléphone.
            </p>
            <div className="dev-input-wrapper">
              <input
                className="dev-input-control"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                style={{ letterSpacing: "6px", textAlign: "center", fontSize: "20px" }}
                autoFocus
              />
            </div>
            <button type="submit" className="dev-submit-action" disabled={enCours || code.length !== 6}>
              {enCours ? "Vérification…" : "Confirmer"}
            </button>
            <div className="dev-auth-footer-link">
              <button
                type="button"
                className="dev-link-accent"
                style={{ background: "none", border: 0, cursor: "pointer", padding: 0, font: "inherit" }}
                onClick={() => {
                  setErreur(null)
                  setDefiId(null)
                  setEtape("connexion")
                }}
              >
                Recevoir un nouveau code
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
