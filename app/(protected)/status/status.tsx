import { useCallback, useEffect, useRef, useState } from "react"
import { useToast } from "../../../src/components/toast"
import { toInitials } from "../../../src/data/session-user"
import { resolveMediaUrl } from "../../../src/services/media-service"
import {
  deleteStatus,
  fetchStatusFeed,
  postMediaStatus,
  postTextStatus,
  viewStatus,
  type StatusFeed,
  type StatusGroup,
} from "../../../src/services/status-service"
import "../calls/calls-page.css"

const TEXT_BG_COLORS = ["#8A4B2B", "#2E7D32", "#C04D29", "#1D4ED8", "#6D28D9", "#2B1B12"]
const STATUS_DURATION_MS = 5000

function groupLabel(group: StatusGroup): string {
  return group.pseudo?.trim() || group.publicNumber
}

function timeAgo(iso: string): string {
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (diffMin < 1) return "a l'instant"
  if (diffMin < 60) return `il y a ${diffMin} min`
  const h = Math.floor(diffMin / 60)
  return `il y a ${h} h`
}

/** Anneau d'avatar : accent si statuts non vus, discret sinon. */
function StatusAvatar({
  group,
  isMine,
  onClick,
}: {
  group: StatusGroup
  isMine?: boolean
  onClick: () => void
}) {
  const label = isMine ? "Mon statut" : groupLabel(group)
  const ringColor = group.hasUnviewed && !isMine ? "var(--accent)" : "var(--border-strong)"
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        width: 86,
      }}
    >
      <div
        style={{
          width: 62,
          height: 62,
          borderRadius: "50%",
          border: `2.5px solid ${ringColor}`,
          padding: 3,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: "var(--accent-dim)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 16,
            fontFamily: "'Bricolage Grotesque', sans-serif",
          }}
        >
          {toInitials(label)}
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          color: "var(--text-secondary)",
          maxWidth: 84,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </button>
  )
}

export default function StatusPage() {
  const { success, error } = useToast()
  const [feed, setFeed] = useState<StatusFeed>({ me: null, others: [] })
  const [loading, setLoading] = useState(true)

  // Visionneuse : groupe ouvert + index du statut affiche
  const [viewer, setViewer] = useState<{
    group: StatusGroup
    index: number
    isMine: boolean
  } | null>(null)
  const [progress, setProgress] = useState(0)
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Composeur
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerText, setComposerText] = useState("")
  const [composerBg, setComposerBg] = useState(TEXT_BG_COLORS[0])
  const [posting, setPosting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    try {
      const data = await fetchStatusFeed()
      setFeed(data)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[status] chargement echoue", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /* ----------------- Visionneuse ----------------- */

  const closeViewer = useCallback(() => {
    setViewer(null)
    if (progressTimer.current) {
      clearInterval(progressTimer.current)
      progressTimer.current = null
    }
    void reload() // rafraichit les anneaux vus/non-vus
  }, [reload])

  const goTo = useCallback((delta: number) => {
    setViewer((current) => {
      if (!current) return null
      const nextIndex = current.index + delta
      if (nextIndex < 0) return { ...current, index: 0 }
      if (nextIndex >= current.group.statuses.length) return null // fin du groupe
      return { ...current, index: nextIndex }
    })
    setProgress(0)
  }, [])

  // Progression + auto-avance (les videos avancent a la fin via onEnded).
  useEffect(() => {
    if (!viewer) return
    const status = viewer.group.statuses[viewer.index]
    if (!status) return

    if (!viewer.isMine) void viewStatus(status.id)

    setProgress(0)
    if (progressTimer.current) clearInterval(progressTimer.current)
    if (status.type === "VIDEO") return // gere par onEnded

    const startedAt = Date.now()
    progressTimer.current = setInterval(() => {
      const ratio = (Date.now() - startedAt) / STATUS_DURATION_MS
      if (ratio >= 1) {
        goTo(1)
      } else {
        setProgress(ratio)
      }
    }, 50)

    return () => {
      if (progressTimer.current) {
        clearInterval(progressTimer.current)
        progressTimer.current = null
      }
    }
  }, [viewer, goTo])

  // Le viewer devient null quand on depasse le dernier statut -> fermeture propre.
  useEffect(() => {
    if (viewer === null && progressTimer.current) {
      clearInterval(progressTimer.current)
      progressTimer.current = null
      void reload()
    }
  }, [viewer, reload])

  /* ----------------- Composeur ----------------- */

  const submitTextStatus = async () => {
    const text = composerText.trim()
    if (!text || posting) return
    setPosting(true)
    try {
      await postTextStatus(text, composerBg)
      success("Statut publie", "Visible par vos contacts pendant 24 h.")
      setComposerText("")
      setComposerOpen(false)
      await reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Publication impossible."
      error("Statut non publie", message)
    } finally {
      setPosting(false)
    }
  }

  const submitMediaStatus = async (file: File) => {
    if (posting) return
    if (file.size > 50 * 1024 * 1024) {
      error("Fichier trop volumineux", "Maximum 50 Mo.")
      return
    }
    setPosting(true)
    try {
      await postMediaStatus(file)
      success("Statut publie", "Visible par vos contacts pendant 24 h.")
      setComposerOpen(false)
      await reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Publication impossible."
      error("Statut non publie", message)
    } finally {
      setPosting(false)
    }
  }

  const handleDeleteCurrent = async () => {
    if (!viewer || !viewer.isMine) return
    const status = viewer.group.statuses[viewer.index]
    try {
      await deleteStatus(status.id)
      success("Statut supprime", "")
      closeViewer()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Suppression impossible."
      error("Erreur", message)
    }
  }

  const currentStatus = viewer?.group.statuses[viewer.index]

  return (
    <div className="calls-root" style={{ padding: "20px 0" }}>
      <div className="calls-head" style={{ marginBottom: 18 }}>
        <div className="calls-title-row">
          <h1 className="calls-title">Statuts</h1>
          <button className="new-call-btn" onClick={() => setComposerOpen((v) => !v)}>
            {composerOpen ? "Fermer" : "+ Publier un statut"}
          </button>
        </div>
      </div>

      {composerOpen && (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 14,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            Statut texte (fond colore) ou photo/video — visible 24 h par vos contacts.
          </div>
          <textarea
            className="input-base"
            placeholder="Exprimez-vous..."
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            maxLength={700}
            rows={3}
            style={{ width: "100%", padding: 12, fontSize: 13, resize: "vertical" }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            {TEXT_BG_COLORS.map((colorHex) => (
              <button
                key={colorHex}
                onClick={() => setComposerBg(colorHex)}
                aria-label={`Fond ${colorHex}`}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: colorHex,
                  border:
                    composerBg === colorHex
                      ? "3px solid var(--text-primary)"
                      : "2px solid var(--border-default)",
                  cursor: "pointer",
                }}
              />
            ))}
            <div style={{ flex: 1 }} />
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void submitMediaStatus(file)
                e.target.value = ""
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={posting}
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: "8px 14px",
                color: "var(--text-secondary)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Photo / video
            </button>
            <button
              className="new-call-btn"
              onClick={() => void submitTextStatus()}
              disabled={!composerText.trim() || posting}
            >
              {posting ? "Publication..." : "Publier"}
            </button>
          </div>
        </div>
      )}

      {/* Rangee "Mon statut" + contacts */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {feed.me && feed.me.statuses.length > 0 && (
          <StatusAvatar
            group={feed.me}
            isMine
            onClick={() => setViewer({ group: feed.me!, index: 0, isMine: true })}
          />
        )}
        {feed.others.map((group) => (
          <StatusAvatar
            key={group.userId}
            group={group}
            onClick={() => setViewer({ group, index: 0, isMine: false })}
          />
        ))}
      </div>

      {loading && (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: 12 }}>Chargement...</div>
      )}
      {!loading && !feed.me?.statuses.length && feed.others.length === 0 && (
        <div className="empty-state">
          <div className="empty-txt">
            Aucun statut pour le moment. Publiez le votre ou ajoutez des contacts !
          </div>
        </div>
      )}

      {/* Visionneuse plein ecran */}
      {viewer && currentStatus && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9000,
            background: "#000000f0",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Barres de progression */}
          <div style={{ display: "flex", gap: 4, padding: "12px 14px 8px" }}>
            {viewer.group.statuses.map((s, i) => (
              <div
                key={s.id}
                style={{ flex: 1, height: 3, borderRadius: 2, background: "#ffffff35" }}
              >
                <div
                  style={{
                    height: "100%",
                    borderRadius: 2,
                    background: "#fff",
                    width:
                      i < viewer.index ? "100%" : i === viewer.index ? `${progress * 100}%` : "0%",
                  }}
                />
              </div>
            ))}
          </div>

          {/* En-tete */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 16px 10px" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "var(--accent)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {toInitials(viewer.isMine ? "Moi" : groupLabel(viewer.group))}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>
                {viewer.isMine ? "Mon statut" : groupLabel(viewer.group)}
              </div>
              <div style={{ color: "#ffffff90", fontSize: 11 }}>
                {timeAgo(currentStatus.createdAt)}
                {viewer.isMine ? ` — ${currentStatus.viewsCount} vue(s)` : ""}
              </div>
            </div>
            {viewer.isMine && (
              <button
                onClick={() => void handleDeleteCurrent()}
                aria-label="Supprimer ce statut"
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
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            )}
            <button
              onClick={closeViewer}
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
                width="16"
                height="16"
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

          {/* Contenu + zones de navigation (gauche = precedent, droite = suivant) */}
          <div
            style={{
              flex: 1,
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <div
              onClick={() => goTo(-1)}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "32%",
                zIndex: 5,
                cursor: "w-resize",
              }}
            />
            <div
              onClick={() => goTo(1)}
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: "32%",
                zIndex: 5,
                cursor: "e-resize",
              }}
            />

            {currentStatus.type === "TEXT" && (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background: currentStatus.bgColor ?? "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 40,
                }}
              >
                <div
                  style={{
                    color: "#fff",
                    fontSize: 26,
                    fontWeight: 700,
                    textAlign: "center",
                    fontFamily: "'Bricolage Grotesque', sans-serif",
                    maxWidth: 640,
                    lineHeight: 1.4,
                    wordBreak: "break-word",
                  }}
                >
                  {currentStatus.text}
                </div>
              </div>
            )}

            {currentStatus.type === "IMAGE" && currentStatus.mediaUrl && (
              <img
                src={resolveMediaUrl(currentStatus.mediaUrl)}
                alt="statut"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            )}

            {currentStatus.type === "VIDEO" && currentStatus.mediaUrl && (
              <video
                key={currentStatus.id}
                src={resolveMediaUrl(currentStatus.mediaUrl)}
                autoPlay
                playsInline
                controls={false}
                onTimeUpdate={(e) => {
                  const video = e.currentTarget
                  if (Number.isFinite(video.duration) && video.duration > 0) {
                    setProgress(video.currentTime / video.duration)
                  }
                }}
                onEnded={() => goTo(1)}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
