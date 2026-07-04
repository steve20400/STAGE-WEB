import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAuth } from "../../../src/components/auth-provider"
import { requestRegistrationOtp } from "../../../src/services/auth-api"
const alanyaLogo = "/alanya-logo.png"
import "./signup-page.css"

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

  const levels = [
    { label: "Tres faible", color: "var(--danger)" },
    { label: "Faible", color: "#f97316" },
    { label: "Moyen", color: "#eab308" },
    { label: "Bon", color: "#84cc16" },
    { label: "Fort", color: "var(--success)" },
    { label: "Tres fort", color: "var(--accent)" },
  ]

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
  return (
    <div className="step-head">
      <div className="step-pre">Etape {step} sur 3</div>
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
    if (!form.name.trim()) return setError("Le nom est requis.")
    if (!form.email.trim()) return setError("L'adresse email est requise.")
    if (!validEmail(form.email)) return setError("Adresse email invalide.")

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

    if (strength.score < 2) return setError("Mot de passe trop faible.")
    if (!match) return setError("Les mots de passe ne correspondent pas.")

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
      setError(
        submitError instanceof Error ? submitError.message : "Impossible d'envoyer le code OTP."
      )
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
      navigate("/dashboard", { replace: true })
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
          <img src={alanyaLogo} alt="Logo Alanya" className="auth-school-logo" />
          <div className="auth-brand-copy">
            <span className="logo-txt">Alanya</span>
            <span className="auth-brand-subtitle">Messagerie ENSPY</span>
          </div>
        </div>

        <div className="stepper">
          {["Informations", "Mot de passe", "Verification"].map((label, index) => {
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
          <div className="sec-title">Authentification</div>
          <div className="sec-item">
            <div className="sec-icon">1</div>
            <div className="sec-txt">Email obligatoire et lie a un seul numero.</div>
          </div>
          <div className="sec-item">
            <div className="sec-icon">2</div>
            <div className="sec-txt">Mot de passe fort requis.</div>
          </div>
          <div className="sec-item">
            <div className="sec-icon">3</div>
            <div className="sec-txt">Code OTP fictif pour le prototype.</div>
          </div>
        </div>
      </aside>

      <main className="si-right">
        <div className="form-wrap">
          {error && (
            <div className="error-banner">
              <span>{error}</span>
            </div>
          )}

          {step === 1 && (
            <form onSubmit={submitStep1} noValidate>
              <StepHeader
                step={1}
                title="Creer un compte."
                subtitle="Votre nom et votre adresse email. Votre numero Alanya sera genere automatiquement."
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
                <label htmlFor="name">Nom complet</label>
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
                <label htmlFor="email">Adresse email</label>
              </div>

              <button
                type="submit"
                className="btn-submit"
                disabled={!form.name.trim() || !form.email.trim() || !validEmail(form.email)}
              >
                Continuer -&gt;
              </button>
              <div className="login-link">
                Deja un compte ? <Link to="/login">Se connecter</Link>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={submitStep2} noValidate>
              <StepHeader
                step={2}
                title="Securisez votre compte."
                subtitle={`Pour ${form.email.trim().toLowerCase()}`}
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
                <label htmlFor="pwd">Mot de passe</label>
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
                      {strength.label}
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
                <label htmlFor="confirm">Confirmer le mot de passe</label>
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
                  {loading ? "Creation..." : "Creer le compte ->"}
                </button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div>
              <StepHeader
                step={3}
                title="Verification."
                subtitle={`Code envoye a ${form.email.trim().toLowerCase()}`}
              />

              <div className="otp-wrap">
                <OtpInput value={otpDigits} onChange={setOtpDigits} />
                <div className="resend-row">
                  {demoOtp ? (
                    <>
                      Code fictif (prototype):{" "}
                      <strong className="countdown-accent">{demoOtp}</strong>
                    </>
                  ) : (
                    <>Consultez votre boite mail pour recuperer le code.</>
                  )}
                </div>
                <div className="resend-row">
                  {countdown > 0 ? (
                    <span>
                      Renvoyer dans <strong className="countdown-accent">{countdown}s</strong>
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
                              : "Impossible de regenerer le code."
                          )
                        }
                      }}
                    >
                      Generer un nouveau code
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
