import { useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../../../src/components/auth-provider"
import { LANGUAGE_CODES, libelleLangue, useTranslation, type LanguageCode } from "../../../src/i18n"
import {
  ALANYA_NUMBER_FORMATTED_MAX_LENGTH,
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../../../src/lib/alanya-number"
const alanyaLogo = `${import.meta.env.BASE_URL}alanya-logo.jpeg`
import "./login-page.css"
import { BrandName } from "../../../src/components/brand-name"

function isNumberLikeIdentifier(value: string) {
  const compact = value.trim().replace(/\s+/g, "")
  return compact.length > 0 && /^[\d-]+$/.test(compact)
}

function normalizeIdentifier(value: string) {
  const compact = value.trim().replace(/\s+/g, "")
  return isNumberLikeIdentifier(compact) ? normalizeAlanyaNumber(compact) : compact
}

function formatIdentifierInput(value: string) {
  if (value.trim() === "") return ""
  return /^[\d\s-]+$/.test(value) ? formatAlanyaNumber(value).replace(/-/g, " ") : value
}

// Le backend accepte un email ou l'Alanya ID, sans longueur imposee.
function isValidIdentifier(value: string) {
  const normalized = normalizeIdentifier(value)
  return isValidAlanyaNumber(normalized) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { language, setLanguage, t } = useTranslation()
  const location = useLocation()
  const { login } = useAuth()
  const [showPwd, setShowPwd] = useState(false)
  const [phone, setPhone] = useState("")
  const [pwd, setPwd] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const canSubmit = useMemo(() => {
    return isValidIdentifier(phone) && pwd.length >= 4
  }, [phone, pwd])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    const redirectTo =
      (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/chats"

    setError("")
    setLoading(true)

    try {
      await login({ phone: normalizeIdentifier(phone), password: pwd })
      navigate(redirectTo, { replace: true })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Connexion impossible.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-root">
      <div className="left-panel">
        <div className="logo">
          <img src={alanyaLogo} alt="Logo Alanya Work" className="auth-school-logo" />
          <div className="auth-brand-copy">
            <BrandName className="logo-name" />
          </div>
        </div>

        <div className="left-body">
          <h1 className="left-heading">{t("login_heading")}</h1>
          <p className="left-sub">{t("login_left_sub")}</p>
        </div>

        <div className="stat-row">
          <div>
            <div className="stat-num">{t("login_stat_messages")}</div>
            <div className="stat-lbl">{t("login_stat_messages_sub")}</div>
          </div>
          <div>
            <div className="stat-num">{t("login_stat_calls")}</div>
            <div className="stat-lbl">{t("login_stat_calls_sub")}</div>
          </div>
          <div>
            <div className="stat-num">{t("login_stat_status")}</div>
            <div className="stat-lbl">{t("login_stat_status_sub")}</div>
          </div>
        </div>
      </div>

      <div className="right-panel">
        <form className="form-card" onSubmit={handleSubmit}>
          <div className="form-pretitle">{t("login_pretitle")}</div>
          <h2 className="form-title">{t("login_back")}</h2>
          <p className="form-subtitle">{t("login_subtitle")}</p>

          {error ? (
            <div
              style={{
                marginBottom: 16,
                border: "1px solid var(--danger-border, #ef444430)",
                background: "var(--danger-dim, #ef444415)",
                color: "var(--danger, #ef4444)",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}

          <div className="field">
            <input
              id="phone"
              type="text"
              placeholder=" "
              value={phone}
              onChange={(event) => setPhone(formatIdentifierInput(event.target.value))}
              required
              autoComplete="username"
              maxLength={
                isNumberLikeIdentifier(phone) ? ALANYA_NUMBER_FORMATTED_MAX_LENGTH : undefined
              }
            />
            <label htmlFor="phone">{t("email_or_id")}</label>
          </div>

          <div className="field">
            <input
              id="password"
              type={showPwd ? "text" : "password"}
              placeholder=" "
              value={pwd}
              onChange={(event) => setPwd(event.target.value)}
              required
              autoComplete="current-password"
              style={{ paddingRight: 52 }}
            />
            <label htmlFor="password">{t("password")}</label>
            <button
              type="button"
              className="pwd-toggle"
              onClick={() => setShowPwd((value) => !value)}
              aria-label={showPwd ? t("hide") : t("show")}
            >
              {showPwd ? t("hide") : t("show")}
            </button>
          </div>

          <div className="forgot-row">
            <Link to="/forgot-password" className="forgot-link">
              {t("forgot_password")}
            </Link>
          </div>

          {/* Juste au-dessus du bouton de connexion : c'est le dernier reglage
              qu'on ajuste avant de valider. Meme choix que dans les parametres —
              la langue est une preference d'appareil, deja retenue en arrivant. */}
          <div className="langue-field">
            <label className="langue-label" htmlFor="login-langue">
              {t("language_settings")}
            </label>
            <select
              id="login-langue"
              className="langue-select"
              value={language}
              onChange={(event) => setLanguage(event.target.value as LanguageCode)}
            >
              {LANGUAGE_CODES.map((code) => (
                <option key={code} value={code}>
                  {libelleLangue(code, language)}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-submit" disabled={loading || !canSubmit}>
            {loading ? (
              <>
                <div className="spinner" /> {t("signing_in")}
              </>
            ) : (
              <>{t("login_pretitle")}</>
            )}
          </button>

          <p className="signup-txt">
            {t("no_account")}{" "}
            <Link to="/signup" className="signup-link">
              {t("create_account")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
