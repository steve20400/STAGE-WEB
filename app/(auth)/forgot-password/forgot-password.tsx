import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useTranslation } from "../../../src/i18n"
const alanyaLogo = `${import.meta.env.BASE_URL}alanya-logo.jpeg`
import "./forgot-password-page.css"
import { BrandName } from "../../../src/components/brand-name"
import {
  demanderCodeReinitialisation,
  reinitialiserParCodeRecuperation,
  reinitialiserParEmail,
} from "../../../src/services/auth-api"

/**
 * 🔴 CETTE PAGE N'APPELAIT AUCUNE API — c'était une maquette.
 *
 * Constaté le 25/08/2026 en y ajoutant le code de récupération : `handleSubmit`
 * posait `submitted = true` et affichait « compte trouvé », sans la moindre
 * requête. La récupération de mot de passe n'a donc JAMAIS fonctionné sur le
 * web, quel que soit le chemin — et l'écran affirmait le contraire, ce qui est
 * pire que de ne rien afficher : l'utilisateur attendait un courriel que
 * personne n'avait demandé.
 *
 * Elle est désormais branchée sur les deux chemins réels :
 *   - par ADRESSE : `/api/auth/forgot-password` puis `/api/auth/reset-password`
 *     avec le code à 6 chiffres ;
 *   - par CODE DE RÉCUPÉRATION : `/api/auth/reset-password` en une étape, pour
 *     les comptes ouverts sans adresse.
 */

type Mode = "email" | "code"

function adresseValide(valeur: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur.trim())
}

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [codeRecuperation, setCodeRecuperation] = useState("")
  const [motDePasse, setMotDePasse] = useState("")
  const [codeEnvoye, setCodeEnvoye] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [succes, setSucces] = useState<string | null>(null)

  const peutEnvoyer = useMemo(() => {
    if (mode === "code") {
      return codeRecuperation.trim().length > 0 && motDePasse.length >= 8
    }
    if (!codeEnvoye) return adresseValide(email)
    return code.trim().length === 6 && motDePasse.length >= 8
  }, [mode, codeRecuperation, motDePasse, codeEnvoye, email, code])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!peutEnvoyer || enCours) return
    setErreur(null)
    setEnCours(true)
    try {
      if (mode === "code") {
        await reinitialiserParCodeRecuperation(codeRecuperation, motDePasse)
      } else if (!codeEnvoye) {
        await demanderCodeReinitialisation(email)
        setCodeEnvoye(true)
        setSucces(t("auth_recover_next", { identifiant: email.trim() }))
        return
      } else {
        await reinitialiserParEmail(email, code, motDePasse)
      }
      // Redirection vers la connexion : le mot de passe vient de changer, et
      // TOUTES les sessions ont été révoquées par le serveur — rester ici
      // laisserait croire qu'on est encore connecté ailleurs.
      setSucces(t("auth_password_reset_done"))
      setTimeout(() => navigate("/login"), 1200)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : t("auth_verify_unexpected"))
    } finally {
      setEnCours(false)
    }
  }

  /** Changer de chemin remet à zéro : voir le commentaire du mobile. */
  function changerMode(nouveau: Mode) {
    if (nouveau === mode) return
    setMode(nouveau)
    setCodeEnvoye(false)
    setErreur(null)
    setSucces(null)
    setCode("")
    setMotDePasse("")
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

        {/*
          Choix du chemin. Masqué une fois le code parti par courriel : changer
          de mode à ce moment-là abandonnerait un code déjà envoyé, sans le dire.
        */}
        {!codeEnvoye && (
          <div className="fp-modes" role="tablist" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "email"}
              onClick={() => changerMode("email")}
              style={{ flex: 1, padding: "8px 12px", cursor: "pointer", fontWeight: mode === "email" ? 600 : 400 }}
            >
              {t("auth_recover_by_email")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "code"}
              onClick={() => changerMode("code")}
              style={{ flex: 1, padding: "8px 12px", cursor: "pointer", fontWeight: mode === "code" ? 600 : 400 }}
            >
              {t("auth_recover_by_code")}
            </button>
          </div>
        )}

        {erreur && (
          <div className="fp-error" role="alert" style={{ marginBottom: 12 }}>
            {erreur}
          </div>
        )}
        {succes && (
          <div className="fp-success" role="status" style={{ marginBottom: 12 }}>
            {succes}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {mode === "code" ? (
            <>
              <div className="fp-field">
                <input
                  id="code-recuperation"
                  type="text"
                  placeholder=" "
                  value={codeRecuperation}
                  onChange={(e) => setCodeRecuperation(e.target.value.toUpperCase())}
                  // 12 et non 10 : les séparateurs de relecture que
                  // l'utilisateur recopie doivent tenir. Le serveur les ignore.
                  maxLength={12}
                  autoComplete="off"
                  style={{ fontFamily: "monospace", letterSpacing: 2 }}
                />
                <label htmlFor="code-recuperation">{t("auth_recovery_code")}</label>
              </div>
              <div className="fp-field">
                <input
                  id="nouveau-mdp"
                  type="password"
                  placeholder=" "
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  autoComplete="new-password"
                />
                <label htmlFor="nouveau-mdp">{t("auth_new_password")}</label>
              </div>
            </>
          ) : (
            <>
              <div className="fp-field">
                <input
                  id="identifier"
                  type="email"
                  placeholder=" "
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={codeEnvoye}
                  autoComplete="username"
                />
                <label htmlFor="identifier">{t("email")}</label>
              </div>
              {codeEnvoye && (
                <>
                  <div className="fp-field">
                    <input
                      id="otp"
                      type="text"
                      inputMode="numeric"
                      placeholder=" "
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      maxLength={6}
                      autoComplete="one-time-code"
                    />
                    <label htmlFor="otp">{t("enter_code")}</label>
                  </div>
                  <div className="fp-field">
                    <input
                      id="nouveau-mdp-email"
                      type="password"
                      placeholder=" "
                      value={motDePasse}
                      onChange={(e) => setMotDePasse(e.target.value)}
                      autoComplete="new-password"
                    />
                    <label htmlFor="nouveau-mdp-email">{t("auth_new_password")}</label>
                  </div>
                </>
              )}
            </>
          )}

          <button type="submit" className="fp-submit" disabled={!peutEnvoyer || enCours}>
            {mode === "code" || codeEnvoye ? t("auth_reset_password") : t("receive_code")}
          </button>
        </form>

        <div className="fp-actions">
          <Link to="/login">{t("auth_back_to_login")}</Link>
          <Link to="/signup">{t("create_account")}</Link>
        </div>
      </main>
    </div>
  )
}
