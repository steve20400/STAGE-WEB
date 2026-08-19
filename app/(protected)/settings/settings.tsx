import { useState, useRef, useCallback, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../../src/components/auth-provider"
import { useToast } from "../../../src/components/toast"
import { ThemeSelector } from "../../../src/components/theme-toggle"
import { type SessionUser } from "../../../src/data/session-user"
import { isTurnConfigured } from "../../../src/services/calls-service"
import TurnTester from "../../../src/components/turn-tester"
import RealtimeStatus from "../../../src/components/realtime-status"
import BoutonFicheMoteur from "../../../src/components/fiche-confidentialite"
import {
  debloquer,
  listerBloques,
  type PersonneBloquee,
} from "../../../src/services/blocked-service"
import {
  enregistrerPseudo,
  lirePseudoServeur,
  pseudoEnCache,
} from "../../../src/services/pseudo-appareil-service"
import {
  LANGUAGE_CODES,
  nomLangue,
  langueInitiale,
  libelleLangue,
  traduire,
  useTranslation,
  type Cle,
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
  rafraichirCatalogue,
  removeCustomRingtone,
  type CustomRingtone,
  previewRingtone,
  ringtoneFile,
  setRingtone,
  stopRingtonePreview,
  type RingtoneEvent,
} from "../../../src/services/ringtones"
import {
  defaultAudioOutput,
  setDefaultAudioOutput,
  type AudioOutputMode,
} from "../../../src/services/audio-output"
import {
  changePasswordApi,
  demanderReinitialisation,
  updateProfileApi,
} from "../../../src/services/auth-api"
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
} from "../../../src/services/user-access-service"
import {
  compterCacheTraductions,
  definirMoteurTraduction,
  lireMoteurTraduction,
  moteurLocalPresent,
  sAbonnerAuMoteurTraduction,
  telechargerComposants,
  viderCacheTraductions,
} from "../../../src/services/traduction-service"
import {
  MOTEURS_CONNUS,
  MOTEUR_PAR_DEFAUT,
  chargerFournisseurs,
  moteurSurAppareil,
  nomMoteur,
  noteMoteur,
  oublierFournisseurs,
  type CatalogueFournisseurs,
  type CodeMoteur,
  type FournisseurAnnonce,
} from "../../../src/services/traduction-fournisseurs"
// Sonde le couple de langues directement : `etatTraduction` du service repond
// « en-ligne » des qu'un moteur distant est choisi, ce qui masquerait l'etat
// reel des composants du navigateur — or c'est precisement ce que cette carte
// doit montrer, y compris a qui vient de choisir un autre moteur et voudrait
// savoir ce qu'il faudrait installer pour revenir sur l'appareil.
import {
  TelechargementRefuse,
  disponibiliteCouple,
  type DisponibiliteCouple,
} from "../../../src/services/traduction-locale"
import { type EtatCacheTraductions } from "../../../src/services/traduction-cache"
import { sendSessionRevoked } from "../../../src/services/websocket-service"
import { avatarDisplaySrc, fileToAvatarDataUrl, uploadAvatarDataUrl } from "../../../src/lib/avatar"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"

type SettingsSection =
  | "profile"
  | "security"
  | "notifications"
  | "privacy"
  | "translation"
  | "appearance"
  | "about"

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
  const langue = langueInitiale()
  return {
    name: sessionUser?.name ?? traduire(langue, "default_user_name"),
    email: sessionUser?.email ?? "",
    // Pas de numero factice en repli : « Enregistrer » recopie draft.phone dans la
    // session locale (updateUser), le faux numero devenait donc l'Alanya ID affiche.
    phone: sessionUser?.phone ?? "",
    statusMsg: sessionUser?.statusMsg ?? traduire(langue, "set_status_available"),
    avatar: sessionUser?.avatar ?? null,
  }
}

/**
 * Force du mot de passe. Le libelle est rendu sous forme de CLE : il est
 * traduit au moment de l'affichage, sinon il resterait fige dans la langue
 * active au moment du calcul.
 */
function analyzePassword(pwd: string): { score: number; labelKey: Cle | null; color: string } {
  if (!pwd) return { score: 0, labelKey: null, color: "var(--border-subtle)" }
  let score = 0
  if (pwd.length >= 8) score++
  if (pwd.length >= 14) score++
  if (/[A-Z]/.test(pwd)) score++
  if (/[0-9]/.test(pwd)) score++
  if (/[^A-Za-z0-9]/.test(pwd)) score++
  const levels: { labelKey: Cle; color: string }[] = [
    { labelKey: "strength_very_weak", color: "var(--danger)" },
    { labelKey: "strength_weak", color: "#f97316" },
    { labelKey: "strength_medium", color: "#eab308" },
    { labelKey: "strength_good", color: "#84cc16" },
    { labelKey: "strength_strong", color: "var(--success)" },
    { labelKey: "strength_very_strong", color: "var(--accent)" },
  ]
  return { score, ...levels[Math.min(5, score)] }
}

/*
 * Nom des sonneries fournies, et nom des sorties audio, sous forme de CLES.
 *
 * Les services les exposent en francais en dur (« Sonnerie classique »,
 * « Haut-parleur ») dans des tableaux construits a l'import : un libelle deja
 * traduit y resterait fige dans la langue du chargement. On garde donc la cle
 * ici et on traduit au rendu.
 */
const NOM_SONNERIE: Record<string, Cle> = {
  "incoming_ring.mp3": "p2_ringtone_alanya_incoming",
  "outgoing_ring.mp3": "p2_ringtone_alanya_outgoing",
  "notification.mp3": "p2_ringtone_alanya_notification",
  "ringtone.mp3": "p2_ringtone_classic",
  "message.mp3": "p2_ringtone_message_beep",
}

const NOM_SORTIE_AUDIO: Record<AudioOutputMode, Cle> = {
  earpiece: "p2_audio_earpiece",
  speaker: "p2_audio_speaker",
}

/**
 * Choix des sonneries. Les trois sons proposes par defaut sont ceux de
 * l'application mobile, repris a l'octet pres, pour que les deux plateformes
 * sonnent pareil.
 *
 * Deux portees a ne pas confondre, et l'ecran doit le dire :
 *  - le CATALOGUE des sonneries importees appartient au COMPTE. Il est relu au
 *    serveur a l'ouverture de la section, pour qu'une sonnerie importee depuis un
 *    autre appareil s'y trouve sans avoir a la reimporter ;
 *  - le CHOIX fait pour chacun des trois evenements reste une preference
 *    d'APPAREIL, comme le theme : discrete au bureau, forte sur le telephone.
 */
function RingtonePicker() {
  const { t } = useTranslation()
  const events: RingtoneEvent[] = ["incoming", "outgoing", "message"]
  const [choices, setChoices] = useState<Record<RingtoneEvent, string>>(() => ({
    incoming: ringtoneFile("incoming"),
    outgoing: ringtoneFile("outgoing"),
    message: ringtoneFile("message"),
  }))
  const [playing, setPlaying] = useState<string | null>(null)
  const [imported, setImported] = useState<CustomRingtone[]>(() => customRingtones())
  const [importing, setImporting] = useState(false)
  /** URL dont le retrait est en cours : son bouton se desarme, sinon un second clic part sur une ligne deja supprimee. */
  const [retrait, setRetrait] = useState<string | null>(null)
  const [sortieAudio, setSortieAudio] = useState<AudioOutputMode>(() => defaultAudioOutput())
  const fileInput = useRef<HTMLInputElement>(null)
  const { success, error: toastError } = useToast()

  const relireChoix = () =>
    setChoices({
      incoming: ringtoneFile("incoming"),
      outgoing: ringtoneFile("outgoing"),
      message: ringtoneFile("message"),
    })

  // Ne pas laisser un extrait tourner apres avoir quitte les reglages.
  useEffect(() => stopRingtonePreview, [])

  /*
   * Le catalogue du compte, relu a l'ouverture de la section. `rafraichirCatalogue()`
   * ne rejette pas : une panne reseau rend le miroir local, donc l'ecran ne se vide
   * pas et le premier rendu — deja servi par `customRingtones()` — reste valable.
   *
   * Les choix sont resynchronises dans la foulee : une sonnerie supprimee depuis un
   * autre appareil quitte le catalogue, et `ringtoneFile()` rend alors le son par
   * defaut. Le menu doit montrer ce repli plutot qu'une entree morte.
   */
  useEffect(() => {
    let monte = true
    void rafraichirCatalogue().then((catalogue) => {
      if (!monte) return
      setImported(catalogue)
      relireChoix()
    })
    return () => {
      monte = false
    }
  }, [])

  const onImport = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    try {
      const entree = await importRingtone(file)
      setImported(customRingtones())
      success(t("set_ringtone_imported"), t("set_ringtone_imported_detail", { nom: entree.label }))
    } catch (err) {
      toastError(
        t("set_ringtone_import_failed"),
        err instanceof Error ? err.message : t("set_ringtone_upload_failed")
      )
    } finally {
      setImporting(false)
      // Reinitialise le champ, sinon reimporter le meme fichier n'emet aucun evenement.
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  /*
   * Le retrait passe par le serveur, puisque le catalogue y vit. Un refus laisse la
   * sonnerie en place ici comme ailleurs, et il faut le dire : la taire ferait
   * croire a une suppression que le prochain rafraichissement annulerait.
   */
  const onRemove = async (entree: CustomRingtone) => {
    setRetrait(entree.url)
    try {
      await removeCustomRingtone(entree.url)
    } catch (err) {
      toastError(
        t("set_ringtone_remove_failed"),
        err instanceof Error ? err.message : t("set_unknown_error")
      )
      return
    } finally {
      setRetrait(null)
    }
    setImported(customRingtones())
    relireChoix()
    success(t("set_ringtone_removed"), t("set_ringtone_removed_detail", { nom: entree.label }))
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
      <div className="s-card-title">{t("set_ringtones")}</div>
      {events.map((event) => (
        <div key={event} className="ringtone-row">
          <div className="ringtone-row-label">{t(RINGTONE_LABELS[event])}</div>
          <div className="ringtone-row-controls">
            <select
              className="ringtone-select"
              value={choices[event]}
              onChange={(e) => choose(event, e.target.value)}
              aria-label={t("set_ringtone_for", {
                evenement: t(RINGTONE_LABELS[event]).toLowerCase(),
              })}
            >
              {RINGTONES.map((ringtone) => (
                <option key={ringtone.file} value={ringtone.file}>
                  {NOM_SONNERIE[ringtone.file] ? t(NOM_SONNERIE[ringtone.file]) : ringtone.label}
                  {ringtone.note ? ` — ${t(ringtone.note)}` : ""}
                </option>
              ))}
              {imported.length > 0 && (
                <optgroup label={t("set_ringtones_imported_group")}>
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
              aria-label={playing === choices[event] ? t("set_stop_listening") : t("set_listen")}
              title={playing === choices[event] ? t("set_stop") : t("set_listen")}
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
          <div className="privacy-choice-label">{t("set_audio_output")}</div>
          <div className="privacy-choice-desc">{t("set_audio_output_desc")}</div>
        </div>
        <div className="privacy-choice-opts" role="group" aria-label={t("set_audio_output_group")}>
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
              {t(NOM_SORTIE_AUDIO[mode])}
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
          {importing ? t("set_importing") : t("set_import_ringtone")}
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
                    playing === entree.url
                      ? t("set_stop_listening")
                      : t("set_listen_named", { nom: entree.label })
                  }
                  title={playing === entree.url ? t("set_stop") : t("set_listen")}
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
                  onClick={() => void onRemove(entree)}
                  disabled={retrait === entree.url}
                  aria-label={t("set_remove_named", { nom: entree.label })}
                  title={t("set_remove")}
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

      <div className="s-hint">{t("set_ringtones_hint")}</div>
      {/* La portee des deux reglages, dite explicitement : le catalogue suit le
          compte, le choix reste sur l'appareil. */}
      <div className="s-hint">{t("set_ringtones_shared")}</div>
    </div>
  )
}

/** Etat du service worker de notification, independant de la langue d'affichage. */
type EtatServiceWorker = "unchecked" | "active" | "unregistered" | "unsupported"

function PushDiagnostic() {
  const { t } = useTranslation()
  const [permission, setPermission] = useState<string>("default")
  // L'etat est garde sous forme de code, pas de phrase : le libelle est traduit
  // au rendu, il suit donc un changement de langue sans nouvelle verification.
  const [swStatus, setSwStatus] = useState<EtatServiceWorker>("unchecked")
  const [swScope, setSwScope] = useState<string>("")
  const [vapidKeyExists, setVapidKeyExists] = useState<boolean>(false)
  const [configValide, setConfigValide] = useState<boolean | null>(null)
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
      setConfigValide(false)
    } else {
      setConfigValide(true)
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).then((reg) => {
        if (reg) {
          setSwScope(reg.scope)
          setSwStatus("active")
        } else {
          setSwStatus("unregistered")
        }
      })
    } else {
      setSwStatus("unsupported")
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
      alert(t("set_push_init_done"))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("set_unknown_error")
      alert(t("set_push_init_error", { message }))
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
        <span>{t("set_push_diag")}</span>
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
          {loading ? t("set_activating") : t("set_activate_test")}
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
          <span>{t("set_permission_label")}</span>
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
              ? t("set_permission_granted")
              : permission === "denied"
                ? t("set_permission_denied")
                : t("set_permission_default")}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t("set_sw_push_label")}</span>
          <span
            style={{
              fontWeight: 700,
              color: swStatus === "active" ? "var(--success)" : "var(--danger)",
            }}
          >
            {swStatus === "active"
              ? t("set_sw_active", { scope: swScope })
              : swStatus === "unregistered"
                ? t("set_sw_unregistered")
                : swStatus === "unsupported"
                  ? t("set_sw_unsupported")
                  : t("set_sw_unchecked")}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t("set_firebase_vars_label")}</span>
          <span
            style={{
              fontWeight: 700,
              color: configValide ? "var(--success)" : "var(--danger)",
            }}
          >
            {configValide === null
              ? ""
              : configValide
                ? t("set_firebase_config_ok")
                : t("set_firebase_config_ko")}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t("set_vapid_label")}</span>
          <span
            style={{ fontWeight: 700, color: vapidKeyExists ? "var(--success)" : "var(--danger)" }}
          >
            {vapidKeyExists ? t("set_vapid_yes") : t("set_vapid_no")}
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
  autoComplete,
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
  /** Sert surtout a dire au navigateur de NE PAS remplir un champ. */
  autoComplete?: string
}) {
  const { t } = useTranslation()
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
          autoComplete={autoComplete}
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
            {showPwd ? t("hide") : t("show")}
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
  const { t } = useTranslation()
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
            {t("cancel")}
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

/**
 * Taille approximative des traductions gardees en local.
 *
 * Hors composant : la langue est relue a chaque appel, jamais figee a l'import.
 */
function tailleCacheLisible(octets: number, langue: LanguageCode): string {
  const enMo = octets / (1024 * 1024)
  if (enMo >= 1) return traduire(langue, "v2_size_mb", { taille: enMo.toFixed(1) })
  return traduire(langue, "v2_size_kb", { taille: Math.max(1, Math.round(octets / 1024)) })
}

/**
 * Consentement avant de confier le texte a un fournisseur distant.
 *
 * Fenetre bloquante plutot qu'un simple clic dans la liste : ce choix fait
 * sortir le texte des messages de l'appareil, et cette consequence doit etre
 * lue avant d'etre subie. Fermer la fenetre par la croix, par l'exterieur ou
 * par le bouton de repli garde le moteur precedent — un clic distrait ne change
 * donc rien.
 *
 * Le fournisseur est NOMME partout : titre, premier paragraphe et bouton. La
 * version precedente annoncait « Microsoft Azure » quel que soit le moteur
 * reellement appele ; l'avertissement devenait faux des qu'un autre
 * fournisseur entrait en jeu. Le paragraphe sur la conservation des donnees
 * vient lui aussi du moteur choisi : chacun a sa propre politique, et une
 * promesse valable pour l'un n'engage pas l'autre.
 */
function TranslationConsentDialog({
  moteur,
  onCancel,
  onAccept,
}: {
  moteur: CodeMoteur
  onCancel: () => void
  onAccept: () => void
}) {
  const { t, language } = useTranslation()
  const nom = nomMoteur(moteur, language)

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
        zIndex: 9600,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("trad_consent_title", { moteur: nom })}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(470px, 100%)",
          maxHeight: "86vh",
          overflowY: "auto",
          borderRadius: 16,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          boxShadow: "0 24px 64px #00000080",
          padding: 22,
        }}
      >
        <div
          style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontSize: 20,
            fontWeight: 800,
            color: "var(--text-primary)",
            marginBottom: 14,
          }}
        >
          {t("trad_consent_title", { moteur: nom })}
        </div>
        <p className="trad-consent-p trad-consent-p-lead">
          {t("trad_consent_p1", { moteur: nom })}
        </p>
        <p className="trad-consent-p">{t(noteMoteur(moteur))}</p>
        <p className="trad-consent-p">{t("trad_consent_p3")}</p>
        <p className="trad-consent-p">{t("trad_consent_p4")}</p>
        <p className="trad-consent-p">{t("trad_consent_p5")}</p>
        <div className="trad-consent-actions">
          <button className="trad-btn-online" onClick={onAccept}>
            {t("trad_consent_accept", { moteur: nom })}
          </button>
          <button className="trad-btn-stay" onClick={onCancel} autoFocus>
            {t("trad_consent_stay_local")}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Prix affichable d'un fournisseur, dans la langue de lecture.
 *
 * Le montant et la devise viennent du serveur : les tarifs bougent, et un prix
 * fige dans le client obligerait a redeployer le web pour corriger un chiffre.
 * Hors composant : la langue est passee, jamais figee a l'import.
 */
function prixLisible(fournisseur: FournisseurAnnonce, langue: LanguageCode): string {
  if (fournisseur.gratuit || fournisseur.prixParMillion <= 0) {
    return traduire(langue, "trad_engine_price_free")
  }
  let montant: string
  try {
    montant = new Intl.NumberFormat(langue, {
      style: "currency",
      currency: fournisseur.devise,
    }).format(fournisseur.prixParMillion)
  } catch {
    // Devise inconnue d'`Intl` : on rend le nombre et le code tels quels. Un
    // prix brut reste lisible, une exception de formatage viderait la carte.
    montant = `${fournisseur.prixParMillion} ${fournisseur.devise}`
  }
  return traduire(langue, "trad_engine_price", { prix: montant })
}

/**
 * Section « Traduction » des Parametres.
 *
 * Composant a part, avec son propre etat : sonder la disponibilite des couples
 * de langues, lire le catalogue des fournisseurs et compter les traductions
 * gardees n'a de sens que quand la section est ouverte, et ces mesures ne
 * doivent pas se relancer a chaque frappe ailleurs dans les Parametres.
 */
function TranslationSettings() {
  const { language, t } = useTranslation()
  const { success, error: toastError, info } = useToast()

  const [moteur, setMoteur] = useState<CodeMoteur>(() => lireMoteurTraduction())
  // Presence du moteur du navigateur : elle ne change pas en cours de session.
  const [moteurPresent] = useState(() => moteurLocalPresent())
  // Catalogue des fournisseurs, lu au serveur : lui seul sait lesquels sont
  // configures et a quel prix. `null` = pas encore lu ; l'echec est distingue,
  // pour ne pas faire passer une panne de lecture pour une liste vide.
  const [catalogue, setCatalogue] = useState<CatalogueFournisseurs | null>(null)
  const [echecCatalogue, setEchecCatalogue] = useState(false)
  // Moteur en attente de consentement — jamais applique tant que la fenetre
  // n'a pas ete acceptee.
  const [consentement, setConsentement] = useState<CodeMoteur | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  // Un couple absent de la carte n'a pas encore ete sonde : l'interface annonce
  // alors une verification, jamais une indisponibilite qu'elle ignore encore.
  const [disponibilites, setDisponibilites] = useState<
    Partial<Record<LanguageCode, DisponibiliteCouple>>
  >({})
  const [telechargement, setTelechargement] = useState<{
    langue: LanguageCode
    fraction: number
  } | null>(null)
  const [cache, setCache] = useState<EtatCacheTraductions | null>(null)

  // Langues que l'on peut recevoir : toutes sauf celle de l'interface, qui est
  // la cible. Un couple identique n'aurait rien a traduire.
  const sources = useMemo(() => LANGUAGE_CODES.filter((code) => code !== language), [language])

  // Le moteur peut changer depuis un autre onglet du meme navigateur.
  useEffect(() => sAbonnerAuMoteurTraduction(setMoteur), [])

  const lireCatalogue = useCallback(() => {
    setEchecCatalogue(false)
    void chargerFournisseurs()
      .then(setCatalogue)
      .catch(() => setEchecCatalogue(true))
  }, [])

  useEffect(() => lireCatalogue(), [lireCatalogue])

  const relireCatalogue = () => {
    // La promesse partagee garde le dernier succes : sans cet oubli, le bouton
    // « reessayer » ne rappellerait jamais le serveur.
    oublierFournisseurs()
    lireCatalogue()
  }

  const rafraichirCache = useCallback(() => {
    void compterCacheTraductions().then(setCache)
  }, [])

  useEffect(() => rafraichirCache(), [rafraichirCache])

  useEffect(() => {
    if (!moteurPresent) return
    let annule = false
    setDisponibilites({})
    // Sondage sequentiel : huit `availability()` lances d'un bloc font
    // travailler le navigateur pendant que la page finit de s'afficher. Il est
    // refait a chaque ouverture car un paquet est evince des que l'espace
    // disque libre passe sous le seuil du navigateur.
    void (async () => {
      for (const code of sources) {
        const etat = await disponibiliteCouple(code, language)
        if (annule) return
        setDisponibilites((precedent) => ({ ...precedent, [code]: etat }))
      }
    })()
    return () => {
      annule = true
    }
  }, [language, moteurPresent, sources])

  /**
   * Liste affichee : l'ordre vient du serveur — prix croissant, moteur par
   * defaut en tete — puis les moteurs qu'il n'annonce pas.
   *
   * Ces derniers ne sont pas masques. Une option qui disparait sans un mot
   * laisse croire qu'elle n'existe pas ; desactivee avec sa raison, elle dit au
   * contraire ce qu'il faudrait pour l'obtenir.
   */
  const lignes = useMemo(() => {
    const annonces = catalogue?.fournisseurs ?? []
    const parId = new Map(annonces.map((fournisseur) => [fournisseur.id, fournisseur]))
    const ordre = [
      ...annonces.map((fournisseur) => fournisseur.id),
      ...MOTEURS_CONNUS.filter((id) => !parId.has(id)),
    ]
    return ordre.map((id) => ({ id, annonce: parId.get(id) ?? null }))
  }, [catalogue])

  /**
   * Le badge « recommande, par defaut » suit le defaut DU CLIENT, pas celui que
   * le serveur annonce.
   *
   * Le serveur classe la liste, et son `defaut` sert a la trier ; mais ce qui
   * s'applique reellement quand l'utilisateur n'a jamais choisi, c'est
   * `MOTEUR_PAR_DEFAUT` — c'est vers lui que retombe `lireMoteurTraduction`.
   * Coller le badge sur la reponse du serveur le poserait, le jour ou celle-ci
   * changerait, sur un moteur payant qui fait sortir le texte de l'appareil,
   * alors meme que ce n'est pas lui qui traduit par defaut. Le badge serait
   * alors faux deux fois.
   */
  const moteurParDefaut = MOTEUR_PAR_DEFAUT

  const choisirMoteur = (id: CodeMoteur) => {
    if (id === moteur) return
    // Le moteur de l'appareil n'envoie rien nulle part : il ne demande aucun
    // consentement, et revenir a lui doit rester le geste le plus simple.
    if (moteurSurAppareil(id)) {
      definirMoteurTraduction(id)
      info(
        t("trad_local_restored"),
        t("trad_engine_active_local", { moteur: nomMoteur(id, language) })
      )
      return
    }
    setConsentement(id)
  }

  const accepterMoteur = () => {
    const choisi = consentement
    if (!choisi) return
    setConsentement(null)
    definirMoteurTraduction(choisi)
    const nom = nomMoteur(choisi, language)
    success(
      t("trad_engine_changed", { moteur: nom }),
      t("trad_engine_active_remote", { moteur: nom })
    )
  }

  /**
   * Installe les composants d'un couple.
   *
   * Appele depuis le clic et rien d'autre : hors geste de l'utilisateur, le
   * navigateur refuse le telechargement. Un seul couple a la fois, sans quoi
   * plusieurs modeles se disputeraient la bande passante et le disque.
   */
  const lancerTelechargement = async (code: LanguageCode) => {
    setTelechargement({ langue: code, fraction: 0 })
    try {
      const pret = await telechargerComposants(code, language, (fraction) =>
        setTelechargement({ langue: code, fraction })
      )
      setDisponibilites((precedent) => ({
        ...precedent,
        [code]: pret ? "available" : "unavailable",
      }))
      if (pret) {
        success(
          t("trad_download_done"),
          t("trad_download_done_detail", { langue: nomLangue(code, language) })
        )
      } else {
        toastError(t("trad_download_failed"))
      }
    } catch (erreur) {
      toastError(
        erreur instanceof TelechargementRefuse
          ? t("trad_download_refused")
          : t("trad_download_failed")
      )
    } finally {
      setTelechargement(null)
    }
  }

  const demanderEffacement = () => {
    setConfirmState({
      title: t("trad_cache_confirm_title"),
      description: t("trad_cache_confirm_desc"),
      confirmLabel: t("trad_cache_clear_btn"),
      tone: "warning",
      onConfirm: async () => {
        await viderCacheTraductions()
        rafraichirCache()
        info(t("trad_cache_cleared"), t("trad_cache_packs_note"))
      },
    })
  }

  const surAppareil = moteurSurAppareil(moteur)
  const nomMoteurActif = nomMoteur(moteur, language)
  // Tous les couples sondes, et tous refuses : le moteur existe mais ne sert a
  // rien ici. La condition exige que le sondage soit termine, sinon elle serait
  // vraie une fraction de seconde au montage.
  const aucunCoupleUtilisable = sources.every((code) => disponibilites[code] === "unavailable")

  return (
    <>
      <div className="s-page-title">{t("settings_translation")}</div>
      <p className="s-page-sub">{t("trad_sub")}</p>

      <div className="s-card">
        <div className="s-card-title">{t("trad_engines_title")}</div>
        <div className="trad-note" style={{ marginTop: 0 }}>
          {t("trad_engines_desc")}
        </div>

        {catalogue === null && !echecCatalogue && (
          <div className="trad-note">{t("trad_engines_loading")}</div>
        )}
        {echecCatalogue && (
          <div className="trad-note">
            {t("trad_engines_failed")}{" "}
            <button type="button" className="trad-relire" onClick={relireCatalogue}>
              {t("trad_engines_retry")}
            </button>
          </div>
        )}

        {/* Un `radiogroup` ne peut pas contenir de `listitem` : les boutons y
            sont donc directs, sans <ul> intermediaire. */}
        <div className="trad-engines" role="radiogroup" aria-label={t("trad_engines_title")}>
          {lignes.map(({ id, annonce }) => {
            // Le moteur de l'appareil ne depend pas du serveur : sa
            // disponibilite est celle du navigateur, meme catalogue en panne.
            const utilisable = moteurSurAppareil(id) ? moteurPresent : annonce !== null
            // Une raison par ligne, mais seulement quand elle apprend quelque
            // chose. Tant que le catalogue n'est pas lu — en cours, ou en echec
            // — la carte le dit deja une fois, en tete : la repeter sur chacun
            // des moteurs distants noierait la seule ligne qui porte le bouton
            // « reessayer ». Les lignes restent desactivees pour autant.
            const raison: Cle | null = utilisable
              ? null
              : moteurSurAppareil(id)
                ? "trad_engine_unavailable_browser"
                : catalogue
                  ? "trad_engine_unavailable_server"
                  : null
            const actif = id === moteur
            return (
              // Le bouton de la fiche est FRERE du choix, pas dedans : un
              // bouton dans un bouton n'est pas du HTML valide, et le clic
              // irait au mauvais des deux. La fiche reste ouvrable meme quand
              // le moteur est indisponible — savoir ce qu'il ferait de vos
              // messages ne depend pas de pouvoir l'utiliser aujourd'hui.
              <div className="trad-engine-row" key={id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={actif}
                  disabled={!utilisable}
                  className={`trad-engine ${actif ? "on" : ""}`}
                  onClick={() => choisirMoteur(id)}
                >
                  <span className="trad-engine-head">
                    <span className="trad-engine-name">{nomMoteur(id, language)}</span>
                    {/* « Recommande » ne s'affiche que sur une ligne
                        REELLEMENT choisissable. Le moteur du navigateur est le
                        defaut, mais il n'existe pas dans tous les navigateurs :
                        recommander une option grisee, juste au-dessus de la
                        phrase qui explique qu'elle est indisponible, est une
                        contradiction — et la seule action possible serait de
                        cliquer sur un bouton desactive. */}
                    {id === moteurParDefaut && utilisable && (
                      <span className="trad-engine-badge">{t("trad_engine_recommended")}</span>
                    )}
                    <span className="trad-engine-price">
                      {annonce
                        ? prixLisible(annonce, language)
                        : moteurSurAppareil(id)
                          ? t("trad_engine_price_free")
                          : "—"}
                    </span>
                  </span>
                  <span className="trad-engine-note">{t(noteMoteur(id))}</span>
                  {raison && <span className="trad-engine-off">{t(raison)}</span>}
                </button>
                <BoutonFicheMoteur moteur={id} />
              </div>
            )
          })}
        </div>

        {/* Ligne permanente : l'utilisateur doit pouvoir lire ou part son texte,
            et CHEZ QUI, sans avoir a se rappeler ce qu'il a coche plus haut. */}
        <div className={`trad-mode-state ${surAppareil ? "" : "online"}`}>
          {surAppareil
            ? t("trad_engine_active_local", { moteur: nomMoteurActif })
            : t("trad_engine_active_remote", { moteur: nomMoteurActif })}
        </div>
      </div>

      <div className="s-card">
        <div className="s-card-title">{t("trad_local_title")}</div>
        {moteurPresent ? (
          <>
            <div className="trad-note" style={{ marginTop: 0, marginBottom: 14 }}>
              {t("trad_local_desc", { langue: nomLangue(language, language) })}
            </div>
            <ul className="trad-pairs">
              {sources.map((code) => {
                const etat = disponibilites[code]
                const enCours =
                  telechargement && telechargement.langue === code ? telechargement : null
                const pourcent = Math.round((enCours?.fraction ?? 0) * 100)
                return (
                  <li key={code} className="trad-pair">
                    <div className="trad-pair-head">
                      <span className="trad-pair-lang">{nomLangue(code, language)}</span>
                      <span className={`trad-pair-state ${etat === "available" ? "on" : ""}`}>
                        {enCours
                          ? t("trad_downloading", { pourcent })
                          : etat === undefined
                            ? t("trad_state_checking")
                            : etat === "available"
                              ? t("trad_state_installed")
                              : etat === "unavailable"
                                ? t("trad_state_unavailable")
                                : t("trad_state_ready")}
                      </span>
                      {(etat === "downloadable" || etat === "downloading") && !enCours && (
                        <button
                          className="trad-dl"
                          disabled={telechargement !== null}
                          onClick={() => void lancerTelechargement(code)}
                        >
                          {t("trad_download")}
                        </button>
                      )}
                    </div>
                    {enCours && (
                      <div
                        className="trad-progress"
                        role="progressbar"
                        aria-valuenow={pourcent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div className="trad-progress-fill" style={{ width: `${pourcent}%` }} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="trad-note">{t("trad_pairs_note")}</div>
            {/* Le moteur est la mais aucun couple ne repond : fonctionnalite
                desactivee par une politique d'entreprise, ou langues hors du
                catalogue du navigateur. L'utilisateur se retrouverait devant
                une liste de refus sans issue, on lui redit donc ce qui reste
                possible — la liste des moteurs est juste au-dessus. */}
            {aucunCoupleUtilisable && (
              <div className="trad-note">{t("trad_local_unsupported_cta")}</div>
            )}
          </>
        ) : (
          <>
            <div className="trad-note" style={{ marginTop: 0 }}>
              {t("trad_err_local_unavailable")}
            </div>
            <div className="trad-note">{t("trad_local_unsupported_cta")}</div>
          </>
        )}
      </div>

      <div className="s-card">
        <div className="s-card-title">{t("trad_cache_title")}</div>
        <div className="trad-note" style={{ marginTop: 0, marginBottom: 14 }}>
          {t("trad_cache_desc")}
        </div>
        <DangerZoneItem
          label={
            cache === null
              ? t("trad_state_checking")
              : cache.entrees === 0
                ? t("trad_cache_empty")
                : t("trad_cache_count", {
                    nombre: cache.entrees,
                    taille: tailleCacheLisible(cache.octets, language),
                  })
          }
          description={t("trad_cache_packs_note")}
          buttonLabel={t("trad_cache_clear")}
          onClick={demanderEffacement}
        />
      </div>

      {consentement && (
        <TranslationConsentDialog
          moteur={consentement}
          onCancel={() => setConsentement(null)}
          onAccept={accepterMoteur}
        />
      )}
      {confirmState && (
        <ConfirmDialog state={confirmState} onCancel={() => setConfirmState(null)} />
      )}
    </>
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
  // Hors composant : la langue est relue a chaque appel, jamais figee a l'import.
  const langue = langueInitiale()
  if (!iso) return traduire(langue, "set_never_connected")
  const date = new Date(iso)
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (minutes < 2) return traduire(langue, "set_now")
  if (minutes < 60) return traduire(langue, "set_ago_minutes", { n: minutes })
  if (minutes < 24 * 60) return traduire(langue, "set_ago_hours", { n: Math.floor(minutes / 60) })
  if (minutes < 7 * 24 * 60)
    return traduire(langue, "set_ago_days", { n: Math.floor(minutes / 1440) })
  return date.toLocaleDateString(langue, { day: "numeric", month: "long", year: "numeric" })
}

/**
 * Date d'une connexion en clair : « Aujourd'hui a 14:32 », « Hier a 09:05 »,
 * puis la date complete.
 *
 * Le `quand()` du service renvoie ces mots en francais en dur et force la
 * locale fr-FR ; on reformate ici pour que le journal des connexions suive la
 * langue choisie, heure et date comprises.
 */
function quandTraduit(iso: string): string {
  // Hors composant : la langue est relue a chaque appel, jamais figee a l'import.
  const langue = langueInitiale()
  const date = new Date(iso)
  const heure = date.toLocaleTimeString(langue, { hour: "2-digit", minute: "2-digit" })
  const jour = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const maintenant = new Date()
  const ceJour = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate())
  const ecart = Math.round((ceJour.getTime() - jour.getTime()) / 86400000)
  if (ecart === 0) return traduire(langue, "p2_today_at", { heure })
  if (ecart === 1) return traduire(langue, "p2_yesterday_at", { heure })
  const jourMoisAnnee = date.toLocaleDateString(langue, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
  return traduire(langue, "p2_date_at", { date: jourMoisAnnee, heure })
}

/**
 * Nom affiche d'une personne bloquee. Le `nomDuBloque()` du service retombe sur
 * un « Inconnu » francais en dur quand ni le pseudo ni le numero ne sont
 * connus : ce repli est traduit ici.
 */
function nomBloque(personne: PersonneBloquee): string {
  return (
    personne.pseudo?.trim() ||
    personne.publicNumber ||
    traduire(langueInitiale(), "p2_unknown_person")
  )
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
    // « Unknown » est la valeur que le registre stocke quand le systeme n'a pas
    // pu etre reconnu : c'est un identifiant, pas un libelle. On le traduit ici,
    // a l'affichage, sans toucher a ce qui est ecrit en base.
    location: (() => {
      const systeme =
        a.system === "Unknown" ? traduire(langueInitiale(), "v2_unknown") : (a.system ?? "")
      return a.nomAgent ? `${systeme} (${a.nomAgent})`.trim() : systeme
    })(),
    current: estAppareilCourant(a),
    ts: derniereActivite(a.lastLogin),
    isMobile: a.typeDevice === TYPE_DEVICE.android || a.typeDevice === TYPE_DEVICE.ios,
  }
}

export default function SettingsPage() {
  const { language, setLanguage, t } = useTranslation()
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
        warning(t("set_session_closed"), t("set_session_closed_detail", { appareil: libelle }))
      } catch {
        toastError(t("set_disconnect_failed"), t("set_try_again_soon"))
      }
    },
    [warning, toastError, t]
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
        t("set_setting_not_saved"),
        err instanceof Error ? err.message : t("set_server_refused")
      )
    }
  }

  // Apparence. La langue vit dans le fournisseur d'internationalisation : elle
  // pilote toute l'interface, pas seulement cet ecran.
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">("medium")

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
      success(t("set_device_name_saved"), enregistre)
    } catch (err) {
      toastError(t("set_save_failed"), err instanceof Error ? err.message : undefined)
    } finally {
      setPseudoEnregistre(false)
    }
  }

  /**
   * Envoi d'un code de reinitialisation a l'adresse du compte.
   *
   * Le serveur repond toujours un succes, meme pour une adresse inconnue — on
   * ne peut donc pas promettre que le mail est parti, seulement que la demande
   * a ete prise. Le message le dit dans ces termes.
   */
  const [reinitEnvoi, setReinitEnvoi] = useState(false)
  const envoyerReinitialisation = async () => {
    const email = user?.email?.trim()
    if (!email) {
      toastError(t("set_no_email_title"), t("set_no_email_detail"))
      return
    }
    if (reinitEnvoi) return
    setReinitEnvoi(true)
    try {
      await demanderReinitialisation(email)
      success(t("set_code_sent"), t("set_code_sent_detail", { email }))
    } catch (err) {
      toastError(t("set_send_failed"), err instanceof Error ? err.message : undefined)
    } finally {
      setReinitEnvoi(false)
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
      success(t("unblocked_toast"), t("set_unblocked_detail", { nom: nomBloque(personne) }))
    } catch (err) {
      toastError(t("set_unblock_failed"), err instanceof Error ? err.message : undefined)
    }
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const isDirty = JSON.stringify(profile) !== JSON.stringify(draft)
  const pwdStrength = analyzePassword(security.newPwd)

  const setD = (k: keyof Profile) => (v: string) => setDraft((prev) => ({ ...prev, [k]: v }))

  const saveProfile = async () => {
    if (!draft.name.trim()) return toastError(t("set_invalid_name"), t("set_name_empty"))
    if (draft.statusMsg.length > 100)
      return toastError(t("set_message_too_long"), t("set_max_100_chars"))
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
      success(t("profile_updated"), t("set_profile_saved_detail"))
    } catch (err) {
      const message = err instanceof Error ? err.message : t("set_save_impossible")
      toastError(t("error"), message)
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (file.size > 10 * 1024 * 1024)
      return toastError(t("set_file_too_large"), t("set_avatar_max_10mb"))
    if (!file.type.startsWith("image/"))
      return toastError(t("set_invalid_format"), t("set_choose_image"))
    try {
      // Apercu local : la miniature n'est televersee qu'a l'enregistrement.
      const dataUrl = await fileToAvatarDataUrl(file)
      setDraft((prev) => ({ ...prev, avatar: dataUrl }))
      info(t("set_avatar_selected"), t("set_avatar_confirm_hint", { action: t("save") }))
    } catch (err) {
      const message = err instanceof Error ? err.message : t("set_image_unreadable")
      toastError(t("set_avatar_rejected"), message)
    }
  }

  const changePassword = async () => {
    if (!security.currentPwd) return toastError(t("set_current_password_required"))
    if (security.newPwd.length < 8)
      return toastError(t("set_password_too_short"), t("password_min_8"))
    if (security.newPwd !== security.confirmPwd) return toastError(t("passwords_differ"))
    if (security.newPwd === security.currentPwd)
      return toastError(t("set_password_same"), t("set_choose_different_password"))
    setSaving(true)
    try {
      await changePasswordApi(security.currentPwd, security.newPwd)
      setSecurity({ currentPwd: "", newPwd: "", confirmPwd: "" })
      success(t("set_password_changed"), t("set_password_changed_detail"))
    } catch (err) {
      const message = err instanceof Error ? err.message : t("set_current_password_wrong")
      toastError(t("error"), message)
    } finally {
      setSaving(false)
    }
  }

  const logoutAll = async () => {
    setConfirmState({
      title: t("set_logout_all_confirm"),
      description: t("set_logout_all_confirm_detail"),
      confirmLabel: t("set_logout_all_confirm_btn"),
      tone: "warning",
      onConfirm: async () => {
        await logoutEverywhere()
        navigate("/login", { replace: true })
      },
    })
  }

  const deleteAccount = async () => {
    // Le mot a recopier est traduit lui aussi : on ne peut pas demander a un
    // utilisateur russophone de taper un mot francais.
    const mot = t("set_delete_word")
    const confirm1 = window.prompt(t("set_delete_prompt", { mot }))
    if (confirm1?.trim().toUpperCase() !== mot.toUpperCase())
      return toastError(t("set_delete_cancelled"))

    // Le backend (DELETE /api/account) exige le mot de passe pour confirmer.
    const password = window.prompt(t("set_delete_password_prompt"))
    if (!password) return toastError(t("set_delete_cancelled"))

    try {
      await removeAccount(password)
    } catch (err) {
      const message = err instanceof Error ? err.message : t("set_delete_failed_detail")
      return toastError(t("set_delete_refused"), message)
    }
    warning(t("set_account_deleted"), t("set_account_deleted_detail"))
    navigate("/welcome", { replace: true })
  }

  const NAV: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    {
      id: "profile",
      label: t("settings_profile"),
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
      label: t("settings_security"),
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
      label: t("settings_notifications"),
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
      label: t("settings_privacy"),
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
      id: "translation",
      label: t("settings_translation"),
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 5h9M9 3v2c0 4-2 7-5 8" />
          <path d="M6 11c1.5 2.5 3.5 4 6 5" />
          <path d="M13 21l4-9 4 9M14.6 18h4.8" />
        </svg>
      ),
    },
    {
      id: "appearance",
      label: t("settings_appearance"),
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
      label: t("settings_about"),
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

        /* Sortie de secours sous le champ « mot de passe actuel ». Discrete et
           courte : c'est un recours, pas l'action principale de la carte. Alignee
           a droite, la ou l'oeil arrive apres avoir laisse le champ vide, et de
           la largeur de son texte — pleine largeur, elle concurrencerait le
           bouton de validation juste en dessous. */
        .pwd-oubli-rangee {
          display: flex; justify-content: flex-end; margin: -12px 0 18px;
        }
        .pwd-oubli {
          padding: 7px 12px; border-radius: 8px;
          border: 1px solid transparent; background: none;
          color: var(--accent); font-family: 'DM Sans', sans-serif;
          font-size: 12px; font-weight: 600; cursor: pointer;
          transition: background .15s, border-color .15s;
        }
        .pwd-oubli:hover:not(:disabled) {
          background: var(--accent-dim); border-color: var(--accent-border);
        }
        .pwd-oubli:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        .pwd-oubli:disabled { opacity: .55; cursor: default; }


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
        .ringtone-remove:hover:not(:disabled) { color: var(--danger); background: var(--danger-dim); }
        /* Le retrait passe par le serveur : le bouton reste visible mais inerte le temps de l'aller-retour. */
        .ringtone-remove:disabled { cursor: progress; opacity: 0.5; }

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

        /* Traduction : notes, etat des couples de langues, consentement. */
        .trad-note {
          font-size: 11.5px; color: var(--text-faint); line-height: 1.55; margin-top: 12px;
        }
        .trad-mode-state {
          display: flex; align-items: center; gap: 8px;
          margin-top: 14px; padding: 10px 12px; border-radius: 9px;
          font-size: 12px; line-height: 1.5;
          background: var(--accent-dim); border: 1px solid var(--accent-border);
          color: var(--accent);
        }
        .trad-mode-state::before {
          content: ''; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
          background: currentColor;
        }
        /* Un moteur distant se distingue au premier coup d'oeil : il n'a pas les
           memes consequences que le moteur de l'appareil, il ne doit pas avoir
           la meme couleur. */
        .trad-mode-state.online {
          background: var(--danger-dim); border-color: var(--danger-border); color: var(--danger);
        }

        /* Liste des moteurs : un choix par ligne, son prix a droite, sa note
           dessous. Le prix doit se lire sans ouvrir quoi que ce soit — c'est la
           moitie de la decision. */
        .trad-engines {
          list-style: none; margin: 14px 0 0; padding: 0;
          display: flex; flex-direction: column; gap: 8px;
        }
        /* Une ligne porte deux boutons : le choix du moteur, qui prend toute la
           place, et le « i » de la fiche, qui ne prend que la sienne. Aligne en
           haut : la note sous le nom peut faire deux lignes, la pastille reste
           en face du nom. Les styles du « i » vivent avec la fiche, dans
           fiche-confidentialite.css. */
        .trad-engine-row {
          display: flex; align-items: flex-start; gap: 8px;
        }
        .trad-engine {
          width: 100%; display: flex; flex-direction: column; gap: 6px; text-align: left;
          padding: 12px 13px; border-radius: 10px; cursor: pointer;
          border: 1px solid var(--border-subtle); background: var(--bg-elevated);
          font-family: 'DM Sans', sans-serif; transition: border-color .15s, background .15s;
        }
        .trad-engine:hover:not(:disabled) { border-color: var(--accent-border); }
        .trad-engine.on { border-color: var(--accent); background: var(--accent-dim); }
        /* Desactive, mais toujours lisible : la raison sous le nom doit rester
           dechiffrable, sinon autant ne rien afficher. */
        .trad-engine:disabled { opacity: .6; cursor: not-allowed; }
        .trad-engine-head {
          display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; row-gap: 4px;
        }
        .trad-engine-name {
          font-size: 13px; font-weight: 600; color: var(--text-primary);
        }
        .trad-engine-badge {
          font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 99px;
          background: var(--success-dim); color: var(--success);
        }
        .trad-engine-price {
          margin-left: auto; font-size: 12px; font-weight: 600; color: var(--text-secondary);
        }
        .trad-engine-note { font-size: 11.5px; color: var(--text-faint); line-height: 1.55; }
        .trad-engine-off { font-size: 11.5px; color: var(--danger); line-height: 1.55; }
        .trad-relire {
          border: none; background: none; padding: 0; cursor: pointer;
          color: var(--accent); font-family: 'DM Sans', sans-serif;
          font-size: 11.5px; font-weight: 600; text-decoration: underline;
        }

        .trad-pairs { list-style: none; margin: 0; padding: 0; }
        .trad-pair { padding: 11px 0; border-bottom: 1px solid var(--border-subtle); }
        .trad-pair:last-child { border-bottom: none; }
        .trad-pair-head {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap; row-gap: 6px;
        }
        .trad-pair-lang {
          flex: 1; min-width: 0; font-size: 13px; font-weight: 500; color: var(--text-primary);
        }
        .trad-pair-state { font-size: 11.5px; color: var(--text-faint); }
        .trad-pair-state.on { color: var(--success); }
        .trad-dl {
          flex-shrink: 0; padding: 7px 13px; border-radius: 8px;
          border: 1px solid var(--border-default); background: var(--bg-elevated);
          color: var(--text-secondary); font-family: 'DM Sans', sans-serif;
          font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s;
        }
        .trad-dl:hover:not(:disabled) { color: var(--accent); border-color: var(--accent-border); }
        .trad-dl:disabled { opacity: .5; cursor: not-allowed; }

        .trad-progress {
          height: 3px; margin-top: 9px; border-radius: 99px;
          background: var(--border-subtle); overflow: hidden;
        }
        /* Aucune transition sur la largeur : le navigateur peut passer de 0 a
           100 en un seul evenement, une animation ferait clignoter la barre. */
        .trad-progress-fill { height: 100%; border-radius: 99px; background: var(--accent); }

        .trad-consent-p {
          font-size: 13px; color: var(--text-muted); line-height: 1.6; margin-bottom: 12px;
        }
        .trad-consent-p-lead { color: var(--text-primary); font-weight: 500; }
        .trad-consent-actions {
          display: flex; justify-content: flex-end; align-items: center;
          gap: 10px; margin-top: 18px; flex-wrap: wrap;
        }
        .trad-btn-online {
          border: 1px solid var(--danger-border); background: var(--danger-dim);
          color: var(--danger); border-radius: 9px; padding: 10px 14px;
          font-size: 12px; font-weight: 600; cursor: pointer;
          font-family: 'DM Sans', sans-serif;
        }
        .trad-btn-stay {
          border: 1px solid transparent; background: var(--accent);
          color: var(--bg-base); border-radius: 9px; padding: 10px 14px;
          font-size: 12px; font-weight: 700; cursor: pointer;
          font-family: 'DM Sans', sans-serif;
        }
        @media (max-width: 560px) {
          .trad-consent-actions { flex-direction: column-reverse; align-items: stretch; }
          .trad-consent-actions button { width: 100%; }
        }

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
            {t("back")}
          </button>

          <div className="s-nav-title">{t("settings")}</div>

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
              <div className="s-page-title">{t("my_profile")}</div>
              <p className="s-page-sub">{t("set_profile_sub")}</p>

              {/* Barre de sauvegarde */}
              {isDirty && (
                <div className="save-bar">
                  <span className="save-bar-txt">{t("set_unsaved_changes")}</span>
                  <div className="save-btns">
                    <button className="btn-discard" onClick={() => setDraft(profile)}>
                      {t("cancel")}
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
                      {saving ? t("set_saving") : t("save")}
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
                          alt={t("set_avatar_alt")}
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
                      {t("change_photo")}
                    </button>
                  </div>
                </div>

                <Field
                  label={t("full_name")}
                  value={draft.name}
                  onChange={setD("name")}
                  maxLength={60}
                  placeholder={t("your_name")}
                />
                <Field
                  label={t("status_message")}
                  value={draft.statusMsg}
                  onChange={setD("statusMsg")}
                  maxLength={100}
                  placeholder={t("status_placeholder")}
                  helper={t("status_visible")}
                />
              </div>

              <div className="s-card">
                <div className="s-card-title">
                  {t("set_contact_info")}{" "}
                  <span className="s-card-title-badge">{t("set_not_editable_here")}</span>
                </div>
                {draft.email ? (
                  <Field
                    label={t("set_email_address")}
                    value={draft.email}
                    disabled
                    helper={t("email_support_note")}
                  />
                ) : (
                  <Field
                    label={t("set_email_address")}
                    value={t("no_email")}
                    disabled
                    helper={t("email_required_note")}
                  />
                )}
                {/* C'est ici que le repertoire renvoie l'utilisateur chercher son
                    identifiant : il doit y porter le meme nom qu'ailleurs, et etre
                    groupe par paires comme dans les champs de saisie. */}
                <Field
                  label="Alanya ID"
                  value={draft.phone ? formatAlanyaNumber(draft.phone) : "—"}
                  disabled
                  helper={t("alanya_id_locked")}
                />
              </div>
            </>
          )}

          {section === "security" && (
            <>
              <div className="s-page-title">{t("settings_security")}</div>
              <p className="s-page-sub">{t("security_sub")}</p>

              <div className="s-card">
                <div className="s-card-title">{t("change_password")}</div>
                {/* Champ vide, sans placeholder d'asterisques : une suite
                    d'etoiles ressemble a un mot de passe deja saisi, et on
                    cherche a l'effacer avant de comprendre qu'il n'y a rien.
                    `autoComplete="off"` empeche en plus le navigateur de le
                    pre-remplir, ce qui produisait la meme confusion. */}
                <Field
                  label={t("current_password")}
                  value={security.currentPwd}
                  onChange={(v) => setSecurity((p) => ({ ...p, currentPwd: v }))}
                  type="password"
                  autoComplete="off"
                />
                {/* Sortie de secours : sans elle, quelqu'un qui a oublie son mot
                    de passe actuel ne peut plus rien faire depuis cet ecran. */}
                <div className="pwd-oubli-rangee">
                  <button
                    type="button"
                    className="pwd-oubli"
                    onClick={() => void envoyerReinitialisation()}
                    disabled={reinitEnvoi}
                  >
                    {reinitEnvoi ? t("set_sending") : t("forgot_password")}
                  </button>
                </div>
                <Field
                  label={t("new_password")}
                  value={security.newPwd}
                  onChange={(v) => setSecurity((p) => ({ ...p, newPwd: v }))}
                  type="password"
                  placeholder={t("strong_password")}
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
                        {pwdStrength.labelKey ? t(pwdStrength.labelKey) : ""}
                      </span>
                    </div>
                  </div>
                )}

                <Field
                  label={t("confirm_new_password")}
                  value={security.confirmPwd}
                  onChange={(v) => setSecurity((p) => ({ ...p, confirmPwd: v }))}
                  type="password"
                  placeholder={t("repeat_password")}
                  error={
                    security.confirmPwd && security.newPwd !== security.confirmPwd
                      ? t("passwords_differ")
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
                    security.newPwd.length < 8 ||
                    security.newPwd === security.currentPwd
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
                      security.newPwd.length < 8 ||
                      security.newPwd === security.currentPwd
                        ? 0.4
                        : 1,
                    transition: "opacity .15s",
                  }}
                >
                  {saving ? t("set_modifying") : t("modify_password")}
                </button>
              </div>

              {/* Pseudo de cet appareil. Place juste avant la liste des
                  sessions : c'est la qu'on lit « Windows 11 (Poste accueil) »,
                  donc la qu'on comprend a quoi sert ce champ. */}
              <div className="s-card">
                <div className="s-card-title">{t("device_name_section")}</div>
                <div className="s-hint" style={{ marginTop: 0, marginBottom: 12 }}>
                  {t("device_name_explain")}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={pseudoAppareil}
                    maxLength={50}
                    onChange={(e) => setPseudoAppareil(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void sauverPseudo()
                    }}
                    placeholder={t("device_name_placeholder")}
                    aria-label={t("device_name_label")}
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
                    {pseudoEnregistre ? "…" : t("device_name_save")}
                  </button>
                </div>
              </div>

              <div className="s-card">
                <div className="s-card-title">{t("set_active_sessions")}</div>
                {sessions === null && (
                  <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "12px 0" }}>
                    {t("loading")}
                  </div>
                )}
                {sessions !== null && sessions.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "12px 0" }}>
                    {t("no_device_yet")}
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
                              {t("set_current_device")}
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
                        {t("set_disconnect")}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="s-card">
                <div className="s-card-title">{t("login_history")}</div>
                <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 10 }}>
                  {t("login_history_sub")}
                </div>

                {historique === null && (
                  <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "12px 0" }}>
                    {t("loading")}
                  </div>
                )}
                {historique !== null && historique.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "12px 0" }}>
                    {t("no_login_yet")}
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
                          {quandTraduit(a.dateLogin)}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                          {details.length > 0 ? details.join(" - ") : t("set_unknown_origin")}
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
                          {t("most_recent")}
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
                  {t("set_danger_zone")}
                </div>
                <DangerZoneItem
                  label={t("logout_all")}
                  description={t("logout_all_sub")}
                  buttonLabel={t("set_logout_all_btn")}
                  onClick={logoutAll}
                />
                <DangerZoneItem
                  label={t("set_delete_my_account")}
                  description={t("delete_account_sub")}
                  buttonLabel={t("delete_account")}
                  onClick={deleteAccount}
                  destructive
                />
              </div>
            </>
          )}

          {section === "notifications" && (
            <>
              <div className="s-page-title">{t("settings_notifications")}</div>
              <p className="s-page-sub">{t("notif_sub")}</p>
              <div className="s-card">
                <div className="s-card-title">{t("set_push_notifications")}</div>
                <Toggle
                  value={notifMessages}
                  onChange={updateNotifMessages}
                  label={t("messages_label")}
                  description={t("notif_new_message")}
                />
                <Toggle
                  value={notifCalls}
                  onChange={updateNotifCalls}
                  label={t("set_incoming_calls")}
                  description={t("notif_calls")}
                />
                <Toggle
                  value={notifSounds}
                  onChange={updateNotifSounds}
                  label={t("set_sounds")}
                  description={t("notif_sound")}
                />
                <Toggle
                  value={notifPreview}
                  onChange={updateNotifPreview}
                  label={t("notif_preview")}
                  description={t("notif_preview_sub")}
                />
                <PushDiagnostic />
              </div>

              <RingtonePicker />
            </>
          )}

          {section === "privacy" && (
            <>
              <div className="s-page-title">{t("settings_privacy")}</div>
              <p className="s-page-sub">{t("privacy_sub")}</p>
              <div className="s-card">
                <div className="s-card-title">{t("set_visibility")}</div>
                <Toggle
                  value={privacy.readReceipts}
                  onChange={(v) => void updatePrivacy({ readReceipts: v })}
                  label={t("read_receipts")}
                  description={t("read_receipts_sub")}
                />

                <div className="privacy-choice">
                  <div className="privacy-choice-head">
                    <div className="privacy-choice-label">{t("last_seen")}</div>
                    <div className="privacy-choice-desc">{t("last_seen_sub")}</div>
                  </div>
                  <div
                    className="privacy-choice-opts"
                    role="group"
                    aria-label={t("last_seen_visibility")}
                  >
                    {([2, 1, 0] as LastSeenVisibility[]).map((niveau) => (
                      <button
                        key={niveau}
                        className={`filter-btn ${privacy.lastSeenVisibility === niveau ? "on" : ""}`}
                        aria-pressed={privacy.lastSeenVisibility === niveau}
                        disabled={!privacyLoaded}
                        onClick={() => void updatePrivacy({ lastSeenVisibility: niveau })}
                      >
                        {t(LAST_SEEN_LABELS[niveau])}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="s-hint">{t("settings_sync_note")}</div>
              </div>

              {/* Personnes bloquees. Sans cette liste, on ne peut debloquer que
                  quelqu'un dont on retrouve la fiche contact — or on peut
                  parfaitement bloquer un numero qu'on n'a jamais enregistre. */}
              <div className="s-card">
                <div className="s-card-title">{t("set_blocked_people")}</div>
                <div className="s-hint" style={{ marginTop: 0, marginBottom: 12 }}>
                  {t("blocked_list_sub")}
                </div>
                {bloques.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 0" }}>
                    {t("blocked_none")}
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
                          {nomBloque(personne)}
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
                        {t("unblock")}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {section === "translation" && <TranslationSettings />}

          {section === "appearance" && (
            <>
              <div className="s-page-title">{t("settings_appearance")}</div>
              <p className="s-page-sub">{t("appearance_sub")}</p>
              <div className="s-card">
                <div className="s-card-title">{t("theme")}</div>
                <ThemeSelector />
              </div>
              <div className="s-card">
                <div className="s-card-title">{t("text_size")}</div>
                <div className="font-opts">
                  {(["small", "medium", "large"] as const).map((size) => (
                    <button
                      key={size}
                      className={`font-opt ${fontSize === size ? "on" : ""}`}
                      onClick={() => {
                        setFontSize(size)
                        info(
                          size === "small"
                            ? t("set_text_size_small_applied")
                            : size === "medium"
                              ? t("set_text_size_medium_applied")
                              : t("set_text_size_large_applied")
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
                        {size === "small"
                          ? t("set_size_small")
                          : size === "medium"
                            ? t("set_size_medium")
                            : t("set_size_large")}
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
                    info(traduire(code, "language_settings"), nomLangue(code, code))
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
                      {libelleLangue(code, language)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {section === "about" && (
            <>
              <div className="s-page-title">{t("settings_about")}</div>
              <p className="s-page-sub">{t("about_sub")}</p>
              <div className="s-card">
                {[
                  { label: t("set_about_app"), value: "Alanya" },
                  { label: t("set_about_version"), value: "1.0.0-beta" },
                  { label: t("set_about_env"), value: t("set_about_env_value") },
                  {
                    label: t("set_about_turn"),
                    // Diagnostic visible depuis un telephone : dit si ce build
                    // embarque les variables VITE_TURN_* (necessaires pour les
                    // appels entre reseaux differents).
                    value: isTurnConfigured() ? t("set_turn_configured") : t("set_turn_missing"),
                  },
                  { label: t("set_about_project"), value: t("set_about_project_value") },
                  { label: t("set_about_supervisor"), value: "Dr. NANA BINKEU" },
                  { label: t("set_about_group"), value: "Alanya II" },
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
                <div className="s-card-title">{t("set_tech_stack")}</div>
                {[
                  { label: t("set_stack_frontend"), value: t("set_stack_frontend_value") },
                  { label: t("set_stack_backend"), value: "Next.js (App Router, API Routes)" },
                  { label: t("database"), value: "PostgreSQL  -  Prisma" },
                  { label: t("set_stack_realtime"), value: t("set_stack_realtime_value") },
                  { label: t("set_stack_calls"), value: t("set_stack_calls_value") },
                  { label: t("set_stack_auth"), value: t("set_stack_auth_value") },
                  { label: t("set_stack_deploy"), value: t("set_stack_deploy_value") },
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
                <div className="s-card-title">{t("set_realtime_diagnostic")}</div>
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
