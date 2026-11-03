import { useState } from "react"
import { useTranslation } from "../i18n"
import {
  choisirQualite,
  ORDRE_QUALITES,
  QUALITES,
  qualiteChoisie,
  type QualiteVideo,
} from "../services/qualite-video"

/**
 * « REGLAGE APPEL VIDEO » (procedure du patron, 01/11/2026) : trois qualites,
 * propres a ce navigateur. Le choix vaut pour les appels suivants.
 */
export function ReglageQualiteVideo() {
  const { t } = useTranslation()
  const [qualite, setQualite] = useState<QualiteVideo>(() => qualiteChoisie())

  return (
    <div className="s-card">
      <div className="s-card-title">{t("video_quality_title")}</div>
      <div className="privacy-choice">
        <div className="privacy-choice-head">
          <div className="privacy-choice-desc">{t("video_quality_hint")}</div>
        </div>
        <div className="privacy-choice-opts" role="radiogroup" aria-label={t("video_quality_title")}>
          {ORDRE_QUALITES.map((q) => (
            <button
              key={q}
              type="button"
              role="radio"
              aria-checked={qualite === q}
              className={`filter-btn ${qualite === q ? "on" : ""}`}
              title={QUALITES[q].detail}
              onClick={() => {
                choisirQualite(q)
                setQualite(q)
              }}
            >
              {t(QUALITES[q].cleLibelle)}
              <small style={{ display: "block", opacity: 0.75, fontSize: 11 }}>{QUALITES[q].detail}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
