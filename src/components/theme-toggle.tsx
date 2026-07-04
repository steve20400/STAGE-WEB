import { useEffect, useRef } from "react"
import { useTheme } from "./theme-provider"

export function ThemeToggle({ className }: { className?: string }) {
  const { palette, resolvedTheme, toggle, togglePalette } = useTheme()
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDark = resolvedTheme === "dark"
  const isSoftPalette = palette === "soft"

  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current)
    }
  }, [])

  const handlePress = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      togglePalette()
      return
    }

    clickTimer.current = setTimeout(() => {
      clickTimer.current = null
      toggle()
    }, 240)
  }

  return (
    <button
      onClick={handlePress}
      aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
      title={`${isDark ? "Mode clair" : "Mode sombre"} - double tap: ${isSoftPalette ? "theme standard" : "theme creme"}`}
      className={className}
      style={{
        width: 36,
        height: 36,
        borderRadius: 9,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: "var(--text-muted)",
        transition: "all .2s",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent-border)"
        e.currentTarget.style.color = "var(--accent)"
        e.currentTarget.style.background = "var(--accent-dim)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border-subtle)"
        e.currentTarget.style.color = "var(--text-muted)"
        e.currentTarget.style.background = "var(--bg-elevated)"
      }}
    >
      {isDark ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  )
}

export function ThemeSelector() {
  const { theme, setTheme } = useTheme()

  const OPTIONS = [
    {
      value: "light" as const,
      label: "Clair",
      icon: (
        <svg
          width="18"
          height="18"
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
      preview: (
        <div
          style={{
            width: "100%",
            height: 56,
            borderRadius: 7,
            background: "#F5EFE6",
            border: "1px solid #EADBC8",
            overflow: "hidden",
            marginBottom: 10,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              height: 14,
              background: "#FFFFFF",
              borderBottom: "1px solid #EADBC8",
              display: "flex",
              alignItems: "center",
              paddingLeft: 7,
              gap: 4,
            }}
          >
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#EADBC8" }} />
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#EADBC8" }} />
            <div
              style={{
                width: 28,
                height: 4,
                borderRadius: 2,
                background: "#8A4B2B",
                marginLeft: 4,
              }}
            />
          </div>
          <div style={{ flex: 1, display: "flex" }}>
            <div style={{ width: 40, background: "#FFFFFF", borderRight: "1px solid #EADBC8" }} />
            <div style={{ flex: 1, padding: 5, display: "flex", flexDirection: "column", gap: 3 }}>
              <div
                style={{
                  alignSelf: "flex-end",
                  width: "55%",
                  height: 9,
                  borderRadius: 5,
                  background: "#8A4B2B",
                }}
              />
              <div style={{ width: "70%", height: 9, borderRadius: 5, background: "#EADBC8" }} />
            </div>
          </div>
        </div>
      ),
    },
    {
      value: "dark" as const,
      label: "Sombre",
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      ),
      preview: (
        <div
          style={{
            width: "100%",
            height: 56,
            borderRadius: 7,
            background: "#150D08",
            border: "1px solid #372417",
            overflow: "hidden",
            marginBottom: 10,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              height: 14,
              background: "#1E130C",
              borderBottom: "1px solid #372417",
              display: "flex",
              alignItems: "center",
              paddingLeft: 7,
              gap: 4,
            }}
          >
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#372417" }} />
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#372417" }} />
            <div
              style={{
                width: 28,
                height: 4,
                borderRadius: 2,
                background: "#C8895E",
                marginLeft: 4,
              }}
            />
          </div>
          <div style={{ flex: 1, display: "flex" }}>
            <div style={{ width: 40, background: "#1E130C", borderRight: "1px solid #372417" }} />
            <div style={{ flex: 1, padding: 5, display: "flex", flexDirection: "column", gap: 3 }}>
              <div
                style={{
                  alignSelf: "flex-end",
                  width: "55%",
                  height: 9,
                  borderRadius: 5,
                  background: "#C8895E",
                }}
              />
              <div style={{ width: "70%", height: 9, borderRadius: 5, background: "#2B1B12" }} />
            </div>
          </div>
        </div>
      ),
    },
    {
      value: "system" as const,
      label: "Systeme",
      icon: (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <polyline points="8 21 12 17 16 21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
      preview: (
        <div
          style={{
            width: "100%",
            height: 56,
            borderRadius: 7,
            border: "1px solid var(--border-subtle)",
            overflow: "hidden",
            marginBottom: 10,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ flex: 1, display: "flex" }}>
            <div
              style={{
                flex: 1,
                background: "#F5EFE6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#8A4B2B"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42" />
              </svg>
            </div>
            <div
              style={{
                flex: 1,
                background: "#150D08",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#C8895E"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            </div>
          </div>
        </div>
      ),
    },
  ]

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
      {OPTIONS.map((opt) => {
        const active = theme === opt.value
        return (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            style={{
              background: active ? "var(--accent-dim)" : "var(--bg-elevated)",
              border: `1px solid ${active ? "var(--accent-border)" : "var(--border-subtle)"}`,
              borderRadius: 10,
              padding: "12px 10px",
              cursor: "pointer",
              textAlign: "center",
              transition: "all .2s",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              position: "relative",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.borderColor = "var(--border-default)"
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.borderColor = "var(--border-subtle)"
            }}
            aria-pressed={active}
          >
            {/* Checkmark */}
            {active && (
              <div
                style={{
                  position: "absolute",
                  top: 7,
                  right: 7,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
            )}

            {/* Miniature */}
            {opt.preview}

            <div style={{ color: active ? "var(--accent)" : "var(--text-muted)", marginBottom: 4 }}>
              {opt.icon}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: active ? "var(--accent)" : "var(--text-secondary)",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              {opt.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}
