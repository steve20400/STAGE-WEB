import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
const alanyaLogo = "/alanya-logo.png"
import "./forgot-password-page.css"

function isValidIdentifier(value: string) {
  const trimmed = value.trim()
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
  const phoneOk = /^\+?[0-9\s().-]{8,20}$/.test(trimmed)
  return emailOk || phoneOk
}

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("")
  const [submitted, setSubmitted] = useState(false)

  const canSubmit = useMemo(() => isValidIdentifier(identifier), [identifier])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitted(true)
  }

  return (
    <div className="fp-root">
      <main className="fp-card">
        <Link to="/" className="fp-brand" aria-label="Retour a l'accueil">
          <img src={alanyaLogo} alt="Logo Alanya" className="fp-logo" />
          <span>
            <strong>Alanya</strong>
            <small>Messagerie ENSPY</small>
          </span>
        </Link>

        <div className="fp-copy">
          <div className="fp-pretitle">Recuperation</div>
          <h1>Recuperation du compte.</h1>
          <p>
            Entrez l'email ou le numero associe au compte. Pour ce prototype, aucun vrai lien n'est
            envoye, mais le parcours reste pret pour le futur service serveur.
          </p>
        </div>

        {submitted ? (
          <div className="fp-success" role="status">
            <strong>Compte retrouve.</strong>
            <span>
              La prochaine version pourra envoyer un lien ou un code a{` ${identifier.trim()}`} pour
              changer le mot de passe.
            </span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="fp-field">
              <input
                id="identifier"
                type="text"
                placeholder=" "
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
              />
              <label htmlFor="identifier">Email ou numero de telephone</label>
            </div>

            <button type="submit" className="fp-submit" disabled={!canSubmit}>
              Verifier le compte -&gt;
            </button>
          </form>
        )}

        <div className="fp-actions">
          <Link to="/login">Retour a la connexion</Link>
          <Link to="/signup">Creer un compte</Link>
        </div>
      </main>
    </div>
  )
}
