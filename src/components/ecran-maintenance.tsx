import { useMaintenance, verifierMaintenance } from "../lib/maintenance"
import { useTranslation } from "../i18n"

/**
 * L'ÉCRAN « EN MAINTENANCE » (24/10/2026) — jumeau de `ecran_maintenance.dart`.
 *
 * Superposé à toute l'application tant que le serveur est en maintenance ; il
 * disparaît seul quand elle est levée (vérification toutes les 20 s) ou au
 * bouton « Réessayer ».
 */
export function EcranMaintenance() {
  const active = useMaintenance()
  const { t } = useTranslation()
  if (!active) return null
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 32,
        textAlign: "center",
        background: "var(--bg, #fbf7f1)",
        color: "var(--text, #2b211b)",
      }}
    >
      <div style={{ fontSize: 56 }} aria-hidden="true">
        🛠️
      </div>
      <h1 style={{ fontSize: 24, margin: 0 }}>{t("maintenance_titre")}</h1>
      <p style={{ maxWidth: 420, margin: 0, opacity: 0.75, lineHeight: 1.5 }}>{t("maintenance_texte")}</p>
      <button
        type="button"
        onClick={() => void verifierMaintenance()}
        style={{
          marginTop: 10,
          padding: "10px 18px",
          borderRadius: 10,
          border: "1px solid #B85C38",
          background: "transparent",
          color: "#B85C38",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("maintenance_reessayer")}
      </button>
    </div>
  )
}
