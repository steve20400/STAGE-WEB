import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAuth } from "../../../src/components/auth-provider"
import { requestRegistrationOtp } from "../../../src/services/auth-api"
import { LANGUAGE_CODES, libelleLangue, useTranslation, type LanguageCode } from "../../../src/i18n"
const alanyaLogo = `${import.meta.env.BASE_URL}alanya-logo.jpeg`
import "./signup-page.css"
import { BrandName } from "../../../src/components/brand-name"

type Step = 1 | 2 | 3

interface FormData {
  name: string
  phone: string
  email: string
  password: string
  confirm: string
}

const OTP_LEN = 6

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

function passwordStrength(pwd: string) {
  let score = 0
  if (pwd.length >= 8) score += 1
  if (/[A-Z]/.test(pwd)) score += 1
  if (/[0-9]/.test(pwd)) score += 1
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1
  if (pwd.length >= 12) score += 1

  // La cle de traduction, pas le libelle : la force du mot de passe se dit dans
  // la langue de l'utilisateur comme le reste de l'ecran.
  const levels = [
    { cle: "strength_very_weak", color: "var(--danger)" },
    { cle: "strength_weak", color: "#f97316" },
    { cle: "strength_medium", color: "#eab308" },
    { cle: "strength_good", color: "#84cc16" },
    { cle: "strength_strong", color: "var(--success)" },
    { cle: "strength_very_strong", color: "var(--accent)" },
  ] as const

  return { score, ...levels[Math.min(5, score)] }
}

function StepHeader({
  step,
  title,
  subtitle,
}: {
  step: Step
  title: React.ReactNode
  subtitle: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="step-head">
      <div className="step-pre">{t("signup_step", { n: step })}</div>
      <h1 className="step-title">{title}</h1>
      <p className="step-sub">{subtitle}</p>
    </div>
  )
}

function OtpInput({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const refs = useRef<Array<HTMLInputElement | null>>([])

  return (
    <div className="otp-inputs">
      {Array.from({ length: OTP_LEN }, (_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el
          }}
          className="otp-digit"
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[index]}
          onChange={(event) => {
            const digit = event.target.value.replace(/\D/g, "").slice(-1)
            const next = [...value]
            next[index] = digit
            onChange(next)
            if (digit && index < OTP_LEN - 1) refs.current[index + 1]?.focus()
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !value[index] && index > 0) {
              refs.current[index - 1]?.focus()
            }
          }}
        />
      ))}
    </div>
  )
}

export default function SignUpPage() {
  const navigate = useNavigate()
  const { language, setLanguage, t } = useTranslation()
  const { register } = useAuth()

  const [step, setStep] = useState<Step>(1)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState<FormData>({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirm: "",
  })

  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LEN).fill(""))
  const [demoOtp, setDemoOtp] = useState("")
  const [countdown, setCountdown] = useState(0)

  const strength = useMemo(() => passwordStrength(form.password), [form.password])
  const match = form.password.length > 0 && form.password === form.confirm

  useEffect(() => {
    if (countdown <= 0) return
    const id = window.setTimeout(() => setCountdown((value) => value - 1), 1000)
    return () => window.clearTimeout(id)
  }, [countdown])

  const submitStep1 = (event: React.FormEvent) => {
    event.preventDefault()
    setError("")
    // Le backend impose un pseudo d'au moins 2 caracteres (setupSchema).
    if (form.name.trim().length < 2) return setError(t("auth_name_min_2"))
    if (!form.email.trim()) return setError(t("auth_email_required"))
    if (!validEmail(form.email)) return setError(t("auth_email_invalid"))

    setForm((prev) => ({
      ...prev,
      name: prev.name.trim(),
      email: prev.email.trim().toLowerCase(),
    }))
    setStep(2)
  }

  const submitStep2 = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")

    // Le backend (POST /api/auth/setup) refuse tout mot de passe de moins de
    // 8 caracteres : autant le dire ici plutot qu'apres la saisie du code OTP.
    if (form.password.length < 8) return setError(t("password_min_8"))
    if (strength.score < 2) return setError(t("auth_password_weak"))
    if (!match) return setError(t("passwords_differ"))

    setLoading(true)

    try {
      const response = await requestRegistrationOtp({
        name: form.name.trim(),
        phone: "",
        email: form.email.trim().toLowerCase(),
        password: form.password,
      })

      setDemoOtp(response.debugOtp ?? "")
      setOtpDigits(Array(OTP_LEN).fill(""))
      setCountdown(60)
      setStep(3)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("auth_otp_send_failed"))
    } finally {
      setLoading(false)
    }
  }

  const submitStep3 = async () => {
    const entered = otpDigits.join("")
    if (entered.length !== OTP_LEN) return

    setLoading(true)

    if (demoOtp && entered !== demoOtp) {
      setLoading(false)
      setError("Code incorrect. Reessayez.")
      setOtpDigits(Array(OTP_LEN).fill(""))
      return
    }

    try {
      await register(
        {
          name: form.name.trim(),
          phone: "",
          email: form.email.trim().toLowerCase(),
          password: form.password,
        },
        entered
      )
      navigate("/chats", { replace: true })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Verification impossible.")
      setOtpDigits(Array(OTP_LEN).fill(""))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (step === 3 && otpDigits.every((digit) => digit !== "")) {
      void submitStep3()
    }
  }, [otpDigits, step])

  return (
    <div className="si-root">
      <aside className="si-left">
        <div className="logo">
          <img src={alanyaLogo} alt="Logo Alanya Work" className="auth-school-logo" />
          <div className="auth-brand-copy">
            <BrandName className="logo-txt" />
          </div>
        </div>

        <div className="stepper">
          {(
            [
              t("signup_step_info"),
              t("signup_step_password"),
              t("signup_step_verification"),
            ] as const
          ).map((label, index) => {
            const num = (index + 1) as Step
            const state = step > num ? "done" : step === num ? "active" : "todo"
            return (
              <div className="step-item" key={label}>
                <div className="step-track">
                  <div className={`step-circle ${state}`}>{step > num ? "?" : num}</div>
                  {index < 2 && <div className={`step-line ${step > num ? "done" : ""}`} />}
                </div>
                <div className="step-info">
                  <div className={`step-label ${state}`}>{label}</div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="sec-promises">
          <div className="sec-title">{t("auth_promises")}</div>
          <div className="sec-item">
            <div className="sec-icon">1</div>
            <div className="sec-txt">{t("auth_promise_email")}</div>
          </div>
          <div className="sec-item">
            <div className="sec-icon">2</div>
            <div className="sec-txt">{t("auth_promise_password")}</div>
          </div>
          <div className="sec-item">
            <div className="sec-icon">3</div>
            <div className="sec-txt">{t("auth_promise_otp")}</div>
          </div>
        </div>
      </aside>

      <main className="si-right">
        <div className="form-wrap">
          {/* Le choix de la langue vient AVANT le formulaire : quelqu'un qui ne
              lit pas le francais doit pouvoir basculer avant d'essayer de
              comprendre les champs, pas apres son inscription. */}
          <div className="langue-field">
            <label className="langue-label" htmlFor="signup-langue">
              {t("language_settings")}
            </label>
            <select
              id="signup-langue"
              className="langue-select"
              value={language}
              onChange={(event) => setLanguage(event.target.value as LanguageCode)}
            >
              {LANGUAGE_CODES.map((code) => (
                <option key={code} value={code}>
                  {libelleLangue(code)}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="error-banner">
              <span>{error}</span>
            </div>
          )}

          {step === 1 && (
            <form onSubmit={submitStep1} noValidate>
              <StepHeader
                step={1}
                title={t("signup_title_account")}
                subtitle={t("signup_sub_account")}
              />

              <div className="field">
                <input
                  id="name"
                  type="text"
                  placeholder=" "
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
                <label htmlFor="name">{t("full_name")}</label>
              </div>

              <div className="field">
                <input
                  id="email"
                  type="email"
                  placeholder=" "
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  autoComplete="email"
                  required
                />
                <label htmlFor="email">{t("email")}</label>
              </div>

              <button
                type="submit"
                className="btn-submit"
                disabled={!form.name.trim() || !form.email.trim() || !validEmail(form.email)}
              >
                {t("continue_action")} -&gt;
              </button>
              <div className="login-link">
                {t("have_account")} <Link to="/login">{t("login")}</Link>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={submitStep2} noValidate>
              <StepHeader
                step={2}
                title={t("signup_title_secure")}
                subtitle={t("signup_sub_secure", { email: form.email.trim().toLowerCase() })}
              />

              <div className="field">
                <input
                  id="pwd"
                  type={showPwd ? "text" : "password"}
                  placeholder=" "
                  value={form.password}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, password: event.target.value }))
                  }
                  className="input-with-toggle"
                  required
                />
                <label htmlFor="pwd">{t("password")}</label>
                <div className="field-icon">
                  <button className="tog" type="button" onClick={() => setShowPwd((v) => !v)}>
                    {showPwd ? "Masquer" : "Afficher"}
                  </button>
                </div>
              </div>

              {form.password && (
                <div className="strength-wrap">
                  <div className="strength-bar-track">
                    <div
                      className="strength-bar-fill"
                      style={{
                        width: `${(strength.score / 5) * 100}%`,
                        background: strength.color,
                      }}
                    />
                  </div>
                  <div className="strength-meta">
                    <span className="strength-label" style={{ color: strength.color }}>
                      {t(strength.cle)}
                    </span>
                  </div>
                </div>
              )}

              <div className="field">
                <input
                  id="confirm"
                  type={showConfirm ? "text" : "password"}
                  placeholder=" "
                  value={form.confirm}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, confirm: event.target.value }))
                  }
                  className="input-with-toggle"
                  required
                />
                <label htmlFor="confirm">{t("confirm_password")}</label>
                <div className="field-icon">
                  <button className="tog" type="button" onClick={() => setShowConfirm((v) => !v)}>
                    {showConfirm ? "Masquer" : "Afficher"}
                  </button>
                </div>
              </div>

              <div className="btn-row">
                <button type="button" className="btn-submit btn-back" onClick={() => setStep(1)}>
                  ?
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                  disabled={loading || strength.score < 2 || !match}
                >
                  {loading ? t("auth_creating") : t("auth_create_account_cta")}
                </button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div>
              <StepHeader
                step={3}
                title={t("auth_verification")}
                subtitle={t("auth_code_sent_to", { email: form.email.trim().toLowerCase() })}
              />

              <div className="otp-wrap">
                <OtpInput value={otpDigits} onChange={setOtpDigits} />
                <div className="resend-row">
                  {demoOtp ? (
                    <>
                      {t("auth_demo_code")} <strong className="countdown-accent">{demoOtp}</strong>
                    </>
                  ) : (
                    <>{t("auth_check_mailbox")}</>
                  )}
                </div>
                <div className="resend-row">
                  {countdown > 0 ? (
                    <span>
                      {t("auth_resend_in")}{" "}
                      <strong className="countdown-accent">{countdown}s</strong>
                    </span>
                  ) : (
                    <button
                      className="resend-btn"
                      onClick={async () => {
                        try {
                          const response = await requestRegistrationOtp({
                            name: form.name.trim(),
                            phone: "",
                            email: form.email.trim().toLowerCase(),
                            password: form.password,
                          })
                          setDemoOtp(response.debugOtp ?? "")
                          setOtpDigits(Array(OTP_LEN).fill(""))
                          setCountdown(60)
                        } catch (submitError) {
                          setError(
                            submitError instanceof Error
                              ? submitError.message
                              : t("auth_otp_regen_failed")
                          )
                        }
                      }}
                    >
                      {t("auth_new_code")}
                    </button>
                  )}
                </div>
              </div>

              {loading && (
                <div className="spinner-center">
                  <div className="spinner spinner--gold" />
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
