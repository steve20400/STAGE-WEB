import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react"
import { useTranslation } from "../i18n"

type ToastType = "success" | "error" | "warning" | "info"

interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number // ms, defaut 4000
}

interface ToastContextValue {
  toast: (t: Omit<Toast, "id">) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>")
  return ctx
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  error: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  warning: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
}

const STYLES: Record<ToastType, { icon: string; bar: string; bg: string; border: string }> = {
  success: { icon: "#4ade80", bar: "#4ade80", bg: "#0D1118", border: "#4ade8040" },
  error: { icon: "#f87171", bar: "#f87171", bg: "#0D1118", border: "#f8717140" },
  warning: { icon: "#fbbf24", bar: "#fbbf24", bg: "#0D1118", border: "#fbbf2440" },
  info: { icon: "#60a5fa", bar: "#60a5fa", bg: "#0D1118", border: "#60a5fa40" },
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const s = STYLES[toast.type]
  const duration = toast.duration ?? 4000

  useEffect(() => {
    const apparition = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(apparition)
  }, [])

  useEffect(() => {
    timerRef.current = setTimeout(() => dismiss(), duration)
    return () => clearTimeout(timerRef.current)
  }, [duration])

  const dismiss = () => {
    setExiting(true)
    setTimeout(() => onRemove(toast.id), 320)
  }

  return (
    <div
      style={{
        position: "relative",
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 12,
        padding: "13px 14px",
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        minWidth: 280,
        maxWidth: 380,
        overflow: "hidden",
        cursor: "pointer",
        fontFamily: "'DM Sans', sans-serif",
        opacity: visible && !exiting ? 1 : 0,
        transform: visible && !exiting ? "translateX(0) scale(1)" : "translateX(20px) scale(.97)",
        transition: "opacity .28s ease, transform .28s ease",
        boxShadow: "0 4px 24px #00000060",
      }}
      onClick={dismiss}
    >
      {/* Barre de progression */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: 2,
          background: s.bar,
          borderRadius: "0 0 0 12px",
          animation: `toastProgress ${duration}ms linear forwards`,
        }}
      />

      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          flexShrink: 0,
          background: s.icon + "20",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: s.icon,
          marginTop: 1,
        }}
      >
        {ICONS[toast.type]}
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#E2E8F0",
            marginBottom: toast.message ? 2 : 0,
          }}
        >
          {toast.title}
        </div>
        {toast.message && (
          <div style={{ fontSize: 11, color: "#4B5563", lineHeight: 1.55 }}>{toast.message}</div>
        )}
      </div>

      {/* Croix */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          dismiss()
        }}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#374151",
          padding: 2,
          display: "flex",
          flexShrink: 0,
          transition: "color .15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#9CA3AF")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#374151")}
        aria-label={t("close")}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback((contenu: Omit<Toast, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts((prev) => [...prev.slice(-4), { ...contenu, id }]) // max 5 toasts
  }, [])

  const success = useCallback(
    (title: string, message?: string) => toast({ type: "success", title, message }),
    [toast]
  )
  const error = useCallback(
    (title: string, message?: string) => toast({ type: "error", title, message }),
    [toast]
  )
  const warning = useCallback(
    (title: string, message?: string) => toast({ type: "warning", title, message }),
    [toast]
  )
  const info = useCallback(
    (title: string, message?: string) => toast({ type: "info", title, message }),
    [toast]
  )

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info }}>
      {children}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
        @keyframes toastProgress {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>

      <div
        aria-live="polite"
        aria-label={t("settings_notifications")}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 9999,
          pointerEvents: toasts.length ? "auto" : "none",
        }}
      >
        {toasts.map((item) => (
          <ToastItem key={item.id} toast={item} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
