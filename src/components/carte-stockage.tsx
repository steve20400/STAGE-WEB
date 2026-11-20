import { useCallback, useEffect, useState } from "react"
import { useTranslation, langueInitiale } from "../i18n"
import {
  mesurer,
  poidsLisible,
  viderMedias,
  type RepartitionStockage,
} from "../services/stockage-local"

/**
 * PARAMÈTRES › DONNÉES : CE QUE L'APPLICATION OCCUPE, ET DE QUOI LE LIBÉRER.
 *
 * 🔴 LE MOBILE A CET ÉCRAN DEPUIS LE 11/11/2026 ; le web n'avait rien. Et ce
 * n'est pas qu'un alignement : chaque média chiffré qu'on ouvre est gardé EN
 * CLAIR dans la base du navigateur, sans limite et sans ménage. Personne ne
 * pouvait voir ce que cela pèse, ni le vider.
 *
 * ⚠️ LA CONFIRMATION EST DANS LE BOUTON, et non dans une fenêtre : vider un
 * cache n'efface rien d'irremplaçable — les fichiers restent dans les
 * discussions — mais c'est une minute de retéléchargement qu'on ne veut pas
 * déclencher d'un clic distrait.
 */
export function CarteStockage() {
  const { t } = useTranslation()
  const [etat, setEtat] = useState<RepartitionStockage | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [confirme, setConfirme] = useState(false)
  const langue = langueInitiale()

  const relire = useCallback(() => {
    void mesurer()
      .then(setEtat)
      .catch(() => setEtat(null))
  }, [])

  useEffect(relire, [relire])

  const vider = async () => {
    setOccupe(true)
    try {
      await viderMedias()
      relire()
    } finally {
      setOccupe(false)
      setConfirme(false)
    }
  }

  if (!etat) return null

  // La part des médias dans le total, pour la barre. Jamais de division par zéro.
  const part = etat.total > 0 ? Math.round((etat.medias / etat.total) * 100) : 0

  return (
    <div className="s-card">
      <div className="s-card-title">{t("stock_titre")}</div>
      <p className="s-hint" style={{ marginTop: -4 }}>
        {t("stock_sub")}
      </p>

      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10 }}>
        {poidsLisible(etat.total, langue)}
      </div>
      {etat.quota !== null && (
        <div className="s-hint">
          {t("stock_sur_quota", { quota: poidsLisible(etat.quota, langue) })}
        </div>
      )}

      {/* La répartition, d'un coup d'œil : la part des médias et le reste. */}
      <div
        style={{
          display: "flex",
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          background: "var(--border-subtle)",
          margin: "12px 0 10px",
        }}
        aria-hidden="true"
      >
        <div style={{ width: `${part}%`, background: "var(--accent)" }} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>{t("stock_medias")}</span>
        <span style={{ fontWeight: 600 }}>{poidsLisible(etat.medias, langue)}</span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 13,
          marginTop: 4,
          color: "var(--text-muted)",
        }}
      >
        <span>{t("stock_autres")}</span>
        <span>{poidsLisible(etat.autres, langue)}</span>
      </div>

      {/* Rien à vider : pas de bouton qui ne ferait rien. */}
      {etat.nbMedias > 0 && (
        <button
          type="button"
          className="s-btn"
          disabled={occupe}
          onClick={() => (confirme ? void vider() : setConfirme(true))}
          onBlur={() => setConfirme(false)}
          style={{ marginTop: 14 }}
        >
          {confirme ? t("stock_vider_confirmer") : t("stock_vider_medias")}
        </button>
      )}
      {confirme && <p className="s-hint">{t("stock_vider_medias_confirm")}</p>}
    </div>
  )
}
