import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "../../../src/i18n"
const alanyaLogo = `${import.meta.env.BASE_URL}alanya-logo.jpeg`
import "./forgot-password-page.css"
import { BrandName } from "../../../src/components/brand-name"

function isValidIdentifier(value: string) {
  const trimmed = value.trim()
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
  const phoneOk = /^\+?[0-9\s().-]{8,20}$/.test(trimmed)
  return emailOk || phoneOk
}

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
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
        <Link to="/" className="fp-brand" aria-label={t("auth_back_home")}>
          <img src={alanyaLogo} alt={t("x2_logo_alt")} className="fp-logo" />
          <span>
            <BrandName className="fp-brand-name" />
          </span>
        </Link>

        <div className="fp-copy">
          <div className="fp-pretitle">{t("auth_recovery")}</div>
          <h1>{t("auth_recover_account")}</h1>
          <p>{t("auth_recover_explain")}</p>
        </div>

        {submitted ? (
          <div className="fp-success" role="status">
            <strong>{t("auth_account_found")}</strong>
            <span>{t("auth_recover_next", { identifiant: identifier.trim() })}</span>
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
              <label htmlFor="identifier">{t("auth_email_or_phone")}</label>
            </div>

            <button type="submit" className="fp-submit" disabled={!canSubmit}>
              {t("auth_check_account")}
            </button>
          </form>
        )}

        <div className="fp-actions">
          <Link to="/login">{t("auth_back_to_login")}</Link>
          <Link to="/signup">{t("create_account")}</Link>
        </div>
      </main>
    </div>
  )
}
