import { Link, NavLink } from "react-router-dom"
import { LANGUAGE_CODES, libelleLangue, useTranslation, type LanguageCode } from "../i18n"
import { BrandName } from "./brand-name"
import { ThemeToggle } from "./theme-toggle"
import "./cadre-public.css"

const logo = `${import.meta.env.BASE_URL}logo-alanya.png`

/**
 * L'EN-TÊTE DES PAGES PUBLIQUES (20/11/2026) : accueil, connexion, inscription,
 * mot de passe oublié. Une barre chocolat qui se détache du motif, comme sur la
 * maquette validée par l'utilisateur : le logo et le nom à gauche ; à droite les
 * fonctionnalités, l'action principale, la langue et le thème.
 *
 * La langue était un grand champ au milieu des formulaires. Elle remonte ici, en
 * haut à droite, sur toutes ces pages, à la même place : on la cherche là où les
 * sites la mettent.
 *
 * `action` : le bouton mis en avant. La page de connexion propose de créer un
 * compte, les autres de se connecter.
 */
export function EnTetePublic({ action = "connexion" }: { action?: "connexion" | "inscription" }) {
  const { t } = useTranslation()

  return (
    <header className="cp-entete">
      <Link to="/" className="cp-marque" aria-label={t("auth_back_home")}>
        <img src={logo} alt="" className="cp-logo" />
        <BrandName sur="nuit" className="cp-nom" />
      </Link>

      <nav className="cp-actions">
        <NavLink to="/fonctionnalites" className="cp-lien">
          {t("welcome_nav_features")}
        </NavLink>
        {action === "connexion" ? (
          <Link to="/login" className="cp-bouton">
            {t("login")}
          </Link>
        ) : (
          <Link to="/signup" className="cp-bouton">
            {t("create_account")}
          </Link>
        )}
        <SelecteurLangue />
        <ThemeToggle className="cp-theme" />
      </nav>
    </header>
  )
}

/**
 * Le choix de la langue, en petit : un globe et le code (FR, EN…). La liste
 * déroulante reste celle du système, avec les noms complets ; elle est posée,
 * transparente, sur toute la pastille, qui reste donc cliquable partout et
 * accessible au clavier comme un vrai champ.
 */
function SelecteurLangue() {
  const { language, setLanguage, t } = useTranslation()
  return (
    <label className="cp-langue" title={t("language_settings")}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
      </svg>
      <span className="cp-langue-code" aria-hidden="true">
        {language.toUpperCase()}
      </span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6 9l6 6 6-6z" />
      </svg>
      <select
        aria-label={t("language_settings")}
        value={language}
        onChange={(event) => setLanguage(event.target.value as LanguageCode)}
      >
        {LANGUAGE_CODES.map((code) => (
          <option key={code} value={code}>
            {libelleLangue(code, language)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Le pied des pages publiques : la marque et les pages légales. */
export function PiedPublic() {
  const { t } = useTranslation()
  return (
    <footer className="cp-pied">
      <div className="cp-pied-marque">
        © {new Date().getFullYear()} <BrandName sur="nuit" className="cp-nom-pied" />
      </div>
      <nav className="cp-pied-liens">
        <Link to="/conditions">{t("legal_conditions")}</Link>
        <Link to="/confidentialite">{t("legal_confidentialite")}</Link>
      </nav>
    </footer>
  )
}
