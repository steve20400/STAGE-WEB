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
  verifierCodeRecuperation,
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
 *   - par CODE DE RÉCUPÉRATION : `/api/auth/reset-password/verify` — la preuve,
 *     code et Alanya ID —, puis `/api/auth/reset-password` avec le nouveau mot
 *     de passe, pour les comptes ouverts sans adresse.
 *
 * 🔴 LE CHEMIN PAR CODE SE FAIT EN DEUX TEMPS depuis le 25/08/2026 (demande du
 * user), comme sur le mobile. Les trois champs cohabitaient : on saisissait un
 * mot de passe pour apprendre ensuite que le code était faux, et tout était à
 * refaire. Le mot de passe n'apparaît donc qu'une fois la paire vérifiée, et
 * avec sa CONFIRMATION — ailleurs une faute de frappe se rattrape en
 * redemandant un code par courriel, mais sur un compte sans adresse le seul
 * recours est ce code, dont les essais sont plafonnés.
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
  /** Second facteur : l Alanya ID du compte a reprendre. */
  const [alanyaId, setAlanyaId] = useState("")
  const [motDePasse, setMotDePasse] = useState("")
  /** Confirmation du nouveau mot de passe — chemin par CODE uniquement. */
  const [confirmation, setConfirmation] = useState("")
  /**
   * La paire { code, Alanya ID } a été vérifiée par le serveur : on peut
   * demander le nouveau mot de passe.
   *
   * ⚠️ CE N'EST PAS UNE AUTORISATION — rien n'est ouvert par ce booléen. Il ne
   * décide que de ce qui s'affiche ; c'est le serveur qui revérifie la paire à
   * la réinitialisation. Le forcer ne donnerait accès à aucun compte.
   */
  const [preuveFaite, setPreuveFaite] = useState(false)
  const [codeEnvoye, setCodeEnvoye] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [succes, setSucces] = useState<string | null>(null)

  const peutEnvoyer = useMemo(() => {
    if (mode === "code") {
      // Deux temps : la preuve d'abord, le mot de passe ensuite. La
      // confirmation n'est PAS comparée ici — le bouton reste actif pour que
      // l'écart soit dit explicitement, plutôt que laissé à deviner devant un
      // bouton mort.
      if (!preuveFaite) return codeRecuperation.trim().length > 0 && alanyaId.trim().length > 0
      return motDePasse.length >= 8 && confirmation.length > 0
    }
    if (!codeEnvoye) return adresseValide(email)
    return code.trim().length === 6 && motDePasse.length >= 8
  }, [mode, preuveFaite, codeRecuperation, alanyaId, motDePasse, confirmation, codeEnvoye, email, code])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!peutEnvoyer || enCours) return
    setErreur(null)
    setEnCours(true)
    try {
      if (mode === "code" && !preuveFaite) {
        // Étape 1 : la preuve. Rien n'est changé ici, et rien n'est ouvert —
        // le serveur dit seulement si la paire désigne un compte.
        await verifierCodeRecuperation(codeRecuperation, alanyaId)
        setPreuveFaite(true)
        setSucces(t("auth_recovery_code_verified"))
        return
      }
      if (mode === "code") {
        // Comparaison sur le texte BRUT, sans `trim` : un espace de tête ou de
        // fin fait partie du mot de passe, et le retirer d'un seul côté
        // laisserait passer deux saisies réellement différentes.
        if (motDePasse !== confirmation) {
          setErreur(t("passwords_differ"))
          return
        }
        await reinitialiserParCodeRecuperation(codeRecuperation, alanyaId, motDePasse)
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
    // La preuve ne survit PAS au changement de chemin : elle porte sur un
    // couple qu'on vient d'abandonner, et la garder rouvrirait l'étape du mot
    // de passe pour un compte que plus rien ne désigne.
    setPreuveFaite(false)
    setErreur(null)
    setSucces(null)
    setCode("")
    setMotDePasse("")
    setConfirmation("")
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
        {!codeEnvoye && !preuveFaite && (
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
          {mode === "code" && preuveFaite ? (
            /*
              ÉTAPE 2 — le nouveau mot de passe, et lui seul.
              Le code et l'Alanya ID ne sont plus affichés : ils sont conservés
              en état et repartent avec la demande, mais les remontrer inviterait
              à les modifier après leur vérification, et l'écran mentirait alors
              sur ce qui a été prouvé.
            */
            <>
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
              <div className="fp-field">
                <input
                  id="nouveau-mdp-confirmation"
                  type="password"
                  placeholder=" "
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="new-password"
                />
                <label htmlFor="nouveau-mdp-confirmation">{t("auth_new_password_confirm")}</label>
              </div>
            </>
          ) : mode === "code" ? (
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
              {/*
                Second facteur. Pas de filtre sur les chiffres a la saisie :
                l'Alanya ID est AFFICHE formate par paires dans toute
                l'application, c'est sous cette forme que l'utilisateur le
                connait, et le serveur n'en retient que les chiffres. Le
                contraindre ici rejetterait la facon la plus naturelle de le
                recopier.
              */}
              <div className="fp-field">
                <input
                  id="alanya-id"
                  type="text"
                  inputMode="numeric"
                  placeholder=" "
                  value={alanyaId}
                  onChange={(e) => setAlanyaId(e.target.value)}
                  autoComplete="off"
                />
                <label htmlFor="alanya-id">{t("auth_recovery_alanya_id")}</label>
              </div>
              {/*
                🔴 PAS DE CHAMP « nouveau mot de passe » ICI. Il n'apparaît
                qu'à l'étape suivante, avec sa confirmation, une fois la paire
                vérifiée par le serveur.
              */}
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

          {/*
            « Continuer » tant que la preuve n'est pas faite : rien n'est encore
            changé à cet appui. Annoncer « Réinitialiser » ferait croire
            l'affaire réglée à qui s'arrêterait là.
          */}
          <button type="submit" className="fp-submit" disabled={!peutEnvoyer || enCours}>
            {mode === "code" && !preuveFaite
              ? t("auth_continue")
              : mode === "code" || codeEnvoye
                ? t("auth_reset_password")
                : t("receive_code")}
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
