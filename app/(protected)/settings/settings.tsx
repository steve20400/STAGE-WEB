import { useState, useRef, useCallback, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../../src/components/auth-provider"
import { useToast } from "../../../src/components/toast"
import { ThemeSelector } from "../../../src/components/theme-toggle"
import { type SessionUser } from "../../../src/data/session-user"
import { isTurnConfigured } from "../../../src/services/calls-service"
import TurnTester from "../../../src/components/turn-tester"
import RealtimeStatus from "../../../src/components/realtime-status"
import {
  debloquer,
  listerBloques,
  nomDuBloque,
  type PersonneBloquee,
} from "../../../src/services/blocked-service"
import {
  enregistrerPseudo,
  lirePseudoServeur,
  pseudoEnCache,
} from "../../../src/services/pseudo-appareil-service"
import {
  LANGUAGE_CODES,
  LANGUAGE_NAMES,
  libelleLangue,
  traduire,
  useTranslation,
  type LanguageCode,
} from "../../../src/i18n"
import {
  LAST_SEEN_LABELS,
  PRIVACY_DEFAULTS,
  fetchPrivacy,
  savePrivacy,
  type LastSeenVisibility,
  type PrivacySettings,
} from "../../../src/services/privacy-service"
import {
  RINGTONES,
  RINGTONE_LABELS,
  customRingtones,
  importRingtone,
  removeCustomRingtone,
  type CustomRingtone,
  previewRingtone,
  ringtoneFile,
  setRingtone,
  stopRingtonePreview,
  type RingtoneEvent,
} from "../../../src/services/ringtones"
import {
  OUTPUT_LABELS,
  defaultAudioOutput,
  setDefaultAudioOutput,
  type AudioOutputMode,
} from "../../../src/services/audio-output"
import { changePasswordApi, updateProfileApi } from "../../../src/services/auth-api"
import {
  type Appareil,
  TYPE_DEVICE,
  deconnecterAppareil,
  estAppareilCourant,
  fetchAppareils,
} from "../../../src/services/appareils-service"
import {
  type LoginAccess,
  estRenseigne,
  fetchLoginHistory,
  quand,
} from "../../../src/services/user-access-service"
import { sendSessionRevoked } from "../../../src/services/websocket-service"
import { avatarDisplaySrc, fileToAvatarDataUrl, uploadAvatarDataUrl } from "../../../src/lib/avatar"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"

type SettingsSection = "profile" | "security" | "notifications" | "appearance" | "privacy" | "about"

interface Profile {
  name: string
  email: string
  phone: string
  statusMsg: string
  avatar: string | null // base64 ou URL
}

interface SecurityForm {
  currentPwd: string
  newPwd: string
  confirmPwd: string
}

interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  tone?: "warning" | "danger"
  onConfirm: () => Promise<void> | void
}

function getInitialProfile(sessionUser: SessionUser | null): Profile {
  return {
    name: sessionUser?.name ?? "Utilisateur Alanya",
    email: sessionUser?.email ?? "",
    // Pas de numero factice en repli : « Enregistrer » recopie draft.phone dans la
    // session locale (updateUser), le faux numero devenait donc l'Alanya ID affiche.
    phone: sessionUser?.phone ?? "",
    statusMsg: sessionUser?.statusMsg ?? "Disponible",
    avatar: sessionUser?.avatar ?? null,
  }
}

function analyzePassword(pwd: string): { score: number; label: string; color: string } {
  if (!pwd) return { score: 0, label: "", color: "var(--border-subtle)" }
  let score = 0
  if (pwd.length >= 8) score++
  if (pwd.length >= 14) score++
  if (/[A-Z]/.test(pwd)) score++
  if (/[0-9]/.test(pwd)) score++
  if (/[^A-Za-z0-9]/.test(pwd)) score++
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

/**
 * Choix des sonneries. Les trois sons proposes par defaut sont ceux de
 * l'application mobile, reprisa l'octet pres, pour que les deux plateformes
 * sonnent pareil. Le choix est une preference d'appareil : il survit a la
 * deconnexion.
 */
function RingtonePicker() {
  const events: RingtoneEvent[] = ["incoming", "outgoing", "message"]
  const [choices, setChoices] = useState<Record<RingtoneEvent, string>>(() => ({
    incoming: ringtoneFile("incoming"),
    outgoing: ringtoneFile("outgoing"),
    message: ringtoneFile("message"),
  }))
  const [playing, setPlaying] = useState<string | null>(null)
  const [imported, setImported] = useState<CustomRingtone[]>(() => customRingtones())
  const [importing, setImporting] = useState(false)
  const [sortieAudio, setSortieAudio] = useState<AudioOutputMode>(() => defaultAudioOutput())
  const fileInput = useRef<HTMLInputElement>(null)
  const { success, error: toastError } = useToast()

  // Ne pas laisser un extrait tourner apres avoir quitte les reglages.
  useEffect(() => stopRingtonePreview, [])

  const onImport = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    try {
      const entree = await importRingtone(file)
      setImported(customRingtones())
      success("Sonnerie importee", `« ${entree.label} » est disponible pour les trois evenements.`)
    } catch (err) {
      toastError(
        "Import impossible",
        err instanceof Error ? err.message : "Le fichier n'a pas pu etre televerse."
      )
    } finally {
      setImporting(false)
      // Reinitialise le champ, sinon reimporter le meme fichier n'emet aucun evenement.
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  const onRemove = (entree: CustomRingtone) => {
    removeCustomRingtone(entree.url)
    setImported(customRingtones())
    setChoices({
      incoming: ringtoneFile("incoming"),
      outgoing: ringtoneFile("outgoing"),
      message: ringtoneFile("message"),
    })
    success(
      "Sonnerie retiree",
      `Les evenements qui utilisaient « ${entree.label} » reprennent leur son par defaut.`
    )
  }

  const choose = (event: RingtoneEvent, file: string) => {
    setRingtone(event, file)
    setChoices((prev) => ({ ...prev, [event]: file }))
  }

  const listen = (file: string) => {
    if (playing === file) {
      stopRingtonePreview()
      setPlaying(null)
      return
    }
    setPlaying(file)
    void previewRingtone(file)
      .catch(() => setPlaying(null))
      .finally(() =>
        window.setTimeout(() => setPlaying((current) => (current === file ? null : current)), 4000)
      )
  }

  return (
    <div className="s-card">
      <div className="s-card-title">Sonneries</div>
      {events.map((event) => (
        <div key={event} className="ringtone-row">
          <div className="ringtone-row-label">{RINGTONE_LABELS[event]}</div>
          <div className="ringtone-row-controls">
            <select
              className="ringtone-select"
              value={choices[event]}
              onChange={(e) => choose(event, e.target.value)}
              aria-label={`Sonnerie pour ${RINGTONE_LABELS[event].toLowerCase()}`}
            >
              {RINGTONES.map((ringtone) => (
                <option key={ringtone.file} value={ringtone.file}>
                  {ringtone.label}
                  {ringtone.note ? ` — ${ringtone.note}` : ""}
                </option>
              ))}
              {imported.length > 0 && (
                <optgroup label="Importees">
                  {imported.map((entree) => (
                    <option key={entree.url} value={entree.url}>
                      {entree.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              type="button"
              className="ringtone-listen"
              onClick={() => listen(choices[event])}
              aria-label={playing === choices[event] ? "Arreter l'ecoute" : "Ecouter"}
              title={playing === choices[event] ? "Arreter" : "Ecouter"}
            >
              {playing === choices[event] ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 4 20 12 6 20" />
                </svg>
              )}
            </button>
          </div>
        </div>
      ))}
      <div className="privacy-choice">
        <div className="privacy-choice-head">
          <div className="privacy-choice-label">Sortie audio des appels</div>
          <div className="privacy-choice-desc">
            Mode a la prise d'un appel audio. Un appel video reste toujours au haut-parleur.
            L'ecoute a l'oreille correspond a un volume reduit : le navigateur ne choisit pas la
            sortie physique, contrairement a l'application mobile.
          </div>
        </div>
        <div className="privacy-choice-opts" role="group" aria-label="Sortie audio par defaut">
          {(["earpiece", "speaker"] as AudioOutputMode[]).map((mode) => (
            <button
              key={mode}
              className={`filter-btn ${sortieAudio === mode ? "on" : ""}`}
              aria-pressed={sortieAudio === mode}
              onClick={() => {
                setDefaultAudioOutput(mode)
                setSortieAudio(mode)
              }}
            >
              {OUTPUT_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      <div className="ringtone-import">
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => void onImport(e.target.files?.[0])}
        />
        <button
          type="button"
          className="ringtone-import-btn"
          onClick={() => fileInput.current?.click()}
          disabled={importing}
        >
          {importing ? "Import en cours…" : "Importer une sonnerie"}
        </button>
        {imported.length > 0 && (
          <ul className="ringtone-imported-list">
            {imported.map((entree) => (
              <li key={entree.url}>
                <span className="ringtone-imported-name">{entree.label}</span>
                <button
                  type="button"
                  className="ringtone-listen"
                  onClick={() => listen(entree.url)}
                  aria-label={
                    playing === entree.url ? "Arreter l'ecoute" : `Ecouter ${entree.label}`
                  }
                  title={playing === entree.url ? "Arreter" : "Ecouter"}
                >
                  {playing === entree.url ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="6 4 20 12 6 20" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className="ringtone-remove"
                  onClick={() => onRemove(entree)}
                  aria-label={`Retirer ${entree.label}`}
                  title="Retirer"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="s-hint">
        Les sons proposes en premier sont ceux de l'application mobile. Un son importe est televerse
        sur votre compte, donc reutilisable, et se choisit pour n'importe lequel des trois
        evenements. Cinq megaoctets au maximum. L'ecoute s'arrete au bout de quatre secondes.
      </div>
    </div>
  )
}

function PushDiagnostic() {
  const [permission, setPermission] = useState<string>("default")
  const [swStatus, setSwStatus] = useState<string>("Non verifie")
  const [vapidKeyExists, setVapidKeyExists] = useState<boolean>(false)
  const [configStatus, setConfigStatus] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)

  const checkStatus = useCallback(() => {
    if (typeof window === "undefined") return

    setPermission(Notification.permission)

    const vapid = import.meta.env.VITE_FIREBASE_VAPID_KEY
    setVapidKeyExists(
      !!vapid &&
        vapid !== "VOTRE_CLÉ_VAPID_DEPUIS_FIREBASE" &&
        vapid !== "OBTENIR_DEPUIS_CONSOLE_FIREBASE"
    )

    const apiKey = import.meta.env.VITE_FIREBASE_API_KEY
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
    const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
    const appId = import.meta.env.VITE_FIREBASE_APP_ID

    if (
      !apiKey ||
      apiKey === "VOTRE_API_KEY_DEPUIS_FIREBASE" ||
      !projectId ||
      !messagingSenderId ||
      !appId
    ) {
      setConfigStatus("Configuration Firebase incomplete")
    } else {
      setConfigStatus("Configuration Firebase valide")
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).then((reg) => {
        if (reg) {
          setSwStatus(`Actif (Scope: ${reg.scope})`)
        } else {
          setSwStatus("Non enregistre")
        }
      })
    } else {
      setSwStatus("Non supporte")
    }
  }, [])

  useEffect(() => {
    checkStatus()
    window.addEventListener("focus", checkStatus)
    return () => window.removeEventListener("focus", checkStatus)
  }, [checkStatus])

  const handleRegister = async () => {
    setLoading(true)
    try {
      const { initPushNotifications } = await import("../../../src/services/push-service")
      await initPushNotifications()
      checkStatus()
      alert("Demande d'initialisation terminee. Verifiez les statuts ci-dessous.")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur inconnue"
      alert(`Erreur d'initialisation : ${message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        marginTop: 20,
        padding: 16,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          marginBottom: 12,
          color: "var(--text-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>Diagnostic Push FCM</span>
        <button
          onClick={handleRegister}
          disabled={loading}
          style={{
            background: "var(--accent)",
            color: "var(--bg-base)",
            border: "none",
            borderRadius: 6,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Activation..." : "Activer / Tester"}
        </button>
      </div>

      <div
        style={{
          fontSize: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          color: "var(--text-secondary)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Permission :</span>
          <span
            style={{
              fontWeight: 700,
              color:
                permission === "granted"
                  ? "var(--success)"
                  : permission === "denied"
                    ? "var(--danger)"
                    : "var(--text-muted)",
            }}
          >
            {permission === "granted"
              ? "Accordee ✓"
              : permission === "denied"
                ? "Bloquee ✗"
                : "Non demandee (default)"}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Service Worker Push :</span>
          <span
            style={{
              fontWeight: 700,
              color: swStatus.includes("Actif") ? "var(--success)" : "var(--danger)",
            }}
          >
            {swStatus}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Variables Firebase Client :</span>
          <span
            style={{
              fontWeight: 700,
              color: configStatus.includes("valide") ? "var(--success)" : "var(--danger)",
            }}
          >
            {configStatus}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Cle VAPID configuree :</span>
          <span
            style={{ fontWeight: 700, color: vapidKeyExists ? "var(--success)" : "var(--danger)" }}
          >
            {vapidKeyExists ? "Oui ✓" : "Non ✗ (VITE_FIREBASE_VAPID_KEY manquant/invalide)"}
          </span>
        </div>
      </div>
    </div>
  )
}

function SectionLink({
  id,
  label,
  icon,
  active,
  badge,
  onClick,
}: {
  id: SettingsSection
  label: string
  icon: React.ReactNode
  active: boolean
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        width: "100%",
        padding: "10px 12px",
        borderRadius: 9,
        background: active ? "var(--accent-dim)" : "none",
        border: `1px solid ${active ? "var(--accent-border)" : "transparent"}`,
        cursor: "pointer",
        color: active ? "var(--accent)" : "var(--text-muted)",
        fontSize: 13,
        fontWeight: 500,
        fontFamily: "'DM Sans', sans-serif",
        textAlign: "left",
        transition: "all .15s",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "var(--bg-surface)"
          e.currentTarget.style.color = "var(--text-secondary)"
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "none"
          e.currentTarget.style.color = "var(--text-muted)"
        }
      }}
    >
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            background: "var(--danger)",
            color: "var(--text-primary)",
            fontSize: 10,
            fontWeight: 700,
            padding: "1px 6px",
            borderRadius: 20,
          }}
        >
          {badge}
        </span>
      )}
      {active && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "20%",
            bottom: "20%",
            width: 3,
            borderRadius: "0 2px 2px 0",
            background: "var(--accent)",
          }}
        />
      )}
    </button>
  )
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  maxLength,
  helper,
  error,
  disabled,
}: {
  label: string
  value: string
  onChange?: (v: string) => void
  type?: string
  placeholder?: string
  maxLength?: number
  helper?: string
  error?: string
  disabled?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const [showPwd, setShowPwd] = useState(false)

  return (
    <div style={{ marginBottom: 18 }}>
      <label
        style={{
          display: "block",
          fontSize: 11,
          color: "var(--text-muted)",
          letterSpacing: ".5px",
          textTransform: "uppercase",
          marginBottom: 7,
          fontWeight: 500,
        }}
      >
        {label}
        {maxLength && value && (
          <span
            style={{
              float: "right",
              color: value.length > maxLength * 0.9 ? "#fbbf24" : "var(--text-faint)",
            }}
          >
            {value.length}/{maxLength}
          </span>
        )}
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={type === "password" && showPwd ? "text" : type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: "100%",
            background: disabled ? "var(--bg-elevated)" : "var(--bg-surface)",
            border: `1px solid ${error ? "var(--danger-border)" : focused ? "var(--accent-border)" : "var(--border-subtle)"}`,
            borderRadius: 10,
            padding: type === "password" ? "12px 48px 12px 14px" : "12px 14px",
            fontSize: 13,
            color: disabled ? "var(--text-faint)" : "var(--text-primary)",
            fontFamily: "'DM Sans', sans-serif",
            outline: "none",
            transition: "border-color .2s",
            boxSizing: "border-box",
            cursor: disabled ? "not-allowed" : "text",
          }}
        />
        {type === "password" && (
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-faint)",
              fontSize: 11,
              fontFamily: "'DM Sans', sans-serif",
              transition: "color .15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-faint)")}
          >
            {showPwd ? "Masquer" : "Afficher"}
          </button>
        )}
      </div>
      {error && (
        <p
          style={{
            fontSize: 11,
            color: "var(--danger)",
            marginTop: 5,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span>!</span>
          {error}
        </p>
      )}
      {helper && !error && (
        <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 5 }}>{helper}</p>
      )}
    </div>
  )
}

function Toggle({
  value,
  onChange,
  label,
  description,
}: {
  value: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 0",
        borderBottom: "1px solid var(--border-subtle)",
        flexWrap: "wrap",
        rowGap: 10,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text-primary)",
            marginBottom: description ? 2 : 0,
          }}
        >
          {label}
        </div>
        {description && (
          <div style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
            {description}
          </div>
        )}
      </div>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        style={{
          width: 44,
          height: 24,
          borderRadius: 20,
          flexShrink: 0,
          background: value ? "var(--accent)" : "var(--border-subtle)",
          border: "none",
          cursor: "pointer",
          position: "relative",
          transition: "background .2s",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 3,
            left: value ? 23 : 3,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: value ? "var(--bg-base)" : "var(--text-faint)",
            transition: "left .2s",
          }}
        />
      </button>
    </div>
  )
}

function DangerZoneItem({
  label,
  description,
  buttonLabel,
  onClick,
  destructive = false,
}: {
  label: string
  description: string
  buttonLabel: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <div
      className="dz-item"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 18px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 10,
        marginBottom: 10,
        flexWrap: "wrap",
        rowGap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, marginRight: 20 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: destructive ? "var(--danger)" : "var(--text-primary)",
            marginBottom: 3,
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>
          {description}
        </div>
      </div>
      <button
        onClick={onClick}
        style={{
          background: destructive ? "var(--danger-dim)" : "var(--border-subtle)",
          border: `1px solid ${destructive ? "var(--danger-border)" : "var(--border-default)"}`,
          borderRadius: 8,
          padding: "8px 14px",
          fontSize: 12,
          fontWeight: 600,
          color: destructive ? "var(--danger)" : "var(--text-secondary)",
          cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif",
          whiteSpace: "nowrap",
          transition: "all .15s",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = destructive
            ? "var(--danger-dim)"
            : "var(--border-default)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = destructive
            ? "var(--danger-dim)"
            : "var(--border-subtle)"
        }}
      >
        {buttonLabel}
      </button>
    </div>
  )
}

function ConfirmDialog({ state, onCancel }: { state: ConfirmState; onCancel: () => void }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--overlay)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 9500,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(380px, 100%)",
          borderRadius: 16,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          boxShadow: "0 24px 64px #00000080",
          padding: 20,
        }}
      >
        <div
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontSize: 20,
            fontWeight: 800,
            color: "var(--text-primary)",
            marginBottom: 8,
          }}
        >
          {state.title}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {state.description}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button
            onClick={onCancel}
            style={{
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              borderRadius: 9,
              padding: "10px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Annuler
          </button>
          <button
            onClick={() => {
              void state.onConfirm()
              onCancel()
            }}
            style={{
              border: "1px solid transparent",
              background: state.tone === "warning" ? "var(--warning, #fbbf24)" : "var(--danger)",
              color: "var(--bg-base)",
              borderRadius: 9,
              padding: "10px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Ligne de la carte « Sessions actives ». */
interface SessionAffichee {
  appareilId: number
  /** Identifiant de l appareil : sert a annoncer sa revocation aux autres sessions. */
  cookiesWebId: string | null
  device: string
  /** Systeme d exploitation. Le referentiel ne stocke ni IP ni localisation :
   *  on affiche donc le systeme plutot qu une ville inventee. */
  location: string
  current: boolean
  ts: string
  isMobile: boolean
}

/** Derniere activite en clair : « Maintenant », « Il y a 3 h », puis la date. */
function derniereActivite(iso: string | null): string {
  if (!iso) return "Jamais connecte"
  const date = new Date(iso)
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (minutes < 2) return "Maintenant"
  if (minutes < 60) return `Il y a ${minutes} min`
  if (minutes < 24 * 60) return `Il y a ${Math.floor(minutes / 60)} h`
  if (minutes < 7 * 24 * 60) return `Il y a ${Math.floor(minutes / 1440)} j`
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
}

function versSession(a: Appareil): SessionAffichee {
  return {
    appareilId: a.appareilId,
    cookiesWebId: a.cookiesWebId,
    device: a.libelle,
    /**
     * Systeme, complete du pseudo de l'appareil quand il est renseigne :
     * « Windows 11 (Poste accueil) ». Sans lui, deux appareils du meme systeme
     * sont impossibles a distinguer dans cette liste.
     *
     * Rien n'est ajoute quand le pseudo est absent — pas de parentheses vides.
     */
    location: a.nomAgent ? `${a.system ?? ""} (${a.nomAgent})`.trim() : (a.system ?? ""),
    current: estAppareilCourant(a),
    ts: derniereActivite(a.lastLogin),
    isMobile: a.typeDevice === TYPE_DEVICE.android || a.typeDevice === TYPE_DEVICE.ios,
  }
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const { deleteAccount: removeAccount, logoutEverywhere, updateUser, user } = useAuth()
  const { success, error: toastError, info, warning } = useToast()

  const [section, setSection] = useState<SettingsSection>("profile")
  const [saving, setSaving] = useState(false)
  // Appareils du compte, charges depuis l'API. `null` = chargement en cours.
  const [sessions, setSessions] = useState<SessionAffichee[] | null>(null)
  // Journal des connexions. `null` = chargement en cours.
  const [historique, setHistorique] = useState<LoginAccess[] | null>(null)

  // Charge les appareils quand la section Securite s affiche : inutile de
  // solliciter l API tant que l utilisateur reste sur son profil.
  useEffect(() => {
    if (section !== "security") return
    let annule = false
    void (async () => {
      try {
        const liste = await fetchAppareils()
        if (annule) return
        // Les appareils deconnectes a distance restent en base pour
        // l historique, mais n ont pas leur place dans « sessions actives ».
        setSessions(liste.filter((a) => !a.revoked).map(versSession))
        const journal = await fetchLoginHistory()
        if (!annule) setHistorique(journal)
      } catch {
        if (!annule) setSessions([])
        if (!annule) setHistorique([])
      }
    })()
    return () => {
      annule = true
    }
  }, [section])

  const deconnecterSession = useCallback(
    async (appareilId: number, libelle: string, cookiesWebId: string | null) => {
      try {
        await deconnecterAppareil(appareilId)
        setSessions((prev) => (prev ?? []).filter((s) => s.appareilId !== appareilId))
        // Coupe l acces sans attendre l expiration du jeton (15 min) : les
        // autres sessions du compte recoivent l annonce et celle qui se
        // reconnait se deconnecte immediatement.
        if (cookiesWebId) sendSessionRevoked(cookiesWebId)
        warning("Session fermee", `${libelle} a ete deconnecte.`)
      } catch {
        toastError("Deconnexion impossible", "Reessaie dans un instant.")
      }
    },
    [warning, toastError]
  )
  const [profile, setProfile] = useState<Profile>(() => getInitialProfile(user))
  const [draft, setDraft] = useState<Profile>(() => getInitialProfile(user))
  const [security, setSecurity] = useState<SecurityForm>({
    currentPwd: "",
    newPwd: "",
    confirmPwd: "",
  })
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)

  // Notifications
  const [notifMessages, setNotifMessages] = useState(() => {
    const cached = localStorage.getItem("notif_messages")
    return cached === null ? true : cached === "true"
  })
  const [notifCalls, setNotifCalls] = useState(() => {
    const cached = localStorage.getItem("notif_calls")
    return cached === null ? true : cached === "true"
  })
  const [notifSounds, setNotifSounds] = useState(() => {
    const cached = localStorage.getItem("notif_sounds")
    return cached === null ? true : cached === "true"
  })
  const [notifPreview, setNotifPreview] = useState(() => {
    const cached = localStorage.getItem("notif_preview")
    return cached === null ? true : cached === "true"
  })

  const updateNotifMessages = (val: boolean) => {
    setNotifMessages(val)
    localStorage.setItem("notif_messages", String(val))
  }
  const updateNotifCalls = (val: boolean) => {
    setNotifCalls(val)
    localStorage.setItem("notif_calls", String(val))
  }
  const updateNotifSounds = (val: boolean) => {
    setNotifSounds(val)
    localStorage.setItem("notif_sounds", String(val))
  }
  const updateNotifPreview = (val: boolean) => {
    setNotifPreview(val)
    localStorage.setItem("notif_preview", String(val))
  }

  // Confidentialite : les valeurs viennent du compte, pas d'un etat local.
  const [privacy, setPrivacy] = useState<PrivacySettings>(PRIVACY_DEFAULTS)
  const [privacyLoaded, setPrivacyLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchPrivacy()
      .then((settings) => {
        if (!cancelled) setPrivacy(settings)
      })
      .catch(() => {
        // Serveur injoignable : on affiche les valeurs par defaut du backend
        // plutot qu'un ecran vide, mais on le signale a la premiere modification.
      })
      .finally(() => {
        if (!cancelled) setPrivacyLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Enregistre un reglage et revient en arriere si le serveur refuse : une
   * bascule qui reste dans sa nouvelle position apres un echec ferait croire que
   * le reglage est pris en compte.
   */
  const updatePrivacy = async (patch: Partial<PrivacySettings>) => {
    const precedent = privacy
    setPrivacy((current) => ({ ...current, ...patch }))
    try {
      await savePrivacy(patch)
    } catch (err) {
      setPrivacy(precedent)
      toastError(
        "Reglage non enregistre",
        err instanceof Error ? err.message : "Le serveur n'a pas accepte la modification."
      )
    }
  }

  // Apparence. La langue vit dans le fournisseur d'internationalisation : elle
  // pilote toute l'interface, pas seulement cet ecran.
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">("medium")
  const { language, setLanguage, t } = useTranslation()

  /**
   * Pseudo de CET appareil pour ce compte, modifiable ici.
   *
   * Il est demande une fois a la connexion ; les parametres sont l'endroit ou
   * on le change ensuite — un poste qui change de titulaire, une faute de
   * frappe a corriger.
   */
  const [pseudoAppareil, setPseudoAppareil] = useState<string>(pseudoEnCache() ?? "")
  const [pseudoEnregistre, setPseudoEnregistre] = useState(false)
  useEffect(() => {
    void lirePseudoServeur().then((valeur) => {
      if (valeur) setPseudoAppareil(valeur)
    })
  }, [])

  const sauverPseudo = async () => {
    const propre = pseudoAppareil.trim()
    if (!propre || pseudoEnregistre) return
    setPseudoEnregistre(true)
    try {
      const enregistre = await enregistrerPseudo(propre)
      setPseudoAppareil(enregistre)
      success("Nom de l'appareil enregistre", enregistre)
    } catch (err) {
      toastError("Enregistrement impossible", err instanceof Error ? err.message : undefined)
    } finally {
      setPseudoEnregistre(false)
    }
  }

  /** Personnes bloquees, chargees a l'ouverture des parametres. */
  const [bloques, setBloques] = useState<PersonneBloquee[]>([])
  useEffect(() => {
    let annule = false
    void listerBloques().then((liste) => {
      if (!annule) setBloques(liste)
    })
    return () => {
      annule = true
    }
  }, [])

  const retirerBlocage = async (personne: PersonneBloquee) => {
    try {
      await debloquer(personne.idBlock)
      setBloques((liste) => liste.filter((b) => b.idBlock !== personne.idBlock))
      success("Debloque", `${nomDuBloque(personne)} peut de nouveau vous ecrire.`)
    } catch (err) {
      toastError("Deblocage impossible", err instanceof Error ? err.message : undefined)
    }
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const isDirty = JSON.stringify(profile) !== JSON.stringify(draft)
  const pwdStrength = analyzePassword(security.newPwd)

  const setD = (k: keyof Profile) => (v: string) => setDraft((prev) => ({ ...prev, [k]: v }))

  const saveProfile = async () => {
    if (!draft.name.trim()) return toastError("Nom invalide", "Le nom ne peut pas etre vide.")
    if (draft.statusMsg.length > 100)
      return toastError("Message trop long", "Maximum 100 caracteres.")
    setSaving(true)
    try {
      // Une photo fraichement choisie est encore une data-URL locale : le
      // backend ne l'accepte pas, il faut la televerser et enregistrer son
      // URL /api/media/{id}.
      const avatarUrl = draft.avatar?.startsWith("data:")
        ? await uploadAvatarDataUrl(draft.avatar)
        : (draft.avatar ?? null)

      // Persistance reelle cote backend : c'est ce qui rend le profil (photo
      // comprise) visible par les autres et le fait survivre aux reconnexions.
      const saved = await updateProfileApi({
        pseudo: draft.name.trim(),
        statusMsg: draft.statusMsg || null,
        avatarUrl,
      })
      const nextAvatar = saved.avatarUrl ?? avatarUrl
      setDraft((prev) => ({ ...prev, avatar: nextAvatar }))
      setProfile({ ...draft, avatar: nextAvatar })
      updateUser({
        name: saved.pseudo ?? draft.name.trim(),
        phone: draft.phone,
        email: draft.email,
        statusMsg: saved.statusMsg ?? draft.statusMsg,
        avatar: nextAvatar,
      })
      success("Profil mis a jour", "Vos informations ont bien ete enregistrees.")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de sauvegarder. Reessayez."
      toastError("Erreur", message)
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (file.size > 10 * 1024 * 1024)
      return toastError("Fichier trop volumineux", "L'avatar ne doit pas depasser 10 Mo.")
    if (!file.type.startsWith("image/"))
      return toastError("Format invalide", "Choisissez une image (JPEG, PNG, WebP).")
    try {
      // Apercu local : la miniature n'est televersee qu'a l'enregistrement.
      const dataUrl = await fileToAvatarDataUrl(file)
      setDraft((prev) => ({ ...prev, avatar: dataUrl }))
      info("Avatar selectionne", "Cliquez sur 'Sauvegarder' pour confirmer.")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Image illisible."
      toastError("Avatar refuse", message)
    }
  }

  const changePassword = async () => {
    if (!security.currentPwd) return toastError("Mot de passe actuel requis")
    if (security.newPwd.length < 8)
      return toastError("Mot de passe trop court", "Le backend exige au moins 8 caracteres.")
    if (pwdStrength.score < 2)
      return toastError("Mot de passe trop faible", "Choisissez un mot de passe plus securise.")
    if (security.newPwd !== security.confirmPwd)
      return toastError("Les mots de passe ne correspondent pas")
    if (security.newPwd === security.currentPwd)
      return toastError("Mot de passe identique", "Choisissez un mot de passe different.")
    setSaving(true)
    try {
      await changePasswordApi(security.currentPwd, security.newPwd)
      setSecurity({ currentPwd: "", newPwd: "", confirmPwd: "" })
      success("Mot de passe modifie", "Votre nouveau mot de passe est actif.")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Mot de passe actuel incorrect."
      toastError("Erreur", message)
    } finally {
      setSaving(false)
    }
  }

  const logoutAll = async () => {
    setConfirmState({
      title: "Deconnecter tous vos appareils ?",
      description: "Toutes vos sessions actives seront fermees et vous devrez vous reconnecter.",
      confirmLabel: "Tout deconnecter",
      tone: "warning",
      onConfirm: async () => {
        await logoutEverywhere()
        navigate("/login", { replace: true })
      },
    })
  }

  const deleteAccount = async () => {
    const confirm1 = window.prompt(
      'Tapez "SUPPRIMER" pour confirmer la suppression definitive de votre compte.'
    )
    if (confirm1 !== "SUPPRIMER") return toastError("Suppression annulee")

    // Le backend (DELETE /api/account) exige le mot de passe pour confirmer.
    const password = window.prompt("Saisissez votre mot de passe pour confirmer la suppression.")
    if (!password) return toastError("Suppression annulee")

    try {
      await removeAccount(password)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Suppression impossible."
      return toastError("Suppression refusee", message)
    }
    warning("Compte supprime", "Votre compte et vos donnees ont ete effaces.")
    navigate("/welcome", { replace: true })
  }

  const NAV: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    {
      id: "profile",
      label: "Profil",
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
    {
      id: "security",
      label: "Securite",
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
    },
    {
      id: "notifications",
      label: "Notifications",
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
      ),
    },
    {
      id: "privacy",
      label: "Confidentialite",
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
    },
    {
      id: "appearance",
      label: "Apparence",
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ),
    },
    {
      id: "about",
      label: "A propos",
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      ),
    },
  ]

  return (
    <>
      {confirmState && (
        <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} />
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=DM+Sans:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .settings-root {
          font-family: 'DM Sans', sans-serif;
          background: linear-gradient(var(--motif-overlay), var(--motif-overlay)), url("/motif-bg.png") repeat; background-size: auto, 280px auto; color: var(--text-primary);
          display: grid; grid-template-columns: 230px 1fr;
          width: 100%;
          overflow-x: hidden;
          /* La page vit dans .layout-main (hauteur d'ecran figee, en-tete mobile
             au-dessus) : elle prend l'espace RESTANT et defile seule. Une hauteur
             en dvh deborderait de la hauteur de l'en-tete et couperait le bas de
             la derniere carte — meme idiome que .layout-main > .calls-root. */
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
        }


        .s-sidebar {
          border-right: 1px solid var(--border-subtle);
          padding: 28px 14px;
          display: flex; flex-direction: column; gap: 4px;
          position: sticky; top: 0; height: 100vh; height: 100dvh;
          overflow-y: auto;
        }
        .s-back {
          display: flex; align-items: center; gap: 8px;
          color: var(--text-muted); font-size: 12px; cursor: pointer;
          background: none; border: none; padding: 8px 10px;
          border-radius: 8px; font-family: 'DM Sans', sans-serif;
          transition: color .15s, background .15s; margin-bottom: 16px;
          width: 100%; text-align: left;
        }
        .s-back:hover { color: var(--text-secondary); background: var(--bg-surface); }
        .s-nav-title {
          font-size: 9px; color: var(--text-ghost); letter-spacing: 1.5px;
          text-transform: uppercase; padding: 8px 12px 4px; font-weight: 500;
        }


        .s-main { padding: 36px 48px; max-width: 680px; width: 100%; min-width: 0; }
        .s-mobile-nav { display: none; }

        .s-page-title {
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: 26px; font-weight: 800; letter-spacing: -1px;
          color: var(--text-primary); margin-bottom: 6px;
        }
        .s-page-sub { font-size: 13px; color: var(--text-faint); margin-bottom: 32px; line-height: 1.6; }


        .s-card {
          background: var(--bg-surface); border: 1px solid var(--border-subtle);
          border-radius: 14px; padding: 22px 24px; margin-bottom: 16px;
        }

        /* Reglage a plusieurs choix : un intitule, sa description, ses options. */
        .privacy-choice {
          padding: 14px 0 4px;
          border-top: 1px solid var(--border-subtle);
          margin-top: 6px;
        }
        .privacy-choice-label {
          font-size: 13px; font-weight: 600; color: var(--text-primary);
        }
        .privacy-choice-desc {
          font-size: 11.5px; color: var(--text-faint); line-height: 1.5; margin-top: 3px;
        }
        .privacy-choice-opts {
          display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;
        }
        .privacy-choice-opts button:disabled {
          opacity: 0.55; cursor: progress;
        }

        /* Choix des sonneries : un evenement par ligne, son menu et son ecoute. */
        /* Import d'une sonnerie : le bouton, puis la liste de ce qui a ete importe. */
        .ringtone-import { padding-top: 12px; border-top: 1px solid var(--border-subtle); margin-top: 4px; }
        .ringtone-import-btn {
          width: 100%; padding: 10px 14px; border-radius: 9px;
          border: 1px dashed var(--border-default); background: var(--bg-elevated);
          color: var(--text-secondary); font-family: 'DM Sans', sans-serif;
          font-size: 12.5px; font-weight: 600; cursor: pointer;
        }
        .ringtone-import-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent-border); }
        .ringtone-import-btn:disabled { cursor: progress; opacity: 0.7; }
        .ringtone-imported-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .ringtone-imported-list li { display: flex; align-items: center; gap: 8px; }
        .ringtone-imported-name {
          flex: 1; min-width: 0; font-size: 12px; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ringtone-remove {
          width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%;
          border: none; background: none; color: var(--text-ghost); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .ringtone-remove:hover { color: var(--danger); background: var(--danger-dim); }

        .ringtone-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 14px; padding: 10px 0; border-bottom: 1px solid var(--border-subtle);
        }
        .ringtone-row:last-of-type { border-bottom: none; }
        .ringtone-row-label { font-size: 13px; color: var(--text-primary); font-weight: 600; }
        .ringtone-row-controls { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .ringtone-select {
          max-width: 230px; padding: 7px 10px; border-radius: 8px;
          border: 1px solid var(--border-subtle); background: var(--bg-base);
          color: var(--text-primary); font-family: inherit; font-size: 12px;
        }
        .ringtone-listen {
          width: 32px; height: 32px; flex-shrink: 0; border-radius: 50%;
          border: 1px solid var(--border-subtle); background: var(--bg-base);
          color: var(--accent); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .ringtone-listen:hover { background: var(--bg-surface); }
        .ringtone-listen:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        @media (max-width: 560px) {
          .ringtone-row { flex-direction: column; align-items: flex-start; gap: 8px; }
          .ringtone-row-controls { width: 100%; }
          .ringtone-select { flex: 1; max-width: none; }
        }
        .s-card-title {
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: 14px; font-weight: 700; color: var(--text-primary);
          letter-spacing: -.3px; margin-bottom: 18px;
          display: flex; align-items: center; gap: 8px;
        }
        .s-card-title-badge {
          font-size: 9px; background: var(--border-subtle); color: var(--text-muted);
          padding: 2px 8px; border-radius: 5px; font-weight: 500;
          font-family: 'DM Sans', sans-serif; letter-spacing: .3px;
        }

        /* avatar */
        .avatar-section {
          display: flex; align-items: center; gap: 20px; margin-bottom: 24px;
        }
        .avatar-wrap { position: relative; cursor: pointer; }
        .avatar-circle {
          width: 72px; height: 72px; border-radius: 50%;
          background: var(--av-0-bg); color: var(--accent);
          display: flex; align-items: center; justify-content: center;
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: 22px; font-weight: 800;
          overflow: hidden;
        }
        .avatar-edit-overlay {
          position: absolute; inset: 0; border-radius: 50%;
          background: #00000070; display: flex; align-items: center;
          justify-content: center; opacity: 0; transition: opacity .15s;
          cursor: pointer;
        }
        .avatar-wrap:hover .avatar-edit-overlay { opacity: 1; }
        .avatar-info { flex: 1; }
        .avatar-name {
          font-family: 'Bricolage Grotesque', sans-serif;
          font-size: 18px; font-weight: 800; color: var(--text-primary);
          letter-spacing: -.3px; margin-bottom: 3px;
        }
        .avatar-email { font-size: 12px; color: var(--text-faint); margin-bottom: 10px; }
        .avatar-btn {
          display: inline-flex; align-items: center; gap: 6px;
          background: var(--border-subtle); border: 1px solid var(--border-default);
          border-radius: 8px; padding: 7px 14px;
          font-size: 12px; color: var(--text-secondary); cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-weight: 500;
          transition: all .15s;
        }
        .avatar-btn:hover { background: var(--border-default); color: var(--text-primary); }

        /* save bar */
        .save-bar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px; background: var(--accent-dim);
          border: 1px solid var(--accent-border); border-radius: 10px;
          margin-bottom: 16px;
          animation: fadeIn .2s ease;
        }
        @keyframes fadeIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }
        .save-bar-txt { font-size: 13px; color: var(--accent); font-weight: 500; }
        .save-btns { display: flex; gap: 8px; }
        .btn-discard {
          background: none; border: 1px solid var(--border-default); border-radius: 8px;
          padding: 8px 16px; font-size: 12px; color: "var(--text-muted)"; cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-weight: 500; color: var(--text-muted);
          transition: all .15s;
        }
        .btn-discard:hover { background: var(--border-subtle); color: var(--text-secondary); }
        .btn-save {
          background: var(--accent); border: none; border-radius: 8px;
          padding: 8px 18px; font-size: 12px; color: var(--bg-base);
          font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif;
          display: flex; align-items: center; gap: 6px; transition: opacity .15s;
        }
        .btn-save:hover:not(:disabled) { opacity: .88; }
        .btn-save:disabled { opacity: .5; cursor: not-allowed; }

        /* strength meter */
        .strength-bar { height: 3px; background: var(--border-subtle); border-radius: 99px; overflow: hidden; margin-bottom: 5px; }
        .strength-fill { height: 100%; border-radius: 99px; transition: width .35s, background .35s; }

        /* font size selector */
        .font-opts { display: flex; gap: 8px; }
        .font-opt {
          flex: 1; padding: 10px 12px; border-radius: 9px;
          border: 1px solid var(--border-subtle); background: var(--bg-surface);
          cursor: pointer; text-align: center; transition: all .15s;
          font-family: 'DM Sans', sans-serif;
        }
        .font-opt:hover { border-color: var(--border-default); }
        .font-opt.on { border-color: var(--accent-border); background: var(--accent-dim); }
        .font-opt-label { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .font-opt.on .font-opt-label { color: var(--accent); }

        @media (max-width: 860px) {
          .settings-root { grid-template-columns: 1fr; width: 100%; overflow-x: hidden; }
          .s-sidebar { display: none; }
          .s-main { max-width: 100%; width: 100%; padding: 16px 12px 22px; }
          .s-page-title { font-size: 22px; line-height: 1.15; }
          .s-page-sub { margin-bottom: 18px; }
          .s-card { padding: 16px 14px; margin-bottom: 12px; border-radius: 12px; }
          .s-card-title { margin-bottom: 14px; flex-wrap: wrap; row-gap: 6px; }
          .avatar-section { flex-direction: column; align-items: flex-start; gap: 12px; }
          .avatar-info { width: 100%; }
          .save-bar {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
            padding: 12px;
          }
          .save-btns { width: 100%; flex-direction: column; }
          .save-btns button { width: 100%; justify-content: center; }
          .font-opts { flex-direction: column; }
          .font-opt { width: 100%; }
          .s-mobile-nav {
            display: flex;
            gap: 8px;
            overflow-x: auto;
            padding: 0 2px 10px;
            margin-bottom: 8px;
            scrollbar-width: none;
          }
          .s-mobile-nav::-webkit-scrollbar { display: none; }
          .s-mobile-tab {
            border: 1px solid var(--border-subtle);
            background: var(--bg-surface);
            color: var(--text-secondary);
            border-radius: 999px;
            font-family: 'DM Sans', sans-serif;
            font-size: 12px;
            white-space: nowrap;
            padding: 8px 12px;
          }
          .s-mobile-tab.on {
            border-color: var(--accent-border);
            color: var(--accent);
            background: var(--accent-dim);
          }
          .dz-item {
            padding: 14px 12px !important;
          }
          .dz-item > div {
            margin-right: 0 !important;
            flex-basis: 100%;
          }
          .dz-item button {
            width: 100%;
          }
          .session-row,
          .about-row,
          .stack-row {
            align-items: flex-start !important;
            flex-direction: column;
            gap: 8px;
          }
          .session-main {
            width: 100%;
            min-width: 0;
          }
          .session-row button {
            width: 100%;
          }
          .about-value,
          .stack-value {
            text-align: left !important;
            width: 100%;
          }
        }
      `}</style>

      <input
        ref={fileRef}
        type="file"
        style={{ display: "none" }}
        accept="image/*"
        onChange={handleAvatarUpload}
      />

      <div className="settings-root">
        <aside className="s-sidebar">
          <button className="s-back" onClick={() => navigate(-1)}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Retour
          </button>

          <div className="s-nav-title">Parametres</div>

          {NAV.map((n) => (
            <SectionLink
              key={n.id}
              id={n.id}
              label={n.label}
              icon={n.icon}
              active={section === n.id}
              onClick={() => setSection(n.id)}
            />
          ))}
        </aside>

        <main className="s-main">
          <div className="s-mobile-nav">
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`s-mobile-tab ${section === n.id ? "on" : ""}`}
                onClick={() => setSection(n.id)}
              >
                {n.label}
              </button>
            ))}
          </div>

          {section === "profile" && (
            <>
              <div className="s-page-title">Mon profil</div>
              <p className="s-page-sub">
                Ces informations sont visibles par vos contacts sur Alanya.
              </p>

              {/* Barre de sauvegarde */}
              {isDirty && (
                <div className="save-bar">
                  <span className="save-bar-txt">Modifications non sauvegardees</span>
                  <div className="save-btns">
                    <button className="btn-discard" onClick={() => setDraft(profile)}>
                      Annuler
                    </button>
                    <button className="btn-save" onClick={saveProfile} disabled={saving}>
                      {saving && (
                        <div
                          style={{
                            width: 12,
                            height: 12,
                            border: "2px solid color-mix(in srgb, var(--bg-base) 70%, transparent)",
                            borderTopColor: "var(--bg-base)",
                            borderRadius: "50%",
                            animation: "spin .65s linear infinite",
                          }}
                        />
                      )}
                      {saving ? "Sauvegarde..." : "Sauvegarder"}
                    </button>
                  </div>
                </div>
              )}

              <div className="s-card">
                {/* Avatar */}
                <div className="avatar-section">
                  <div className="avatar-wrap" onClick={() => fileRef.current?.click()}>
                    <div className="avatar-circle">
                      {avatarDisplaySrc(draft.avatar) ? (
                        <img
                          src={avatarDisplaySrc(draft.avatar)!}
                          alt="avatar"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        draft.name
                          .split(" ")
                          .map((w) => w[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()
                      )}
                    </div>
                    <div className="avatar-edit-overlay">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--text-primary)"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </div>
                  </div>
                  <div className="avatar-info">
                    <div className="avatar-name">{profile.name}</div>
                    {profile.email ? <div className="avatar-email">{profile.email}</div> : null}
                    <button className="avatar-btn" onClick={() => fileRef.current?.click()}>
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                      </svg>
                      Changer la photo
                    </button>
                  </div>
                </div>

                <Field
                  label="Nom complet"
                  value={draft.name}
                  onChange={setD("name")}
                  maxLength={60}
                  placeholder="Votre nom"
                />
                <Field
                  label="Message de statut"
                  value={draft.statusMsg}
                  onChange={setD("statusMsg")}
                  maxLength={100}
                  placeholder="Ce que vous faites en ce moment..."
                  helper="Visible par tous vos contacts."
                />
              </div>

              <div className="s-card">
                <div className="s-card-title">
                  Informations de contact{" "}
                  <span className="s-card-title-badge">Non modifiables ici</span>
                </div>
                {draft.email ? (
                  <Field
                    label="Adresse email"
                    value={draft.email}
                    disabled
                    helper="Contactez le support pour modifier votre email."
                  />
                ) : (
                  <Field
                    label="Adresse email"
                    value="Aucun email renseigne"
                    disabled
                    helper="Les nouveaux comptes exigent maintenant une adresse email verifiee."
                  />
                )}
                {/* C'est ici que le repertoire renvoie l'utilisateur chercher son
                    identifiant : il doit y porter le meme nom qu'ailleurs, et etre
                    groupe par paires comme dans les champs de saisie. */}
                <Field
                  label="Alanya ID"
                  value={draft.phone ? formatAlanyaNumber(draft.phone) : "—"}
                  disabled
                  helper="Cet identifiant est lie a votre compte et ne peut pas etre change."
                />
              </div>
            </>
          )}

          {section === "security" && (
            <>
              <div className="s-page-title">Securite</div>
              <p className="s-page-sub">Gerez votre mot de passe et la securite de votre compte.</p>

              <div className="s-card">
                <div className="s-card-title">Changer le mot de passe</div>
                <Field
                  label="Mot de passe actuel"
                  value={security.currentPwd}
                  onChange={(v) => setSecurity((p) => ({ ...p, currentPwd: v }))}
                  type="password"
                  placeholder="********"
                />
                <Field
                  label="Nouveau mot de passe"
                  value={security.newPwd}
                  onChange={(v) => setSecurity((p) => ({ ...p, newPwd: v }))}
                  type="password"
                  placeholder="Choisissez un mot de passe fort"
                />

                {security.newPwd && (
                  <div style={{ marginTop: -10, marginBottom: 16 }}>
                    <div className="strength-bar">
                      <div
                        className="strength-fill"
                        style={{
                          width: `${(pwdStrength.score / 5) * 100}%`,
                          background: pwdStrength.color,
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: pwdStrength.color, fontWeight: 500 }}>
                        {pwdStrength.label}
                      </span>
                    </div>
                  </div>
                )}

                <Field
                  label="Confirmer le nouveau mot de passe"
                  value={security.confirmPwd}
                  onChange={(v) => setSecurity((p) => ({ ...p, confirmPwd: v }))}
                  type="password"
                  placeholder="Repetez le mot de passe"
                  error={
                    security.confirmPwd && security.newPwd !== security.confirmPwd
                      ? "Les mots de passe ne correspondent pas"
                      : undefined
                  }
                />

                <button
                  onClick={changePassword}
                  disabled={
                    saving ||
                    !security.currentPwd ||
                    !security.newPwd ||
                    security.newPwd !== security.confirmPwd ||
                    pwdStrength.score < 2
                  }
                  style={{
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: 9,
                    padding: "12px 24px",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--bg-base)",
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    opacity:
                      saving ||
                      !security.currentPwd ||
                      !security.newPwd ||
                      security.newPwd !== security.confirmPwd ||
                      pwdStrength.score < 2
                        ? 0.4
                        : 1,
                    transition: "opacity .15s",
                  }}
                >
                  {saving ? "Modification..." : "Modifier le mot de passe"}
                </button>
              </div>

              {/* Pseudo de cet appareil. Place juste avant la liste des
                  sessions : c'est la qu'on lit « Windows 11 (Poste accueil) »,
                  donc la qu'on comprend a quoi sert ce champ. */}
              <div className="s-card">
                <div className="s-card-title">Nom de cet appareil</div>
                <div className="s-hint" style={{ marginTop: 0, marginBottom: 12 }}>
                  Affiche au-dessus des messages envoyes depuis cet appareil, et uniquement pour les
                  autres appareils de ce compte. Vos correspondants ne le voient jamais.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={pseudoAppareil}
                    maxLength={50}
                    onChange={(e) => setPseudoAppareil(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void sauverPseudo()
                    }}
                    placeholder="Poste accueil, Bureau d'Awa..."
                    aria-label="Nom de cet appareil"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 10,
                      padding: "12px 14px",
                      fontSize: 13,
                      color: "var(--text-primary)",
                      fontFamily: "'DM Sans', sans-serif",
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => void sauverPseudo()}
                    disabled={!pseudoAppareil.trim() || pseudoEnregistre}
                    style={{
                      flexShrink: 0,
                      padding: "0 18px",
                      borderRadius: 10,
                      border: "none",
                      background: "var(--accent)",
                      color: "var(--accent-text)",
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: pseudoAppareil.trim() ? "pointer" : "default",
                      opacity: pseudoAppareil.trim() && !pseudoEnregistre ? 1 : 0.5,
                    }}
                  >
                    {pseudoEnregistre ? "..." : "Enregistrer"}
                  </button>
                </div>
              </div>

              <div className="s-card">
                <div className="s-card-title">Sessions actives</div>
                {sessions === null && (
                  <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "12px 0" }}>
                    Chargement…
                  </div>
                )}
                {sessions !== null && sessions.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "12px 0" }}>
                    Aucun appareil enregistre pour le moment.
                  </div>
                )}
                {(sessions ?? []).map((s, i) => (
                  <div
                    className="session-row"
                    key={s.appareilId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 0",
                      borderBottom:
                        i < (sessions ?? []).length - 1 ? "1px solid var(--border-subtle)" : "none",
                      gap: 12,
                    }}
                  >
                    <div
                      className="session-main"
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          background: "var(--border-subtle)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--text-muted)"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        >
                          {s.isMobile ? (
                            <>
                              <rect x="5" y="2" width="14" height="20" rx="2" />
                              <line x1="12" y1="18" x2="12.01" y2="18" />
                            </>
                          ) : (
                            <>
                              <rect x="2" y="3" width="20" height="14" rx="2" />
                              <polyline points="8 21 12 17 16 21" />
                              <line x1="12" y1="17" x2="12" y2="21" />
                            </>
                          )}
                        </svg>
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: "var(--text-primary)",
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            marginBottom: 2,
                          }}
                        >
                          {s.device}
                          {s.current && (
                            <span
                              style={{
                                fontSize: 9,
                                background: "var(--success-dim)",
                                color: "var(--success)",
                                padding: "2px 7px",
                                borderRadius: 4,
                                fontWeight: 600,
                              }}
                            >
                              Appareil actuel
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                          {s.location ? `${s.location} - ` : ""}
                          {s.ts}
                        </div>
                      </div>
                    </div>
                    {!s.current && (
                      <button
                        onClick={() =>
                          void deconnecterSession(s.appareilId, s.device, s.cookiesWebId)
                        }
                        style={{
                          background: "var(--danger-dim)",
                          border: "1px solid var(--danger-border)",
                          borderRadius: 7,
                          padding: "6px 12px",
                          fontSize: 11,
                          color: "var(--danger)",
                          cursor: "pointer",
                          fontFamily: "'DM Sans', sans-serif",
                          fontWeight: 500,
                          transition: "all .15s",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "var(--danger-dim)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "var(--danger-dim)")
                        }
                      >
                        Deconnecter
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="s-card">
                <div className="s-card-title">Historique de connexion</div>
                <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 10 }}>
                  Chaque ouverture de session est enregistree. Une connexion que tu ne reconnais pas
                  ? Change ton mot de passe et deconnecte l appareil concerne.
                </div>

                {historique === null && (
                  <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "12px 0" }}>
                    Chargement…
                  </div>
                )}
                {historique !== null && historique.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "12px 0" }}>
                    Aucune connexion enregistree pour le moment.
                  </div>
                )}
                {(historique ?? []).map((a, i) => {
                  const details = [a.device, a.osSystem, a.ipAdress].filter(estRenseigne)
                  return (
                    <div
                      key={a.idLogin}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 0",
                        borderBottom:
                          i < (historique ?? []).length - 1
                            ? "1px solid var(--border-subtle)"
                            : "none",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: "var(--text-primary)",
                            marginBottom: 2,
                          }}
                        >
                          {quand(a.dateLogin)}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                          {details.length > 0 ? details.join(" - ") : "Origine inconnue"}
                        </div>
                      </div>
                      {i === 0 && (
                        <span
                          style={{
                            flex: "none",
                            fontSize: 9,
                            background: "var(--accent-dim)",
                            color: "var(--accent-text)",
                            padding: "2px 7px",
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          La plus recente
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="s-card">
                <div
                  className="s-card-title"
                  style={{ color: "var(--danger)", display: "flex", alignItems: "center", gap: 8 }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--danger)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Zone dangereuse
                </div>
                <DangerZoneItem
                  label="Deconnecter tous les appareils"
                  description="Invalide tous les refresh tokens actifs sur tous vos appareils."
                  buttonLabel="Deconnecter tout"
                  onClick={logoutAll}
                />
                <DangerZoneItem
                  label="Supprimer mon compte"
                  description="Action irreversible. Toutes vos donnees seront effacees definitivement apres 30 jours."
                  buttonLabel="Supprimer le compte"
                  onClick={deleteAccount}
                  destructive
                />
              </div>
            </>
          )}

          {section === "notifications" && (
            <>
              <div className="s-page-title">Notifications</div>
              <p className="s-page-sub">Choisissez ce que vous voulez recevoir et comment.</p>
              <div className="s-card">
                <div className="s-card-title">Notifications push</div>
                <Toggle
                  value={notifMessages}
                  onChange={updateNotifMessages}
                  label="Messages"
                  description="Recevoir une notification pour chaque nouveau message."
                />
                <Toggle
                  value={notifCalls}
                  onChange={updateNotifCalls}
                  label="Appels entrants"
                  description="Etre notifie des appels audio et video."
                />
                <Toggle
                  value={notifSounds}
                  onChange={updateNotifSounds}
                  label="Sons"
                  description="Jouer un son a la reception d'un message."
                />
                <Toggle
                  value={notifPreview}
                  onChange={updateNotifPreview}
                  label="Apercu du message"
                  description="Afficher le debut du message dans la notification."
                />
                <PushDiagnostic />
              </div>

              <RingtonePicker />
            </>
          )}

          {section === "privacy" && (
            <>
              <div className="s-page-title">Confidentialite</div>
              <p className="s-page-sub">Controlez ce que les autres peuvent voir sur vous.</p>
              <div className="s-card">
                <div className="s-card-title">Visibilite</div>
                <Toggle
                  value={privacy.readReceipts}
                  onChange={(v) => void updatePrivacy({ readReceipts: v })}
                  label="Confirmations de lecture"
                  description="Envoyer la confirmation de lecture quand vous lisez un message. Desactive, vous ne verrez pas non plus celles des autres."
                />

                <div className="privacy-choice">
                  <div className="privacy-choice-head">
                    <div className="privacy-choice-label">
                      Derniere connexion et statut en ligne
                    </div>
                    <div className="privacy-choice-desc">
                      Qui peut voir quand vous etes en ligne et quand vous avez ete vu pour la
                      derniere fois.
                    </div>
                  </div>
                  <div
                    className="privacy-choice-opts"
                    role="group"
                    aria-label="Visibilite de la derniere connexion"
                  >
                    {([2, 1, 0] as LastSeenVisibility[]).map((niveau) => (
                      <button
                        key={niveau}
                        className={`filter-btn ${privacy.lastSeenVisibility === niveau ? "on" : ""}`}
                        aria-pressed={privacy.lastSeenVisibility === niveau}
                        disabled={!privacyLoaded}
                        onClick={() => void updatePrivacy({ lastSeenVisibility: niveau })}
                      >
                        {LAST_SEEN_LABELS[niveau]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="s-hint">
                  Ces deux reglages sont enregistres sur votre compte et s'appliquent aussi a
                  l'application mobile.
                </div>
              </div>

              {/* Personnes bloquees. Sans cette liste, on ne peut debloquer que
                  quelqu'un dont on retrouve la fiche contact — or on peut
                  parfaitement bloquer un numero qu'on n'a jamais enregistre. */}
              <div className="s-card">
                <div className="s-card-title">Personnes bloquees</div>
                <div className="s-hint" style={{ marginTop: 0, marginBottom: 12 }}>
                  Leurs messages ne vous parviennent pas. Debloquer retablit l'echange.
                </div>
                {bloques.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 0" }}>
                    Vous n'avez bloque personne.
                  </div>
                ) : (
                  bloques.map((personne) => (
                    <div
                      key={personne.idBlock}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "10px 0",
                        borderTop: "1px solid var(--border-subtle)",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>
                          {nomDuBloque(personne)}
                        </div>
                        {personne.publicNumber && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {personne.publicNumber}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => void retirerBlocage(personne)}
                        style={{
                          flexShrink: 0,
                          padding: "7px 14px",
                          borderRadius: 8,
                          border: "1px solid var(--border-default)",
                          background: "var(--bg-surface)",
                          color: "var(--text-primary)",
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        Debloquer
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {section === "appearance" && (
            <>
              <div className="s-page-title">Apparence</div>
              <p className="s-page-sub">Personnalisez l'interface selon vos preferences.</p>
              <div className="s-card">
                <div className="s-card-title">Theme</div>
                <ThemeSelector />
              </div>
              <div className="s-card">
                <div className="s-card-title">Taille du texte</div>
                <div className="font-opts">
                  {(["small", "medium", "large"] as const).map((size) => (
                    <button
                      key={size}
                      className={`font-opt ${fontSize === size ? "on" : ""}`}
                      onClick={() => {
                        setFontSize(size)
                        info(
                          `Taille ${size === "small" ? "petite" : size === "medium" ? "normale" : "grande"} activee`
                        )
                      }}
                    >
                      <div
                        style={{
                          fontSize: size === "small" ? 14 : size === "medium" ? 17 : 21,
                          color: fontSize === size ? "var(--accent)" : "var(--text-primary)",
                          fontFamily: "'Bricolage Grotesque', sans-serif",
                          fontWeight: 700,
                          lineHeight: 1,
                        }}
                      >
                        Aa
                      </div>
                      <div className="font-opt-label">
                        {size === "small" ? "Petite" : size === "medium" ? "Normale" : "Grande"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="s-card">
                <div className="s-card-title">{t("language_settings")}</div>
                <div className="s-hint" style={{ marginTop: 0, marginBottom: 12 }}>
                  {t("language_description")}
                </div>
                <select
                  value={language}
                  onChange={(e) => {
                    const code = e.target.value as LanguageCode
                    setLanguage(code)
                    info(traduire(code, "language_settings"), LANGUAGE_NAMES[code])
                  }}
                  aria-label={t("language_settings")}
                  style={{
                    width: "100%",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 10,
                    padding: "12px 14px",
                    fontSize: 13,
                    color: "var(--text-primary)",
                    fontFamily: "'DM Sans', sans-serif",
                    outline: "none",
                  }}
                >
                  {LANGUAGE_CODES.map((code) => (
                    <option key={code} value={code}>
                      {libelleLangue(code)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {section === "about" && (
            <>
              <div className="s-page-title">A propos</div>
              <p className="s-page-sub">Informations sur l'application Alanya.</p>
              <div className="s-card">
                {[
                  { label: "Application", value: "Alanya" },
                  { label: "Version", value: "1.0.0-beta" },
                  { label: "Environnement", value: "Production" },
                  {
                    label: "Relais TURN (appels)",
                    // Diagnostic visible depuis un telephone : dit si ce build
                    // embarque les variables VITE_TURN_* (necessaires pour les
                    // appels entre reseaux differents).
                    value: isTurnConfigured() ? "Configure ✓" : "Absent — appels limites",
                  },
                  { label: "Projet", value: "Projet BD - ENSPY 2025-2026" },
                  { label: "Encadrant", value: "Dr. NANA BINKEU" },
                  { label: "Groupe", value: "Alanya II" },
                ].map(({ label, value }) => (
                  <div
                    className="about-row"
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "11px 0",
                      borderBottom: "1px solid var(--border-subtle)",
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{label}</span>
                    <span
                      className="about-value"
                      style={{
                        fontSize: 13,
                        color: "var(--text-primary)",
                        fontWeight: 500,
                        textAlign: "right",
                      }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="s-card">
                <div className="s-card-title">Stack technique</div>
                {[
                  { label: "Front-end", value: "React + Vite (web)  -  Flutter (mobile)" },
                  { label: "Back-end", value: "Next.js (App Router, API Routes)" },
                  { label: "Base de donnees", value: "PostgreSQL  -  Prisma" },
                  { label: "Temps reel", value: "WebSocket (serveur Node dedie)" },
                  { label: "Appels A/V", value: "WebRTC + serveur TURN/STUN (Metered)" },
                  { label: "Auth", value: "JWT (Access 15 min  -  Refresh rotatif)" },
                  { label: "Deploiement", value: "Vercel (API + web)  -  Render (WebSocket)" },
                ].map(({ label, value }) => (
                  <div
                    className="stack-row"
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "11px 0",
                      borderBottom: "1px solid var(--border-subtle)",
                      gap: 16,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
                      {label}
                    </span>
                    <span
                      className="stack-value"
                      style={{
                        fontSize: 12,
                        color: "var(--text-secondary)",
                        fontWeight: 500,
                        textAlign: "right",
                      }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Diagnostic en direct de la connexion temps reel (messages) */}
              <div className="s-card">
                <div className="s-card-title">Diagnostic temps reel</div>
                <RealtimeStatus />
              </div>

              {/* Comparateur de fournisseurs TURN (Metered, Cloudflare, coturn...) */}
              <TurnTester />
            </>
          )}
        </main>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}
