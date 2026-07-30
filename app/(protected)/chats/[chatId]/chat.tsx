import { Component, useState, useRef, useEffect, useCallback, useMemo, type ErrorInfo, type ReactNode } from "react"
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
  deleteChatMessage,
  fetchMessages,
  fetchMessagesCacheFirst,
  forwardChatMessage,
  markChatAsRead,
  persistIncomingWsMessage,
  removeMessageFromDB,
  sendChatMessage,
  toFrontMessage,
} from "../../../../src/services/messages-service"
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
import {
  publishTyping,
  subscribeToConversation,
  subscribeToMessageDeleted,
  subscribeToPresence,
  subscribeToStatus,
  subscribeToTyping,
  subscribeToWsConnected,
} from "../../../../src/services/websocket-service"
import { getMyUserId } from "../../../../src/data/session-user"
import { startOutgoingCall } from "../../../../src/services/call-manager"
import { fetchCallsForConversation, type CallRecord } from "../../../../src/services/calls-service"
import { avatarDisplaySrc } from "../../../../src/lib/avatar"
import ChatInfoPage from "./chat-info"
import "./chat-room-page.css"

type Message = ChatMessageMock

/** Une carte média défectueuse ne doit jamais faire tomber toute la discussion. */
class MessageErrorBoundary extends Component<{ children: ReactNode; name?: string; size?: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    try { localStorage.setItem("alanya_last_preview_error", `${new Date().toISOString()} | ${error.message} | ${info.componentStack?.slice(0, 500) ?? ""}`) } catch { /* stockage facultatif */ }
    console.error("[Alanya preview] erreur isolée", error)
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <div style={{ margin: "6px 0", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)", fontSize: 11, color: "var(--text-secondary)" }}>
      <div style={{ fontWeight: 700 }}>{this.props.name ?? "Fichier"}</div>
      {this.props.size && <div style={{ marginTop: 2 }}>{this.props.size}</div>}
      <div style={{ marginTop: 5 }}>Aperçu indisponible pour ce fichier. Les autres messages restent accessibles.</div>
    </div>
  }
}

// Realtime : WebSocket natif du backend Alanya (evenements { type: "message" | "typing" | "read" })

function formatTime(d: Date) {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
}

function formatDateSeparator(d: Date) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui"
  if (d.toDateString() === yesterday.toDateString()) return "Hier"
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
}

/** Visionneuse intégrée pour documents (texte, code, PDF, image, vidéo, DOC, XLS, PPT). */
function DocumentViewer({ url, name, mime, isMe, onClose }: { url: string; name?: string; mime?: string; isMe: boolean; onClose: () => void }) {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? ""
  const isImage = mime?.startsWith("image/") || ["jpg","jpeg","png","gif","webp","bmp"].map((e)=>e.toLowerCase()).includes(ext)
  const isVideo = mime?.startsWith("video/") || ["mp4","mov","avi","mkv","webm"].map((e)=>e.toLowerCase()).includes(ext)
  const isAudio = mime?.startsWith("audio/") || ["mp3","aac","acc","wav","ogg","m4a","flac","webm"].includes(ext)
  const isText = mime?.startsWith("text/") || TEXT_PREVIEW_EXTENSIONS.includes(ext)
  const isPdf = mime === "application/pdf" || ext === "pdf"
  const isDoc = ["doc","docx"].includes(ext) || (mime ?? "").includes("word")
  const isSpreadsheet = ["xls","xlsx","ods","numbers"].includes(ext) || (mime ?? "").includes("spreadsheet") || (mime ?? "").includes("excel")
  const isPresentation = ["ppt","pptx"].includes(ext) || (mime ?? "").includes("presentation")

  // Pour le texte/code : on lit le contenu via fetch et on affiche dans un textarea
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loadingText, setLoadingText] = useState(false)

  useEffect(() => {
    if (isText && url) {
      setLoadingText(true)
      loadPreviewBlob(url).then((blob) => blob.text())
        .then((t) => {
          setTextContent(t.slice(0, 50000))
          setLoadingText(false)
        })
        .catch(() => {
          setTextContent("Impossible de charger le contenu du fichier.")
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
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9500,
        background: "#000000d9",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, flexDirection: "column",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(92vw, 960px)", maxHeight: "88vh",
          background: isMe ? "#2a1f14" : "#0a0d12",
          borderRadius: 16, border: `1px solid ${isMe ? "#ffffff18" : "#1a1f24"}`,
          boxShadow: "0 32px 80px #000000b0",
          overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Barre de titre */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${isMe ? "#ffffff15" : "#1a1f24"}`, fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 15, color: isMe ? "#fff" : "var(--text-primary)" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name ?? "Fichier"}</span>
          <button onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", color: isMe ? "rgba(255,255,255,0.8)" : "var(--text-secondary)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>

        {/* Corps */}
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {isOffice && (
            <OfficePreview url={url} name={name} label={officeLabel} isMe={isMe} height="70vh" />
          )}
          {!isOffice && isImage && (
            <img src={url} alt={name ?? "image"} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 10, display: "block", margin: "0 auto" }} />
          )}
          {!isOffice && isVideo && (
            <video src={url} controls preload="metadata" style={{ width: "100%", maxHeight: "70vh", borderRadius: 10, display: "block", margin: "0 auto" }} />
          )}
          {!isOffice && isAudio && <audio src={url} controls preload="metadata" style={{ width: "100%", marginTop: 12 }} />}
          {!isOffice && isPdf && <PdfViewer url={url} isMe={isMe} full />}
          {!isOffice && isText && (
            <>
              {loadingText ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "65vh", color: isMe ? "rgba(255,255,255,0.5)" : "var(--text-muted)" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", border: `3px solid ${isMe ? "rgba(255,255,255,0.2)" : "var(--border-subtle)"}`, borderTopColor: isMe ? "#fff" : "var(--accent)", animation: "spin 0.8s linear infinite", marginRight: 10 }} />
                  <span>Chargement du document...</span>
                </div>
              ) : textContent !== null ? (
                <textarea readOnly value={textContent} style={{ width: "100%", height: "65vh", background: "#0d1117", color: isMe ? "#f0f6fc" : "#c9d1d9", border: "1px solid #30363d", borderRadius: 8, padding: 12, fontFamily: "'Fira Code', monospace", fontSize: 13, lineHeight: 1.5, resize: "none" }} />
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh", color: isMe ? "rgba(255,255,255,0.5)" : "var(--text-muted)", flexDirection: "column", gap: 12 }}>
                  <span>Impossible de charger le contenu.</span>
                  <a href={url} target="_blank" rel="noreferrer" style={{ color: isMe ? "#fff" : "var(--accent)", fontWeight: 600, textDecoration: "underline" }}>Ouvrir dans un nouvel onglet</a>
                </div>
              )}
            </>
          )}
          {!isOffice && !isImage && !isVideo && !isAudio && !isPdf && !isText && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh", color: isMe ? "rgba(255,255,255,0.5)" : "var(--text-muted)", flexDirection: "column", gap: 12 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={isMe ? "rgba(255,255,255,0.4)" : "var(--text-muted)"} strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              <div style={{ fontSize: 13, opacity: 0.8 }}>{name ?? "Fichier"}</div>
              <a href={url} target="_blank" rel="noreferrer" style={{ color: isMe ? "#fff" : "var(--accent)", fontWeight: 600, textDecoration: "underline" }}>Télécharger / Ouvrir</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Lecteur PDF rendu par PDF.js : ne dépend pas du lecteur PDF du téléphone. */
function PdfViewer({ url, isMe, full = false }: { url: string; isMe: boolean; full?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState("Chargement du PDF…")
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
      setState("Chargement du PDF…"); setErrorMessage(""); setNativeFallback(false)
      let blob: Blob
      try {
        blob = await loadPreviewBlob(url)
      } catch {
        if (!cancelled) { setState(""); setNativeFallback(true) }
        return
      }
      try {
        const sample = await blob.slice(0, 1000).text()
        if (/AccessDenied|cap exceeded|Caps & Alerts/i.test(sample)) throw new Error("Le stockage du serveur a atteint son quota de téléchargement.")
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString()
        task = pdfjs.getDocument({ data: await blob.arrayBuffer() })
        const pdf = await task.promise
        if (cancelled || !host.current) return
        host.current.replaceChildren()
        // Premier rendu léger : les pages suivantes sont construites sans relancer le téléchargement.
        for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, full ? 30 : 1); pageNo++) {
          const page = await pdf.getPage(pageNo); const viewport = page.getViewport({ scale: 1.25 })
          const canvas = document.createElement("canvas"); canvas.width = viewport.width; canvas.height = viewport.height
          canvas.style.cssText = "display:block;width:100%;height:auto;margin:0 auto 12px;background:white;border-radius:6px"
          const ctx = canvas.getContext("2d"); if (ctx) await page.render({ canvasContext: ctx, viewport }).promise
          if (!cancelled) host.current?.append(canvas)
        }
        if (!cancelled) setState("")
      } catch (err: unknown) { if (!cancelled) { setState(""); setErrorMessage(err instanceof Error ? err.message : "Le PDF ne peut pas être chargé.") } }
    }
    void render(); return () => { cancelled = true; task?.destroy?.() }
  }, [url, full])

  // Repli natif : le document reste consultable et defilable, sans PDF.js.
  if (nativeFallback) {
    return <div style={{ position: "relative" }}>
      <iframe
        src={url}
        title="Apercu PDF"
        style={{ width: "100%", height: full ? "70vh" : 220, border: "none", borderRadius: 8, background: "#fff", display: "block" }}
      />
      <a href={url} target="_blank" rel="noreferrer" style={{ display: "block", padding: "6px 2px 0", fontSize: 10, color: isMe ? "rgba(255,255,255,0.85)" : "var(--text-secondary)" }}>
        Ouvrir dans un nouvel onglet
      </a>
    </div>
  }

  // Le host canvas est volontairement distinct du texte React : PDF.js manipule
  // ses enfants avec replaceChildren(), React ne doit donc jamais les gérer.
  return <div style={{ minHeight: 120, color: isMe ? "#fff" : "var(--text-secondary)", textAlign: "center", padding: 10 }}>
    {state && <div style={{ padding: 10 }}>{state}</div>}
    {errorMessage && <div style={{ padding: 10, color: isMe ? "#ffe0d1" : "var(--danger)" }}>{errorMessage}</div>}
    <div ref={host} />
  </div>
}

/** Coche simple (envoye) / double blanche (recu) / double bleue (lu), comme sur WhatsApp.
    Affichee uniquement sur la bulle terracotta de l'expediteur -> teintes claires. */
function StatusIcon({ status }: { status: MessageStatus }) {
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

/** Detecte des coordonnees GPS (lat,lng) ou un lien Google Maps. */
const GPS_REGEX = /(-?\d+\.\d{4,})\s*,\s*(-?\d+\.\d{4,})/
const GMAPS_REGEX = /(?:google\.\w+\/maps|maps\.google\.\w+|goo\.gl\/maps).*?[/@](-?\d+\.\d+),(-?\d+\.\d+)/

function extractGpsCoords(text: string): { lat: number; lng: number } | null {
  const gm = text.match(GMAPS_REGEX)
  if (gm) return { lat: parseFloat(gm[1]), lng: parseFloat(gm[2]) }
  const gps = text.match(GPS_REGEX)
  if (gps) return { lat: parseFloat(gps[1]), lng: parseFloat(gps[2]) }
  return null
}

/** Les coordonnées sont affichées sous la carte : on évite de les répéter au-dessus. */
function removeGpsCoordinates(text: string): string {
  return text.replace(GPS_REGEX, "").replace(/\s{2,}/g, " ").trim()
}

/** Couleurs distinctes pour les noms d'envoyeurs en groupe. */
const SENDER_NAME_COLORS = ["#E8B84B", "#60a5fa", "#a78bfa", "#34d399", "#f87171", "#fb923c", "#38bdf8", "#c084fc"]
function senderNameColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
  return SENDER_NAME_COLORS[Math.abs(h) % SENDER_NAME_COLORS.length]
}

/** Extensions lues comme du texte source par le visionneur integre.
 *  Un .html n'est jamais execute : il est affiche tel quel. */
const TEXT_PREVIEW_EXTENSIONS = ["txt","csv","log","md","tex","latex","bib","sty","tsx","ts","jsx","js","mjs","cjs","html","htm","xhtml","vue","svelte","astro","css","scss","sass","less","styl","postcss","json","yaml","yml","xml","toml","ini","cfg","env","properties","dockerfile","makefile","gradle","maven","sh","bash","zsh","fish","powershell","bat","cmd","py","java","cpp","c","h","hpp","cs","go","rust","rs","swift","kt","kts","scala","r","rb","pl","pm","lua","perl","php","sql","graphql","prisma","mdx","rst","asciidoc","org","wiki"]

/** Icone + couleur par extension de fichier. */
function fileTypeInfo(filename?: string, mime?: string): { color: string; label: string } {
  const ext = (filename ?? "").split(".").pop()?.toLowerCase() ?? ""
  const m = (mime ?? "").toLowerCase()
  if (ext === "pdf" || m === "application/pdf") return { color: "#ef4444", label: "PDF" }
  if (["doc", "docx"].includes(ext) || m.includes("word")) return { color: "#3b82f6", label: "DOC" }
  if (["xls", "xlsx"].includes(ext) || m.includes("spreadsheet") || m.includes("excel")) return { color: "#22c55e", label: "XLS" }
  if (["ppt", "pptx"].includes(ext) || m.includes("presentation")) return { color: "#f97316", label: "PPT" }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return { color: "#a855f7", label: "ZIP" }
  if (["txt","csv","log","md","tex","latex","bib","sty"].includes(ext)) return { color: "#6b7280", label: "TXT" }
  if (["tsx","ts","jsx","js","mjs","cjs","html","htm","xhtml","vue","svelte","astro"].includes(ext)) return { color: "#f59e0b", label: "CODE" }
  if (["css","scss","sass","less","styl","postcss"].includes(ext)) return { color: "#6366f1", label: "CSS" }
  if (["json","yaml","yml","xml","toml","ini","cfg","env","properties","dockerfile","makefile","gradle","maven","sh","bash","zsh","fish","powershell","bat","cmd","py","java","cpp","c","h","hpp","cs","go","rust","rs","swift","kt","kts","scala","r","rb","pl","pm","lua","perl","php","sql","graphql","prisma","mdx","rst","asciidoc","org","wiki"].includes(ext)) return { color: "#10b981", label: "CODE" }
  if (m.startsWith("audio/")) return { color: "#22c55e", label: "AUDIO" }
  if (m.startsWith("video/")) return { color: "#8b5cf6", label: "VIDEO" }
  if (m.startsWith("image/")) return { color: "#ec4899", label: "IMG" }
  if (ext === "apk") return { color: "#34d399", label: "APK" }
  return { color: "var(--text-secondary)", label: ext.toUpperCase() || "FILE" }
}

/** Estime le nombre de pages approximatif d'un document selon sa taille et son type. */
function estimatePages(fileName?: string, fileSize?: string): number {
  const ext = (fileName ?? "").split(".").pop()?.toLowerCase() ?? ""
  const bytesStr = fileSize ?? "0 Mo"
  const bytesMatch = bytesStr.match(/([0-9]+(?:\.[0-9]+)?)\s*Mo/i)
  const bytes = bytesMatch ? parseFloat(bytesMatch[1]) * 1024 * 1024 : 0
  if (["pdf"].includes(ext)) return Math.max(1, Math.ceil(bytes / 5000))
  if (["doc","docx","ppt","pptx","txt","csv","md","tex","latex","bib"].includes(ext)) return Math.max(1, Math.ceil(bytes / 3000))
  if (["xls","xlsx","ods","numbers"].includes(ext)) return Math.max(1, Math.ceil(bytes / 2000))
  if (["tsx","ts","jsx","js","mjs","cjs","html","htm","css","scss","json","yaml","yml","xml","py","java","cpp","c","h","cpp","go","rust","php","sql","sh","bash","zsh","vue","svelte","astro","mdx","rst","lua","perl","pl","rb","swift","kt","scala","r","cs","gradle","maven","ini","cfg","env","dockerfile","makefile"].includes(ext)) return Math.max(1, Math.ceil(bytes / 2500))
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
      <a key={key++} href={url} target="_blank" rel="noreferrer"
        style={{ color: isMe ? "#93c5fd" : "var(--accent)", textDecoration: "underline", wordBreak: "break-all" }}>
        {url}
      </a>
    )
    remaining = remaining.slice(idx + url.length)
  }
  if (remaining) parts.push(<span key={key++}>{remaining}</span>)

  let domain = ""
  try { if (urls[0]) domain = new URL(urls[0]).hostname.replace("www.", "") } catch { /* ignore */ }

  return (
    <>
      {parts}
      {domain && (
        <a href={urls[0]} target="_blank" rel="noreferrer"
          style={{
            display: "flex", alignItems: "center", gap: 8, marginTop: 6,
            padding: "8px 10px", background: isMe ? "#ffffff12" : "var(--bg-elevated)",
            border: `1px solid ${isMe ? "#ffffff18" : "var(--border-subtle)"}`,
            borderRadius: 8, textDecoration: "none", color: "inherit",
          }}>
          <img src={`https://www.google.com/s2/favicons?sz=32&domain=${domain}`} alt="" width={20} height={20}
            style={{ borderRadius: 4, flexShrink: 0 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{domain}</div>
            <div style={{ fontSize: 10, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{urls[0]}</div>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </a>
      )}
    </>
  )
}

/** Preview de coordonnees GPS avec mini-carte OpenStreetMap. */
function GpsPreview({ lat, lng, isMe }: { lat: number; lng: number; isMe: boolean }) {
  return (
    <div style={{ marginTop: 6 }}>
      <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`}
        target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
        <div style={{
          width: "100%", maxWidth: 260, height: 140, borderRadius: 8, overflow: "hidden",
          border: `1px solid ${isMe ? "#ffffff18" : "var(--border-subtle)"}`,
          background: isMe ? "#ffffff08" : "var(--bg-elevated)",
          position: "relative",
        }}>
          <iframe title="Position GPS" loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01},${lat - 0.01},${lng + 0.01},${lat + 0.01}&layer=mapnik&marker=${lat},${lng}`}
            style={{ width: "100%", height: "130%", border: "none", pointerEvents: "none", display: "block" }} />
          {/* Masque tout message d'erreur ou texte intégré en bas du preview */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 55,
            background: `linear-gradient(to top, ${isMe ? "rgba(255,255,255,0.25)" : "var(--bg-elevated)"}, transparent 10%)`,
            pointerEvents: "none",
          }} />
          {/* Overlay supplémentaire au centre-bas pour cacher tout texte résiduel */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0, height: 35,
            background: isMe ? "rgba(255,255,255,0.15)" : "var(--bg-elevated)",
            opacity: 0.9,
            pointerEvents: "none",
          }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 10, opacity: 0.75 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
          </svg>
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </div>
      </a>
    </div>
  )
}

/**
 * Evenement d'appel affiche dans le fil de discussion :
 * aligne a gauche (entrant) ou a droite (sortant), avec couleurs directionnelles.
 */
function CallEventChip({ call }: { call: CallRecord }) {
  const isOutgoing = call.direction === "out"
  const outcome = call.status === "missed" || call.status === "no_answer" ? "Appel manqué" : call.status === "declined" ? "Appel rejeté" : call.status === "busy" ? "Occupé" : ""
  const failed = Boolean(outcome)

  const label = `${call.type === "video" ? "Appel vidéo" : "Appel vocal"}${outcome ? ` — ${outcome}` : ""}`

  // Couleurs : rouge si manque/refuse, vert si sortant reussi, bleu si entrant reussi
  const tint = failed ? "var(--danger)" : isOutgoing ? "#22c55e" : "#3b82f6"
  const bgTint = failed ? "#ef444412" : isOutgoing ? "#22c55e12" : "#3b82f612"

  return (
    <div style={{ display: "flex", justifyContent: isOutgoing ? "flex-end" : "flex-start", margin: "4px 0" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, background: bgTint,
          border: `1px solid ${tint}22`,
          borderRadius: isOutgoing ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
          padding: "8px 14px", fontSize: 12, color: tint, maxWidth: "min(70%, 340px)",
        }}
      >
        <span style={{
          width: 28, height: 28, borderRadius: "50%", background: bgTint,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          {call.type === "video" ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            {/* Fleche de direction */}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              {isOutgoing
                ? <><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></>
                : <><line x1="17" y1="7" x2="7" y2="17" /><polyline points="17 17 7 17 7 7" /></>}
            </svg>
            {label}
          </div>
          <div style={{ fontSize: 10, opacity: 0.75, marginTop: 1 }}>
            {formatTime(call.ts)}{call.duration ? ` — ${call.duration}` : ""}
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
        aria-label={playing ? "Pause" : "Lecture"}
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
  const [text, setText] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState("")
  const [query, setQuery] = useState("")
  const ext = name?.split(".").pop()?.toLowerCase() ?? "txt"
  const isCsv = ext === "csv"
  useEffect(() => {
    let cancelled = false
    setLoading(true); setErrorMessage(""); setText("")
    void loadPreviewBlob(url).then((blob) => blob.text()).then((content) => {
      if (/AccessDenied|cap exceeded|Caps & Alerts/i.test(content.slice(0, 1000))) throw new Error("Stockage indisponible : quota de téléchargement atteint.")
      if (!cancelled) { setText(content.slice(0, 50000)); setLoading(false) }
    }).catch((err: unknown) => {
      if (!cancelled) { setErrorMessage(err instanceof Error ? err.message : "Le document ne peut pas être chargé."); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [url])

  const copy = () => { void navigator.clipboard?.writeText(text) }
  const rows = useMemo(() => isCsv ? text.split(/\r?\n/).filter(Boolean).slice(0, 30).map((row) => row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.replace(/^"|"$/g, "").trim())) : [], [isCsv, text])
  const visibleLines = useMemo(() => text.split(/\r?\n/).filter((line) => !query || line.toLowerCase().includes(query.toLowerCase())).slice(0, 80), [text, query])
  const tone = isMe ? "#ffffff" : "var(--text-primary)"

  return <div style={{ width: "100%", borderRadius: 8, border: `1px solid ${isMe ? "#ffffff25" : "var(--border-subtle)"}`, background: isMe ? "#00000018" : "#10151d", marginBottom: 6, overflow: "hidden", color: tone }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", background: isMe ? "#00000018" : "#171d27" }}>
      <span style={{ fontFamily: "monospace", fontSize: 10, opacity: .75, fontWeight: 700 }}>{ext.toUpperCase()}</span>
      <input aria-label="Rechercher dans le document" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher" style={{ minWidth: 0, flex: 1, border: "none", borderRadius: 4, padding: "4px 6px", background: "#ffffff14", color: tone, fontSize: 10, outline: "none" }} />
      <button onClick={copy} title="Copier le contenu" style={{ border: "none", borderRadius: 4, cursor: "pointer", padding: "4px 6px", background: "#ffffff18", color: tone, fontSize: 10 }}>Copier</button>
    </div>
    {loading ? <div style={{ padding: 12, fontFamily: "monospace", fontSize: 11 }}>Chargement de l’aperçu…</div> : errorMessage ? (
      // Le visionneur a besoin du texte : sans les octets il n'a rien a rendre.
      // On laisse au moins une porte de sortie vers le fichier lui-meme.
      <div style={{ padding: 12, fontFamily: "monospace", fontSize: 11, color: "#ffb4a2" }}>
        {errorMessage}
        <a href={url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 6, color: "inherit", opacity: 0.85 }}>Ouvrir dans un nouvel onglet</a>
      </div>
    ) : isCsv ? (
      <div style={{ overflow: "auto", maxHeight: 180 }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 10 }}><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={{ border: "1px solid #ffffff18", padding: "4px 6px", whiteSpace: "nowrap" }}>{cell}</td>)}</tr>)}</tbody></table>{text.split(/\r?\n/).filter(Boolean).length > 30 && <div style={{ padding: 6, fontSize: 10, opacity: .65 }}>30 premières lignes affichées</div>}</div>
    ) : <div style={{ maxHeight: 180, overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, lineHeight: 1.48, padding: "6px 0" }}>{visibleLines.map((line, index) => <div key={index} style={{ display: "flex", paddingRight: 8, background: query && line.toLowerCase().includes(query.toLowerCase()) ? "#fbbf241f" : undefined }}><span style={{ width: 32, flexShrink: 0, textAlign: "right", paddingRight: 8, userSelect: "none", opacity: .42 }}>{index + 1}</span><code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: line.trimStart().startsWith("#") ? "#8be9fd" : line.includes(":") ? "#f8c878" : tone }}>{line}</code></div>)}</div>}
  </div>
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
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return }
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() } },
      { rootMargin: "600px 0px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  // La hauteur reservee evite que le fil ne sursaute quand l'apercu se monte.
  return <div ref={holder} style={visible ? undefined : { minHeight }}>{visible ? children : null}</div>
}

/**
 * Word, Excel et PowerPoint sont des formats binaires qu'aucun rendu local ne
 * couvre ici : leur apercu passe par Office Online, donc par Microsoft. Or
 * l'URL transmise porte le jeton de session Alanya (resolveMediaUrl en a besoin
 * pour que le service puisse lire le document). L'apercu n'est donc plus
 * automatique : il demande un accord explicite, pour qu'aucun jeton ne parte a
 * l'insu de l'utilisateur a la simple ouverture d'une conversation.
 */
function OfficePreview({ url, name, label, isMe, height }: { url: string; name?: string; label: string; isMe: boolean; height: number | string }) {
  const [accepted, setAccepted] = useState(false)

  if (accepted) {
    return <iframe
      src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
      title={name ?? label}
      style={{ width: "100%", height, borderRadius: 8, border: "none", display: "block", marginBottom: 6 }}
      loading="lazy"
    />
  }

  return <div style={{
    marginBottom: 6, padding: "12px 14px", borderRadius: 10,
    background: isMe ? "#ffffff20" : "#f5f6fa",
    border: `1px solid ${isMe ? "#ffffff35" : "#dde1e7"}`,
    color: isMe ? "#fff" : "var(--text-primary)",
  }}>
    <div style={{ fontSize: 12, fontWeight: 600 }}>Apercu {label} par Microsoft Office Online</div>
    <div style={{ fontSize: 10, opacity: 0.8, marginTop: 4, lineHeight: 1.45 }}>
      Ce format ne peut pas etre rendu dans Alanya. L'afficher transmet le document et le
      jeton de votre session a Microsoft. Le telechargement, lui, reste entre vous et Alanya.
    </div>
    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAccepted(true) }}
        style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: isMe ? "#ffffff25" : "var(--accent)", color: isMe ? "#fff" : "var(--accent-text)", fontSize: 10, fontWeight: 600, cursor: "pointer" }}
      >
        Afficher l'apercu
      </button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${isMe ? "#ffffff30" : "var(--border-default)"}`, background: "transparent", color: isMe ? "rgba(255,255,255,0.8)" : "var(--text-secondary)", fontSize: 10, fontWeight: 500, textDecoration: "none" }}
      >
        Telecharger
      </a>
    </div>
  </div>
}

function VideoPreview({ src, name, size, durationMs }: { src: string; name?: string; size?: string; durationMs?: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <div style={{ marginBottom: 6, padding: "10px 12px", borderRadius: 9, background: "#00000012", fontSize: 11 }}>
    <div style={{ fontWeight: 600 }}>{name ?? "Vidéo"}</div>
    <div style={{ opacity: 0.72, marginTop: 3 }}>{size ?? "Taille inconnue"} · {formatAudioDuration(durationMs)}</div>
    <div style={{ opacity: 0.72, marginTop: 4 }}>Aperçu indisponible — le fichier reste téléchargeable.</div>
  </div>
  return <video src={src} controls preload="metadata" onError={() => setFailed(true)} style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 10, display: "block", marginBottom: 6 }} />
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

/** Apercu plein contenu d'un fichier local, avant tout envoi. */
function PendingMediaPreview({ item }: { item: PendingMedia }) {
  const name = item.file.name
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const isPdf = item.mime === "application/pdf" || ext === "pdf"
  const isText = item.mime.startsWith("text/") || TEXT_PREVIEW_EXTENSIONS.includes(ext)
  const frame = { maxWidth: "100%", maxHeight: "58vh", borderRadius: 12, display: "block", margin: "0 auto" } as const

  if (item.kind === "image") return <img src={item.url} alt={name} style={{ ...frame, objectFit: "contain" }} />
  if (item.kind === "video") return <video src={item.url} controls preload="metadata" style={frame} />
  if (item.kind === "audio") return <audio src={item.url} controls preload="metadata" style={{ width: "100%" }} />
  if (isPdf) return <div style={{ maxHeight: "58vh", overflow: "auto", borderRadius: 12 }}><PdfViewer url={item.url} isMe={false} full /></div>
  if (isText) return <TextFilePreview url={item.url} isMe={false} name={name} />

  // Formats binaires sans rendu local : on confirme au moins de quel fichier il s'agit.
  const fti = fileTypeInfo(name, item.mime)
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 18, borderRadius: 12, background: "#ffffff10", border: "1px solid #ffffff1f" }}>
      <div style={{ width: 54, height: 54, borderRadius: 12, background: `${fti.color}22`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: fti.color }}>{fti.label}</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 3 }}>
          {(item.file.size / 1024 / 1024).toFixed(1)} Mo — ce format n'a pas d'apercu dans le navigateur.
        </div>
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
    <div style={{ position: "fixed", inset: 0, zIndex: 9600, background: "#000000ee", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", color: "#fff", flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current.file.name}
          {items.length > 1 && <span style={{ opacity: 0.6, fontWeight: 400 }}> — {index + 1}/{items.length}</span>}
        </span>
        <button onClick={onCancel} aria-label="Annuler l'envoi" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.85)", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>✕</button>
      </div>

      <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 18px" }}>
        <div style={{ width: "min(100%, 820px)" }}>
          <PendingMediaPreview item={current} />
        </div>
      </div>

      {items.length > 1 && (
        <div style={{ display: "flex", gap: 8, padding: "10px 18px", overflowX: "auto", flexShrink: 0 }}>
          {items.map((item, i) => (
            <div key={item.url} style={{ position: "relative", flexShrink: 0 }}>
              <button
                onClick={() => onIndexChange(i)}
                aria-label={`Voir ${item.file.name}`}
                aria-current={i === index}
                style={{
                  width: 52, height: 52, borderRadius: 8, cursor: "pointer", padding: 0, overflow: "hidden",
                  border: i === index ? "2px solid var(--accent)" : "2px solid transparent",
                  background: "#ffffff14",
                }}
              >
                {item.kind === "image" ? (
                  <img src={item.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : item.kind === "video" ? (
                  <video src={`${item.url}#t=0.1`} preload="metadata" muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  <span style={{ fontSize: 8, fontWeight: 800, color: fileTypeInfo(item.file.name, item.mime).color }}>
                    {fileTypeInfo(item.file.name, item.mime).label}
                  </span>
                )}
              </button>
              <button
                onClick={() => onRemove(i)}
                aria-label={`Retirer ${item.file.name}`}
                style={{ position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", border: "none", background: "#000000cc", color: "#fff", fontSize: 11, lineHeight: 1, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, padding: "12px 18px 18px", flexShrink: 0 }}>
        <textarea
          value={current.caption}
          onChange={(e) => onCaptionChange(index, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend() } }}
          placeholder="Ajouter une legende..."
          rows={1}
          style={{
            flex: 1, minWidth: 0, resize: "none", maxHeight: 96,
            padding: "11px 14px", borderRadius: 20, border: "1px solid #ffffff25",
            background: "#ffffff12", color: "#fff", fontSize: 14, fontFamily: "inherit", outline: "none",
          }}
        />
        <button
          onClick={onSend}
          aria-label="Envoyer"
          style={{ width: 44, height: 44, borderRadius: "50%", border: "none", background: "var(--accent)", color: "var(--accent-text)", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
        </button>
      </div>
    </div>
  )
}

/** Un message cite merite une vignette des lors qu'il porte un fichier. */
function hasQuotedMedia(msg: Message): boolean {
  return Boolean(msg.mediaUrl) || msg.type === "image" || msg.type === "video" || msg.type === "audio" || msg.type === "file"
}

/** Libelle d'un media cite : sa legende si elle existe, sinon son nom, sinon son genre. */
function quotedMediaLabel(msg: Message): string {
  const caption = msg.content?.trim()
  if (caption) return caption
  if (msg.fileName) return msg.fileName
  if (msg.type === "image") return "Photo"
  if (msg.type === "video") return "Vidéo"
  if (msg.type === "audio") return "Message vocal"
  return "Fichier"
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
function QuoteThumbnail({ msg }: { msg: Message }) {
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
    void loadPdfThumbnail(src).then((dataUrl) => { if (!cancelled) setPdfThumb(dataUrl) })
    return () => { cancelled = true }
  }, [isPdf, src])

  const box = { width: 32, height: 32, borderRadius: 5, flexShrink: 0, display: "block" } as const

  if (isImage && src) return <img src={src} alt="" style={{ ...box, objectFit: "cover" }} />
  if (isVideo && src) return <video src={videoPosterUrl(src)} preload="metadata" muted playsInline style={{ ...box, objectFit: "cover", background: "#000" }} />
  if (isPdf && pdfThumb) return <img src={pdfThumb} alt="" style={{ ...box, objectFit: "cover", background: "#fff" }} />

  const fti = fileTypeInfo(msg.fileName, msg.mediaMime)
  return (
    <div style={{ ...box, background: `${fti.color}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 8, fontWeight: 800, color: fti.color, letterSpacing: 0.4 }}>{fti.label}</span>
    </div>
  )
}

function MessageBubble({
  msg,
  isMe,
  replyMsg,
  onReply,
  onOpenImage,
  onDelete,
  onForward,
  onCopy,
  isGroup,
  senderName,
  quoteAuthor,
  onJumpToMessage,
}: {
  msg: Message
  isMe: boolean
  replyMsg?: Message
  onReply: (m: Message) => void
  onOpenImage: (url: string, name?: string) => void
  onDelete: (m: Message, scope: "me" | "everyone") => void
  onForward: (m: Message) => void
  onCopy: (m: Message) => void
  isGroup?: boolean
  senderName?: string
  /** Nom de l'auteur du message cite, affiche en tete du bloc de citation. */
  quoteAuthor?: string
  onJumpToMessage?: (messageId: string) => void
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
  /** Le menu deroulant s'ouvre vers le haut sauf s'il n'y a pas la place. */
  const [menuAbove, setMenuAbove] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const messageMenuRef = useRef<HTMLDivElement>(null)
  const [dragX, setDragX] = useState(0)
  const [viewingDoc, setViewingDoc] = useState<{ url: string; name?: string; mime?: string } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const lastPreviewTapRef = useRef(0)
  const dragStart = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false })

  // Identifiant servant a colorer la citation (meme palette que les noms en groupe),
  // pour que la barre laterale rappelle l'auteur du message cite.
  const quotedAuthorKey = msg.replySnapshot?.senderId ?? replyMsg?.senderId ?? msg.senderId

  // Apercu du message cite : snapshot backend en priorite, sinon lookup local.
  const quote = msg.replySnapshot
    ? {
        content: msg.replySnapshot.isDeleted
          ? "Message supprime"
          : msg.replySnapshot.content || "[media]",
      }
    : replyMsg
      ? { content: replyMsg.content || "[media]" }
      : undefined

  // Pendant un glisser-pour-repondre, la fleche occupe la meme place que le
  // bouton d'actions : on masque ce dernier le temps du geste.
  const actionsShown = (actionsVisible || menuOpen) && dragX === 0

  const mediaSrc = msg.mediaUrl ? resolveMediaUrl(msg.mediaUrl) : ""
  const isVideoFile = (msg.mediaMime ?? "").startsWith("video/")
  const canExpandMedia = Boolean(mediaSrc) && !msg.isDeleted

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
    return <div style={{ display: "flex", justifyContent: "center", margin: "10px 0" }}>
      <div style={{ maxWidth: "82%", padding: "6px 12px", borderRadius: 14, background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", textAlign: "center", fontSize: 11, lineHeight: 1.35 }}>
        {msg.content}
      </div>
    </div>
  }

  return (<>
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
              aria-label="Actions du message"
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
                {menuItem("Repondre", () => onReply(msg))}
                {msg.content ? menuItem("Copier", () => onCopy(msg)) : null}
                {canExpandMedia ? menuItem("Agrandir", openExpandedPreview) : null}
                {msg.type === "audio" && mediaSrc ? menuItem("Télécharger l’audio", downloadAudio) : null}
                {menuItem("Transferer", () => onForward(msg))}
                {menuItem("Supprimer pour moi", () => onDelete(msg, "me"), true)}
                {isMe
                  ? menuItem("Supprimer pour tous", () => onDelete(msg, "everyone"), true)
                  : null}
              </div>
            )}
          </div>
        )}

        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Nom de l'envoyeur en groupe (pas pour soi-meme) */}
          {isGroup && !isMe && senderName && !msg.isDeleted && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: senderNameColor(msg.senderId),
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
              title={msg.replyTo && onJumpToMessage ? "Aller au message d'origine" : undefined}
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
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {quotedMediaLabel(replyMsg)}
                  </span>
                </div>
              ) : <span>{quote.content}</span>}
                </div>
              </div>
            </div>
            )}

            {msg.isDeleted ? (
              <span style={{ fontStyle: "italic", opacity: 0.65, fontSize: 12 }}>
                Ce message a ete supprime
              </span>
            ) : (
              <>
                {msg.type === "image" && mediaSrc && (
                  <img src={mediaSrc} alt={msg.fileName ?? "image"} onClick={() => onOpenImage(mediaSrc, msg.fileName)} style={{ width: "100%", maxWidth: 280, height: "auto", maxHeight: 320, objectFit: "contain", boxSizing: "border-box", borderRadius: 12, display: "block", cursor: "zoom-in" }} />
                )}

                {msg.type === "audio" && mediaSrc && (
                  <div>
                    <AudioPlayer src={mediaSrc} durationMs={msg.durationMs} isMe={isMe} />
                    {/* Les fichiers audio importés restent identifiables, contrairement aux vocaux. */}
                    {msg.fileName && <div style={{ marginTop: 5, fontSize: 10, opacity: 0.76, display: "flex", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170, whiteSpace: "nowrap" }}>{msg.fileName}</span>
                      {msg.fileSize && <span>{msg.fileSize}</span>}
                      <span>{formatAudioDuration(msg.durationMs)}</span>
                    </div>}
                  </div>
                )}

                {msg.type === "video" && mediaSrc && (
                  <VideoPreview src={mediaSrc} name={msg.fileName} size={msg.fileSize} durationMs={msg.durationMs} />
                )}

                {msg.type === "file" && mediaSrc && isVideoFile && (
                  <VideoPreview src={mediaSrc} name={msg.fileName} size={msg.fileSize} durationMs={msg.durationMs} />
                )}

                {msg.type === "file" && (!mediaSrc || !isVideoFile) && (() => {
                  const fti = fileTypeInfo(msg.fileName, msg.mediaMime)
                  const ext = (msg.fileName ?? "").split(".").pop()?.toLowerCase() ?? ""
                  const mime = msg.mediaMime ?? ""
                  // --- Preview du fichier ---
                  const filePreview = (() => {
                    // Même sans mediaSrc : afficher la carte d'aperçu (visible sur PC et mobile)
                    // Pour les images, PDF, CSV, DOC avec URL : on affiche le preview natif
                    const isImageFile = mediaSrc && (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext))
                    const isPdfFile = mediaSrc && (ext === "pdf" || mime === "application/pdf")
                    const isTextOrCodeFile = mediaSrc && (TEXT_PREVIEW_EXTENSIONS.includes(ext) || mime.startsWith("text/"))
                    const isDocFile = mediaSrc && (["doc","docx"].includes(ext) || mime.includes("word")) && !mediaSrc.startsWith("blob:")
                    const isSpreadsheetFile = mediaSrc && (["xls","xlsx","ods","numbers"].includes(ext) || mime.includes("spreadsheet") || mime.includes("excel")) && !mediaSrc.startsWith("blob:")
                    const isPresentationFile = mediaSrc && (["ppt","pptx"].includes(ext) || mime.includes("presentation")) && !mediaSrc.startsWith("blob:")
                    const isVideoFileLocal = mediaSrc && (ext === "mp4" || ext === "mov" || ext === "avi" || ext === "mkv" || ext === "webm" || mime.startsWith("video/"))

                    if (isImageFile) {
                      return (
                        <img src={mediaSrc} alt={msg.fileName ?? "image"} style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 10, display: "block", marginBottom: 6, cursor: "zoom-in" }} />
                      )
                    }
                    if (isVideoFileLocal) {
                      return (
                        <video src={mediaSrc} controls preload="metadata" style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 10, display: "block", marginBottom: 6 }} />
                      )
                    }
                    if (isPdfFile) {
                      return (
                        <LazyPreview minHeight={220}>
                          <div style={{ maxHeight: 220, overflow: "hidden", borderRadius: 10, marginBottom: 6 }}><PdfViewer url={mediaSrc} isMe={isMe} /></div>
                        </LazyPreview>
                      )
                    }
                    if (isDocFile) {
                      return <OfficePreview url={mediaSrc} name={msg.fileName} label="Word" isMe={isMe} height={200} />
                    }
                    if (isSpreadsheetFile) {
                      return <OfficePreview url={mediaSrc} name={msg.fileName} label="Excel" isMe={isMe} height={200} />
                    }
                    if (isPresentationFile) {
                      return <OfficePreview url={mediaSrc} name={msg.fileName} label="PowerPoint" isMe={isMe} height={200} />
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
                        onClick={() => { setDownloading(true); setTimeout(() => setDownloading(false), 2500) }}
                        style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "12px 14px", borderRadius: 10, marginBottom: 6,
                          background: isMe ? "#ffffff20" : "#f5f6fa",
                          border: `1px solid ${isMe ? "#ffffff35" : "#dde1e7"}`,
                          textDecoration: "none", color: isMe ? "#fff" : "var(--text-primary)",
                          width: "100%",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                          position: "relative",
                        }}
                      >
                        {downloading && (
                          <div style={{ position: "absolute", top: 4, right: 4, width: 12, height: 12, borderRadius: "50%", border: `2px solid ${isMe ? "rgba(255,255,255,0.3)" : "var(--border-subtle)"}`, borderTopColor: isMe ? "#fff" : "var(--accent)", animation: "spin 0.8s linear infinite" }} />
                        )}
                        <div style={{
                          width: 48, height: 48, borderRadius: 10,
                          background: `${fti.color}18`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                        }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={fti.color} strokeWidth="2" strokeLinecap="round">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {msg.fileName ?? msg.content ?? "Fichier"}
                          </div>
                          {msg.fileSize && <div style={{ fontSize: 10, opacity: 0.7 }}>{msg.fileSize}</div>}
                          {msg.fileSize && msg.fileName ? <div style={{ fontSize: 9, opacity: 0.7, marginTop: 1 }}>Pages : ~{estimatePages(msg.fileName, msg.fileSize)}</div> : null}
                          <div style={{ fontSize: 9, opacity: 0.85, marginTop: 2, color: isMe ? "rgba(255,255,255,0.9)" : "var(--text-secondary)" }}>
                            {mediaSrc ? "Aperçu disponible — cliquer pour ouvrir" : "Aperçu disponible après chargement"}
                          </div>
                          {msg.status === "sending" && (
                            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, fontSize: 10, opacity: 0.8 }}>
                              <span style={{ width: 10, height: 10, borderRadius: "50%", border: `2px solid ${isMe ? "rgba(255,255,255,0.35)" : "var(--text-secondary)"}`, borderTopColor: isMe ? "#fff" : "var(--accent)", animation: "spin 0.8s linear infinite" }} />
                              <span style={{ color: isMe ? "rgba(255,255,255,0.9)" : "var(--text-secondary)" }}>Envoi en cours...</span>
                            </div>
                          )}
                          <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setViewingDoc({ url: mediaSrc || msg.mediaUrl || "#", name: msg.fileName, mime: msg.mediaMime }); setDownloading(true); setTimeout(() => setDownloading(false), 2500); }}
                              style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: isMe ? "#ffffff25" : "var(--accent)", color: isMe ? "#fff" : "var(--accent-text)", fontSize: 10, fontWeight: 600, cursor: "pointer" }}
                            >
                              Ouvrir
                            </button>
                            <a href={mediaSrc ? mediaSrc : "#"} target="_blank" rel="noreferrer" onClick={(e) => { e.stopPropagation(); setDownloading(true); setTimeout(() => setDownloading(false), 2500); }} style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${isMe ? "#ffffff30" : "var(--border-default)"}`, background: "transparent", color: isMe ? "rgba(255,255,255,0.8)" : "var(--text-secondary)", fontSize: 10, fontWeight: 500, textDecoration: "none", display: "inline-block" }}>
                              Télécharger
                            </a>
                          </div>
                        </div>
                      </a>
                    )
                  })()

                  return (
                    <>
                      <div
                        style={{ position: "relative", cursor: canExpandMedia ? "zoom-in" : undefined }}
                        onDoubleClick={() => { if (canExpandMedia) openExpandedPreview() }}
                        onPointerUp={canExpandMedia ? onPreviewPointerUp : undefined}
                        title={canExpandMedia ? "Double-cliquez ou tapez deux fois pour agrandir" : undefined}
                      >
                        {filePreview}
                      </div>
                      <a
                        href={msg.mediaUrl ? resolveMediaUrl(msg.mediaUrl, { download: true }) : "#"}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          minWidth: 200, color: "inherit", textDecoration: "none",
                        }}
                      >
                        <div style={{
                          width: 40, height: 40, borderRadius: 8,
                          background: `${fti.color}18`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0, flexDirection: "column", gap: 1,
                        }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={fti.color} strokeWidth="2" strokeLinecap="round">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span style={{ fontSize: 7, fontWeight: 700, color: fti.color, letterSpacing: 0.5 }}>{fti.label}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {msg.fileName ?? msg.content ?? "Fichier"}
                          </div>
                          {msg.fileSize && <div style={{ fontSize: 10, opacity: 0.7 }}>{msg.fileSize}</div>}
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                      </a>
                    </>
                  )
                })()}

                {/* Legende du media : elle accompagne aussi les documents et les
                    audios, sinon le texte saisi au moment de l'envoi serait perdu
                    a l'affichage. */}
                {msg.content && (
                  <span
                    style={
                      msg.type === "image"
                        ? { display: "block", padding: "6px 8px 4px" }
                        : msg.type === "file" || msg.type === "audio" || msg.type === "video"
                          ? { display: "block", marginTop: 5 }
                          : undefined
                    }
                  >
                    <RichText text={extractGpsCoords(msg.content) ? removeGpsCoordinates(msg.content) : msg.content} isMe={isMe} />
                    {(() => {
                      const gps = extractGpsCoords(msg.content)
                      return gps ? <GpsPreview lat={gps.lat} lng={gps.lng} isMe={isMe} /> : null
                    })()}
                  </span>
                )}
              </>
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
                {formatTime(msg.timestamp)}
                {isMe && <StatusIcon status={msg.status} />}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
    {viewingDoc && (
      <DocumentViewer url={viewingDoc.url} name={viewingDoc.name} mime={viewingDoc.mime} isMe={isMe} onClose={() => setViewingDoc(null)} />
    )}
  </>)
}

export default function ChatRoomPage() {
  const params = useParams()
  const navigate = useNavigate()
  const chatId = params.chatId as string
  const returnTo = `/chats/${chatId}`
  const { error, success } = useToast()

  const contacts = useMemo(() => loadContacts(), [])
  const fallbackContact = useMemo(
    () => contacts.find((contact) => contact.id === chatId),
    [contacts, chatId]
  )
  const fallbackGroup = useMemo(() => findLocalGroup(chatId), [chatId])

  // Conversation chargee depuis le backend (GET /api/chats trouve par id)
  const [backendChat, setBackendChat] = useState<ConversationMock | null>(null)
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
  // Visionneuse d'image plein ecran
  const [lightbox, setLightbox] = useState<{ url: string; name?: string } | null>(null)
  /** Fichiers choisis mais pas encore envoyes : l'ecran de confirmation les porte. */
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([])
  const [pendingIndex, setPendingIndex] = useState(0)
  // Message en cours de transfert (ouvre le selecteur de conversations)
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null)
  // Enregistrement vocal en cours
  const [recording, setRecording] = useState(false)
  const [recordSec, setRecordSec] = useState(0)

  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesBodyRef = useRef<HTMLDivElement>(null)
  // Evite que les refresh/previews renvoient l'utilisateur en bas pendant sa lecture.
  const isNearBottomRef = useRef(true)
  const lastMessageIdRef = useRef<string | null>(null)
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
      if (attachRef.current && !attachRef.current.contains(event.target as Node)) setShowAttach(false)
    }
    document.addEventListener("pointerdown", closeOutside)
    return () => document.removeEventListener("pointerdown", closeOutside)
  }, [showAttach])

  const refreshMessages = useCallback(async () => {
    await fetchMessagesCacheFirst(
      chatId,
      // onCached : affichage instantané depuis IndexedDB (~2ms)
      (cached) => {
        setMessages((prev) => {
          const pending = prev.filter(
            (m) => m.id.startsWith("tmp-") && !cached.some((saved) => saved.id === m.id)
          )
          return [...cached, ...pending]
        })
      },
      // onFresh : mise à jour silencieuse avec les données réseau
      (fresh) => {
        setMessages((prev) => {
          const pending = prev.filter(
            (m) => m.id.startsWith("tmp-") && !fresh.some((saved) => saved.id === m.id)
          )
          return [...fresh, ...pending]
        })
      }
    )
  }, [chatId])

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
      setMessages((prev) =>
        event.scope === "me"
          ? prev.filter((m) => m.id !== event.messageId)
          : prev.map((m) =>
              m.id === event.messageId
                ? { ...m, isDeleted: true, content: "", mediaUrl: undefined }
                : m
            )
      )
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
    }
    lastMessageIdRef.current = newestId
  }, [messages])

  // Chaque conversation possède son propre chargement initial.
  useEffect(() => {
    initialScrollDoneRef.current = false
    lastMessageIdRef.current = null
    isNearBottomRef.current = true
  }, [chatId])

  const handleMessagesScroll = () => {
    const body = messagesBodyRef.current
    if (!body) return
    isNearBottomRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 100
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
      const message = err instanceof Error ? err.message : "Envoi impossible."
      error("Message non envoye", message)
    } finally {
      setSending(false)
    }
  }, [input, sending, replyTo, chatId, error])

  // Touche Entree = envoi (Shift+Entree = saut de ligne)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Auto-resize du textarea + emission typing via WebSocket
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
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
      const tempId = `tmp-${Date.now()}`
      const localUrl = URL.createObjectURL(file)
      const optimistic: Message = {
        id: tempId,
        senderId: "me",
        content: caption,
        type: msgType,
        status: "sending",
        timestamp: new Date(),
        fileName: filename,
        fileSize: `${(file.size / 1024 / 1024).toFixed(1)} Mo`,
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
          return prev.map((m) => m.id === tempId ? {
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
          } : m)
        })
        // Le blob local n'est plus affiche des que le media confirme prend sa
        // place. Sans cette liberation, chaque fichier envoye restait retenu en
        // memoire jusqu'au rechargement de la page. On ne libere que si le
        // backend a bien renvoye une URL : sinon le blob porte encore l'apercu.
        if (saved.mediaUrl) {
          try { URL.revokeObjectURL(localUrl) } catch { /* deja libere */ }
        }
      } catch (err) {
        setMessages((prev) => {
          const msg = prev.find((m) => m.id === tempId)
          if (msg?.mediaUrl && msg.mediaUrl.startsWith("blob:")) {
            try { URL.revokeObjectURL(msg.mediaUrl) } catch { /* ignore */ }
          }
          return prev.filter((m) => m.id !== tempId)
        })
        const message = err instanceof Error ? err.message : "Envoi du fichier impossible."
        error("Fichier non envoye", message)
      }
    },
    [chatId, replyTo, error]
  )

  const mediaKindFromFile = (file: File): "image" | "audio" | "video" | "file" => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (file.type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"].includes(ext)) return "image"
    if (file.type.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video"
    if (file.type.startsWith("audio/") || ["mp3", "aac", "acc", "wav", "ogg", "m4a", "flac", "webm"].includes(ext)) return "audio"
    return "file"
  }

  const readAudioDuration = (file: File): Promise<number | undefined> => new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = document.createElement("audio")
    audio.preload = "metadata"
    const done = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined) }
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
      error("Fichier(s) trop volumineux", `${oversized.length} fichier(s) depassent 2 Go et seront ignores.`)
    }
    const valid = toSend.filter((f) => f.size <= 2000 * 1024 * 1024)
    const prepared: PendingMedia[] = []
    for (const file of valid) {
      const kind = mediaKindFromFile(file)
      const ext = file.name.split(".").pop()?.toLowerCase()
      // Certains gestionnaires Android annoncent .aac/.acc comme octet-stream.
      // On transmet le MIME attendu par le backend afin qu'il ne soit pas rejeté.
      const mime = (ext === "aac" || ext === "acc") ? "audio/aac" : (file.type || "application/octet-stream")
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
      prev.forEach((item) => { try { URL.revokeObjectURL(item.url) } catch { /* deja libere */ } })
      return []
    })
    setPendingIndex(0)
  }, [])

  const removePendingMedia = useCallback((index: number) => {
    setPendingMedia((prev) => {
      const target = prev[index]
      if (target) { try { URL.revokeObjectURL(target.url) } catch { /* deja libere */ } }
      return prev.filter((_, i) => i !== index)
    })
    setPendingIndex((prev) => (index < prev || prev > 0 ? Math.max(0, prev - 1) : prev))
  }, [])

  /** Confirmation : chaque fichier part avec sa propre legende, dans l'ordre choisi. */
  const sendPendingMedia = useCallback(() => {
    pendingMedia.forEach((item) => {
      void sendMediaMessage(item.file, item.file.name, item.mime, item.kind, item.durationMs, item.caption.trim())
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
      error("Micro inaccessible", "Autorisez le micro pour envoyer un vocal.")
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

  // --- Actions sur un message ---
  const handleCopy = (msg: Message) => {
    void navigator.clipboard
      .writeText(msg.content)
      .then(() => success("Copie", "Message copie dans le presse-papiers."))
      .catch(() => error("Copie impossible", "Le presse-papiers est inaccessible."))
  }

  const handleDelete = (msg: Message, scope: "me" | "everyone") => {
    deleteChatMessage(msg.id, scope)
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
    void startOutgoingCall(chatId, callType, chat?.name ?? "Contact")
      .then((newCallId) => {
        navigate(`/calls/${newCallId}?type=${callType}&returnTo=${encodeURIComponent(returnTo)}`)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Impossible de demarrer l'appel."
        error("Appel impossible", message)
      })
  }

  // Index des messages : le bloc de citation cherchait son origine avec un
  // find() par message rendu, soit un cout quadratique sur un fil charge.
  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])

  // Fil unifie : messages + evenements d'appel (facon WhatsApp), tries par date.
  type TimelineItem =
    | { kind: "msg"; ts: Date; msg: Message }
    | { kind: "call"; ts: Date; call: CallRecord }
  const timeline: TimelineItem[] = [
    ...messages.map((msg): TimelineItem => ({ kind: "msg", ts: msg.timestamp, msg })),
    ...callEvents.map((call): TimelineItem => ({ kind: "call", ts: call.ts, call })),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime())

  /** Nom affichable d'un expediteur : membre du groupe, contact, sinon debut d'UUID. */
  const resolveSenderName = (senderId: string): string => {
    if (senderId === "me") return "Vous"
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
      error("Message introuvable", "Il est trop ancien pour etre affiche ici.")
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
      <div style={{ padding: 24, color: "var(--text-muted)" }}>
        Chargement de la conversation...
      </div>
    )
  }

  if (!chat) {
    // Ne pas rediriger brutalement après un échec réseau temporaire : cela faisait
    // « disparaître » la discussion quelques secondes après son ouverture.
    return <div className="room-root" style={{ padding: 24, color: "var(--text-muted)" }}>Conversation temporairement indisponible. Vérifiez la connexion puis revenez à la liste des discussions.</div>
  }

  const color = CHAT_COLORS[chat.colorIdx % CHAT_COLORS.length]

  return (
    <div className={`room-root ${infoPanelOpen ? "info-panel-open" : ""}`}>
      <div className="room-top">
        <button className="back-btn" onClick={() => navigate("/chats")} aria-label="Retour">
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
              ? "en train d'ecrire..."
              : chat.isGroup
                ? `${chat.members?.length ?? 0} membres`
                : peerOnline
                  ? "En ligne"
                  : " "}
          </div>
        </div>

        <div className="room-actions">
          {/* Appel audio */}
          <button className="action-btn" aria-label="Appel audio" title="Appel audio" onClick={() => startCallFromChat("audio")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" /></svg>
          </button>
          {/* Appel video */}
          <button className="action-btn" aria-label="Appel video" title="Appel video" onClick={() => startCallFromChat("video")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
          </button>
          {!infoPanelOpen && <button className="action-btn" aria-label="Infos conversation" title="Infos" onClick={() => { if (window.matchMedia("(min-width: 901px)").matches) setInfoPanelOpen(true); else navigate(`/chats/${chatId}/info`) }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
          </button>}
        </div>
      </div>

      <div ref={messagesBodyRef} className="room-body" onScroll={handleMessagesScroll}>
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
              const msg = item.msg
              const isMe = msg.senderId === "me"
              const reply = msg.replyTo ? messagesById.get(msg.replyTo) : undefined
              // Resoudre le nom de l'envoyeur pour les groupes
              const resolvedName = !isMe && chat?.isGroup ? resolveSenderName(msg.senderId) : undefined
              // Auteur du message cite : affiche en tete du bloc de citation.
              const quotedSenderId = msg.replySnapshot?.senderId ?? reply?.senderId
              const quoteAuthor = quotedSenderId ? resolveSenderName(quotedSenderId) : undefined
              return (
                <MessageErrorBoundary key={msg.id} name={msg.fileName ?? msg.content} size={msg.fileSize}>
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isMe={isMe}
                  replyMsg={reply}
                  onReply={setReplyTo}
                  onOpenImage={(url, name) => setLightbox({ url, name })}
                  onDelete={handleDelete}
                  onForward={setForwardMsg}
                  onCopy={handleCopy}
                  isGroup={chat?.isGroup}
                  senderName={resolvedName}
                  quoteAuthor={quoteAuthor}
                  onJumpToMessage={jumpToMessage}
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
            <div className="reply-bar-label">Repondre a</div>
            <div className="reply-bar-txt">
              {hasQuotedMedia(replyTo) ? quotedMediaLabel(replyTo) : replyTo.content}
            </div>
          </div>
          <button
            className="reply-cancel"
            onClick={() => setReplyTo(null)}
            aria-label="Annuler la reponse"
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

      <div className="room-input-wrap">
        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />

        <div ref={attachRef} className="room-input-row" style={{ position: "relative" }} onMouseLeave={() => setShowAttach(false)}>
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
                <div className="attach-icon" style={{ background: "#a78bfa20", color: "#a78bfa" }}>
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
                Photo / image
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
                    <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
                  </svg>
                </div>
                Vidéo
              </button>
              <button
                className="attach-opt"
                onClick={() => {
                  fileRef.current!.accept = ".pdf,.doc,.docx,.txt,.tsx,.css,.json,.py,.java,.cpp,.h,.md,.yaml,.yml,.properties,.xml,.php"
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
                Document
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
                Audio
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
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                </div>
                Tout fichier
              </button>
            </div>
          )}

          <button
            className="attach-btn"
            onMouseEnter={() => setShowAttach(true)}
            onClick={() => setShowAttach((v) => !v)}
            aria-expanded={showAttach}
            aria-label="Joindre un fichier"
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
                Enregistrement du vocal...
              </span>
              <button
                onClick={() => stopRecording(true)}
                aria-label="Annuler le vocal"
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
                Annuler
              </button>
              <button
                className="send-btn"
                onClick={() => stopRecording(false)}
                aria-label="Envoyer le vocal"
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
                placeholder="Message..."
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                rows={1}
                aria-label="Saisir un message"
              />

              {input.trim() ? (
                <button
                  className="send-btn"
                  onClick={sendMessage}
                  disabled={sending}
                  aria-label="Envoyer"
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
                  aria-label="Enregistrer un vocal"
                  title="Enregistrer un message vocal"
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

      {infoPanelOpen && <aside className="chat-info-drawer"><ChatInfoPage embedded onEmbeddedClose={() => setInfoPanelOpen(false)} /></aside>}

      {/* Visionneuse d'image plein ecran */}
      {pendingMedia.length > 0 && (
        <MediaComposer
          items={pendingMedia}
          index={Math.min(pendingIndex, pendingMedia.length - 1)}
          onIndexChange={setPendingIndex}
          onCaptionChange={(index, caption) =>
            setPendingMedia((prev) => prev.map((item, i) => (i === index ? { ...item, caption } : item)))
          }
          onRemove={removePendingMedia}
          onCancel={closeMediaComposer}
          onSend={sendPendingMedia}
        />
      )}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9000,
            background: "#000000d9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            cursor: "zoom-out",
          }}
        >
          <img
            src={lightbox.url}
            alt={lightbox.name ?? "image"}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "92vw",
              maxHeight: "88vh",
              borderRadius: 8,
              boxShadow: "0 24px 80px #000000a0",
              cursor: "default",
            }}
          />
          <div style={{ position: "absolute", top: 16, right: 16, display: "flex", gap: 10 }}>
            <a
              href={lightbox.url.includes("?") ? `${lightbox.url}&download=1` : lightbox.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="Telecharger l'image"
              style={{
                background: "#ffffff20",
                border: "none",
                borderRadius: 8,
                padding: "8px 10px",
                color: "#fff",
                display: "flex",
                alignItems: "center",
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
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            </a>
            <button
              onClick={() => setLightbox(null)}
              aria-label="Fermer"
              style={{
                background: "#ffffff20",
                border: "none",
                borderRadius: 8,
                padding: "8px 10px",
                color: "#fff",
                cursor: "pointer",
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Selecteur de conversations pour le transfert */}
      {forwardMsg && (
        <ForwardDialog
          onClose={() => setForwardMsg(null)}
          onForward={async (convIds) => {
            try {
              const count = await forwardChatMessage(forwardMsg.id, convIds)
              success("Message transfere", `Envoye dans ${count} conversation(s).`)
            } catch (err) {
              const message = err instanceof Error ? err.message : "Transfert impossible."
              error("Transfert echoue", message)
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
          Transferer vers...
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {loading && (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              Chargement...
            </div>
          )}
          {!loading && conversations.length === 0 && (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
              Aucune conversation disponible.
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
            Annuler
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
            {sending ? "Transfert..." : `Transferer (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
