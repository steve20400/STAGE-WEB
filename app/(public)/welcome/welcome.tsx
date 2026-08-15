import { useTranslation } from "../../../src/i18n"
import { Link } from "react-router-dom"
import { ThemeToggle } from "../../../src/components/theme-toggle"
const alanyaLogo = `${import.meta.env.BASE_URL}alanya-logo.jpeg`
import "./welcome-page.css"
import { BrandName } from "../../../src/components/brand-name"

export default function WelcomePage() {
  const { t } = useTranslation()
  return (
    <>
      <div className="alanya-root">
        {/* Navbar */}
        <nav className="nav">
          <div className="nav-logo">
            <img src={alanyaLogo} alt={t("x2_logo_alt")} className="school-logo" />
            <div className="brand-copy">
              <BrandName className="display-font brand-name" />
            </div>
          </div>
          <div className="nav-links">
            <div className="welcome-theme-row">
              <span className="welcome-theme-label">{t("theme")}</span>
              <ThemeToggle className="welcome-theme-toggle" />
            </div>
            <a href="#features">{t("welcome_nav_features")}</a>
            <Link to="/login" className="btn-nav">
              {t("login")}
            </Link>
            <Link to="/developer/auth" className="btn-nav" style={{ background: "var(--accent, #0284c7)", color: "#ffffff", borderColor: "var(--accent, #0284c7)", fontWeight: 600 }}>
              Espace Développeur
            </Link>
          </div>
        </nav>

        {/* Hero */}
        <div className="hero">
          <div className="hero-left">
            <div className="badge">
              <div className="badge-dot" />
              <span>{t("welcome_tagline")}</span>
            </div>

            <h1 className="headline">
              <span>{t("welcome_word1")}</span>
              <span>{t("welcome_word2")}</span>
              <span className="overflow-word">
                <em>{t("welcome_word3")}</em>
              </span>
            </h1>

            <p className="subline">{t("welcome_pitch")}</p>

            <div className="cta-row">
              <Link to="/signup" className="btn-primary">
                {t("welcome_start")}
              </Link>
              <a href="#features" className="btn-ghost">
                {t("welcome_features")}
                <span style={{ fontSize: 14 }}>-&gt;</span>
              </a>
            </div>

            <div id="features" className="features">
              <div className="feat">
                <div className="feat-label">{t("welcome_latency")}</div>
                <div className="feat-val">
                  <strong>&lt; 500ms</strong>
                  {t("welcome_delivery")}
                </div>
              </div>
              <div className="feat">
                <div className="feat-label">{t("welcome_files")}</div>
                <div className="feat-val">{t("welcome_files_sub")}</div>
              </div>
              <div className="feat">
                <div className="feat-label">{t("welcome_calls")}</div>
                <div className="feat-val">{t("welcome_calls_sub")}</div>
              </div>
            </div>
          </div>

          {/* Chat preview */}
          <div id="about" className="hero-right">
            <div className="phone">
              <div className="phone-bar">
                <div className="avatar-sm">SM</div>
                <div>
                  <div className="phone-name">STEVE AUREL MANFO</div>
                  <div className="phone-status">{t("welcome_demo_status")}</div>
                </div>
              </div>
              <div className="chat-body">
                <div>
                  <div className="bubble them">{t("welcome_demo_q")}</div>
                  <div className="meta">10:42</div>
                </div>
                <div>
                  <div className="bubble me">{t("welcome_demo_a")}</div>
                  <div className="meta right">{`10:43 ${t("welcome_demo_read")}`}</div>
                </div>
                <div>
                  <div className="bubble them">{t("welcome_demo_r")}</div>
                  <div className="meta">10:43</div>
                </div>
                <div className="typing">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
              </div>
              <div className="phone-input">
                <div className="phone-input-field">{t("welcome_demo_input")}</div>
                <div className="send-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--bg-base)">
                    <path
                      d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
                      stroke="var(--bg-base)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
