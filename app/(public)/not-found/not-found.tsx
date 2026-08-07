import { Link } from "react-router-dom"
import { useTranslation } from "../../../src/i18n"

export default function NotFound() {
  const { t } = useTranslation()
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=DM+Sans:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .root {
          font-family: 'DM Sans', sans-serif;
          min-height: 100vh; background: var(--bg-base); color: var(--text-primary);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 40px 24px; text-align: center;
          position: relative; overflow: hidden;
        }
        .root::before {
          content: '';
          position: absolute; inset: 0;
          background-image: radial-gradient(circle, var(--text-primary)fff06 1px, transparent 1px);
          background-size: 30px 30px; pointer-events: none;
        }
        .root::after {
          content: '';
          position: absolute;
          width: 500px; height: 500px;
          background: radial-gradient(circle, var(--accent-dim) 0%, transparent 65%);
          border-radius: 50%;
          top: 50%; left: 50%; transform: translate(-50%, -55%);
          pointer-events: none;
        }
        .code {
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: clamp(96px, 18vw, 160px);
          font-weight: 800; letter-spacing: -8px;
          line-height: 1; color: var(--accent);
          opacity: .12; position: relative; z-index: 1;
          user-select: none;
        }
        .hex {
          width: 56px; height: 56px; background: var(--accent);
          clip-path: polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
          margin: -28px auto 24px; position: relative; z-index: 2;
        }
        .title {
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: 28px; font-weight: 800; letter-spacing: -1px;
          color: var(--text-primary); margin-bottom: 10px; position: relative; z-index: 2;
        }
        .sub {
          font-size: 14px; color: var(--text-muted); line-height: 1.7;
          max-width: 340px; margin-bottom: 36px;
          position: relative; z-index: 2;
        }
        .actions {
          display: flex; gap: 12px; flex-wrap: wrap;
          justify-content: center; position: relative; z-index: 2;
        }
        .btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          background: var(--accent); color: var(--bg-base);
          padding: 13px 28px; border-radius: 10px;
          font-weight: 700; font-size: 14px; text-decoration: none;
          transition: opacity .15s, transform .1s;
        }
        .btn-primary:hover { opacity: .88; transform: translateY(-1px); }
        .btn-ghost {
          display: inline-flex; align-items: center; gap: 8px;
          background: var(--bg-surface); border: 1px solid var(--border-subtle);
          color: var(--text-secondary); padding: 13px 24px; border-radius: 10px;
          font-size: 14px; font-weight: 500; text-decoration: none;
          transition: all .15s;
        }
        .btn-ghost:hover { border-color: var(--border-default); color: var(--text-primary); }
      `}</style>

      <div className="root">
        <div className="code" aria-hidden="true">
          404
        </div>
        <div className="hex" />
        <h1 className="title">{t("not_found_title")}</h1>
        <p className="sub">
          {t("not_found_line1")}
          <br />
          {t("not_found_line2")}
        </p>
        <div className="actions">
          <Link to="/chats" className="btn-primary">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            {t("dashboard")}
          </Link>
          <Link to="/chats" className="btn-ghost">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            {t("messages_label")}
          </Link>
        </div>
      </div>
    </>
  )
}
