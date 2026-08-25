import {
  Component,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
} from "react"
import type { PDFDocumentLoadingTask } from "pdfjs-dist"
import { useNavigate, useParams } from "react-router-dom"
import {
  CHAT_COLORS,
  type ChatMessageMock,
  type ConversationMock,
  type MessageStatus,
} from "../../../../src/mocks/chat-data"
import { loadContacts } from "../../../../src/data/contacts"
import {
  ensureDirectConversation,
  ensureGroupConversation,
  syncConversationFromMessages,
} from "../../../../src/data/local-conversations"
import { findLocalGroup, toChatInfoMock } from "../../../../src/data/local-groups"
import { useToast } from "../../../../src/components/toast"
import {
  formatBytes,
  applyMessageEditToCache,
  deleteChatMessage,
  fetchMessages,
  fetchMessagesCacheFirst,
  fetchOlderMessages,
  forwardChatMessage,
  markChatAsRead,
  persistIncomingWsMessage,
  removeMessageFromDB,
  sendChatMessage,
  toFrontMessage,
} from "../../../../src/services/messages-service"
import {
  apercuStructure,
  contactsDepuisContenu,
  nomAffichable,
  positionDepuisContenu,
  LONGUEUR_MAX_CONTENU,
} from "../../../../src/services/message-payload"
import {
  fetchChatConversations,
  fetchConversationById,
} from "../../../../src/services/chats-service"
import {
  formatAudioDuration,
  resolveMediaUrl,
  uploadMedia,
} from "../../../../src/services/media-service"
import { loadPreviewBlob } from "../../../../src/services/media-preview-cache"
import { loadPdfThumbnail, videoPosterUrl } from "../../../../src/services/media-thumbnail"
import { langueInitiale, traduire, useTranslation } from "../../../../src/i18n"
import { appareilCourantId } from "../../../../src/services/appareils-service"
import { composerMessageSysteme } from "../../../../src/i18n/messages-systeme"
import { lireVerrou, useVerrou } from "../../../../src/hooks/use-verrou"
import { ensurePdfWorker } from "../../../../src/services/pdf-worker"
import {
  publishTyping,
  subscribeToConversation,
  subscribeToMessageDeleted,
  subscribeToMessageEdited,
  subscribeToPresence,
  subscribeToStatus,
  subscribeToTyping,
  subscribeToWsConnected,
} from "../../../../src/services/websocket-service"
import { getMyUserId } from "../../../../src/data/session-user"
import { startOutgoingCall } from "../../../../src/services/call-manager"
import { fetchCallsForConversation, type CallRecord } from "../../../../src/services/calls-service"
import { avatarDisplaySrc } from "../../../../src/lib/avatar"
import {
  EVENEMENT_TRADUCTION_AUTO,
  detecterLangueMessage,
  libererMoteurLocal,
  moteurLocalPresent,
  oublierTraductionsDuTexte,
  traductionAutoActive,
} from "../../../../src/services/traduction-service"
import ChatInfoPage from "./chat-info"
import { CLE_ERREUR, EVENEMENT_ECHEC_AUTO, MessageTranslation } from "./message-translation"
import "./chat-room-page.css"

type Message = ChatMessageMock

/** Une carte média défectueuse ne doit jamais faire tomber toute la discussion. */
class MessageErrorBoundary extends Component<
  { children: ReactNode; name?: string; size?: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      localStorage.setItem(
        "alanya_last_preview_error",
        `${new Date().toISOString()} | ${error.message} | ${info.componentStack?.slice(0, 500) ?? ""}`
      )
    } catch {
      /* stockage facultatif */
    }
    console.error("[Alanya preview] erreur isolée", error)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div
        style={{
          margin: "6px 0",
          padding: "10px 12px",
          borderRadius: 9,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-elevated)",
          fontSize: 11,
          color: "var(--text-secondary)",
        }}
      >
        <div style={{ fontWeight: 700 }}>
          {this.props.name ?? traduire(langueInitiale(), "file")}
        </div>
        {this.props.size && <div style={{ marginTop: 2 }}>{this.props.size}</div>}
        <div style={{ marginTop: 5 }}>{traduire(langueInitiale(), "preview_unavailable")}</div>
      </div>
    )
  }
}

// Realtime : WebSocket natif du backend Alanya (evenements { type: "message" | "typing" | "read" })

function formatTime(d: Date) {
  return d.toLocaleTimeString(langueInitiale(), { hour: "2-digit", minute: "2-digit" })
}

function formatDateSeparator(d: Date) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return traduire(langueInitiale(), "f2_today")
  if (d.toDateString() === yesterday.toDateString())
    return traduire(langueInitiale(), "f2_yesterday")
  // Le jour et le mois s'ecrivent en toutes lettres : ils suivent la langue choisie.
  return d.toLocaleDateString(langueInitiale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
}

/**
 * Bascule « plein ecran » d'un visionneur. On demande le plein ecran natif quand
 * le navigateur l'accorde — la barre du navigateur disparait, c'est la plus
 * grande surface possible — et on retombe sinon sur un agrandissement a tout le
 * viewport, qui donne l'essentiel du gain. Le retour redonne la taille d'origine.
 */
function useViewerFullscreen(host: RefObject<HTMLElement | null>) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const node = host.current
    // F11 et Echap sortent du plein ecran sans passer par notre bouton : on suit
    // l'etat reel du document plutot que de le supposer.
    const sync = () => {
      if (!document.fullscreenElement) setExpanded(false)
    }
    document.addEventListener("fullscreenchange", sync)
    return () => {
      document.removeEventListener("fullscreenchange", sync)
      // Fermeture du visionneur alors qu'il est en plein ecran : sans ca, la page
      // resterait en plein ecran une fois le visionneur disparu.
      if (document.fullscreenElement === node)
        void document.exitFullscreen().catch(() => {
          /* deja sorti */
        })
    }
  }, [host])

  const toggle = useCallback(() => {
    if (expanded) {
      setExpanded(false)
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {
          /* deja sorti */
        })
      return
    }
    setExpanded(true)
    const node = host.current
    if (node?.requestFullscreen)
      void node.requestFullscreen().catch(() => {
        /* agrandissement CSS seul */
      })
  }, [expanded, host])

  return { expanded, toggle }
}

/** Le bouton qui va avec, a poser dans la barre de titre d'un visionneur. */
function ViewerFullscreenButton({
  expanded,
  onToggle,
  color,
  style,
}: {
  expanded: boolean
  onToggle: () => void
  color: string
  style?: React.CSSProperties
}) {
  const { t } = useTranslation()


  return (
    <button
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      aria-label={expanded ? t("reset_zoom") : t("f2_show_fullscreen")}
      aria-pressed={expanded}
      title={expanded ? t("f2_original_size") : t("f2_fullscreen")}
      style={{
        background: "none",
        border: "none",
        color,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        padding: 0,
        ...style,
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {expanded ? (
          <>
            <polyline points="4 14 10 14 10 20" />
            <polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </>
        ) : (
          <>
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </>
        )}
      </svg>
    </button>
  )
}

/** Visionneuse intégrée pour documents (texte, code, PDF, image, vidéo, DOC, XLS, PPT). */
function DocumentViewer({
  url,
  name,
  mime,
  isMe,
  onClose,
}: {
  url: string
  name?: string
  mime?: string
  isMe: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? ""
  const isImage =
    mime?.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "bmp"].map((e) => e.toLowerCase()).includes(ext)
  const isVideo =
    mime?.startsWith("video/") ||
    ["mp4", "mov", "avi", "mkv", "webm"].map((e) => e.toLowerCase()).includes(ext)
  const isAudio =
    mime?.startsWith("audio/") ||
    ["mp3", "aac", "acc", "wav", "ogg", "m4a", "flac", "webm"].includes(ext)
  const isText = mime?.startsWith("text/") || TEXT_PREVIEW_EXTENSIONS.includes(ext)
  const isPdf = mime === "application/pdf" || ext === "pdf"
  const isDoc = ["doc", "docx"].includes(ext) || (mime ?? "").includes("word")
  const isSpreadsheet =
    ["xls", "xlsx", "ods", "numbers"].includes(ext) ||
    (mime ?? "").includes("spreadsheet") ||
    (mime ?? "").includes("excel")
  const isPresentation = ["ppt", "pptx"].includes(ext) || (mime ?? "").includes("presentation")

  // Pour le texte/code : on lit le contenu via fetch et on affiche dans un textarea
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loadingText, setLoadingText] = useState(false)

  const host = useRef<HTMLDivElement>(null)
  const { expanded, toggle } = useViewerFullscreen(host)
  // En plein ecran, le corps prend tout ce que la barre de titre laisse.
  const bodyHeight = expanded ? "calc(100vh - 84px)" : "70vh"
  const textHeight = expanded ? "calc(100vh - 84px)" : "65vh"

  useEffect(() => {
    if (isText && url) {
      setLoadingText(true)
      loadPreviewBlob(url)
        .then((blob) => blob.text())
        .then((t) => {
          setTextContent(t.slice(0, 50000))
          setLoadingText(false)
        })
        .catch(() => {
          setTextContent(t("file_load_failed"))
          setLoadingText(false)
        })
    }
  }, [isText, url])

  const isPublicUrl = !(url ?? "").startsWith("blob:")
  // Meme regle que dans le fil : rien ne part chez Microsoft sans accord.
  const isOffice = isPublicUrl && (isDoc || isSpreadsheet || isPresentation)
  const officeLabel = isDoc ? "Word" : isSpreadsheet ? "Excel" : "PowerPoint"

  return (
    <div
      ref={host}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9500,
        background: "#000000d9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: expanded ? 0 : 24,
        flexDirection: "column",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: expanded ? "100vw" : "min(92vw, 960px)",
          height: expanded ? "100vh" : undefined,
          maxHeight: expanded ? "100vh" : "88vh",
          background: isMe ? "#2a1f14" : "#0a0d12",
          borderRadius: expanded ? 0 : 16,
          border: `1px solid ${isMe ? "#ffffff18" : "#1a1f24"}`,
          boxShadow: "0 32px 80px #000000b0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Barre de titre */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: `1px solid ${isMe ? "#ffffff15" : "#1a1f24"}`,
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 700,
            fontSize: 15,
            color: isMe ? "#fff" : "var(--text-primary)",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name ?? t("file")}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
            <ViewerFullscreenButton
              expanded={expanded}
              onToggle={toggle}
              color={isMe ? "rgba(255,255,255,0.8)" : "var(--text-secondary)"}
            />
            <button
              onClick={onClose}
              aria-label={t("close")}
              style={{
                background: "none",
                border: "none",
                color: isMe ? "rgba(255,255,255,0.8)" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </span>
        </div>

        {/* Corps */}
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {isOffice && (
            <OfficePreview
              url={url}
              name={name}
              label={officeLabel}
              isMe={isMe}
              height={bodyHeight}
            />
          )}
          {!isOffice && isImage && (
            <img
              src={url}
              alt={name ?? t("f2_image")}
              style={{
                maxWidth: "100%",
                maxHeight: bodyHeight,
                borderRadius: 10,
                display: "block",
                margin: "0 auto",
              }}
            />
          )}
          {!isOffice && isVideo && (
            <video
              src={url}
              controls
              preload="metadata"
              style={{
                width: "100%",
                maxHeight: bodyHeight,
                borderRadius: 10,
                display: "block",
                margin: "0 auto",
              }}
            />
          )}
          {!isOffice && isAudio && (
            <audio src={url} controls preload="metadata" style={{ width: "100%", marginTop: 12 }} />
          )}
          {!isOffice && isPdf && <PdfViewer url={url} isMe={isMe} full fullHeight={bodyHeight} />}
          {!isOffice && isText && (
            <>
              {loadingText ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: textHeight,
                    color: isMe ? "rgba(255,255,255,0.5)" : "var(--text-muted)",
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: `3px solid ${isMe ? "rgba(255,255,255,0.2)" : "var(--border-subtle)"}`,
                      borderTopColor: isMe ? "#fff" : "var(--accent)",
                      animation: "spin 0.8s linear infinite",
                      marginRight: 10,
                    }}
                  />
                  <span>{t("loading_document")}</span>
                </div>
              ) : textContent !== null ? (
                <textarea
                  readOnly
                  value={textContent}
                  style={{
                    width: "100%",
                    height: textHeight,
                    background: "#0d1117",
                    color: isMe ? "#f0f6fc" : "#c9d1d9",
                    border: "1px solid #30363d",
                    borderRadius: 8,
                    padding: 12,
                    fontFamily: "'Fira Code', monospace",
                    fontSize: 13,
                    lineHeight: 1.5,
                    resize: "none",
                  }}
                />
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: bodyHeight,
                    color: isMe ? "rgba(255,255,255,0.5)" : "var(--text-muted)",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <span>{t("doc_load_failed")}</span>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: isMe ? "#fff" : "var(--accent)",
                      fontWeight: 600,
                      textDecoration: "underline",
                    }}
                  >
                    {t("open_new_tab")}
                  </a>
                </div>
              )}
            </>
          )}
          {!isOffice && !isImage && !isVideo && !isAudio && !isPdf && !isText && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: bodyHeight,
                color: isMe ? "rgba(255,255,255,0.5)" : "var(--text-muted)",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isMe ? "rgba(255,255,255,0.4)" : "var(--text-muted)"}
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <div style={{ fontSize: 13, opacity: 0.8 }}>{name ?? t("file")}</div>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: isMe ? "#fff" : "var(--accent)",
                  fontWeight: 600,
                  textDecoration: "underline",
                }}
              >
                {t("download_open")}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Lecteur PDF rendu par PDF.js : ne dépend pas du lecteur PDF du téléphone. */
function PdfViewer({
  url,
  isMe,
  full = false,
  fullHeight = "70vh",
}: {
  url: string
  isMe: boolean
  full?: boolean
  fullHeight?: string
}) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState(t("loading_pdf"))
  const [errorMessage, setErrorMessage] = useState("")
  // PDF.js a besoin des octets. Quand ils sont illisibles — le backend redirige
  // vers Backblaze B2, qui n'envoie pas les en-tetes CORS, et le proxy
  // same-origin n'est pas deploye sur cet hebergement — le lecteur PDF natif du
  // navigateur, lui, suit la redirection sans restriction. On lui passe la main
  // plutot que de n'afficher qu'une erreur.
  const [nativeFallback, setNativeFallback] = useState(false)
  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | undefined
    const render = async () => {
      setState(t("loading_pdf"))
      setErrorMessage("")
      setNativeFallback(false)
      let blob: Blob
      try {
        blob = await loadPreviewBlob(url)
      } catch {
        if (!cancelled) {
          setState("")
          setNativeFallback(true)
        }
        return
      }
      let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs")
      try {
        const sample = await blob.slice(0, 1000).text()
        if (/AccessDenied|cap exceeded|Caps & Alerts/i.test(sample))
          throw new Error(t("storage_quota"))
        pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
        // Le worker indisponible ne dit rien du document : il est peut-etre
        // parfaitement lisible. On passe la main au lecteur natif au lieu
        // d'afficher une erreur sur un PDF valide.
        await ensurePdfWorker(pdfjs)
      } catch (err: unknown) {
        if (cancelled) return
        setState("")
        if (err instanceof Error && /quota de téléchargement/.test(err.message))
          setErrorMessage(err.message)
        else setNativeFallback(true)
        return
      }
      try {
        task = pdfjs.getDocument({ data: await blob.arrayBuffer() })
        const pdf = await task.promise
        if (cancelled || !host.current) return
        host.current.replaceChildren()
        // Premier rendu léger : les pages suivantes sont construites sans relancer le téléchargement.
        for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, full ? 30 : 1); pageNo++) {
          const page = await pdf.getPage(pageNo)
          const viewport = page.getViewport({ scale: 1.25 })
          const canvas = document.createElement("canvas")
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.style.cssText =
            "display:block;width:100%;height:auto;margin:0 auto 12px;background:white;border-radius:6px"
          const ctx = canvas.getContext("2d")
          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise
          if (!cancelled) host.current?.append(canvas)
        }
        if (!cancelled) setState("")
      } catch (err: unknown) {
        if (!cancelled) {
          setState("")
          setErrorMessage(err instanceof Error ? err.message : t("pdf_load_failed"))
        }
      }
    }
    void render()
    return () => {
      cancelled = true
      task?.destroy?.()
    }
  }, [url, full])

  // Repli natif : le document reste consultable et defilable, sans PDF.js.
  if (nativeFallback) {
    return (
      <div style={{ position: "relative" }}>
        <iframe
          src={url}
          title={t("thr_pdf_preview")}
          style={{
            width: "100%",
            height: full ? fullHeight : 220,
            border: "none",
            borderRadius: 8,
            background: "#fff",
            display: "block",
          }}
        />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "block",
            padding: "6px 2px 0",
            fontSize: 10,
            color: isMe ? "rgba(255,255,255,0.85)" : "var(--text-secondary)",
          }}
        >
          {t("open_new_tab")}
        </a>
      </div>
    )
  }

  // Le host canvas est volontairement distinct du texte React : PDF.js manipule
  // ses enfants avec replaceChildren(), React ne doit donc jamais les gérer.
  return (
    <div
      style={{
        minHeight: 120,
        color: isMe ? "#fff" : "var(--text-secondary)",
        textAlign: "center",
        padding: 10,
      }}
    >
      {state && <div style={{ padding: 10 }}>{state}</div>}
      {errorMessage && (
        <div style={{ padding: 10, color: isMe ? "#ffe0d1" : "var(--danger)" }}>{errorMessage}</div>
      )}
      <div ref={host} />
    </div>
  )
}

/** Coche simple (envoye) / double blanche (recu) / double bleue (lu), comme sur WhatsApp.
    Affichee uniquement sur la bulle terracotta de l'expediteur -> teintes claires. */
function StatusIcon({ status }: { status: MessageStatus }) {
  const { t } = useTranslation()
  if (status === "sending") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(255, 255, 255, 0.6)"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
    )
  }

  // Bleu vif quand lu, blanc translucide sinon (lisible sur le terracotta).
  const color = status === "read" ? "#6fd0f5" : "rgba(255, 255, 255, 0.8)"
  const doubleCheck = status === "delivered" || status === "read"

  return (
    <svg
      width="16"
      height="12"
      viewBox="0 0 28 16"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 8.5l4 4L14 4" />
      {doubleCheck && <path d="M10 8.5l4 4L22 4" />}
    </svg>
  )
}

/** Extrait les URLs d'un texte. */
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi

/**
 * Détecte des coordonnées GPS DANS UN TEXTE — annonce d'un vendeur, message
 * d'une autre plateforme. Un partage de position est désormais un vrai message
 * de type `location` et ne passe pas par ici.
 *
 * 🔴 **UN COUPLE DE DÉCIMAUX NU N'EST PLUS RECONNU, et c'est une correction.**
 * L'ancienne règle acceptait deux décimaux n'importe où : « j'ai payé 12.50,
 * 30.75 » affichait une carte au Soudan — et, plus grave, `removeGpsCoordinates`
 * RETIRE du texte affiché ce qui a été reconnu, donc les montants
 * disparaissaient du message. Les bornes seules ne suffisaient pas : ces deux
 * nombres SONT des coordonnées valides.
 *
 * Il faut maintenant une marque explicite : parenthèses, lien de carte, ou URI
 * `geo:`. Même correction que côté mobile (`gps_preview.dart`) — cette règle
 * est partagée, elle ne doit pas diverger d'un client à l'autre.
 */
const GPS_PARENTHESES_REGEX = /\(\s*(-?\d+\.\d{2,})\s*,\s*(-?\d+\.\d{2,})\s*\)/
const GEO_URI_REGEX = /geo:\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/
const GMAPS_REGEX =
  /(?:google\.\w+\/maps|maps\.google\.\w+|goo\.gl\/maps).*?[/@](-?\d+\.\d+),(-?\d+\.\d+)/

function coordonneesValides(a: string, b: string): { lat: number; lng: number } | null {
  const lat = parseFloat(a)
  const lng = parseFloat(b)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

function extractGpsCoords(text: string): { lat: number; lng: number } | null {
  const gm = text.match(GMAPS_REGEX)
  if (gm) {
    const r = coordonneesValides(gm[1], gm[2])
    if (r) return r
  }
  const geo = text.match(GEO_URI_REGEX)
  if (geo) {
    const r = coordonneesValides(geo[1], geo[2])
    if (r) return r
  }
  const par = text.match(GPS_PARENTHESES_REGEX)
  if (par) {
    const r = coordonneesValides(par[1], par[2])
    if (r) return r
  }
  return null
}

/**
 * Les coordonnées sont affichées sous la carte : on évite de les répéter.
 *
 * ⚠️ Les motifs retirés sont EXACTEMENT ceux que `extractGpsCoords` reconnaît.
 * Le couple de décimaux nu n'en fait plus partie : le garder ici effacerait un
 * montant cité dans le message.
 */
function removeGpsCoordinates(text: string): string {
  return text
    .replace(new RegExp(GPS_PARENTHESES_REGEX, "g"), "")
    .replace(new RegExp(GEO_URI_REGEX, "g"), "")
    .replace(new RegExp(GMAPS_REGEX, "g"), "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

/** Couleurs distinctes pour les noms d'envoyeurs en groupe. */
const SENDER_NAME_COLORS = [
  "#E8B84B",
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#f87171",
  "#fb923c",
  "#38bdf8",
  "#c084fc",
]
function senderNameColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
  return SENDER_NAME_COLORS[Math.abs(h) % SENDER_NAME_COLORS.length]
}

/** Extensions lues comme du texte source par le visionneur integre.
 *  Un .html n'est jamais execute : il est affiche tel quel. */
const TEXT_PREVIEW_EXTENSIONS = [
  "txt",
  "csv",
  "log",
  "md",
  "tex",
  "latex",
  "bib",
  "sty",
  "tsx",
  "ts",
  "jsx",
  "js",
  "mjs",
  "cjs",
  "html",
  "htm",
  "xhtml",
  "vue",
  "svelte",
  "astro",
  "css",
  "scss",
  "sass",
  "less",
  "styl",
  "postcss",
  "json",
  "yaml",
  "yml",
  "xml",
  "toml",
  "ini",
  "cfg",
  "env",
  "properties",
  "dockerfile",
  "makefile",
  "gradle",
  "maven",
  "sh",
  "bash",
  "zsh",
  "fish",
  "powershell",
  "bat",
  "cmd",
  "py",
  "java",
  "cpp",
  "c",
  "h",
  "hpp",
  "cs",
  "go",
  "rust",
  "rs",
  "swift",
  "kt",
  "kts",
  "scala",
  "r",
  "rb",
  "pl",
  "pm",
  "lua",
  "perl",
  "php",
  "sql",
  "graphql",
  "prisma",
  "mdx",
  "rst",
  "asciidoc",
  "org",
  "wiki",
]

/** Icone + couleur par extension de fichier. */
function fileTypeInfo(filename?: string, mime?: string): { color: string; label: string } {
  const ext = (filename ?? "").split(".").pop()?.toLowerCase() ?? ""
  const m = (mime ?? "").toLowerCase()
  if (ext === "pdf" || m === "application/pdf") return { color: "#ef4444", label: "PDF" }
  if (["doc", "docx"].includes(ext) || m.includes("word")) return { color: "#3b82f6", label: "DOC" }
  if (["xls", "xlsx"].includes(ext) || m.includes("spreadsheet") || m.includes("excel"))
    return { color: "#22c55e", label: "XLS" }
  if (["ppt", "pptx"].includes(ext) || m.includes("presentation"))
    return { color: "#f97316", label: "PPT" }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return { color: "#a855f7", label: "ZIP" }
  if (["txt", "csv", "log", "md", "tex", "latex", "bib", "sty"].includes(ext))
    return { color: "#6b7280", label: "TXT" }
  if (
    [
      "tsx",
      "ts",
      "jsx",
      "js",
      "mjs",
      "cjs",
      "html",
      "htm",
      "xhtml",
      "vue",
      "svelte",
      "astro",
    ].includes(ext)
  )
    return { color: "#f59e0b", label: "CODE" }
  if (["css", "scss", "sass", "less", "styl", "postcss"].includes(ext))
    return { color: "#6366f1", label: "CSS" }
  if (
    [
      "json",
      "yaml",
      "yml",
      "xml",
      "toml",
      "ini",
      "cfg",
      "env",
      "properties",
      "dockerfile",
      "makefile",
      "gradle",
      "maven",
      "sh",
      "bash",
      "zsh",
      "fish",
      "powershell",
      "bat",
      "cmd",
      "py",
      "java",
      "cpp",
      "c",
      "h",
      "hpp",
      "cs",
      "go",
      "rust",
      "rs",
      "swift",
      "kt",
      "kts",
      "scala",
      "r",
      "rb",
      "pl",
      "pm",
      "lua",
      "perl",
      "php",
      "sql",
      "graphql",
      "prisma",
      "mdx",
      "rst",
      "asciidoc",
      "org",
      "wiki",
    ].includes(ext)
  )
    return { color: "#10b981", label: "CODE" }
  if (m.startsWith("audio/")) return { color: "#22c55e", label: "AUDIO" }
  if (m.startsWith("video/")) return { color: "#8b5cf6", label: "VIDEO" }
  if (m.startsWith("image/")) return { color: "#ec4899", label: "IMG" }
  if (ext === "apk") return { color: "#34d399", label: "APK" }
  return { color: "var(--text-secondary)", label: ext.toUpperCase() || "FILE" }
}

/** Estime le nombre de pages approximatif d'un document selon sa taille et son type. */
function estimatePages(fileName?: string, fileSize?: string): number {
  const ext = (fileName ?? "").split(".").pop()?.toLowerCase() ?? ""
  // On lit le NOMBRE et son ordre de grandeur, jamais le mot qui suit : l'unite
  // est traduite a l'affichage — « Mo », « MB », « МБ » — et la relire figeait
  // l'estimation a une page dans huit langues sur neuf.
  const taille = (fileSize ?? "").match(/([0-9]+(?:[.,][0-9]+)?)\s*([kKmMgG])?/)
  const nombre = taille ? parseFloat(taille[1].replace(",", ".")) : 0
  const facteur =
    { k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 }[(taille?.[2] ?? "").toLowerCase()] ?? 1
  const bytes = Number.isFinite(nombre) ? nombre * facteur : 0
  if (["pdf"].includes(ext)) return Math.max(1, Math.ceil(bytes / 5000))
  if (["doc", "docx", "ppt", "pptx", "txt", "csv", "md", "tex", "latex", "bib"].includes(ext))
    return Math.max(1, Math.ceil(bytes / 3000))
  if (["xls", "xlsx", "ods", "numbers"].includes(ext)) return Math.max(1, Math.ceil(bytes / 2000))
  if (
    [
      "tsx",
      "ts",
      "jsx",
      "js",
      "mjs",
      "cjs",
      "html",
      "htm",
      "css",
      "scss",
      "json",
      "yaml",
      "yml",
      "xml",
      "py",
      "java",
      "cpp",
      "c",
      "h",
      "cpp",
      "go",
      "rust",
      "php",
      "sql",
      "sh",
      "bash",
      "zsh",
      "vue",
      "svelte",
      "astro",
      "mdx",
      "rst",
      "lua",
      "perl",
      "pl",
      "rb",
      "swift",
      "kt",
      "scala",
      "r",
      "cs",
      "gradle",
      "maven",
      "ini",
      "cfg",
      "env",
      "dockerfile",
      "makefile",
    ].includes(ext)
  )
    return Math.max(1, Math.ceil(bytes / 2500))
  return 0
}

/** Rend le texte avec les URLs cliquables et un preview du premier lien. */
function RichText({ text, isMe }: { text: string; isMe: boolean }) {
  const urls = text.match(URL_REGEX) || []
  if (urls.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0
  for (const url of urls) {
    const idx = remaining.indexOf(url)
    if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>)
    parts.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{
          color: isMe ? "#93c5fd" : "var(--accent)",
          textDecoration: "underline",
          wordBreak: "break-all",
        }}
      >
        {url}
      </a>
    )
    remaining = remaining.slice(idx + url.length)
  }
  if (remaining) parts.push(<span key={key++}>{remaining}</span>)

  let domain = ""
  try {
    if (urls[0]) domain = new URL(urls[0]).hostname.replace("www.", "")
  } catch {
    /* ignore */
  }

  return (
    <>
      {parts}
      {domain && (
        <a
          href={urls[0]}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
            padding: "8px 10px",
            background: isMe ? "#ffffff12" : "var(--bg-elevated)",
            border: `1px solid ${isMe ? "#ffffff18" : "var(--border-subtle)"}`,
            borderRadius: 8,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <img
            src={`https://www.google.com/s2/favicons?sz=32&domain=${domain}`}
            alt=""
            width={20}
            height={20}
            style={{ borderRadius: 4, flexShrink: 0 }}
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = "none"
            }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {domain}
            </div>
            <div
              style={{
                fontSize: 10,
                opacity: 0.6,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {urls[0]}
            </div>
          </div>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </a>
      )}
    </>
  )
}

/** Preview de coordonnees GPS avec mini-carte OpenStreetMap. */
function GpsPreview({ lat, lng, isMe }: { lat: number; lng: number; isMe: boolean }) {
  const { t } = useTranslation()
  return (
    <div style={{ marginTop: 6 }}>
      <a
        href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`}
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: "none", color: "inherit" }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 260,
            height: 140,
            borderRadius: 8,
            overflow: "hidden",
            border: `1px solid ${isMe ? "#ffffff18" : "var(--border-subtle)"}`,
            background: isMe ? "#ffffff08" : "var(--bg-elevated)",
            position: "relative",
          }}
        >
          <iframe
            title={t("thr_gps_position")}
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}&layer=mapnik&marker=${lat},${lng}`}
            style={{
              width: "100%",
              height: "130%",
              border: "none",
              pointerEvents: "none",
              display: "block",
            }}
          />
          {/* Masque tout message d'erreur ou texte intégré en bas du preview */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 55,
              background: `linear-gradient(to top, ${isMe ? "rgba(255,255,255,0.25)" : "var(--bg-elevated)"}, transparent 10%)`,
              pointerEvents: "none",
            }}
          />
          {/* Overlay supplémentaire au centre-bas pour cacher tout texte résiduel */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 35,
              background: isMe ? "rgba(255,255,255,0.15)" : "var(--bg-elevated)",
              opacity: 0.9,
              pointerEvents: "none",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 4,
            fontSize: 10,
            opacity: 0.75,
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </div>
      </a>
    </div>
  )
}

/**
 * Fiche de contact reçue (message de type `contact`).
 *
 * La charge utile est du JSON dans `content` — format imposé par le serveur,
 * voir `services/message-payload.ts`. Sans ce rendu, le web affichait ce JSON
 * en clair dans la bulle.
 *
 * ⚠️ Une charge illisible n'affiche PAS une carte vide : on rend la mention
 * générique, et on ne prétend pas connaître un contact qu'on ne sait pas lire.
 */
function ContactCard({ content, isMe }: { content: string | null; isMe: boolean }) {
  const contacts = contactsDepuisContenu(content)
  if (!contacts) {
    return <div style={{ opacity: 0.8, fontSize: 13 }}>👤 Contact</div>
  }
  const bordure = isMe ? "#ffffff28" : "var(--border-subtle)"
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 200 }}>
      {contacts.map((c, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 8px",
            borderRadius: 8,
            border: `1px solid ${bordure}`,
            background: isMe ? "#ffffff10" : "var(--bg-elevated)",
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isMe ? "#ffffff20" : "var(--accent-soft, #E8B84B33)",
              fontWeight: 600,
              fontSize: 14,
              overflow: "hidden",
            }}
          >
            {c.avatarUrl ? (
              <img
                src={c.avatarUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              nomAffichable(c).charAt(0).toUpperCase()
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 13.5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {nomAffichable(c)}
            </div>
            {c.phones.length > 0 && nomAffichable(c) !== c.phones[0] && (
              <div style={{ fontSize: 12, opacity: 0.75 }}>{c.phones[0]}</div>
            )}
            {c.alanyaId && (
              <div style={{ fontSize: 10.5, opacity: 0.65 }}>Sur Alanya</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Position reçue (message de type `location`). Réutilise la mini-carte. */
function LocationCard({ content, isMe }: { content: string | null; isMe: boolean }) {
  const position = positionDepuisContenu(content)
  if (!position) {
    return <div style={{ opacity: 0.8, fontSize: 13 }}>📍 Position</div>
  }
  return (
    <div style={{ minWidth: 200 }}>
      {position.label && (
        <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>
          📍 {position.label}
        </div>
      )}
      <GpsPreview lat={position.lat} lng={position.lng} isMe={isMe} />
      {position.accuracy !== null && (
        // La précision change le sens de ce qu'on reçoit : une position à
        // 1 200 m près désigne un quartier, pas un lieu.
        <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 2 }}>
          Précision {Math.round(position.accuracy)} m
        </div>
      )}
    </div>
  )
}

/**
 * Evenement d'appel affiche dans le fil de discussion :
 * aligne a gauche (entrant) ou a droite (sortant), avec couleurs directionnelles.
 */
function CallEventChip({ call }: { call: CallRecord }) {
  const { t } = useTranslation()
  const isOutgoing = call.direction === "out"
  const outcome =
    call.status === "missed" || call.status === "no_answer"
      ? t("call_missed")
      : call.status === "declined"
        ? t("call_declined")
        : call.status === "busy"
          ? t("call_busy")
          : ""
  const failed = Boolean(outcome)

  const label = `${call.type === "video" ? t("video_call") : t("audio_call")}${outcome ? ` — ${outcome}` : ""}`

  // Couleurs : rouge si manque/refuse, vert si sortant reussi, bleu si entrant reussi
  const tint = failed ? "var(--danger)" : isOutgoing ? "#22c55e" : "#3b82f6"
  const bgTint = failed ? "#ef444412" : isOutgoing ? "#22c55e12" : "#3b82f612"

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isOutgoing ? "flex-end" : "flex-start",
        margin: "4px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: bgTint,
          border: `1px solid ${tint}22`,
          borderRadius: isOutgoing ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
          padding: "8px 14px",
          fontSize: 12,
          color: tint,
          maxWidth: "min(70%, 340px)",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: bgTint,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {call.type === "video" ? (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
          ) : (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
          >
            {/* Fleche de direction */}
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            >
              {isOutgoing ? (
                <>
                  <line x1="7" y1="17" x2="17" y2="7" />
                  <polyline points="7 7 17 7 17 17" />
                </>
              ) : (
                <>
                  <line x1="17" y1="7" x2="7" y2="17" />
                  <polyline points="17 17 7 17 7 7" />
                </>
              )}
            </svg>
            {label}
          </div>
          <div style={{ fontSize: 10, opacity: 0.75, marginTop: 1 }}>
            {formatTime(call.ts)}
            {call.duration ? ` — ${call.duration}` : ""}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Lecteur audio compact style WhatsApp (vocaux et fichiers audio). */
function AudioPlayer({
  src,
  durationMs,
  isMe,
}: {
  src: string
  durationMs?: number
  isMe: boolean
}) {
  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      void audio.play()
    }
  }

  const fg = isMe ? "var(--bubble-me-text)" : "var(--text-primary)"

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 190, padding: "2px 0" }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setProgress(0)
          setElapsedSec(0)
        }}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget
          const total =
            Number.isFinite(audio.duration) && audio.duration > 0
              ? audio.duration
              : (durationMs ?? 0) / 1000
          setElapsedSec(audio.currentTime)
          setProgress(total > 0 ? audio.currentTime / total : 0)
        }}
      />
      <button
        onClick={toggle}
        aria-label={playing ? t("f2_pause") : t("f2_play")}
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "none",
          background: isMe ? "#ffffff30" : "var(--accent-dim)",
          color: isMe ? fg : "var(--accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {playing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 3 21 12 6 21 6 3" />
          </svg>
        )}
      </button>
      <div style={{ flex: 1, minWidth: 110 }}>
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: isMe ? "#ffffff35" : "var(--border-default)",
            position: "relative",
            cursor: "pointer",
          }}
          onClick={(e) => {
            const audio = audioRef.current
            if (!audio || !Number.isFinite(audio.duration)) return
            const rect = e.currentTarget.getBoundingClientRect()
            audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${Math.min(100, progress * 100)}%`,
              borderRadius: 2,
              background: isMe ? fg : "var(--accent)",
            }}
          />
        </div>
        <div style={{ fontSize: 10, opacity: 0.75, marginTop: 4 }}>
          {playing || elapsedSec > 0
            ? formatAudioDuration(elapsedSec * 1000)
            : formatAudioDuration(durationMs)}
        </div>
      </div>
    </div>
  )
}

const SWIPE_REPLY_THRESHOLD = 56

/** Survol prolonge avant de reveler les actions d'un message (pas de saut au passage de souris). */
const ACTIONS_HOVER_DELAY_MS = 800

/** Sursis avant de masquer les actions quand la souris quitte le message. */
const ACTIONS_HIDE_GRACE_MS = 320

/** Largeur reservee a droite/gauche de la bulle pour accueillir le bouton d'actions. */
const ACTIONS_GUTTER = 34

/** Hauteur approximative du menu deroulant, pour decider s'il s'ouvre vers le haut. */
const ACTIONS_MENU_HEIGHT = 240

/** Duree du flash du message d'origine quand on clique une citation (cf. .msg-highlight). */
const MSG_FLASH_MS = 1200

/** Composant de preview natif pour fichiers texte/code. */
function TextFilePreview({ url, isMe, name }: { url: string; isMe: boolean; name?: string }) {
  const { t } = useTranslation()
  const [text, setText] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState("")
  const [query, setQuery] = useState("")
  const ext = name?.split(".").pop()?.toLowerCase() ?? "txt"
  const isCsv = ext === "csv"
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrorMessage("")
    setText("")
    void loadPreviewBlob(url)
      .then((blob) => blob.text())
      .then((content) => {
        if (/AccessDenied|cap exceeded|Caps & Alerts/i.test(content.slice(0, 1000)))
          throw new Error(t("storage_quota"))
        if (!cancelled) {
          setText(content.slice(0, 50000))
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : t("doc_load_failed"))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [url])

  const copy = () => {
    void navigator.clipboard?.writeText(text)
  }
  const rows = useMemo(
    () =>
      isCsv
        ? text
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(0, 30)
            .map((row) =>
              row
                .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
                .map((cell) => cell.replace(/^"|"$/g, "").trim())
            )
        : [],
    [isCsv, text]
  )
  const visibleLines = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .filter((line) => !query || line.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 80),
    [text, query]
  )
  const tone = isMe ? "#ffffff" : "var(--text-primary)"

  return (
    <div
      style={{
        width: "100%",
        borderRadius: 8,
        border: `1px solid ${isMe ? "#ffffff25" : "var(--border-subtle)"}`,
        background: isMe ? "#00000018" : "#10151d",
        marginBottom: 6,
        overflow: "hidden",
        color: tone,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 8px",
          background: isMe ? "#00000018" : "#171d27",
        }}
      >
        <span style={{ fontFamily: "monospace", fontSize: 10, opacity: 0.75, fontWeight: 700 }}>
          {ext.toUpperCase()}
        </span>
        <input
          aria-label={t("search_in_document")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("cinfo_search")}
          style={{
            minWidth: 0,
            flex: 1,
            border: "none",
            borderRadius: 4,
            padding: "4px 6px",
            background: "#ffffff14",
            color: tone,
            fontSize: 10,
            outline: "none",
          }}
        />
        <button
          onClick={copy}
          title={t("copy_content")}
          style={{
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            padding: "4px 6px",
            background: "#ffffff18",
            color: tone,
            fontSize: 10,
          }}
        >
          {t("copy")}
        </button>
      </div>
      {loading ? (
        <div style={{ padding: 12, fontFamily: "monospace", fontSize: 11 }}>
          {t("loading_preview")}
        </div>
      ) : errorMessage ? (
        // Le visionneur a besoin du texte : sans les octets il n'a rien a rendre.
        // On laisse au moins une porte de sortie vers le fichier lui-meme.
        <div style={{ padding: 12, fontFamily: "monospace", fontSize: 11, color: "#ffb4a2" }}>
          {errorMessage}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ display: "block", marginTop: 6, color: "inherit", opacity: 0.85 }}
          >
            {t("open_new_tab")}
          </a>
        </div>
      ) : isCsv ? (
        <div style={{ overflow: "auto", maxHeight: 180 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10 }}>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      style={{
                        border: "1px solid #ffffff18",
                        padding: "4px 6px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {text.split(/\r?\n/).filter(Boolean).length > 30 && (
            <div style={{ padding: 6, fontSize: 10, opacity: 0.65 }}>{t("first_lines_shown")}</div>
          )}
        </div>
      ) : (
        <div
          style={{
            maxHeight: 180,
            overflow: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            lineHeight: 1.48,
            padding: "6px 0",
          }}
        >
          {visibleLines.map((line, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                paddingRight: 8,
                background:
                  query && line.toLowerCase().includes(query.toLowerCase())
                    ? "#fbbf241f"
                    : undefined,
              }}
            >
              <span
                style={{
                  width: 32,
                  flexShrink: 0,
                  textAlign: "right",
                  paddingRight: 8,
                  userSelect: "none",
                  opacity: 0.42,
                }}
              >
                {index + 1}
              </span>
              <code
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: line.trimStart().startsWith("#")
                    ? "#8be9fd"
                    : line.includes(":")
                      ? "#f8c878"
                      : tone,
                }}
              >
                {line}
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Un apercu couteux ne se monte qu'a l'approche de l'ecran. Sans ce garde-fou,
 * ouvrir une conversation instancie d'un coup les apercus des cent derniers
 * messages : autant de telechargements complets, de documents PDF.js et de
 * canvas, y compris pour des fichiers que personne ne regardera. La marge de
 * 600 px fait charger l'apercu avant qu'il n'entre dans le champ, pour que la
 * lecture reste continue au defilement.
 */
function LazyPreview({ minHeight, children }: { minHeight: number; children: ReactNode }) {
  const [visible, setVisible] = useState(false)
  const holder = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = holder.current
    if (!node) return
    // Navigateur sans IntersectionObserver : on affiche tout, comme avant.
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "600px 0px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  // La hauteur reservee evite que le fil ne sursaute quand l'apercu se monte.
  return (
    <div ref={holder} style={visible ? undefined : { minHeight }}>
      {visible ? children : null}
    </div>
  )
}

/**
 * Word, Excel et PowerPoint sont des formats binaires qu'aucun rendu local ne
 * couvre ici : leur apercu passe par Office Online, donc par Microsoft. Or
 * l'URL transmise porte le jeton de session Alanya (resolveMediaUrl en a besoin
 * pour que le service puisse lire le document). L'apercu n'est donc plus
 * automatique : il demande un accord explicite, pour qu'aucun jeton ne parte a
 * l'insu de l'utilisateur a la simple ouverture d'une conversation.
 */
function OfficePreview({
  url,
  name,
  label,
  isMe,
  height,
  compact = false,
}: {
  url: string
  name?: string
  label: string
  isMe: boolean
  height: number | string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [accepted, setAccepted] = useState(false)

  if (accepted) {
    return (
      <iframe
        src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
        title={name ?? label}
        style={{
          width: "100%",
          height,
          borderRadius: 8,
          border: "none",
          display: "block",
          marginBottom: 6,
        }}
        loading="lazy"
      />
    )
  }

  return (
    <div
      style={{
        marginBottom: 6,
        padding: "9px 11px",
        borderRadius: 9,
        background: isMe ? "#ffffff18" : "#f5f6fa",
        border: `1px solid ${isMe ? "#ffffff2e" : "#dde1e7"}`,
        color: isMe ? "#fff" : "var(--text-primary)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600 }}>{t("f2_preview_of", { format: label })}</div>
        <div style={{ fontSize: 9.5, opacity: 0.78, marginTop: 2, lineHeight: 1.4 }}>
          {t("office_warning")}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setAccepted(true)
        }}
        style={{
          flexShrink: 0,
          padding: "5px 10px",
          borderRadius: 6,
          border: "none",
          background: isMe ? "#ffffff28" : "var(--accent)",
          color: isMe ? "#fff" : "var(--accent-text)",
          fontSize: 10,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("show")}
      </button>
      {/* Dans le fil, la ligne de fichier sous l'apercu porte deja le
        telechargement : le repeter ici alourdissait la bulle pour rien. */}
      {!compact && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            flexShrink: 0,
            padding: "5px 10px",
            borderRadius: 6,
            border: `1px solid ${isMe ? "#ffffff30" : "var(--border-default)"}`,
            color: isMe ? "rgba(255,255,255,0.8)" : "var(--text-secondary)",
            fontSize: 10,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          {t("download")}
        </a>
      )}
    </div>
  )
}

function VideoPreview({
  src,
  name,
  size,
  durationMs,
}: {
  src: string
  name?: string
  size?: string
  durationMs?: number
}) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  if (failed)
    return (
      <div
        style={{
          marginBottom: 6,
          padding: "10px 12px",
          borderRadius: 9,
          background: "#00000012",
          fontSize: 11,
        }}
      >
        <div style={{ fontWeight: 600 }}>{name ?? t("video_label")}</div>
        <div style={{ opacity: 0.72, marginTop: 3 }}>
          {size ?? t("f2_unknown_size")} · {formatAudioDuration(durationMs)}
        </div>
        <div style={{ opacity: 0.72, marginTop: 4 }}>{t("preview_downloadable")}</div>
      </div>
    )
  return (
    <video
      src={src}
      controls
      preload="metadata"
      onError={() => setFailed(true)}
      style={{
        maxWidth: "100%",
        maxHeight: 260,
        borderRadius: 10,
        display: "block",
        marginBottom: 6,
      }}
    />
  )
}

/** Fichier choisi par l'utilisateur, en attente de confirmation d'envoi. */
interface PendingMedia {
  file: File
  /** URL blob: locale, uniquement pour l'apercu avant envoi. */
  url: string
  kind: "image" | "audio" | "video" | "file"
  mime: string
  durationMs?: number
  caption: string
}

/** Ce dont un apercu plein contenu a besoin, qu'il vienne du disque ou du serveur. */
interface PreviewSubject {
  url: string
  name?: string
  mime: string
  kind: "image" | "audio" | "video" | "file"
  /** Ligne d'information sous les formats sans rendu possible (taille, duree...). */
  note?: string
}

/**
 * Apercu plein contenu, partage par l'ecran de confirmation d'envoi et par la
 * galerie d'un lot recu. Les deux montrent la meme chose : seule la provenance
 * de l'URL change (blob: local avant envoi, media backend apres).
 */
function FullMediaPreview({
  subject,
  maxHeight = "58vh",
}: {
  subject: PreviewSubject
  maxHeight?: string
}) {
  const { t } = useTranslation()
  const name = subject.name ?? t("file")
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const isPdf = subject.mime === "application/pdf" || ext === "pdf"
  const isText = subject.mime.startsWith("text/") || TEXT_PREVIEW_EXTENSIONS.includes(ext)
  const frame = {
    maxWidth: "100%",
    maxHeight,
    borderRadius: 12,
    display: "block",
    margin: "0 auto",
  } as const

  if (subject.kind === "image")
    return <img src={subject.url} alt={name} style={{ ...frame, objectFit: "contain" }} />
  if (subject.kind === "video")
    return <video src={subject.url} controls preload="metadata" style={frame} />
  if (subject.kind === "audio")
    return <audio src={subject.url} controls preload="metadata" style={{ width: "100%" }} />
  if (isPdf)
    return (
      <div style={{ maxHeight, overflow: "auto", borderRadius: 12 }}>
        <PdfViewer url={subject.url} isMe={false} full fullHeight={maxHeight} />
      </div>
    )
  if (isText) return <TextFilePreview url={subject.url} isMe={false} name={name} />

  // Formats binaires sans rendu local : on identifie au moins le fichier.
  const fti = fileTypeInfo(name, subject.mime)
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: 18,
        borderRadius: 12,
        background: "#ffffff10",
        border: "1px solid #ffffff1f",
      }}
    >
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: 12,
          background: `${fti.color}22`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: fti.color }}>{fti.label}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#fff",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 3 }}>
          {subject.note ? `${subject.note} — ` : ""}
          {t("f2_no_browser_preview")}
        </div>
      </div>
    </div>
  )
}

/** Un message porteur de media, vu comme sujet d'apercu. */
function messageSubject(msg: Message): PreviewSubject {
  return {
    url: msg.mediaUrl ? resolveMediaUrl(msg.mediaUrl) : "",
    name: msg.fileName,
    mime: msg.mediaMime ?? "",
    kind: msg.type === "image" || msg.type === "video" || msg.type === "audio" ? msg.type : "file",
    note: msg.fileSize,
  }
}

/**
 * Galerie d'un lot de medias : on passe de l'un a l'autre par defilement
 * horizontal. L'accrochage CSS (scroll-snap) fait le travail nativement, donc
 * le geste tactile reste celui du navigateur, sans gestionnaire maison.
 */
function MediaGallery({
  msgs,
  index,
  onClose,
}: {
  msgs: Message[]
  index: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const track = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(index)
  const { expanded, toggle } = useViewerFullscreen(host)
  // En plein ecran, le media prend tout ce que l'en-tete et les pastilles laissent.
  const mediaHeight = expanded ? "calc(100vh - 92px)" : "58vh"

  // Ouverture sur la tuile cliquee : positionnement direct, sans animation.
  useEffect(() => {
    const node = track.current
    if (node) node.scrollTo({ left: node.clientWidth * index, behavior: "auto" })
  }, [index])

  /** Avance ou recule d'une vue entiere : l'accrochage CSS fait le reste. */
  const step = useCallback((delta: number) => {
    const node = track.current
    if (node) node.scrollBy({ left: node.clientWidth * delta, behavior: "smooth" })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // En plein ecran natif, Echap rend d'abord la main au navigateur : la
      // galerie ne se ferme qu'a la seconde pression.
      if (event.key === "Escape" && !document.fullscreenElement) onClose()
      if (event.key === "ArrowRight") step(1)
      if (event.key === "ArrowLeft") step(-1)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose, step])

  const onScroll = () => {
    const node = track.current
    if (node && node.clientWidth > 0) setCurrent(Math.round(node.scrollLeft / node.clientWidth))
  }

  const position = Math.min(current, msgs.length - 1)
  const shown = msgs[position]

  return (
    <div
      ref={host}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9550,
        background: "#000000ee",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {shown?.fileName ?? t("f2_media")}
          <span style={{ opacity: 0.6, fontWeight: 400 }}>
            {" "}
            — {position + 1}/{msgs.length}
          </span>
        </span>
        <span style={{ display: "flex", gap: 14, alignItems: "center", flexShrink: 0 }}>
          {shown?.mediaUrl && (
            <a
              href={resolveMediaUrl(shown.mediaUrl, { download: true })}
              target="_blank"
              rel="noreferrer"
              style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }}
            >
              {t("download")}
            </a>
          )}
          <ViewerFullscreenButton
            expanded={expanded}
            onToggle={toggle}
            color="rgba(255,255,255,0.85)"
          />
          <button
            onClick={onClose}
            aria-label={t("close")}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.85)",
              cursor: "pointer",
              fontSize: 22,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </span>
      </div>

      <div style={{ flex: 1, position: "relative", display: "flex", minHeight: 0 }}>
        <div
          ref={track}
          onScroll={onScroll}
          style={{
            flex: 1,
            display: "flex",
            overflowX: "auto",
            overflowY: "hidden",
            scrollSnapType: "x mandatory",
            scrollbarWidth: "none",
          }}
        >
          {msgs.map((item) => (
            <div
              key={item.id}
              style={{
                flex: "0 0 100%",
                scrollSnapAlign: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: expanded ? "0 8px" : "0 18px",
              }}
            >
              <div style={{ width: expanded ? "100%" : "min(100%, 820px)" }}>
                <FullMediaPreview subject={messageSubject(item)} maxHeight={mediaHeight} />
              </div>
            </div>
          ))}
        </div>

        {/* Sur mobile le lot se parcourt au doigt ; sur grand ecran il n'y a pas
            de geste de balayage, d'ou ces deux fleches (masquees par la CSS
            sous 901 px, ou elles recouvriraient le media). */}
        {position > 0 && (
          <button
            className="gallery-nav gallery-nav-prev"
            onClick={() => step(-1)}
            aria-label={t("thr_previous_media")}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        {position < msgs.length - 1 && (
          <button
            className="gallery-nav gallery-nav-next"
            onClick={() => step(1)}
            aria-label={t("thr_next_media")}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 7,
          justifyContent: "center",
          padding: "12px 18px 20px",
          flexShrink: 0,
        }}
      >
        {msgs.map((item, i) => (
          <span
            key={item.id}
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: i === position ? "#fff" : "#ffffff45",
            }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Visionneuse d'une image seule, ouverte au clic sur une photo du fil. Elle porte
 * la meme bascule plein ecran que les autres visionneurs.
 */
function ImageLightbox({
  url,
  name,
  onClose,
}: {
  url: string
  name?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const { expanded, toggle } = useViewerFullscreen(host)
  const chip = { background: "#ffffff20", borderRadius: 8, padding: "8px 10px" } as const

  useEffect(() => {
    // Comme dans la galerie : en plein ecran natif, Echap rend d'abord la main
    // au navigateur, la seconde pression ferme la visionneuse.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      ref={host}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "#000000d9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: expanded ? 0 : 24,
        cursor: "zoom-out",
      }}
    >
      <img
        src={url}
        alt={name ?? t("f2_image")}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: expanded ? "100vw" : "92vw",
          maxHeight: expanded ? "100vh" : "88vh",
          borderRadius: expanded ? 0 : 8,
          boxShadow: expanded ? "none" : "0 24px 80px #000000a0",
          cursor: "default",
        }}
      />
      <div style={{ position: "absolute", top: 16, right: 16, display: "flex", gap: 10 }}>
        <ViewerFullscreenButton expanded={expanded} onToggle={toggle} color="#fff" style={chip} />
        <a
          href={url.includes("?") ? `${url}&download=1` : url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={t("thr_download_image")}
          style={{ ...chip, border: "none", color: "#fff", display: "flex", alignItems: "center" }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        </a>
        <button
          onClick={onClose}
          aria-label={t("close")}
          style={{ ...chip, border: "none", color: "#fff", cursor: "pointer" }}
        >
          <svg
            width="18"
            height="18"
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
      </div>
    </div>
  )
}

/**
 * Confirmation avant envoi, facon WhatsApp : le fichier s'ouvre en grand, on
 * peut lui joindre une legende, et rien ne part tant qu'on n'a pas valide.
 * Plusieurs fichiers se parcourent dans la bande de vignettes du bas ; chacun
 * garde sa propre legende.
 */
function MediaComposer({
  items,
  index,
  onIndexChange,
  onCaptionChange,
  onRemove,
  onCancel,
  onSend,
}: {
  items: PendingMedia[]
  index: number
  onIndexChange: (index: number) => void
  onCaptionChange: (index: number, caption: string) => void
  onRemove: (index: number) => void
  onCancel: () => void
  onSend: () => void
}) {
  const { t } = useTranslation()
  const current = items[index]

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel()
      if (event.key === "ArrowRight") onIndexChange(Math.min(index + 1, items.length - 1))
      if (event.key === "ArrowLeft") onIndexChange(Math.max(index - 1, 0))
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [index, items.length, onCancel, onIndexChange])

  if (!current) return null

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9600,
        background: "#000000ee",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {current.file.name}
          {items.length > 1 && (
            <span style={{ opacity: 0.6, fontWeight: 400 }}>
              {" "}
              — {index + 1}/{items.length}
            </span>
          )}
        </span>
        <button
          onClick={onCancel}
          aria-label={t("thr_cancel_send")}
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.85)",
            cursor: "pointer",
            fontSize: 22,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 18px",
        }}
      >
        <div style={{ width: "min(100%, 820px)" }}>
          <FullMediaPreview
            subject={{
              url: current.url,
              name: current.file.name,
              mime: current.mime,
              kind: current.kind,
              // Meme fonction que le message confirme par le serveur : sans
              // elle, la meme piece jointe s'ecrivait « 8.0 Mo » a l'envoi puis
              // « 8.0 MB » apres confirmation, dans le meme fil.
              note: formatBytes(current.file.size),
            }}
          />
        </div>
      </div>

      {items.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 18px",
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          {items.map((item, i) => (
            <div key={item.url} style={{ position: "relative", flexShrink: 0 }}>
              <button
                onClick={() => onIndexChange(i)}
                aria-label={t("f2_view_named", { nom: item.file.name })}
                aria-current={i === index}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 8,
                  cursor: "pointer",
                  padding: 0,
                  overflow: "hidden",
                  border: i === index ? "2px solid var(--accent)" : "2px solid transparent",
                  background: "#ffffff14",
                }}
              >
                {item.kind === "image" ? (
                  <img
                    src={item.url}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : item.kind === "video" ? (
                  <video
                    src={`${item.url}#t=0.1`}
                    preload="metadata"
                    muted
                    playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 8,
                      fontWeight: 800,
                      color: fileTypeInfo(item.file.name, item.mime).color,
                    }}
                  >
                    {fileTypeInfo(item.file.name, item.mime).label}
                  </span>
                )}
              </button>
              <button
                onClick={() => onRemove(i)}
                aria-label={t("set_remove_named", { nom: item.file.name })}
                style={{
                  position: "absolute",
                  top: -5,
                  right: -5,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: "none",
                  background: "#000000cc",
                  color: "#fff",
                  fontSize: 11,
                  lineHeight: 1,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 10,
          padding: "12px 18px 18px",
          flexShrink: 0,
        }}
      >
        <textarea
          value={current.caption}
          onChange={(e) => onCaptionChange(index, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder={t("add_caption")}
          rows={1}
          style={{
            flex: 1,
            minWidth: 0,
            resize: "none",
            maxHeight: 96,
            padding: "11px 14px",
            borderRadius: 20,
            border: "1px solid #ffffff25",
            background: "#ffffff12",
            color: "#fff",
            fontSize: 14,
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button
          onClick={onSend}
          aria-label={t("send")}
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-text)",
            cursor: "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/**
 * Un vocal enregistre dans l'application, par opposition a un fichier audio
 * importe depuis le telephone.
 *
 * L'enregistreur nomme ses envois `vocal-<horodatage>.<extension>` ; c'est le
 * seul marqueur qui survive a l'aller-retour serveur, le backend ne transportant
 * que le nom de fichier et le type MIME. Un vocal venu du mobile, ou un media
 * sans nom, tombe aussi dans ce cas — c'est le comportement voulu : il n'y a rien
 * d'utile a afficher.
 */
function isVoiceNote(msg: Message): boolean {
  return msg.type === "audio" && (!msg.fileName || /^vocal-\d+\./i.test(msg.fileName))
}

/** Un message cite merite une vignette des lors qu'il porte un fichier. */
function hasQuotedMedia(msg: Message): boolean {
  return (
    Boolean(msg.mediaUrl) ||
    msg.type === "image" ||
    msg.type === "video" ||
    msg.type === "audio" ||
    msg.type === "file" ||
    // Contact et position passent par le même chemin, non pour leur vignette
    // mais pour leur LIBELLÉ : sans cela, la branche `quote.content` afficherait
    // leur charge JSON telle quelle.
    msg.type === "contact" ||
    msg.type === "location"
  )
}

/**
 * Libellé d'un message cité, sur une ligne.
 *
 * ⚠️ Le libellé structuré passe AVANT le contenu : une fiche de contact ou une
 * position porte du JSON dans `content`, et une citation qui tient sur une
 * ligne afficherait `{"v":1,…}`.
 */
function quotedMediaLabel(msg: Message): string {
  const structure = apercuStructure(msg.type, msg.content ?? null)
  if (structure) return structure
  const caption = msg.content?.trim()
  if (caption) return caption
  if (msg.fileName) return msg.fileName
  if (msg.type === "image") return traduire(langueInitiale(), "photo")
  if (msg.type === "video") return traduire(langueInitiale(), "video_label")
  if (msg.type === "audio") return traduire(langueInitiale(), "voice_message")
  return traduire(langueInitiale(), "file")
}

/**
 * Vignette d'un media cite, facon WhatsApp : une vraie image des que le format
 * le permet, l'icone typee du fichier sinon.
 *
 * La vidéo s'appuie sur le fragment `#t=` plutot que sur un canvas : la
 * redirection vers Backblaze B2 est cross-origin, elle contaminerait le canvas
 * et interdirait d'en extraire l'image. Le PDF, lui, doit etre rendu ; quand
 * ses octets sont hors de portee, l'icone reste affichee.
 */
function QuoteThumbnail({ msg, size = 32 }: { msg: Message; size?: number }) {
  const { t } = useTranslation()
  const src = msg.mediaUrl ? resolveMediaUrl(msg.mediaUrl) : ""
  const mime = msg.mediaMime ?? ""
  const ext = (msg.fileName ?? "").split(".").pop()?.toLowerCase() ?? ""
  const isImage = msg.type === "image" || mime.startsWith("image/")
  const isVideo = msg.type === "video" || mime.startsWith("video/")
  const isPdf = mime === "application/pdf" || ext === "pdf"
  const [pdfThumb, setPdfThumb] = useState<string | null>(null)

  useEffect(() => {
    if (!isPdf || !src) return
    let cancelled = false
    void loadPdfThumbnail(src).then((dataUrl) => {
      if (!cancelled) setPdfThumb(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [isPdf, src])

  const box = {
    width: size,
    height: size,
    borderRadius: size > 48 ? 8 : 5,
    flexShrink: 0,
    display: "block",
  } as const

  if (isImage && src) return <img src={src} alt="" style={{ ...box, objectFit: "cover" }} />
  if (isVideo && src)
    return (
      <video
        src={videoPosterUrl(src)}
        preload="metadata"
        muted
        playsInline
        style={{ ...box, objectFit: "cover", background: "#000" }}
      />
    )
  if (isPdf && pdfThumb)
    return <img src={pdfThumb} alt="" style={{ ...box, objectFit: "cover", background: "#fff" }} />

  const fti = fileTypeInfo(msg.fileName, msg.mediaMime)

  // En grand (tuile d'album), un aplat de couleur se lit mal a cote d'une vraie
  // miniature : la tuile prend l'aspect d'une feuille, avec son icone, son type
  // et son nom.
  if (size > 48) {
    return (
      <div
        style={{
          ...box,
          background: "#fbfbfd",
          border: `1px solid ${fti.color}40`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          overflow: "hidden",
          padding: 6,
          boxSizing: "border-box",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke={fti.color}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span style={{ fontSize: 9, fontWeight: 800, color: fti.color, letterSpacing: 0.5 }}>
          {fti.label}
        </span>
        {msg.fileName && (
          <span
            style={{
              fontSize: 8,
              lineHeight: 1.25,
              color: "#4a5058",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {msg.fileName}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        ...box,
        background: `${fti.color}20`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <span style={{ fontSize: 8, fontWeight: 800, color: fti.color, letterSpacing: 0.4 }}>
        {fti.label}
      </span>
    </div>
  )
}

/** Fil unifie : messages, lots de medias et evenements d'appel, tries par date. */
type TimelineItem =
  | { kind: "msg"; ts: Date; msg: Message }
  | { kind: "album"; ts: Date; msgs: Message[] }
  | { kind: "call"; ts: Date; call: CallRecord }

/** Fenetre pendant laquelle des medias successifs sont consideres comme un meme envoi. */
const ALBUM_WINDOW_MS = 60_000

/**
 * Un media regroupable. Le protocole ne transporte qu'un mediaId par message :
 * un envoi multiple arrive donc en N messages, ici comme depuis le mobile. Le
 * regroupement se fait a l'affichage, ce qui vaut aussi pour l'historique deja
 * recu.
 *
 * Une citation exclut le message du lot : elle ne survivrait pas a la mise en
 * grille. Une legende, si, a condition qu'il n'y en ait qu'une dans le lot :
 * c'est exactement ce que fait le mobile, ou un envoi multiple est un seul
 * message portant plusieurs medias et une legende unique. Depuis l'ecran de
 * confirmation avant envoi, chaque fichier peut porter sa legende, et exiger
 * qu'aucune ne soit remplie faisait perdre le groupement des envois recents.
 */
function isAlbumCandidate(msg: Message): boolean {
  return (
    !msg.isDeleted &&
    !msg.replyTo &&
    Boolean(msg.mediaUrl) &&
    (msg.type === "image" || msg.type === "video" || msg.type === "file")
  )
}

/** Fusionne les suites de medias d'un meme expediteur envoyes coup sur coup. */
function groupMediaRuns(items: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = []
  let run: Message[] = []

  const flush = () => {
    // Un media isole reste une bulle ordinaire : une grille d'un seul element
    // n'apporterait rien et retirerait son apercu au message.
    // Deux legendes differentes dans un meme lot ne tiennent pas sous une seule
    // grille : on prefere alors ne pas grouper plutot que d'en perdre une.
    const captions = run.map((m) => m.content?.trim()).filter(Boolean)
    if (run.length >= 2 && captions.length <= 1)
      out.push({ kind: "album", ts: run[0].timestamp, msgs: run })
    else run.forEach((m) => out.push({ kind: "msg", ts: m.timestamp, msg: m }))
    run = []
  }

  for (const item of items) {
    if (item.kind === "msg" && isAlbumCandidate(item.msg)) {
      const last = run[run.length - 1]
      const sameSender = !last || last.senderId === item.msg.senderId
      const closeEnough = !last || item.ts.getTime() - last.timestamp.getTime() <= ALBUM_WINDOW_MS
      if (sameSender && closeEnough) {
        run.push(item.msg)
        continue
      }
      flush()
      run.push(item.msg)
      continue
    }
    flush()
    out.push(item)
  }
  flush()
  return out
}

/** Au-dela, la grille montre « +N » sur la derniere tuile plutot que de s'etendre. */
const ALBUM_VISIBLE_TILES = 4

/** Grille d'un lot de medias, facon WhatsApp : un seul cadre pour tout l'envoi. */
function MediaAlbumGrid({ msgs, onOpen }: { msgs: Message[]; onOpen: (index: number) => void }) {
  const { t } = useTranslation()
  const visible = msgs.slice(0, ALBUM_VISIBLE_TILES)
  const hidden = msgs.length - visible.length
  // Deux tuiles tiennent cote a cote ; trois ou plus passent en carre.
  const columns = visible.length === 2 ? 2 : visible.length === 3 ? 3 : 2
  const tile = visible.length === 2 ? 108 : visible.length === 3 ? 88 : 108

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, ${tile}px)`,
        gap: 3,
        marginBottom: 6,
      }}
    >
      {visible.map((item, index) => (
        <button
          key={item.id}
          onClick={(e) => {
            e.stopPropagation()
            onOpen(index)
          }}
          aria-label={t("f2_open_media_position", {
            nom: item.fileName ?? t("the_media"),
            index: index + 1,
            total: msgs.length,
          })}
          style={{
            position: "relative",
            padding: 0,
            border: "none",
            background: "#00000018",
            borderRadius: 8,
            overflow: "hidden",
            cursor: "zoom-in",
            width: tile,
            height: tile,
          }}
        >
          <QuoteThumbnail msg={item} size={tile} />
          {(item.mediaMime ?? "").startsWith("video/") && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffffe0" stroke="none">
                <polygon points="7 4 20 12 7 20 7 4" />
              </svg>
            </span>
          )}
          {index === visible.length - 1 && hidden > 0 && (
            <span
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#000000a8",
                color: "#fff",
                fontSize: 20,
                fontWeight: 700,
                pointerEvents: "none",
              }}
            >
              +{hidden}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * Faut-il proposer spontanement la traduction d'un message ?
 *
 * Quand le navigateur sait detecter une langue, on n'affiche le bouton que sur
 * une certitude — langue reconnue et differente de celle de lecture — sinon un
 * « ok » de trois lettres, indetectable, porterait un bouton inutile sous
 * chaque bulle.
 *
 * Quand il ne sait pas detecter (Firefox, Safari, mobile), le doute profite a
 * l'utilisateur : sans cela la fonction serait tout simplement introuvable chez
 * lui. L'entree du menu du message, elle, reste toujours disponible.
 */
async function traductionAProposer(texte: string, cible: string): Promise<boolean> {
  // Teste avant toute chose : sans moteur, la reponse est la meme pour tout le
  // monde, et calculer une empreinte puis interroger IndexedDB par bulle pour
  // l'apprendre reviendrait a payer un cout certain pour un resultat connu.
  if (!moteurLocalPresent()) return true
  const source = await detecterLangueMessage(texte)
  return source ? source !== cible : false
}

function MessageBubble({
  msg,
  isMe,
  replyMsg,
  onReply,
  onQuickReply,
  onOpenImage,
  onDelete,
  onForward,
  onCopy,
  isGroup,
  senderName,
  quoteAuthor,
  onJumpToMessage,
  albumMsgs,
  onOpenAlbum,
  autoTraduction,
}: {
  msg: Message
  isMe: boolean
  replyMsg?: Message
  onReply: (m: Message) => void
  onQuickReply?: (text: string, replyToMsg?: Message) => void
  onOpenImage: (url: string, name?: string) => void
  onDelete: (m: Message, scope: "me" | "everyone") => void
  onForward: (m: Message) => void
  onCopy: (m: Message) => void
  isGroup?: boolean
  senderName?: string
  /** Nom de l'auteur du message cite, affiche en tete du bloc de citation. */
  quoteAuthor?: string
  onJumpToMessage?: (messageId: string) => void
  /** Lot de medias envoyes ensemble : la bulle affiche une grille au lieu d'un media. */
  albumMsgs?: Message[]
  onOpenAlbum?: (index: number) => void
  /** Traduction automatique active pour cette discussion (reglage par appareil). */
  autoTraduction: boolean
}) {
  // Les actions n'apparaissent pas au survol immediat : le bouton surgissait
  // dans la rangee et decalait la bulle a chaque passage de souris. Il est
  // desormais hors du flux (position absolue) et se revele soit au clic sur le
  // message — immediatement, sans transition — soit apres un survol prolonge,
  // en fondu.
  const [actionsReveal, setActionsReveal] = useState<"instant" | "fade" | null>(null)
  const actionsVisible = actionsReveal !== null
  const hoverRevealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Les messages systeme se composent dans la langue du lecteur ; `language`
  // est aussi la langue CIBLE de la traduction d'un message.
  const { t, language } = useTranslation()
  /** Le menu deroulant s'ouvre vers le haut sauf s'il n'y a pas la place. */
  const [menuAbove, setMenuAbove] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const messageMenuRef = useRef<HTMLDivElement>(null)
  const [dragX, setDragX] = useState(0)
  const [viewingDoc, setViewingDoc] = useState<{
    url: string
    name?: string
    mime?: string
  } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const lastPreviewTapRef = useRef(0)
  const dragStart = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false })

  // --- Traduction du message ---
  /**
   * Tout texte ECRIT PAR UN HUMAIN est traduisible, quel que soit le type de
   * message : le texte d'une bulle, mais aussi la legende d'une photo, d'une
   * video, d'un vocal ou d'un document. `content` porte les deux — c'est le
   * texte pour un message texte, la legende pour un media — et une legende en
   * russe sous une photo est exactement le cas ou l'on a besoin de traduire.
   *
   * Deux exclusions, et elles sont de nature differente :
   *
   *  - les messages SYSTEME, deja composes dans la langue du lecteur : les
   *    traduire ferait un aller-retour pour retomber sur le meme texte ;
   *  - les COORDONNEES d'un message de position, retirees du texte soumis.
   *    « 4.0511, 9.7679 » n'a pas de traduction, et le moteur facturerait un
   *    appel pour rendre les memes chiffres. Ce qui accompagne les coordonnees,
   *    lui, se traduit — d'ou un retrait plutot qu'un rejet du message entier.
   */
  const texteATraduire = useMemo(() => {
    if (msg.isDeleted || msg.type === "system") return ""
    const brut = (msg.content ?? "").trim()
    if (!brut) return ""
    const prose = extractGpsCoords(brut) ? removeGpsCoordinates(brut) : brut
    return prose.trim()
  }, [msg.isDeleted, msg.type, msg.content])
  const [traductionOuverte, setTraductionOuverte] = useState(false)
  const [traductionProposee, setTraductionProposee] = useState(false)
  /**
   * En mode automatique la bulle n'attend aucun geste : le bloc s'ouvre seul,
   * et les boutons disparaissent puisqu'ils n'ont plus rien a declencher. Ses
   * propres messages restent hors sujet — on ecrit dans sa langue.
   */
  const traductionAutomatique = autoTraduction && !isMe && texteATraduire !== ""
  const blocTraductionVisible = traductionAutomatique || traductionOuverte

  useEffect(() => {
    // Sonder la langue de ses propres messages n'apprendrait rien : on ecrit
    // dans la sienne. En automatique, le bouton n'existe pas : sonder la langue
    // pour decider de l'afficher serait une depense sans objet.
    if (!texteATraduire || isMe || autoTraduction) {
      setTraductionProposee(false)
      return
    }
    let vivant = true
    void traductionAProposer(texteATraduire, language)
      .then((utile) => {
        if (vivant) setTraductionProposee(utile)
      })
      .catch(() => undefined)
    return () => {
      vivant = false
    }
  }, [texteATraduire, isMe, language, autoTraduction])

  // Identifiant servant a colorer la citation (meme palette que les noms en groupe),
  // pour que la barre laterale rappelle l'auteur du message cite.
  const quotedAuthorKey = msg.replySnapshot?.senderId ?? replyMsg?.senderId ?? msg.senderId

  // Apercu du message cite : snapshot backend en priorite, sinon lookup local.
  const quote = msg.replySnapshot
    ? {
        content: msg.replySnapshot.isDeleted
          ? t("message_deleted")
          : msg.replySnapshot.content || t("f2_media_tag"),
      }
    : replyMsg
      ? { content: replyMsg.content || t("f2_media_tag") }
      : undefined

  // Pendant un glisser-pour-repondre, la fleche occupe la meme place que le
  // bouton d'actions : on masque ce dernier le temps du geste.
  const actionsShown = (actionsVisible || menuOpen) && dragX === 0

  const mediaSrc = msg.mediaUrl ? resolveMediaUrl(msg.mediaUrl) : ""
  const isVideoFile = (msg.mediaMime ?? "").startsWith("video/")
  const canExpandMedia = Boolean(mediaSrc) && !msg.isDeleted
  // La legende d'un lot vit sur l'un de ses messages, pas forcement le premier.
  // Le regroupement garantit qu'il n'y en a qu'une : la premiere trouvee est
  // donc bien celle du lot.
  const albumCaption = albumMsgs?.map((item) => item.content?.trim()).find(Boolean) ?? ""

  // --- Swipe-to-reply (pointeur / tactile) ---
  const onPointerDown = (e: React.PointerEvent) => {
    if (msg.isDeleted) return
    dragStart.current = { x: e.clientX, y: e.clientY, active: true }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current.active) return
    const dx = e.clientX - dragStart.current.x
    const dy = Math.abs(e.clientY - dragStart.current.y)
    if (dy > 40) {
      dragStart.current.active = false
      setDragX(0)
      return
    }
    // On glisse vers la droite (messages recus) ou la gauche (mes messages).
    const directional = isMe ? Math.min(0, dx) : Math.max(0, dx)
    setDragX(Math.max(-90, Math.min(90, directional)))
  }
  const endDrag = () => {
    if (!dragStart.current.active) return
    dragStart.current.active = false
    if (Math.abs(dragX) >= SWIPE_REPLY_THRESHOLD) onReply(msg)
    setDragX(0)
  }

  const cancelHoverReveal = () => {
    if (hoverRevealTimer.current) {
      clearTimeout(hoverRevealTimer.current)
      hoverRevealTimer.current = null
    }
  }

  const cancelHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }

  /** Survol prolonge : on ne revele qu'au bout du delai, pour ne rien faire bouger au passage. */
  const scheduleHoverReveal = () => {
    cancelHide()
    if (msg.isDeleted || actionsVisible) return
    cancelHoverReveal()
    hoverRevealTimer.current = setTimeout(() => setActionsReveal("fade"), ACTIONS_HOVER_DELAY_MS)
  }

  /** Clic / clic droit : affichage immediat, sans fondu. */
  const revealActionsNow = () => {
    if (msg.isDeleted) return
    cancelHoverReveal()
    cancelHide()
    setActionsReveal("instant")
  }

  /**
   * Sortie du message : on laisse un court sursis avant de masquer, sinon le
   * bouton disparait pendant que la souris se deplace vers lui — impossible a
   * cliquer. Tant que le menu deroulant est ouvert, on ne masque jamais.
   */
  const scheduleHide = () => {
    cancelHoverReveal()
    if (menuOpen) return
    cancelHide()
    hideTimer.current = setTimeout(() => setActionsReveal(null), ACTIONS_HIDE_GRACE_MS)
  }

  useEffect(
    () => () => {
      cancelHoverReveal()
      cancelHide()
    },
    []
  )

  // Positionnement intelligent : le menu s'ouvre vers le bas quand il n'y a pas
  // la place au-dessus (message tout en haut du fil), pour ne jamais sortir de
  // la zone de lecture.
  useEffect(() => {
    if (!menuOpen) return
    const anchor = messageMenuRef.current
    if (!anchor) return
    const limit = anchor.closest(".room-body")?.getBoundingClientRect().top ?? 0
    setMenuAbove(anchor.getBoundingClientRect().top - ACTIONS_MENU_HEIGHT > limit)
  }, [menuOpen])

  // Même comportement que Telegram : ferme le menu d'actions dès que l'on tape/click ailleurs.
  useEffect(() => {
    if (!menuOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (messageMenuRef.current && !messageMenuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
        // La souris est peut-etre deja loin du message : sans ca, le bouton
        // resterait affiche faute d'un futur mouseleave.
        hideTimer.current = setTimeout(() => setActionsReveal(null), ACTIONS_HIDE_GRACE_MS)
      }
    }
    document.addEventListener("pointerdown", closeOutside)
    return () => document.removeEventListener("pointerdown", closeOutside)
  }, [menuOpen])

  const openExpandedPreview = () => {
    if (mediaSrc) setViewingDoc({ url: mediaSrc, name: msg.fileName, mime: msg.mediaMime })
  }
  const downloadAudio = () => {
    if (!mediaSrc) return
    const link = document.createElement("a")
    link.href = msg.mediaUrl ? resolveMediaUrl(msg.mediaUrl, { download: true }) : mediaSrc
    link.download = msg.fileName ?? "audio"
    link.rel = "noreferrer"
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const onPreviewPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return
    const now = Date.now()
    if (now - lastPreviewTapRef.current < 320) {
      event.preventDefault()
      openExpandedPreview()
      lastPreviewTapRef.current = 0
    } else {
      lastPreviewTapRef.current = now
    }
  }

  const menuItem = (label: string, onClick: () => void, danger = false) => (
    <button
      key={label}
      onClick={() => {
        setMenuOpen(false)
        onClick()
      }}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 14px",
        background: "none",
        border: "none",
        color: danger ? "var(--danger)" : "var(--text-primary)",
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "'DM Sans', sans-serif",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  )

  if (msg.type === "system") {
    // Le serveur enregistre un code et ses parametres, pas une phrase : le
    // texte se compose ici, dans la langue du lecteur, et selon qu'il est
    // concerne ou non. Une charge vide ne merite pas de bulle.
    const texteSysteme = composerMessageSysteme(msg.content, getMyUserId(), t)
    if (!texteSysteme) return null
    return (
      <div style={{ display: "flex", justifyContent: "center", margin: "10px 0" }}>
        <div
          style={{
            maxWidth: "82%",
            padding: "6px 12px",
            borderRadius: 14,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-muted)",
            textAlign: "center",
            fontSize: 11,
            lineHeight: 1.35,
          }}
        >
          {texteSysteme}
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: isMe ? "flex-end" : "flex-start",
          marginBottom: 2,
        }}
        onMouseEnter={scheduleHoverReveal}
        onMouseLeave={scheduleHide}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            flexDirection: isMe ? "row-reverse" : "row",
            // La limite de largeur vit ICI (le parent fait 100% de la colonne) :
            // un % sur un enfant d'une rangee auto-dimensionnee ecrase la bulle
            // a sa largeur minimale (une lettre par ligne).
            maxWidth: "min(78%, 560px)",
            transform: dragX ? `translateX(${dragX}px)` : undefined,
            // Le message s'ecarte du bord pour laisser la place au bouton d'actions :
            // celui-ci reste ainsi TOUJOURS dans le cadre, jamais hors de l'ecran.
            marginRight: isMe && actionsShown ? ACTIONS_GUTTER : 0,
            marginLeft: !isMe && actionsShown ? ACTIONS_GUTTER : 0,
            transition: dragStart.current.active
              ? "none"
              : "transform 0.18s ease, margin 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
            touchAction: "pan-y",
            position: "relative",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={revealActionsNow}
          onContextMenu={(e) => {
            if (msg.isDeleted) return
            e.preventDefault()
            revealActionsNow()
            setMenuOpen((v) => !v)
          }}
        >
          {/* Indicateur de swipe */}
          {Math.abs(dragX) > 16 && (
            <div
              style={{
                position: "absolute",
                [isMe ? "right" : "left"]: -34,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--accent)",
                opacity: Math.min(1, Math.abs(dragX) / SWIPE_REPLY_THRESHOLD),
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <polyline points="9 17 4 12 9 7" />
                <path d="M20 18v-2a4 4 0 00-4-4H4" />
              </svg>
            </div>
          )}

          {/* Menu actions — hors du flux : son apparition ne pousse jamais la bulle. */}
          {!msg.isDeleted && (
            <div
              ref={messageMenuRef}
              onMouseEnter={cancelHide}
              onMouseLeave={scheduleHide}
              style={{
                position: "absolute",
                // Cote exterieur de la bulle. La gouttiere ouverte par la marge du
                // message ci-dessus garantit qu'il reste dans le cadre.
                [isMe ? "right" : "left"]: -ACTIONS_GUTTER,
                top: "50%",
                opacity: actionsShown ? 1 : 0,
                transform: `translateY(-50%) scale(${actionsShown ? 1 : 0.85})`,
                pointerEvents: actionsShown ? "auto" : "none",
                // Clic : apparition instantanee. Survol prolonge : fondu doux.
                transition:
                  actionsReveal === "instant" ? "none" : "opacity .18s ease, transform .18s ease",
                zIndex: 20,
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen((v) => !v)
                }}
                aria-label={t("message_actions")}
                aria-hidden={!actionsShown}
                tabIndex={actionsShown ? 0 : -1}
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 8,
                  padding: "4px 7px",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  cursor: "pointer",
                  lineHeight: 1,
                  boxShadow: "0 2px 8px #00000024",
                  transition: "background .15s ease, color .15s ease",
                }}
              >
                ⋮
              </button>
              {menuOpen && (
                <div
                  style={{
                    position: "absolute",
                    ...(menuAbove ? { bottom: "110%" } : { top: "110%" }),
                    [isMe ? "right" : "left"]: 0,
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 10,
                    boxShadow: "0 12px 32px #00000060",
                    zIndex: 50,
                    padding: "4px 0",
                    minWidth: 170,
                  }}
                >
                  {menuItem(t("reply"), () => onReply(msg))}
                  {msg.content ? menuItem(t("copy"), () => onCopy(msg)) : null}
                  {/* Toujours proposee quand la traduction se fait a la demande,
                    meme si le bouton sous la bulle ne l'est pas : la detection
                    peut se tromper ou n'exister nulle part, l'action doit rester
                    joignable. En automatique elle disparait — la traduction est
                    deja sous les yeux, l'entree ne ferait que repeter l'etat. */}
                  {texteATraduire && !traductionAutomatique
                    ? menuItem(traductionOuverte ? t("thr_trad_hide") : t("thr_trad_action"), () =>
                        setTraductionOuverte((ouverte) => !ouverte)
                      )
                    : null}
                  {/* Sur un lot, « Agrandir » ouvre la galerie : le menu porte sur la
                    grille entiere, pas sur son premier fichier. */}
                  {albumMsgs && onOpenAlbum
                    ? menuItem(t("f2_enlarge"), () => onOpenAlbum(0))
                    : canExpandMedia
                      ? menuItem(t("f2_enlarge"), openExpandedPreview)
                      : null}
                  {msg.type === "audio" && mediaSrc
                    ? menuItem(t("download_audio"), downloadAudio)
                    : null}
                  {menuItem(t("forward"), () => onForward(msg))}
                  {menuItem(t("delete_for_me"), () => onDelete(msg, "me"), true)}
                  {isMe
                    ? menuItem(t("delete_for_all"), () => onDelete(msg, "everyone"), true)
                    : null}
                </div>
              )}
            </div>
          )}

          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {/* Pseudo de l'appareil emetteur.
                Le serveur ne le met dans la charge que pour les appareils du
                MEME compte : le recevoir suffit a avoir le droit de l'afficher,
                il n'y a rien a filtrer ici. En tete-a-tete c'est la seule ligne
                au-dessus de la bulle ; en groupe elle vient en complement du
                nom complet, deja affiche pour tout le monde. */}
            {/* Le pseudo ne s'affiche PAS sur cet appareil pour ses propres
                messages : il sait deja qui il est. Il sert aux AUTRES appareils
                du compte, pour savoir qui dans l'equipe a repondu. Les autres
                comptes ne recoivent meme pas le champ. */}
            {msg.nomAgent && msg.appareilId !== appareilCourantId() && !msg.isDeleted && (
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 0.2,
                  color: "var(--agent-name)",
                  padding: "2px 4px 0",
                  textAlign: isMe ? "right" : "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={t("f2_sent_from", { nom: msg.nomAgent })}
              >
                {msg.nomAgent}
              </div>
            )}
            {/* Nom de l'envoyeur en groupe (pas pour soi-meme) */}
            {isGroup && !isMe && senderName && !msg.isDeleted && (
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--agent-name)",
                  marginBottom: 2,
                  padding: "2px 4px 0",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {senderName}
              </div>
            )}
            {/* Bulle */}
            <div
              data-message-id={msg.id}
              style={{
                background: isMe ? "var(--bubble-me-bg)" : "var(--bubble-them-bg)",
                color: isMe ? "var(--bubble-me-text)" : "var(--bubble-them-text)",
                border: isMe ? "none" : "1px solid var(--bubble-them-border)",
                boxShadow: "0 1px 1px rgba(0, 0, 0, 0.06)",
                padding: msg.type === "image" && mediaSrc ? 4 : "6px 9px 5px",
                borderRadius: isMe ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                fontSize: 13.5,
                lineHeight: 1.4,
                wordBreak: "break-word",
                // flow-root : contient l'heure flottante facon WhatsApp
                display: "flow-root",
              }}
            >
              {/* Citation — DANS la bulle, comme sur WhatsApp : le message cite et la
                reponse forment un seul bloc, relies par la barre laterale coloree. */}
              {quote && !msg.isDeleted && (
                <div
                  onClick={(event) => {
                    const originId = msg.replyTo
                    if (!originId || !onJumpToMessage) return
                    event.stopPropagation()
                    onJumpToMessage(originId)
                  }}
                  role={msg.replyTo && onJumpToMessage ? "button" : undefined}
                  title={msg.replyTo && onJumpToMessage ? t("go_to_original") : undefined}
                  style={{
                    display: "flex",
                    borderRadius: 6,
                    overflow: "hidden",
                    background: isMe ? "rgba(0, 0, 0, 0.14)" : "var(--border-subtle)",
                    marginBottom: 5,
                    cursor: msg.replyTo && onJumpToMessage ? "pointer" : "default",
                    maxWidth: "100%",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 4,
                      flexShrink: 0,
                      background: isMe ? "var(--bubble-me-text)" : senderNameColor(quotedAuthorKey),
                      opacity: isMe ? 0.7 : 1,
                    }}
                  />
                  <div style={{ padding: "5px 9px", minWidth: 0, flex: 1 }}>
                    {quoteAuthor && (
                      <div
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          lineHeight: 1.3,
                          marginBottom: 1,
                          color: isMe ? "var(--bubble-me-text)" : senderNameColor(quotedAuthorKey),
                          opacity: isMe ? 0.92 : 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {quoteAuthor}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 12,
                        lineHeight: 1.35,
                        color: "inherit",
                        opacity: 0.75,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {replyMsg && hasQuotedMedia(replyMsg) ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <QuoteThumbnail msg={replyMsg} />
                          <span
                            style={{
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {quotedMediaLabel(replyMsg)}
                          </span>
                        </div>
                      ) : (
                        <span>{quote.content}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {msg.isDeleted ? (
                <span style={{ fontStyle: "italic", opacity: 0.65, fontSize: 12 }}>
                  {t("message_deleted")}
                </span>
              ) : albumMsgs ? (
                // Lot envoye d'un bloc : une seule grille, comme sur WhatsApp. Le
                // reste de la bulle (menu, glisser-pour-repondre, heure, statut)
                // reste celui d'un message ordinaire.
                <>
                  <MediaAlbumGrid msgs={albumMsgs} onOpen={onOpenAlbum ?? (() => {})} />
                  {albumCaption && (
                    <span style={{ display: "block", marginTop: 5 }}>{albumCaption}</span>
                  )}
                </>
              ) : (
                <>
                  {msg.type === "image" && mediaSrc && (
                    <img
                      src={mediaSrc}
                      alt={msg.fileName ?? t("f2_image")}
                      onClick={() => onOpenImage(mediaSrc, msg.fileName)}
                      style={{
                        width: "100%",
                        maxWidth: 280,
                        height: "auto",
                        maxHeight: 320,
                        objectFit: "contain",
                        boxSizing: "border-box",
                        borderRadius: 12,
                        display: "block",
                        cursor: "zoom-in",
                      }}
                    />
                  )}

                  {msg.type === "audio" && mediaSrc && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <AudioPlayer src={mediaSrc} durationMs={msg.durationMs} isMe={isMe} />
                        {/* Un vocal n'a plus de ligne d'informations sous lui : le
                          bouton de telechargement, jusqu'ici cache dans le menu
                          du message, devient donc visible. */}
                        {isVoiceNote(msg) && (
                          <button
                            onClick={downloadAudio}
                            aria-label={t("download_audio")}
                            title={t("download")}
                            style={{
                              width: 26,
                              height: 26,
                              flexShrink: 0,
                              borderRadius: "50%",
                              border: "none",
                              cursor: "pointer",
                              background: isMe ? "#ffffff24" : "var(--accent-dim)",
                              color: isMe ? "#fff" : "var(--accent)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                            >
                              <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {/* Un fichier audio importe reste identifiable par son nom et
                        sa taille. Un vocal, non : sa duree est deja affichee par
                        le lecteur, et son nom est un horodatage sans interet. */}
                      {!isVoiceNote(msg) && msg.fileName && (
                        <div
                          style={{
                            marginTop: 5,
                            fontSize: 10,
                            opacity: 0.76,
                            display: "flex",
                            gap: 7,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: 170,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {msg.fileName}
                          </span>
                          {msg.fileSize && <span>{msg.fileSize}</span>}
                          <span>{formatAudioDuration(msg.durationMs)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {msg.type === "video" && mediaSrc && (
                    <VideoPreview
                      src={mediaSrc}
                      name={msg.fileName}
                      size={msg.fileSize}
                      durationMs={msg.durationMs}
                    />
                  )}

                  {msg.type === "file" && mediaSrc && isVideoFile && (
                    <VideoPreview
                      src={mediaSrc}
                      name={msg.fileName}
                      size={msg.fileSize}
                      durationMs={msg.durationMs}
                    />
                  )}

                  {msg.type === "file" &&
                    (!mediaSrc || !isVideoFile) &&
                    (() => {
                      const fti = fileTypeInfo(msg.fileName, msg.mediaMime)
                      const ext = (msg.fileName ?? "").split(".").pop()?.toLowerCase() ?? ""
                      const mime = msg.mediaMime ?? ""
                      // --- Preview du fichier ---
                      const filePreview = (() => {
                        // Même sans mediaSrc : afficher la carte d'aperçu (visible sur PC et mobile)
                        // Pour les images, PDF, CSV, DOC avec URL : on affiche le preview natif
                        const isImageFile =
                          mediaSrc &&
                          (mime.startsWith("image/") ||
                            ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext))
                        const isPdfFile = mediaSrc && (ext === "pdf" || mime === "application/pdf")
                        const isTextOrCodeFile =
                          mediaSrc &&
                          (TEXT_PREVIEW_EXTENSIONS.includes(ext) || mime.startsWith("text/"))
                        const isDocFile =
                          mediaSrc &&
                          (["doc", "docx"].includes(ext) || mime.includes("word")) &&
                          !mediaSrc.startsWith("blob:")
                        const isSpreadsheetFile =
                          mediaSrc &&
                          (["xls", "xlsx", "ods", "numbers"].includes(ext) ||
                            mime.includes("spreadsheet") ||
                            mime.includes("excel")) &&
                          !mediaSrc.startsWith("blob:")
                        const isPresentationFile =
                          mediaSrc &&
                          (["ppt", "pptx"].includes(ext) || mime.includes("presentation")) &&
                          !mediaSrc.startsWith("blob:")
                        const isVideoFileLocal =
                          mediaSrc &&
                          (ext === "mp4" ||
                            ext === "mov" ||
                            ext === "avi" ||
                            ext === "mkv" ||
                            ext === "webm" ||
                            mime.startsWith("video/"))

                        if (isImageFile) {
                          return (
                            <img
                              src={mediaSrc}
                              alt={msg.fileName ?? t("f2_image")}
                              style={{
                                maxWidth: "100%",
                                maxHeight: 220,
                                borderRadius: 10,
                                display: "block",
                                marginBottom: 6,
                                cursor: "zoom-in",
                              }}
                            />
                          )
                        }
                        if (isVideoFileLocal) {
                          return (
                            <video
                              src={mediaSrc}
                              controls
                              preload="metadata"
                              style={{
                                maxWidth: "100%",
                                maxHeight: 220,
                                borderRadius: 10,
                                display: "block",
                                marginBottom: 6,
                              }}
                            />
                          )
                        }
                        if (isPdfFile) {
                          return (
                            <LazyPreview minHeight={220}>
                              <div
                                style={{
                                  maxHeight: 220,
                                  overflow: "hidden",
                                  borderRadius: 10,
                                  marginBottom: 6,
                                }}
                              >
                                <PdfViewer url={mediaSrc} isMe={isMe} />
                              </div>
                            </LazyPreview>
                          )
                        }
                        if (isDocFile) {
                          return (
                            <OfficePreview
                              url={mediaSrc}
                              name={msg.fileName}
                              label="Word"
                              isMe={isMe}
                              height={200}
                              compact
                            />
                          )
                        }
                        if (isSpreadsheetFile) {
                          return (
                            <OfficePreview
                              url={mediaSrc}
                              name={msg.fileName}
                              label="Excel"
                              isMe={isMe}
                              height={200}
                              compact
                            />
                          )
                        }
                        if (isPresentationFile) {
                          return (
                            <OfficePreview
                              url={mediaSrc}
                              name={msg.fileName}
                              label="PowerPoint"
                              isMe={isMe}
                              height={200}
                              compact
                            />
                          )
                        }
                        if (isTextOrCodeFile) {
                          return (
                            <LazyPreview minHeight={180}>
                              <TextFilePreview url={mediaSrc} isMe={isMe} name={msg.fileName} />
                            </LazyPreview>
                          )
                        }

                        // Fallback : carte d'aperçu avec info, bouton Ouvrir/Télécharger, et cercle de chargement
                        return (
                          <a
                            href={mediaSrc ? mediaSrc : "#"}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => {
                              setDownloading(true)
                              setTimeout(() => setDownloading(false), 2500)
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "12px 14px",
                              borderRadius: 10,
                              marginBottom: 6,
                              background: isMe ? "#ffffff20" : "#f5f6fa",
                              border: `1px solid ${isMe ? "#ffffff35" : "#dde1e7"}`,
                              textDecoration: "none",
                              color: isMe ? "#fff" : "var(--text-primary)",
                              width: "100%",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                              position: "relative",
                            }}
                          >
                            {downloading && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: 4,
                                  right: 4,
                                  width: 12,
                                  height: 12,
                                  borderRadius: "50%",
                                  border: `2px solid ${isMe ? "rgba(255,255,255,0.3)" : "var(--border-subtle)"}`,
                                  borderTopColor: isMe ? "#fff" : "var(--accent)",
                                  animation: "spin 0.8s linear infinite",
                                }}
                              />
                            )}
                            <div
                              style={{
                                width: 48,
                                height: 48,
                                borderRadius: 10,
                                background: `${fti.color}18`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <svg
                                width="22"
                                height="22"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke={fti.color}
                                strokeWidth="2"
                                strokeLinecap="round"
                              >
                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {msg.fileName ?? msg.content ?? t("file")}
                              </div>
                              {msg.fileSize && (
                                <div style={{ fontSize: 10, opacity: 0.7 }}>{msg.fileSize}</div>
                              )}
                              {msg.fileSize && msg.fileName ? (
                                <div style={{ fontSize: 9, opacity: 0.7, marginTop: 1 }}>
                                  {t("f2_pages_approx", {
                                    n: estimatePages(msg.fileName, msg.fileSize),
                                  })}
                                </div>
                              ) : null}
                              <div
                                style={{
                                  fontSize: 9,
                                  opacity: 0.85,
                                  marginTop: 2,
                                  color: isMe ? "rgba(255,255,255,0.9)" : "var(--text-secondary)",
                                }}
                              >
                                {mediaSrc ? t("preview_click_open") : t("preview_after_load")}
                              </div>
                              {msg.status === "sending" && (
                                <div
                                  style={{
                                    marginTop: 4,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: 10,
                                    opacity: 0.8,
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 10,
                                      height: 10,
                                      borderRadius: "50%",
                                      border: `2px solid ${isMe ? "rgba(255,255,255,0.35)" : "var(--text-secondary)"}`,
                                      borderTopColor: isMe ? "#fff" : "var(--accent)",
                                      animation: "spin 0.8s linear infinite",
                                    }}
                                  />
                                  <span
                                    style={{
                                      color: isMe
                                        ? "rgba(255,255,255,0.9)"
                                        : "var(--text-secondary)",
                                    }}
                                  >
                                    {t("f2_sending_in_progress")}
                                  </span>
                                </div>
                              )}
                              <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    setViewingDoc({
                                      url: mediaSrc || msg.mediaUrl || "#",
                                      name: msg.fileName,
                                      mime: msg.mediaMime,
                                    })
                                    setDownloading(true)
                                    setTimeout(() => setDownloading(false), 2500)
                                  }}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: 6,
                                    border: "none",
                                    background: isMe ? "#ffffff25" : "var(--accent)",
                                    color: isMe ? "#fff" : "var(--accent-text)",
                                    fontSize: 10,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                  }}
                                >
                                  {t("f2_open")}
                                </button>
                                <a
                                  href={mediaSrc ? mediaSrc : "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setDownloading(true)
                                    setTimeout(() => setDownloading(false), 2500)
                                  }}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: 6,
                                    border: `1px solid ${isMe ? "#ffffff30" : "var(--border-default)"}`,
                                    background: "transparent",
                                    color: isMe ? "rgba(255,255,255,0.8)" : "var(--text-secondary)",
                                    fontSize: 10,
                                    fontWeight: 500,
                                    textDecoration: "none",
                                    display: "inline-block",
                                  }}
                                >
                                  {t("download")}
                                </a>
                              </div>
                            </div>
                          </a>
                        )
                      })()

                      return (
                        <>
                          <div
                            style={{
                              position: "relative",
                              cursor: canExpandMedia ? "zoom-in" : undefined,
                            }}
                            onDoubleClick={() => {
                              if (canExpandMedia) openExpandedPreview()
                            }}
                            onPointerUp={canExpandMedia ? onPreviewPointerUp : undefined}
                            title={canExpandMedia ? t("double_tap_zoom") : undefined}
                          >
                            {filePreview}
                          </div>
                          <a
                            href={
                              msg.mediaUrl ? resolveMediaUrl(msg.mediaUrl, { download: true }) : "#"
                            }
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              minWidth: 200,
                              color: "inherit",
                              textDecoration: "none",
                            }}
                          >
                            <div
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: 8,
                                background: `${fti.color}18`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                flexDirection: "column",
                                gap: 1,
                              }}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke={fti.color}
                                strokeWidth="2"
                                strokeLinecap="round"
                              >
                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                              <span
                                style={{
                                  fontSize: 7,
                                  fontWeight: 700,
                                  color: fti.color,
                                  letterSpacing: 0.5,
                                }}
                              >
                                {fti.label}
                              </span>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 500,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {msg.fileName ?? msg.content ?? t("file")}
                              </div>
                              {msg.fileSize && (
                                <div style={{ fontSize: 10, opacity: 0.7 }}>{msg.fileSize}</div>
                              )}
                            </div>
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            >
                              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                            </svg>
                          </a>
                        </>
                      )
                    })()}

                  {/* Fiche de contact et position : leur `content` est du JSON,
                    il ne doit JAMAIS passer par le rendu de texte ci-dessous. */}
                  {!msg.isDeleted && msg.type === "contact" && (
                    <ContactCard content={msg.content ?? null} isMe={isMe} />
                  )}
                  {!msg.isDeleted && msg.type === "location" && (
                    <LocationCard content={msg.content ?? null} isMe={isMe} />
                  )}

                  {/* Legende du media : elle accompagne aussi les documents et les
                    audios, sinon le texte saisi au moment de l'envoi serait perdu
                    a l'affichage. */}
                  {msg.content && msg.type !== "contact" && msg.type !== "location" && (
                    <span
                      style={
                        msg.type === "image"
                          ? { display: "block", padding: "6px 8px 4px" }
                          : msg.type === "file" || msg.type === "audio" || msg.type === "video"
                            ? { display: "block", marginTop: 5 }
                            : undefined
                      }
                    >
                      <RichText
                        text={(() => {
                          let cleanText = msg.content || ""
                          if (extractGpsCoords(cleanText)) cleanText = removeGpsCoordinates(cleanText)
                          if (!msg.isDeleted && /\[([^\]]+)\]/.test(cleanText)) {
                            cleanText = cleanText.replace(/\[([^\]]+)\]/g, "").trim()
                          }
                          return cleanText
                        })()}
                        isMe={isMe}
                      />
                      {(() => {
                        const gps = extractGpsCoords(msg.content)
                        return gps ? <GpsPreview lat={gps.lat} lng={gps.lng} isMe={isMe} /> : null
                      })()}
                      {(() => {
                        const buttonMatches = [...(msg.content || "").matchAll(/\[([^\]]+)\]/g)]
                        if (buttonMatches.length > 0 && !msg.isDeleted) {
                          return (
                            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {buttonMatches.map((m, idx) => (
                                <button
                                  key={idx}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (onQuickReply) onQuickReply(m[1], msg)
                                  }}
                                  style={{
                                    padding: "6px 12px",
                                    borderRadius: "16px",
                                    border: `1px solid ${isMe ? "rgba(255,255,255,0.4)" : "var(--accent)"}`,
                                    background: isMe ? "rgba(255,255,255,0.15)" : "rgba(181, 123, 99, 0.12)",
                                    color: isMe ? "#ffffff" : "var(--accent)",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                  }}
                                >
                                  {m[1]}
                                </button>
                              ))}
                            </div>
                          )
                        }
                        return null
                      })()}
                    </span>
                  )}
                </>
              )}

              {/* Traduction : sous le texte d'origine, dans la meme bulle. Le
                bloc n'existe que tant qu'il est ouvert — le refermer libere
                l'affichage sans rien garder en memoire, la traduction elle-meme
                etant deja au cache. */}
              {blocTraductionVisible && texteATraduire && (
                <MessageTranslation texte={texteATraduire} automatique={traductionAutomatique} />
              )}

              {/* Heure + coches a l'interieur de la bulle, en bas a droite (WhatsApp).
                float: right -> le texte court reste sur la meme ligne, le texte
                long passe au-dessus ; le parent en flow-root contient le flottant. */}
              {!msg.isDeleted && (
                <span
                  style={{
                    float: "right",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    marginLeft: 8,
                    transform: "translateY(4px)",
                    fontSize: 10,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    color: isMe ? "rgba(255, 255, 255, 0.75)" : "var(--text-faint)",
                  }}
                >
                  {/* « modifie » AVANT l'heure, et en italique, comme le
                    mobile : les deux clients doivent se lire pareil. Le `gap`
                    du parent suffit a l'espacer, rien a ajouter ici. */}
                  {msg.editedAt && (
                    <span style={{ fontStyle: "italic" }}>{t("thr_message_modifie")}</span>
                  )}
                  {formatTime(msg.timestamp)}
                  {isMe && <StatusIcon status={msg.status} />}
                </span>
              )}
            </div>
            {/* Bascule SOUS la bulle : elle ne prend pas de place dans le
              message et reste au meme endroit que la traduction soit affichee
              ou non. Elle survit a la fermeture du bloc pour qu'on puisse
              rouvrir sans repasser par le menu. */}
            {texteATraduire && !traductionAutomatique && (traductionProposee || traductionOuverte) && (
              <button
                type="button"
                className="msg-trad-bouton"
                style={{ alignSelf: isMe ? "flex-end" : "flex-start" }}
                onClick={(event) => {
                  event.stopPropagation()
                  setTraductionOuverte((ouverte) => !ouverte)
                }}
              >
                {traductionOuverte ? t("thr_trad_hide") : t("thr_trad_action")}
              </button>
            )}
          </div>
        </div>
      </div>
      {viewingDoc && (
        <DocumentViewer
          url={viewingDoc.url}
          name={viewingDoc.name}
          mime={viewingDoc.mime}
          isMe={isMe}
          onClose={() => setViewingDoc(null)}
        />
      )}
    </>
  )
}

export default function ChatRoomPage() {
  const params = useParams()
  const navigate = useNavigate()
  const chatId = params.chatId as string
  const returnTo = `/chats/${chatId}`
  const { error, success, info } = useToast()

  const contacts = useMemo(() => loadContacts(), [])
  const fallbackContact = useMemo(
    () => contacts.find((contact) => contact.id === chatId),
    [contacts, chatId]
  )
  const fallbackGroup = useMemo(() => findLocalGroup(chatId), [chatId])

  // Conversation chargee depuis le backend (GET /api/chats trouve par id)
  const [backendChat, setBackendChat] = useState<ConversationMock | null>(null)
  /**
   * Conversation avec SOI-MEME — le « Moi » ou l'on se garde des notes.
   *
   * Le drapeau vient du serveur et n'est pas recalcule ici : lui seul sait qu'une
   * conversation non-groupe a UN seul participant est la sienne, et une seconde
   * regle finirait par diverger de la sienne.
   *
   * Il sert a retirer les boutons d'APPEL : s'appeler soi-meme n'aboutirait a
   * rien, et proposer une action qui echoue est pire que ne rien proposer.
   */
  const cestMoiMeme = backendChat?.isSelf === true
  const [chatLoading, setChatLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setChatLoading(true)
    void fetchConversationById(chatId)
      .then((conv) => {
        if (!cancelled) setBackendChat(conv)
      })
      .catch(() => {
        if (!cancelled) setBackendChat(null)
      })
      .finally(() => {
        if (!cancelled) setChatLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chatId])

  const chat = useMemo(
    () =>
      // Priorite : backend d'abord, puis contact local, puis groupe local.
      backendChat ??
      (fallbackContact
        ? {
            id: fallbackContact.id,
            name: fallbackContact.name,
            initials: fallbackContact.initials,
            colorIdx: 0,
            online: fallbackContact.online,
            isGroup: false,
          }
        : undefined) ??
      (fallbackGroup ? toChatInfoMock(fallbackGroup) : undefined),
    [backendChat, fallbackContact, fallbackGroup]
  )

  const [messages, setMessages] = useState<Message[]>([])
  // Compteur des identifiants temporaires. Date.now() seul ne suffit pas :
  // plusieurs fichiers d'un meme envoi partiraient dans la meme milliseconde.
  const tempSeqRef = useRef(0)
  // Appels passes dans cette conversation, affiches dans le fil (facon WhatsApp)
  const [callEvents, setCallEvents] = useState<CallRecord[]>([])
  const [input, setInput] = useState("")
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  // typing de l'interlocuteur (recu via WebSocket)
  const [isTyping, setIsTyping] = useState(false)
  // Presence : le serveur temps reel diffuse { type: "presence" } et
  // GET /api/conversations porte deja isOnline. On garde le repli deduit de
  // l'activite reelle (message recu, frappe, lecture) quand le pair masque sa
  // presence ou que l'evenement n'est pas encore arrive.
  const [peerPresence, setPeerPresence] = useState<boolean | null>(null)
  const [lastPeerActivity, setLastPeerActivity] = useState<number | null>(null)
  const [presenceTick, setPresenceTick] = useState(0)
  const [sending, setSending] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [infoPanelOpen, setInfoPanelOpen] = useState(false)

  /**
   * Traduction automatique de cette discussion.
   *
   * Active par defaut, coupee discussion par discussion. L'initialisation est
   * paresseuse : `traductionAutoActive` touche `localStorage`, et le faire a
   * chaque rendu couterait une lecture synchrone par bulle affichee.
   */
  const [autoTraduction, setAutoTraduction] = useState(() => traductionAutoActive(chatId))
  // Changer de conversation sans remonter le composant doit relire le reglage
  // de la NOUVELLE conversation, sinon on herite de celui de la precedente.
  useEffect(() => {
    setAutoTraduction(traductionAutoActive(chatId))
  }, [chatId])
  // Le reglage se change desormais dans les informations de la conversation, un
  // composant qui n'est pas un ancetre de celui-ci : c'est l'evenement qui les
  // accorde. On relit plutot que de croire le detail transporte, pour que le fil
  // affiche toujours ce qui est REELLEMENT enregistre.
  useEffect(() => {
    const surChangement = () => setAutoTraduction(traductionAutoActive(chatId))
    window.addEventListener(EVENEMENT_TRADUCTION_AUTO, surChangement)
    return () => window.removeEventListener(EVENEMENT_TRADUCTION_AUTO, surChangement)
  }, [chatId])


  /**
   * Verrou de conversation, entre appareils d'un meme compte.
   *
   * L'etat initial vient de la conversation chargee : sans lui, l'ecran
   * s'ouvrirait deverrouille jusqu'au premier evenement temps reel et
   * laisserait croire une seconde qu'on peut ecrire.
   */
  const verrouInitial = useMemo(() => lireVerrou(chat?.lock), [chat?.lock])
  const { verrou, basculer: basculerVerrou } = useVerrou(chatId, verrouInitial)
  // Visionneuse d'image plein ecran
  const [lightbox, setLightbox] = useState<{ url: string; name?: string } | null>(null)
  /** Fichiers choisis mais pas encore envoyes : l'ecran de confirmation les porte. */
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([])
  const [pendingIndex, setPendingIndex] = useState(0)
  /** Lot de medias ouvert en galerie, avec la tuile par laquelle on y est entre. */
  const [gallery, setGallery] = useState<{ msgs: Message[]; index: number } | null>(null)
  // Message en cours de transfert (ouvre le selecteur de conversations)
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null)
  // Enregistrement vocal en cours
  const [recording, setRecording] = useState(false)
  const [recordSec, setRecordSec] = useState(0)

  const bottomRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  /**
   * Un echec de traduction automatique se dit UNE FOIS, en passant.
   *
   * Chaque bulle qui n'a pas pu etre traduite emet le meme signal ; l'ecrire sous
   * chacune remplissait le fil d'une ligne grise repetee, pour une information
   * qui ne varie pas. La notification disparait d'elle-meme : c'est un
   * renseignement, pas une decision a prendre.
   *
   * « Meme langue » n'entre pas ici. Ce n'est pas un echec : le message etait
   * deja lisible, il n'y avait rien a traduire, et l'annoncer reviendrait a
   * signaler un probleme la ou tout va bien.
   */
  const echecSignale = useRef<string | null>(null)
  useEffect(() => {
    echecSignale.current = null
  }, [chatId])
  useEffect(() => {
    const surEchec = (evenement: Event) => {
      const code = (evenement as CustomEvent<{ code: keyof typeof CLE_ERREUR }>).detail?.code
      if (!code || code === "meme-langue") return
      // Une fois par conversation et par cause : changer de moteur puis echouer
      // autrement est un fait nouveau, que l'utilisateur a interet a connaitre.
      if (echecSignale.current === code) return
      echecSignale.current = code
      info(t("thr_trad_auto_title"), t(CLE_ERREUR[code]))
    }
    window.addEventListener(EVENEMENT_ECHEC_AUTO, surEchec)
    return () => window.removeEventListener(EVENEMENT_ECHEC_AUTO, surEchec)
  }, [chatId, info, t])
  const messagesBodyRef = useRef<HTMLDivElement>(null)

  /**
   * Pagination de l'historique, en remontant.
   *
   * `olderExhausted` retient qu'on a atteint le debut de la conversation, pour ne
   * pas redemander indefiniment une page vide. Il n'est PAS leve par une erreur
   * reseau : dans ce cas on garde la possibilite de reessayer au prochain
   * defilement. `loadingOlderRef` protege du declenchement multiple, le
   * defilement emettant des dizaines d'evenements par seconde.
   */
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderExhausted, setOlderExhausted] = useState(false)
  const [olderError, setOlderError] = useState(false)
  const loadingOlderRef = useRef(false)
  // Evite que les refresh/previews renvoient l'utilisateur en bas pendant sa lecture.
  const isNearBottomRef = useRef(true)
  /**
   * Premier message arrive alors qu'on ne regardait PAS le bas du fil.
   *
   * C'est la frontiere du « non lu » : tout ce qui suit est arrive pendant
   * qu'on lisait ailleurs. On ne se fie pas au compteur de la liste des
   * conversations — il vaut pour la conversation entiere, pas pour la position
   * de lecture a l'instant present.
   */
  const [frontiereNonLus, setFrontiereNonLus] = useState<string | null>(null)
  /** Le bouton n'a de sens que si l'on s'est eloigne du bas. */
  const [loinDuBas, setLoinDuBas] = useState(false)
  const lastMessageIdRef = useRef<string | null>(null)
  /** La frontiere d'ouverture ne se pose qu'une fois par conversation. */
  const frontiereOuvertureFaiteRef = useRef(false)
  const initialScrollDoneRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const attachRef = useRef<HTMLDivElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout>>()
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordCancelledRef = useRef(false)

  // Fermeture Telegram : clic/tap hors du bouton et du menu. Le survol est géré
  // séparément pour les appareils ayant une souris.
  useEffect(() => {
    if (!showAttach) return
    const closeOutside = (event: PointerEvent) => {
      if (attachRef.current && !attachRef.current.contains(event.target as Node))
        setShowAttach(false)
    }
    document.addEventListener("pointerdown", closeOutside)
    return () => document.removeEventListener("pointerdown", closeOutside)
  }, [showAttach])

  /**
   * Fusionne un lot recu avec ce qui est deja affiche, au lieu de remplacer.
   *
   * Le remplacement d'origine effacait tout l'historique remonte au defilement :
   * il suffisait d'un rafraichissement — evenement temps reel, retour de
   * visibilite, resynchronisation — pour que le fil se rabatte sur sa derniere
   * page. Les messages optimistes survivent, et l'ordre chronologique est
   * retabli, un lot ancien arrivant apres un lot recent.
   */
  const fusionnerMessages = useCallback((prev: Message[], entrants: Message[]): Message[] => {
    if (entrants.length === 0) return prev
    const parId = new Map(prev.map((m) => [m.id, m]))
    for (const entrant of entrants) {
      const existant = parId.get(entrant.id)
      // Un message deja connu est mis a jour (statut, suppression), pas duplique.
      parId.set(entrant.id, existant ? { ...existant, ...entrant } : entrant)
    }
    return [...parId.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }, [])

  const refreshMessages = useCallback(async () => {
    await fetchMessagesCacheFirst(
      chatId,
      // onCached : affichage instantané depuis IndexedDB (~2ms)
      (cached) => setMessages((prev) => fusionnerMessages(prev, cached)),
      // onFresh : mise à jour silencieuse avec les données réseau
      (fresh) => setMessages((prev) => fusionnerMessages(prev, fresh))
    )
  }, [chatId, fusionnerMessages])

  // Evenements d'appel de cette conversation (pastilles dans le fil).
  const refreshCallEvents = useCallback(async () => {
    try {
      setCallEvents(await fetchCallsForConversation(chatId))
    } catch {
      // non bloquant : le fil de messages reste utilisable sans l'historique d'appels
    }
  }, [chatId])

  useEffect(() => {
    if (!chat) return

    if (fallbackContact) {
      ensureDirectConversation(fallbackContact)
    }
    if (fallbackGroup) {
      ensureGroupConversation(fallbackGroup)
    }

    let cancelled = false

    // Nouvelle conversation : le fil et sa pagination repartent de zero. Ce vidage
    // etait implicite tant que les lots remplacaient la liste ; la fusion l'exige
    // desormais, sinon deux discussions se melangeraient.
    setMessages([])
    setOlderExhausted(false)
    setOlderError(false)

    // Charge l'historique initial via GET /api/chats/{id}/messages
    void refreshMessages().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[chat] fetchMessages a echoue", err)
      if (!cancelled) setMessages([])
    })
    void refreshCallEvents()

    // Temps reel : abonnement aux nouveaux messages de la conversation
    const myId = getMyUserId()
    // Correspondant d'une conversation directe : sert a filtrer les evenements
    // de presence, qui sont diffuses toutes conversations confondues.
    const peerUserId = chat?.isGroup
      ? null
      : (chat?.membersInfo?.find((member) => member.id !== myId)?.id ?? null)
    // isOnline vient de GET /api/conversations. On ne seme que le "en ligne" :
    // un false peut aussi signifier "presence masquee", auquel cas le repli sur
    // l'activite reelle reste plus juste.
    if (!chat?.isGroup && chat?.online) setPeerPresence(true)

    const unsubscribeMessages = subscribeToConversation(chatId, (message) => {
      if (cancelled) return
      const incoming = toFrontMessage(message, myId)
      // Persiste le message entrant en IndexedDB
      void persistIncomingWsMessage(message)
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev
        return [...prev, incoming]
      })
      if (incoming.senderId !== "me") {
        setLastPeerActivity(Date.now())
        void markChatAsRead(chatId)
      }
    })

    // Abonnement aux evenements "en train d'ecrire"
    let typingTimeoutId: ReturnType<typeof setTimeout> | null = null
    const unsubscribeTyping = subscribeToTyping(chatId, (event) => {
      if (cancelled) return
      // Ignore ses propres evenements
      if (myId && event.userId === myId) return
      setLastPeerActivity(Date.now())
      setIsTyping(Boolean(event.isTyping))
      if (typingTimeoutId) clearTimeout(typingTimeoutId)
      // Failsafe : si on ne recoit pas le "stopped typing", on coupe apres 4s
      if (event.isTyping) {
        typingTimeoutId = setTimeout(() => setIsTyping(false), 4000)
      }
    })

    // Abonnement aux accuses de lecture : l'autre a ouvert la conversation,
    // tous nos messages envoyes passent en "lu".
    const unsubscribeStatus = subscribeToStatus(chatId, (event) => {
      if (cancelled) return
      if (myId && event.readBy === myId) return // c'est nous qui avons lu
      setLastPeerActivity(Date.now())
      setMessages((prev) =>
        prev.map((m) => (m.senderId === "me" && m.status !== "read" ? { ...m, status: "read" } : m))
      )
    })

    // Abonnement a la presence du correspondant (conversation directe).
    const unsubscribePresence = subscribeToPresence((event) => {
      if (cancelled) return
      if (event.userId !== peerUserId) return
      setPeerPresence(event.isOnline)
      if (event.isOnline) setLastPeerActivity(Date.now())
    })

    // Abonnement aux suppressions de messages (pour moi / pour tous)
    const unsubscribeDeleted = subscribeToMessageDeleted(chatId, (event) => {
      if (cancelled) return
      // Supprime aussi du cache IndexedDB
      void removeMessageFromDB(event.messageId)
      setMessages((prev) => {
        // Les traductions sont rangees sous l'empreinte du TEXTE : une fois le
        // contenu efface de l'etat, plus rien ne permet de les retrouver. C'est
        // donc ici, et nulle part ailleurs, qu'elles doivent partir. L'appel est
        // idempotent : une double invocation ne coute rien.
        const supprime = prev.find((m) => m.id === event.messageId)
        if (supprime?.content) void oublierTraductionsDuTexte(supprime.content)
        return event.scope === "me"
          ? prev.filter((m) => m.id !== event.messageId)
          : prev.map((m) =>
              m.id === event.messageId
                ? { ...m, isDeleted: true, content: "", mediaUrl: undefined }
                : m
            )
      })
    })

    // Abonnement aux EDITIONS de messages.
    //
    // Le serveur diffuse `message_edited` a tous les participants depuis
    // toujours, et le mobile le traite ; c'est le web qui ne l'ecoutait pas. Un
    // message modifie gardait donc son ancien texte jusqu'a ce qu'on rouvre la
    // conversation — le fameux « il faut rafraichir pour voir la modification ».
    const unsubscribeEdited = subscribeToMessageEdited(chatId, (event) => {
      if (cancelled) return

      // Le cache IndexedDB doit suivre, sinon le cache-first repeint l'ancien
      // texte au rechargement suivant avant que le reseau ne le corrige.
      void applyMessageEditToCache(chatId, event.messageId, event.content, event.editedAt)

      setMessages((prev) => {
        const ancien = prev.find((m) => m.id === event.messageId)
        if (!ancien) return prev

        // Meme raison qu'a la suppression : les traductions sont rangees sous
        // l'empreinte du TEXTE. Celle de l'ancien contenu ne correspond plus a
        // rien d'affiche et deviendrait introuvable une fois l'etat remplace —
        // pire, une traduction perimee pourrait etre reservie pour un texte qui
        // a change de sens. On l'oublie AVANT de poser le nouveau contenu.
        if (ancien.content && ancien.content !== event.content) {
          void oublierTraductionsDuTexte(ancien.content)
        }

        return prev.map((m) =>
          m.id === event.messageId
            ? { ...m, content: event.content, editedAt: event.editedAt }
            : m
        )
      })
    })

    // Apres une coupure du WebSocket, on recharge l'historique pour rattraper
    // les messages arrives pendant la deconnexion.
    // Après reconnexion WS : delta sync — on ne recharge que les messages
    // plus récents que le dernier connu (au lieu de tout recharger).
    const unsubscribeConnected = subscribeToWsConnected(() => {
      if (cancelled) return
      void refreshMessages().catch(() => undefined)
      void markChatAsRead(chatId)
    })

    // Filet de securite : si le WebSocket de L'AUTRE participant est degrade
    // (4G capricieuse), ses messages partent en REST sans diffusion temps reel.
    // On resynchronise donc la conversation ouverte toutes les 10 s (onglet
    // visible uniquement) pour que rien ne reste bloque.
    // Intervalle augmenté de 10s → 30s car le cache IndexedDB est fiable
    // et le WebSocket gère les messages temps réel
    const pollId = setInterval(() => {
      if (cancelled || document.hidden) return
      void refreshMessages().catch(() => undefined)
      void refreshCallEvents()
    }, 30_000)

    // Quand on ouvre la conv, on marque tout comme lu
    void markChatAsRead(chatId)

    return () => {
      cancelled = true
      unsubscribeMessages()
      unsubscribeTyping()
      unsubscribeStatus()
      unsubscribePresence()
      unsubscribeDeleted()
      unsubscribeEdited()
      unsubscribeConnected()
      clearInterval(pollId)
      if (typingTimeoutId) clearTimeout(typingTimeoutId)
    }
  }, [chat, chatId, refreshMessages, refreshCallEvents, fallbackContact, fallbackGroup])

  useEffect(() => {
    if (!chat || messages.length === 0) return

    syncConversationFromMessages(
      {
        id: chat.id,
        name: chat.name,
        initials: chat.initials,
        colorIdx: chat.colorIdx,
        online: chat.online,
        isGroup: chat.isGroup,
        members: chat.members,
      },
      messages
    )
  }, [chat, messages])

  // Scroll intelligent : le chargement des previews ou la synchronisation ne doit
  // jamais déplacer quelqu'un qui consulte les anciens messages.
  useEffect(() => {
    if (messages.length === 0) return
    const newestId = messages[messages.length - 1]?.id ?? null
    if (!initialScrollDoneRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" })
      initialScrollDoneRef.current = true
    } else if (newestId !== lastMessageIdRef.current && isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    } else if (newestId !== lastMessageIdRef.current && !isNearBottomRef.current) {
      // Arrive pendant qu'on lisait plus haut : on marque la frontiere une
      // seule fois, sur le PREMIER de la salve. Les suivants viennent apres.
      setFrontiereNonLus((actuelle) => actuelle ?? newestId)
    }
    lastMessageIdRef.current = newestId
  }, [messages])

  /**
   * ON RESTE COLLE AU BAS TANT QUE LE FIL GRANDIT.
   *
   * Le calage initial ne se faisait qu'UNE FOIS, au premier rendu — et a cet
   * instant les images, les apercus de lien, les cartes et les fiches de
   * document n'ont pas encore leur hauteur. On se posait donc sur un bas qui
   * n'etait pas le vrai : le contenu grandissait ensuite, et l'on se retrouvait
   * loin au-dessus du dernier message, oblige de defiler vers le bas alors
   * qu'on n'avait rien manque.
   *
   * L'observateur de taille recolle au bas a chaque fois que le contenu
   * s'agrandit, jusqu'a ce que l'utilisateur touche lui-meme au defilement.
   * C'est lui qui decide d'arreter, pas un delai devine : une image lente sur
   * un reseau lent depasserait n'importe quelle duree qu'on aurait fixee.
   */
  const ancrageInitialRef = useRef(true)
  useEffect(() => {
    const corps = messagesBodyRef.current
    if (!corps || typeof ResizeObserver === "undefined") return
    const observateur = new ResizeObserver(() => {
      if (!ancrageInitialRef.current) return
      // `scrollTop` plutot que `scrollIntoView` : on est deja en bas, il s'agit
      // de RESTER colle, pas d'y aller — et un defilement anime a chaque image
      // chargee donnerait une page qui tressaute.
      corps.scrollTop = corps.scrollHeight
    })
    observateur.observe(corps)
    for (const enfant of Array.from(corps.children)) observateur.observe(enfant)
    return () => observateur.disconnect()
  }, [chatId, messages.length])

  // Chaque conversation possède son propre chargement initial.
  useEffect(() => {
    ancrageInitialRef.current = true
    initialScrollDoneRef.current = false
    lastMessageIdRef.current = null
    isNearBottomRef.current = true
    frontiereOuvertureFaiteRef.current = false
    setFrontiereNonLus(null)
    setLoinDuBas(false)
  }, [chatId])

  /**
   * Reprise de lecture a l'ouverture.
   *
   * Le compteur de la conversation dit combien de messages sont arrives depuis
   * la derniere visite : on remonte le fil d'autant, on pose la frontiere sur
   * le premier d'entre eux et on ouvre la conversation LA, pas tout en bas.
   * Sans cela, la frontiere n'existerait que pour les messages arrives sous les
   * yeux — le cas le plus rare — et on rouvrirait toujours au dernier message
   * en ayant saute ceux qu'on n'a pas lus.
   *
   * On ne compte que les messages RECUS : le compteur du serveur ignore les
   * notres, et melanger les deux decalerait la frontiere vers le bas.
   */
  useEffect(() => {
    if (frontiereOuvertureFaiteRef.current || !initialScrollDoneRef.current) return
    const nonLus = backendChat?.unread ?? 0
    if (nonLus <= 0 || messages.length === 0) return
    frontiereOuvertureFaiteRef.current = true

    let restants = nonLus
    let premier: string | null = null
    for (let i = messages.length - 1; i >= 0 && restants > 0; i--) {
      if (messages[i].senderId === "me") continue
      restants -= 1
      premier = messages[i].id
    }
    if (!premier) return

    setFrontiereNonLus(premier)
    // L'ANCRAGE AU BAS S'ARRETE ICI. Il sert a compenser les images qui
    // arrivent quand on ouvre sur le dernier message ; mais des qu'il y a du
    // non-lu, la place voulue est la FRONTIERE, pas le bas. Sans cette ligne,
    // l'observateur de taille ramenerait le fil au bas a la premiere image
    // chargee, et la reprise de lecture serait perdue.
    ancrageInitialRef.current = false
    // Un tour de boucle pour laisser le separateur entrer dans le DOM : il
    // n'existe pas encore au moment ou l'on demande le defilement.
    requestAnimationFrame(() => {
      messagesBodyRef.current
        ?.querySelector('[data-separateur-non-lus="1"]')
        ?.scrollIntoView({ behavior: "auto", block: "center" })
    })
  }, [backendChat, messages])

  /**
   * Le separateur s'efface tout seul huit secondes apres qu'on a rejoint le bas.
   *
   * Il repond a « ou en etais-je ? » — une fois la reponse lue, il n'est plus
   * qu'une ligne de plus dans le fil. On ne l'efface pas des l'arrivee en bas :
   * il faut le temps de le voir passer.
   */
  useEffect(() => {
    if (frontiereNonLus === null || loinDuBas) return
    const minuteur = setTimeout(() => setFrontiereNonLus(null), 8000)
    return () => clearTimeout(minuteur)
  }, [frontiereNonLus, loinDuBas])

  /**
   * Nombre de messages sous la frontiere. Sert le badge du bouton : « revenir
   * en bas » et « il y a 3 messages non lus » ne demandent pas le meme geste.
   */
  const nbNonLus = useMemo(() => {
    if (!frontiereNonLus) return 0
    const index = messages.findIndex((m) => m.id === frontiereNonLus)
    return index === -1 ? 0 : messages.length - index
  }, [messages, frontiereNonLus])

  /**
   * Retour au premier non-lu s'il y en a un, au dernier message sinon.
   *
   * L'ordre compte : quelqu'un qui remonte le fil veut reprendre la ou il s'est
   * arrete, pas sauter la fin qu'il n'a pas lue.
   */
  const revenirEnBas = () => {
    const corps = messagesBodyRef.current
    const cible = frontiereNonLus ? corps?.querySelector('[data-separateur-non-lus="1"]') : null
    // Si la frontiere est deja sous les yeux, y sauter ne bougerait rien : le
    // geste suivant attendu est d'aller au bout. Un seul bouton, deux etapes.
    if (cible && corps) {
      const zone = corps.getBoundingClientRect()
      const ligne = cible.getBoundingClientRect()
      const dejaVisible = ligne.bottom > zone.top && ligne.top < zone.bottom
      if (!dejaVisible) {
        cible.scrollIntoView({ behavior: "smooth", block: "center" })
        return
      }
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  /**
   * Charge la page precedente et la prepose au fil, en conservant la position de
   * lecture : sans compensation, inserer du contenu au-dessus ferait sauter la
   * vue de la hauteur ajoutee, et l'utilisateur perdrait le message qu'il lisait.
   */
  const loadOlderMessages = useCallback(async () => {
    const body = messagesBodyRef.current
    if (!body || loadingOlderRef.current || olderExhausted) return

    // Le curseur est l'identifiant du plus ancien message REEL : un message
    // optimiste (tmp-) n'existe pas encore pour le serveur.
    const oldest = messages.find((m) => !m.id.startsWith("tmp-"))
    if (!oldest) return

    loadingOlderRef.current = true
    setLoadingOlder(true)
    setOlderError(false)
    const hauteurAvant = body.scrollHeight
    const positionAvant = body.scrollTop

    try {
      const older = await fetchOlderMessages(chatId, oldest.id)
      if (older.length === 0) {
        setOlderExhausted(true)
        return
      }
      setMessages((prev) => {
        // Dedoublonnage par identifiant : un message deja present ne doit pas
        // reapparaitre, le backend pouvant renvoyer une page qui chevauche.
        const connus = new Set(prev.map((m) => m.id))
        const nouveaux = older.filter((m) => !connus.has(m.id))
        if (nouveaux.length === 0) {
          setOlderExhausted(true)
          return prev
        }
        return [...nouveaux, ...prev]
      })
      // Apres le rendu, on rend a la vue la hauteur qu'elle a gagnee.
      requestAnimationFrame(() => {
        const apres = messagesBodyRef.current
        if (apres) apres.scrollTop = positionAvant + (apres.scrollHeight - hauteurAvant)
      })
    } catch {
      // Reseau en defaut : on ne declare pas l'historique epuise, et on affiche
      // de quoi reessayer.
      setOlderError(true)
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [chatId, messages, olderExhausted])

  /** Distance au haut du fil a partir de laquelle on precharge la page suivante. */
  const OLDER_LOAD_THRESHOLD_PX = 240

  const handleMessagesScroll = () => {
    const body = messagesBodyRef.current
    if (!body) return
    const distanceDuBas = body.scrollHeight - body.scrollTop - body.clientHeight
    // Des qu'on s'eloigne du bas, l'ancrage automatique s'arrete : c'est le
    // geste de l'utilisateur qui y met fin, et lui seul. Tant qu'il reste au
    // bas, le fil continue de se recoller pendant que les images arrivent.
    if (distanceDuBas > 100) ancrageInitialRef.current = false
    isNearBottomRef.current = distanceDuBas < 100
    // 240 px : au-dela, le bas n'est plus a portee de regard, le bouton se
    // justifie. En deca il ferait doublon avec un simple coup de molette.
    setLoinDuBas(distanceDuBas > 240)
    // Meme seuil que le mobile (chat_screen.dart) : le chargement part avant que
    // l'utilisateur ne touche le haut, pour qu'il ne voie pas d'attente.
    if (body.scrollTop <= OLDER_LOAD_THRESHOLD_PX) void loadOlderMessages()
  }

  // Reevalue la presence toutes les 30 s (pour faire expirer le "En ligne").
  useEffect(() => {
    if (lastPeerActivity === null) return
    const id = setInterval(() => setPresenceTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [lastPeerActivity])

  // Presence du serveur si on l'a recue ; sinon "En ligne" sur activite reelle
  // (message, frappe, lecture) dans les 2 dernieres minutes.
  void presenceTick
  const peerOnline =
    peerPresence ?? (lastPeerActivity !== null && Date.now() - lastPeerActivity < 2 * 60 * 1000)

  // Envoi automatique lors d'un clic sur un bouton interactif
  const sendQuickReplyText = useCallback(async (buttonTitle: string, replyToMsg?: Message) => {
    const text = buttonTitle.trim()
    if (!text || sending) return

    const tempId = `tmp-${Date.now()}`
    const optimistic: Message = {
      id: tempId,
      senderId: "me",
      content: text,
      type: "text",
      status: "sending",
      timestamp: new Date(),
      replyTo: replyToMsg?.id,
    }

    setMessages((prev) => [...prev, optimistic])
    setSending(true)

    try {
      const saved = await sendChatMessage(chatId, text, "text", { replyToId: replyToMsg?.id })
      setMessages((prev) => {
        const alreadyReceived = prev.some((m) => m.id === saved.id)
        if (alreadyReceived) return prev.filter((m) => m.id !== tempId)
        return prev.map((m) => (m.id === tempId ? { ...saved, timestamp: m.timestamp } : m))
      })
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "sending" } : m)))
    } finally {
      setSending(false)
    }
  }, [chatId, sending])

  // Envoi d'un message — POST /api/chats/{chatId}/messages
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    const tempId = `tmp-${Date.now()}`
    const optimistic: Message = {
      id: tempId,
      senderId: "me",
      content: text,
      type: "text",
      status: "sending",
      timestamp: new Date(),
      replyTo: replyTo?.id,
    }

    setMessages((prev) => [...prev, optimistic])
    setInput("")
    setReplyTo(null)
    setSending(true)

    // On a envoye -> on n'ecrit plus
    clearTimeout(typingTimer.current)
    publishTyping(chatId, false)

    try {
      const saved = await sendChatMessage(chatId, text, "text", { replyToId: replyTo?.id })
      // Replace le message optimiste par celui renvoye par le backend.
      // Si le broadcast WebSocket est arrive avant (id deja present), on retire juste le tempId.
      setMessages((prev) => {
        const alreadyReceived = prev.some((m) => m.id === saved.id)
        if (alreadyReceived) return prev.filter((m) => m.id !== tempId)
        return prev.map((m) => (m.id === tempId ? { ...saved, timestamp: m.timestamp } : m))
      })
    } catch (err) {
      // En cas d'echec, on marque le message comme "non envoye" pour informer l'user
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "sending" } : m)))
      const message = err instanceof Error ? err.message : t("send_failed")
      error(t("f2_message_not_sent"), message)
    } finally {
      setSending(false)
    }
  }, [input, sending, replyTo, chatId, error, t])

  // Touche Entree = envoi (Shift+Entree = saut de ligne)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Auto-resize du textarea + emission typing via WebSocket
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Coupe defensive : `maxLength` sur le textarea couvre la frappe et le
    // coller, mais pas tout (glisser-deposer de texte, certaines saisies
    // predictives). Ce qui depasse serait coupe par le serveur de toute facon —
    // autant que l'ecran montre des maintenant ce qui sera reellement envoye.
    setInput(e.target.value.slice(0, LONGUEUR_MAX_CONTENU))
    e.target.style.height = "auto"
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"

    publishTyping(chatId, true)
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      publishTyping(chatId, false)
    }, 1500)
  }

  // Envoie un blob/fichier : upload vers /api/media puis message avec mediaId.
  const sendMediaMessage = useCallback(
    async (
      file: File | Blob,
      filename: string,
      mime: string,
      msgType: "image" | "audio" | "file" | "video",
      durationMs?: number,
      /** Legende saisie a l'ecran de confirmation : elle voyage dans le meme message. */
      caption = ""
    ) => {
      const tempId = `tmp-${Date.now()}-${(tempSeqRef.current += 1)}`
      const localUrl = URL.createObjectURL(file)
      const optimistic: Message = {
        id: tempId,
        senderId: "me",
        content: caption,
        type: msgType,
        status: "sending",
        timestamp: new Date(),
        fileName: filename,
        // Meme fonction que le message confirme par le serveur : le message
        // optimiste et le definitif doivent s'ecrire pareil.
        fileSize: formatBytes(file.size),
        mediaMime: mime,
        durationMs,
        mediaUrl: localUrl,
      }
      setMessages((prev) => [...prev, optimistic])

      try {
        const media = await uploadMedia(file, filename, durationMs)
        const saved = await sendChatMessage(chatId, caption, msgType, {
          mediaId: media.id,
          replyToId: replyTo?.id,
        })
        setReplyTo(null)
        setMessages((prev) => {
          const alreadyReceived = prev.some((m) => m.id === saved.id)
          const optMsg = prev.find((m) => m.id === tempId)
          if (alreadyReceived) return prev.filter((m) => m.id !== tempId)
          return prev.map((m) =>
            m.id === tempId
              ? {
                  ...saved,
                  timestamp: optMsg?.timestamp ?? saved.timestamp,
                  // Le média confirmé est prioritaire; le blob garde le preview si le WS est incomplet.
                  mediaUrl: saved.mediaUrl || optMsg?.mediaUrl,
                  mediaMime: saved.mediaMime || optMsg?.mediaMime,
                  fileName: saved.fileName || optMsg?.fileName,
                  fileSize: saved.fileSize || optMsg?.fileSize,
                  content: saved.content || caption,
                  durationMs: saved.durationMs ?? optMsg?.durationMs,
                  type: saved.mediaMime?.startsWith("video/") ? "video" : saved.type,
                }
              : m
          )
        })
        // Le blob local n'est plus affiche des que le media confirme prend sa
        // place. Sans cette liberation, chaque fichier envoye restait retenu en
        // memoire jusqu'au rechargement de la page. On ne libere que si le
        // backend a bien renvoye une URL : sinon le blob porte encore l'apercu.
        if (saved.mediaUrl) {
          try {
            URL.revokeObjectURL(localUrl)
          } catch {
            /* deja libere */
          }
        }
      } catch (err) {
        setMessages((prev) => {
          const msg = prev.find((m) => m.id === tempId)
          if (msg?.mediaUrl && msg.mediaUrl.startsWith("blob:")) {
            try {
              URL.revokeObjectURL(msg.mediaUrl)
            } catch {
              /* ignore */
            }
          }
          return prev.filter((m) => m.id !== tempId)
        })
        const message = err instanceof Error ? err.message : t("send_file_failed")
        error(t("f2_file_not_sent"), message)
      }
    },
    [chatId, replyTo, error, t]
  )

  const mediaKindFromFile = (file: File): "image" | "audio" | "video" | "file" => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (
      file.type.startsWith("image/") ||
      ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"].includes(ext)
    )
      return "image"
    if (file.type.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm"].includes(ext))
      return "video"
    if (
      file.type.startsWith("audio/") ||
      ["mp3", "aac", "acc", "wav", "ogg", "m4a", "flac", "webm"].includes(ext)
    )
      return "audio"
    return "file"
  }

  const readAudioDuration = (file: File): Promise<number | undefined> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      const audio = document.createElement("audio")
      audio.preload = "metadata"
      const done = () => {
        URL.revokeObjectURL(url)
        resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined)
      }
      audio.onloadedmetadata = done
      audio.onerror = done
      audio.src = url
    })

  // Selection de fichier (photo, document, audio) — supporte la selection multiple.
  // Certains téléphones ne renseignent pas File.type : l'extension est donc aussi reconnue.
  // Rien ne part ici : les fichiers passent par l'ecran de confirmation.
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setShowAttach(false)
    const toSend = Array.from(files)
    const oversized = toSend.filter((f) => f.size > 2000 * 1024 * 1024)
    if (oversized.length > 0) {
      error(t("f2_files_too_large"), t("f2_files_over_limit", { count: oversized.length }))
    }
    const valid = toSend.filter((f) => f.size <= 2000 * 1024 * 1024)
    const prepared: PendingMedia[] = []
    for (const file of valid) {
      const kind = mediaKindFromFile(file)
      const ext = file.name.split(".").pop()?.toLowerCase()
      // Certains gestionnaires Android annoncent .aac/.acc comme octet-stream.
      // On transmet le MIME attendu par le backend afin qu'il ne soit pas rejeté.
      const mime =
        ext === "aac" || ext === "acc" ? "audio/aac" : file.type || "application/octet-stream"
      const durationMs = kind === "audio" ? await readAudioDuration(file) : undefined
      prepared.push({ file, url: URL.createObjectURL(file), kind, mime, durationMs, caption: "" })
    }
    if (prepared.length > 0) {
      setPendingMedia(prepared)
      setPendingIndex(0)
    }
    e.target.value = ""
  }

  /** Libere les apercus locaux : ils ne servent qu'a l'ecran de confirmation. */
  const closeMediaComposer = useCallback(() => {
    setPendingMedia((prev) => {
      prev.forEach((item) => {
        try {
          URL.revokeObjectURL(item.url)
        } catch {
          /* deja libere */
        }
      })
      return []
    })
    setPendingIndex(0)
  }, [])

  const removePendingMedia = useCallback((index: number) => {
    setPendingMedia((prev) => {
      const target = prev[index]
      if (target) {
        try {
          URL.revokeObjectURL(target.url)
        } catch {
          /* deja libere */
        }
      }
      return prev.filter((_, i) => i !== index)
    })
    setPendingIndex((prev) => (index < prev || prev > 0 ? Math.max(0, prev - 1) : prev))
  }, [])

  /** Confirmation : chaque fichier part avec sa propre legende, dans l'ordre choisi. */
  const sendPendingMedia = useCallback(() => {
    pendingMedia.forEach((item) => {
      void sendMediaMessage(
        item.file,
        item.file.name,
        item.mime,
        item.kind,
        item.durationMs,
        item.caption.trim()
      )
    })
    closeMediaComposer()
  }, [pendingMedia, sendMediaMessage, closeMediaComposer])

  // --- Vocaux (MediaRecorder), comme sur WhatsApp ---
  const startRecording = async () => {
    if (recording) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      error(t("micro_unavailable"), t("allow_mic"))
      return
    }

    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : ""
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream)
    recorderRef.current = recorder
    recordChunksRef.current = []
    recordCancelledRef.current = false
    setRecordSec(0)
    setRecording(true)
    recordTimerRef.current = setInterval(() => setRecordSec((s) => s + 1), 1000)

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordChunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current)
        recordTimerRef.current = null
      }
      setRecording(false)

      if (recordCancelledRef.current) return
      // Le backend valide le MIME exact : on retire le suffixe ";codecs=..." du navigateur.
      const type = (recorder.mimeType || "audio/webm").split(";")[0]
      const blob = new Blob(recordChunksRef.current, { type })
      if (blob.size === 0) return
      const ext = type.includes("mp4") ? "m4a" : "webm"
      const durationMs = recordChunksRef.current.length > 0 ? recordSecRef.current * 1000 : 0
      void sendMediaMessage(blob, `vocal-${Date.now()}.${ext}`, type, "audio", durationMs)
    }

    recorder.start()
  }

  // La duree est lue dans onstop : on la garde dans une ref pour eviter une closure figee.
  const recordSecRef = useRef(0)
  useEffect(() => {
    recordSecRef.current = recordSec
  }, [recordSec])

  const stopRecording = (cancelled: boolean) => {
    recordCancelledRef.current = cancelled
    recorderRef.current?.stop()
    recorderRef.current = null
  }

  useEffect(() => {
    return () => {
      // Nettoyage si on quitte la page en plein enregistrement.
      recordCancelledRef.current = true
      recorderRef.current?.stop()
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    }
  }, [])

  // Les modeles de traduction du navigateur pesent lourd en memoire et se
  // recreent en quelques millisecondes : on les rend en quittant la
  // conversation plutot que de les garder pour un fil qu'on ne lit plus.
  useEffect(() => () => libererMoteurLocal(), [])

  // --- Actions sur un message ---
  const handleCopy = (msg: Message) => {
    void navigator.clipboard
      .writeText(msg.content)
      .then(() => success(t("copied"), t("message_copied")))
      .catch(() => error(t("f2_copy_failed"), t("clipboard_unavailable")))
  }

  const handleDelete = (msg: Message, scope: "me" | "everyone") => {
    deleteChatMessage(msg.id, scope)
    // Meme raison que dans l'abonnement a `message_deleted` : le contenu n'est
    // encore lisible qu'avant la mise a jour optimiste.
    if (msg.content) void oublierTraductionsDuTexte(msg.content)
    // L'evenement message_deleted confirmera ; mise a jour optimiste immediate.
    setMessages((prev) =>
      scope === "me"
        ? prev.filter((m) => m.id !== msg.id)
        : prev.map((m) =>
            m.id === msg.id ? { ...m, isDeleted: true, content: "", mediaUrl: undefined } : m
          )
    )
  }

  // Demarre un appel WebRTC dans cette conversation puis ouvre la salle d'appel.
  const startCallFromChat = (callType: "audio" | "video") => {
    void startOutgoingCall(chatId, callType, chat?.name ?? t("f2_contact"))
      .then((newCallId) => {
        navigate(`/calls/${newCallId}?type=${callType}&returnTo=${encodeURIComponent(returnTo)}`)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : t("call_start_failed")
        error(t("call_failed"), message)
      })
  }

  // Index des messages : le bloc de citation cherchait son origine avec un
  // find() par message rendu, soit un cout quadratique sur un fil charge.
  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])

  // Fil unifie : messages + evenements d'appel (facon WhatsApp), tries par date.
  const timeline: TimelineItem[] = groupMediaRuns(
    [
      ...messages.map((msg): TimelineItem => ({ kind: "msg", ts: msg.timestamp, msg })),
      ...callEvents.map((call): TimelineItem => ({ kind: "call", ts: call.ts, call })),
    ].sort((a, b) => a.ts.getTime() - b.ts.getTime())
  )

  /** Nom affichable d'un expediteur : membre du groupe, contact, sinon debut d'UUID. */
  const resolveSenderName = (senderId: string): string => {
    if (senderId === "me") return t("you")
    const backendMember = chat?.membersInfo?.find(
      (m: { id: string; pseudo?: string | null; publicNumber?: string }) => m.id === senderId
    )
    if (backendMember?.pseudo) return backendMember.pseudo
    if (backendMember?.publicNumber) return backendMember.publicNumber
    return contacts.find((c) => c.id === senderId)?.name ?? chat?.name ?? senderId.slice(0, 8)
  }

  /**
   * Remonte au message d'origine d'une citation et le fait briller brievement,
   * comme WhatsApp. Le flash est relance a chaque clic (on retire la classe puis
   * on force un reflow, sinon l'animation ne rejoue pas).
   */
  const jumpToMessage = (messageId: string) => {
    const target = messagesBodyRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`
    )
    if (!target) {
      error(t("f2_message_not_found"), t("too_old_to_show"))
      return
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" })
    target.classList.remove("msg-highlight")
    void target.offsetWidth
    target.classList.add("msg-highlight")
    window.setTimeout(() => target.classList.remove("msg-highlight"), MSG_FLASH_MS)
  }

  // Grouper par date
  const grouped = timeline.reduce<{ date: string; items: TimelineItem[] }[]>((acc, item) => {
    const dateStr = formatDateSeparator(item.ts)
    const last = acc[acc.length - 1]
    if (!last || last.date !== dateStr) acc.push({ date: dateStr, items: [item] })
    else last.items.push(item)
    return acc
  }, [])

  if (chatLoading && !chat) {
    return (
      <div style={{ padding: 24, color: "var(--text-muted)" }}>{t("loading_conversation")}</div>
    )
  }

  if (!chat) {
    // Ne pas rediriger brutalement après un échec réseau temporaire : cela faisait
    // « disparaître » la discussion quelques secondes après son ouverture.
    return (
      <div className="room-root" style={{ padding: 24, color: "var(--text-muted)" }}>
        {t("conversation_unavailable")}
      </div>
    )
  }

  const color = CHAT_COLORS[chat.colorIdx % CHAT_COLORS.length]

  return (
    <div className={`room-root ${infoPanelOpen ? "info-panel-open" : ""}`}>
      <div className="room-top">
        <button className="back-btn" onClick={() => navigate("/chats")} aria-label={t("back")}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <div
          className="room-av"
          style={{ background: color.bg, color: color.text, overflow: "hidden" }}
        >
          {avatarDisplaySrc((chat as { avatar?: string | null }).avatar) ? (
            <img
              src={avatarDisplaySrc((chat as { avatar?: string | null }).avatar)!}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
            />
          ) : (
            chat.initials
          )}
          {peerOnline && !chat.isGroup && <div className="room-av-dot" />}
        </div>

        <div className="room-info">
          <div className="room-name">{chat.name}</div>
          <div
            className="room-sub"
            style={{
              color: isTyping
                ? "var(--accent)"
                : peerOnline
                  ? "var(--success)"
                  : "var(--text-muted)",
            }}
          >
            {/* Presence du serveur temps reel, avec repli sur l'activite recente
                si elle est masquee ; rien (plutot qu'un faux "Hors ligne") sinon. */}
            {isTyping
              ? t("f2_typing")
              : chat.isGroup
                ? t("cinfo_members_count", { count: chat.members?.length ?? 0 })
                : peerOnline
                  ? t("online")
                  : " "}
          </div>
        </div>

        <div className="room-actions">
          {/* Appels. Retires — pas seulement desactives — quand un AUTRE
              appareil du compte a reserve la conversation : la reservation
              couvre toute la relation avec ce correspondant, pas seulement
              l'ecriture. Le serveur ne fait de toute facon pas sonner ce poste
              et refuserait l'appel sortant ; un bouton visible ne ferait que
              promettre une action impossible. */}
          {!verrou.parUnAutre && (
            <>
              {/* Les APPELS n'ont pas de sens vers soi-meme : les boutons
                  disparaissent plutot que d'echouer sous le doigt. Le menu de
                  contact partage applique deja la meme regle. */}
              {!cestMoiMeme && (
                <>
              <button
                className="action-btn"
                aria-label={t("audio_call")}
                title={t("audio_call")}
                onClick={() => startCallFromChat("audio")}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                </svg>
              </button>
              {/* Appel video */}
              <button
                className="action-btn"
                aria-label={t("video_call")}
                title={t("video_call")}
                onClick={() => startCallFromChat("video")}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" />
                </svg>
              </button>
                </>
              )}
            </>
          )}
          {/* Verrou de conversation. Absent — pas seulement desactive — quand un
              AUTRE appareil du compte a la main : il n'y a rien a reprendre, et
              un bouton grise inviterait a essayer.

              La reservation couvre TOUTE la relation avec ce correspondant :
              les boutons d'appel disparaissent aussi (voir plus haut), et le
              serveur ne fait meme pas sonner ce poste. Il suit le fil en
              lecture, et retrouve tous ses droits quand le detenteur rend la
              main. */}
          {!verrou.parUnAutre && (
            <button
              className={`action-btn${verrou.parMoi ? " action-btn-on" : ""}`}
              aria-label={verrou.parMoi ? t("release_hand") : t("reserve_conversation")}
              title={verrou.parMoi ? t("you_have_hand") : t("reserve_hint")}
              aria-pressed={verrou.parMoi}
              onClick={basculerVerrou}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                {verrou.parMoi ? (
                  <path d="M8 11V7a4 4 0 018 0v4" />
                ) : (
                  <path d="M8 11V7a4 4 0 017.5-2" />
                )}
              </svg>
            </button>
          )}
          {/* La traduction automatique n'a plus de bouton ici : c'est un reglage
              de la conversation, pas une action qu'on refait a chaque message. Sa
              place est dans les informations de la discussion, avec la sourdine et
              le blocage. L'en-tete garde les gestes, pas les preferences. */}
          {!infoPanelOpen && (
            <button
              className="action-btn"
              aria-label={t("cinfo_title")}
              title={t("cinfo_title")}
              onClick={() => {
                if (window.matchMedia("(min-width: 901px)").matches) setInfoPanelOpen(true)
                else navigate(`/chats/${chatId}/info`)
              }}
            >
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
            </button>
          )}
        </div>
      </div>

      <div ref={messagesBodyRef} className="room-body" onScroll={handleMessagesScroll}>
        {/* Etat du chargement de l'historique ancien, en haut du fil. Rien ne
            s'affiche quand tout est charge : un « debut de la conversation »
            permanent n'apporte rien. */}
        {loadingOlder && (
          <div className="older-state" aria-live="polite">
            <span className="older-spinner" aria-hidden />
            {t("loading")}
          </div>
        )}
        {olderError && !loadingOlder && (
          <div className="older-state">
            <button className="older-retry" onClick={() => void loadOlderMessages()}>
              {t("retry")}
            </button>
          </div>
        )}

        {grouped.map(({ date, items }) => (
          <div key={date}>
            <div className="date-sep">
              <div className="date-sep-line" />
              <div className="date-sep-txt">{date}</div>
              <div className="date-sep-line" />
            </div>

            {items.map((item) => {
              if (item.kind === "call") {
                return <CallEventChip key={`call-${item.call.id}`} call={item.call} />
              }
              if (item.kind === "album") {
                const lot = item.msgs
                const head = lot[0]
                const albumIsMe = head.senderId === "me"
                // Les actions portent sur tout le lot : c'est ce que l'utilisateur
                // voit, un seul envoi. Supprimer une tuile sur cinq n'aurait pas
                // de sens face a une grille unique.
                return (
                  <MessageErrorBoundary
                    key={`album-${head.id}`}
                    name={t("f2_n_files", { count: lot.length })}
                  >
                    <MessageBubble
                      msg={head}
                      isMe={albumIsMe}
                      replyMsg={head.replyTo ? messagesById.get(head.replyTo) : undefined}
                      onReply={setReplyTo}
                      onQuickReply={sendQuickReplyText}
                      onOpenImage={(url, name) => setLightbox({ url, name })}
                      onDelete={(_, scope) => lot.forEach((m) => handleDelete(m, scope))}
                      onForward={setForwardMsg}
                      onCopy={handleCopy}
                      isGroup={chat?.isGroup}
                      senderName={
                        !albumIsMe && chat?.isGroup ? resolveSenderName(head.senderId) : undefined
                      }
                      albumMsgs={lot}
                      onOpenAlbum={(index) => setGallery({ msgs: lot, index })}
                      autoTraduction={autoTraduction}
                    />
                  </MessageErrorBoundary>
                )
              }
              const msg = item.msg
              const isMe = msg.senderId === "me"
              const reply = msg.replyTo ? messagesById.get(msg.replyTo) : undefined
              // Resoudre le nom de l'envoyeur pour les groupes
              const resolvedName =
                !isMe && chat?.isGroup ? resolveSenderName(msg.senderId) : undefined
              // Auteur du message cite : affiche en tete du bloc de citation.
              const quotedSenderId = msg.replySnapshot?.senderId ?? reply?.senderId
              const quoteAuthor = quotedSenderId ? resolveSenderName(quotedSenderId) : undefined
              return (
                <MessageErrorBoundary
                  key={msg.id}
                  name={msg.fileName ?? msg.content}
                  size={msg.fileSize}
                >
                  {/* Frontiere du non-lu : une ligne centree, juste au-dessus du
                      premier message arrive pendant qu'on lisait ailleurs. Elle
                      repond a « ou en etais-je ? » puis s'efface d'elle-meme. */}
                  {msg.id === frontiereNonLus && (
                    <div className="separateur-non-lus" data-separateur-non-lus="1">
                      <span>{t("unread_below")}</span>
                    </div>
                  )}
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isMe={isMe}
                    replyMsg={reply}
                    onReply={setReplyTo}
                    onQuickReply={sendQuickReplyText}
                    onOpenImage={(url, name) => setLightbox({ url, name })}
                    onDelete={handleDelete}
                    onForward={setForwardMsg}
                    onCopy={handleCopy}
                    isGroup={chat?.isGroup}
                    senderName={resolvedName}
                    quoteAuthor={quoteAuthor}
                    onJumpToMessage={jumpToMessage}
                    autoTraduction={autoTraduction}
                  />
                </MessageErrorBoundary>
              )
            })}
          </div>
        ))}

        {/* Indicateur de frappe */}
        {isTyping && (
          <div className="typing-indicator">
            <div className="typing-av" style={{ background: color.bg, color: color.text }}>
              {chat.initials}
            </div>
            <div className="typing-bubble">
              <div className="td" />
              <div className="td" />
              <div className="td" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Retour au fil. N'apparait qu'une fois eloigne du bas : pose en
          permanence, il masquerait un message pour rien. Le compte des non-lus
          le change de nature — « revenir en bas » et « trois messages
          t'attendent » n'appellent pas le meme geste, et la fleche vise alors
          la frontiere du non-lu plutot que le dernier message. */}
      <div className="retour-fil-zone" aria-hidden={!loinDuBas}>
        {loinDuBas && (
          <button
            type="button"
            className={`retour-fil${nbNonLus > 0 ? " a-des-non-lus" : ""}`}
            onClick={revenirEnBas}
            aria-label={nbNonLus > 0 ? t("go_to_unread") : t("go_to_latest")}
            title={nbNonLus > 0 ? t("go_to_unread") : t("go_to_latest")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
            {nbNonLus > 0 && (
              <span className="retour-fil-compte">{nbNonLus > 99 ? "99+" : nbNonLus}</span>
            )}
          </button>
        )}
      </div>

      {replyTo && (
        <div className="reply-bar">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <polyline points="9 17 4 12 9 7" />
            <path d="M20 18v-2a4 4 0 00-4-4H4" />
          </svg>
          {/* Sur un media, content est vide : le bandeau restait blanc et on ne
              savait plus a quoi on repondait. */}
          {hasQuotedMedia(replyTo) && <QuoteThumbnail msg={replyTo} />}
          <div className="reply-bar-content">
            <div className="reply-bar-label">{t("reply_to")}</div>
            <div className="reply-bar-txt">
              {hasQuotedMedia(replyTo) ? quotedMediaLabel(replyTo) : replyTo.content}
            </div>
          </div>
          <button
            className="reply-cancel"
            onClick={() => setReplyTo(null)}
            aria-label={t("cancel_reply")}
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
        </div>
      )}

      {/* Un autre appareil du compte a la main : on remplace la zone de saisie
          plutot que de la desactiver. Un champ grise laisse chercher pourquoi ;
          une phrase qui nomme le detenteur repond avant qu'on se pose la
          question. Le fil, lui, reste entierement lisible. */}
      {verrou.parUnAutre ? (
        <div className="room-input-wrap">
          <div className="room-locked">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 018 0v4" />
            </svg>
            <span>
              {verrou.detenteur
                ? t("has_the_hand").replace("{name}", verrou.detenteur)
                : t("locked_by_device")}
              {/* On dit ce qui est reserve, pas seulement qu'il l'est : sans
                  cette precision, on chercherait pourquoi les boutons d'appel
                  ont disparu. */}
              <span className="room-locked-detail">{t("locked_detail")}</span>
            </span>
          </div>
        </div>
      ) : (
        <div className="room-input-wrap">
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />

          <div
            ref={attachRef}
            className="room-input-row"
            style={{ position: "relative" }}
            onMouseLeave={() => setShowAttach(false)}
          >
            {/* Popup attachement */}
            {showAttach && (
              <div className="attach-menu">
                <button
                  className="attach-opt"
                  onClick={() => {
                    fileRef.current!.accept = "image/*"
                    fileRef.current!.click()
                  }}
                >
                  <div
                    className="attach-icon"
                    style={{ background: "#a78bfa20", color: "#a78bfa" }}
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
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                  {t("f2_photo_image")}
                </button>
                <button
                  className="attach-opt"
                  onClick={() => {
                    fileRef.current!.accept = ".mp4,.mov,.avi,.mkv,.webm"
                    fileRef.current!.click()
                  }}
                >
                  <div
                    className="attach-icon"
                    style={{ background: "#8b5cf620", color: "#8b5cf6" }}
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
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" />
                    </svg>
                  </div>
                  {t("video")}
                </button>
                <button
                  className="attach-opt"
                  onClick={() => {
                    fileRef.current!.accept =
                      ".pdf,.doc,.docx,.txt,.tsx,.css,.json,.py,.java,.cpp,.h,.md,.yaml,.yml,.properties,.xml,.php"
                    fileRef.current!.click()
                  }}
                >
                  <div
                    className="attach-icon"
                    style={{ background: "var(--info)20", color: "var(--info)" }}
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
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  {t("f2_document")}
                </button>
                <button
                  className="attach-opt"
                  onClick={() => {
                    fileRef.current!.accept = ".mp3,.aac,.acc,.wav,.ogg,.m4a,.flac,.webm"
                    fileRef.current!.click()
                  }}
                >
                  <div
                    className="attach-icon"
                    style={{ background: "var(--success)20", color: "var(--success)" }}
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
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  </div>
                  {t("cinfo_audio")}
                </button>
                <button
                  className="attach-opt"
                  onClick={() => {
                    fileRef.current!.accept = "*/*"
                    fileRef.current!.click()
                  }}
                >
                  <div
                    className="attach-icon"
                    style={{ background: "#6b728020", color: "#6b7280" }}
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
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                  </div>
                  {t("f2_any_file")}
                </button>
              </div>
            )}

            <button
              className="attach-btn"
              onMouseEnter={() => setShowAttach(true)}
              onClick={() => setShowAttach((v) => !v)}
              aria-expanded={showAttach}
              aria-label={t("attach_file")}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            {recording ? (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 12px",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "var(--danger)",
                    animation: "pulse 1.2s ease-in-out infinite",
                  }}
                />
                <span
                  style={{
                    color: "var(--text-primary)",
                    fontSize: 13,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatAudioDuration(recordSec * 1000)}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: 12, flex: 1 }}>
                  {t("recording_voice")}
                </span>
                <button
                  onClick={() => stopRecording(true)}
                  aria-label={t("cancel_voice")}
                  style={{
                    background: "none",
                    border: "1px solid var(--border-default)",
                    borderRadius: 8,
                    padding: "6px 12px",
                    color: "var(--text-secondary)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {t("cancel")}
                </button>
                <button
                  className="send-btn"
                  onClick={() => stopRecording(false)}
                  aria-label={t("send_voice")}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--bg-base)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            ) : (
              <>
                <textarea
                  ref={inputRef}
                  className="room-textarea"
                  placeholder={t("thr_message_placeholder")}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  aria-label={t("type_message")}
                  /*
                   * La colonne `message.content` est un VARCHAR(500) : au-dela,
                   * le serveur COUPE. Borner la saisie evite d'ecrire un texte
                   * qui arriverait ampute sans avertissement.
                   *
                   * `maxLength` borne aussi le COLLER, pas seulement la frappe
                   * — c'est le cas qui compte, personne ne tape 500 caracteres
                   * a la main. La coupe defensive de `handleInput` reste utile
                   * pour ce que l'attribut ne couvre pas (glisser-deposer de
                   * texte, saisie predictive de certains navigateurs).
                   */
                  maxLength={LONGUEUR_MAX_CONTENU}
                />
                {/*
                 * Compteur « reste N caracteres », visible seulement a partir de
                 * 50 caracteres de la fin : toujours affiche, il occuperait une
                 * place permanente pour une limite que la quasi-totalite des
                 * messages n'atteint jamais.
                 */}
                {LONGUEUR_MAX_CONTENU - input.length <= 50 && (
                  <span
                    className="compteur-longueur"
                    aria-live="polite"
                    style={{
                      fontSize: "11px",
                      marginRight: "6px",
                      alignSelf: "flex-end",
                      // A zero la saisie est bloquee : le rouge explique
                      // pourquoi le clavier « ne repond plus ».
                      color:
                        input.length >= LONGUEUR_MAX_CONTENU
                          ? "var(--danger, #d33)"
                          : "var(--text-muted, #888)",
                      fontWeight: input.length >= LONGUEUR_MAX_CONTENU ? 600 : 400,
                    }}
                  >
                    {LONGUEUR_MAX_CONTENU - input.length}
                  </span>
                )}

                {input.trim() ? (
                  <button
                    className="send-btn"
                    onClick={sendMessage}
                    disabled={sending}
                    aria-label={t("send")}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--bg-base)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                ) : (
                  <button
                    className="send-btn"
                    onClick={() => void startRecording()}
                    aria-label={t("record_voice")}
                    title={t("record_voice")}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--bg-base)"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {infoPanelOpen && (
        <aside className="chat-info-drawer">
          <ChatInfoPage embedded onEmbeddedClose={() => setInfoPanelOpen(false)} />
        </aside>
      )}

      {/* Visionneuse d'image plein ecran */}
      {gallery && (
        <MediaGallery msgs={gallery.msgs} index={gallery.index} onClose={() => setGallery(null)} />
      )}

      {pendingMedia.length > 0 && (
        <MediaComposer
          items={pendingMedia}
          index={Math.min(pendingIndex, pendingMedia.length - 1)}
          onIndexChange={setPendingIndex}
          onCaptionChange={(index, caption) =>
            setPendingMedia((prev) =>
              prev.map((item, i) => (i === index ? { ...item, caption } : item))
            )
          }
          onRemove={removePendingMedia}
          onCancel={closeMediaComposer}
          onSend={sendPendingMedia}
        />
      )}

      {lightbox && (
        <ImageLightbox url={lightbox.url} name={lightbox.name} onClose={() => setLightbox(null)} />
      )}

      {/* Selecteur de conversations pour le transfert */}
      {forwardMsg && (
        <ForwardDialog
          onClose={() => setForwardMsg(null)}
          onForward={async (convIds) => {
            try {
              const count = await forwardChatMessage(forwardMsg.id, convIds)
              success(t("forwarded_success"), t("f2_sent_in_n_convs", { count }))
            } catch (err) {
              const message = err instanceof Error ? err.message : t("f2_forward_failed")
              error(t("f2_forward_error"), message)
            } finally {
              setForwardMsg(null)
            }
          }}
        />
      )}
    </div>
  )
}

/** Modal de selection des conversations cibles pour transferer un message. */
function ForwardDialog({
  onClose,
  onForward,
}: {
  onClose: () => void
  onForward: (convIds: string[]) => Promise<void>
}) {
  const { t } = useTranslation()
  const [conversations, setConversations] = useState<
    Array<{ id: string; name: string; initials: string }>
  >([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchChatConversations().then((list) => {
      if (cancelled) return
      setConversations(list.map((c) => ({ id: c.id, name: c.name, initials: c.initials })))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 8500,
        background: "var(--overlay)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          boxShadow: "0 24px 64px #00000080",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid var(--border-subtle)",
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 800,
            fontSize: 17,
            color: "var(--text-primary)",
          }}
        >
          {t("forward_to")}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {loading && (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              {t("loading")}
            </div>
          )}
          {!loading && conversations.length === 0 && (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              {t("no_conversation_available")}
            </div>
          )}
          {conversations.map((conv) => (
            <label
              key={conv.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                borderRadius: 10,
                cursor: "pointer",
                background: selected.has(conv.id) ? "var(--accent-dim)" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(conv.id)}
                onChange={() => toggle(conv.id)}
              />
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: "var(--accent-dim)",
                  color: "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {conv.initials}
              </span>
              <span style={{ color: "var(--text-primary)", fontSize: 13 }}>{conv.name}</span>
            </label>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            padding: 14,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              padding: "8px 14px",
              color: "var(--text-secondary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t("cancel")}
          </button>
          <button
            disabled={selected.size === 0 || sending}
            onClick={() => {
              setSending(true)
              void onForward(Array.from(selected))
            }}
            style={{
              background: "var(--accent)",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              color: "var(--accent-text)",
              fontSize: 12,
              fontWeight: 600,
              cursor: selected.size === 0 || sending ? "not-allowed" : "pointer",
              opacity: selected.size === 0 || sending ? 0.6 : 1,
            }}
          >
            {sending ? t("f2_forwarding") : t("f2_forward_count", { count: selected.size })}
          </button>
        </div>
      </div>
    </div>
  )
}
