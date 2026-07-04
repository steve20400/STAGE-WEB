import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

export type Theme = "dark" | "light" | "system"
export type Palette = "default" | "soft"

interface ThemeContextValue {
  theme: Theme // preference stockee ("dark" | "light" | "system")
  resolvedTheme: "dark" | "light" // theme reellement applique (system resolu)
  palette: Palette
  setTheme: (t: Theme) => void
  togglePalette: () => void
  toggle: () => void // bascule dark/light directement
}

const ThemeCtx = createContext<ThemeContextValue | null>(null)

// localStorage peut etre inaccessible (navigation privee, contexte embarque) :
// on ne doit jamais planter pour une preference de theme.
function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // tant pis, la preference ne sera pas memorisee
  }
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeCtx)
  if (!ctx) throw new Error("useTheme must be inside <ThemeProvider>")
  return ctx
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Clair creme par defaut, comme l'app mobile (le sombre reste une option).
  const [theme, setThemeState] = useState<Theme>("light")
  const [resolved, setResolved] = useState<"dark" | "light">("light")
  const [palette, setPaletteState] = useState<Palette>("default")

  useEffect(() => {
    const stored = (safeGet("alanya-theme") ?? "light") as Theme
    const storedPalette = (safeGet("alanya-palette") ?? "default") as Palette
    setThemeState(stored)
    setPalette(storedPalette === "soft" ? "soft" : "default")
    applyTheme(stored)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      if (theme === "system") applyTheme("system")
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [theme])

  function applyTheme(t: Theme) {
    const isDark =
      t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)

    const root = document.documentElement
    root.setAttribute("data-theme", isDark ? "dark" : "light")
    // Pour Tailwind dark mode (class strategy)
    if (isDark) root.classList.add("dark")
    else root.classList.remove("dark")

    setResolved(isDark ? "dark" : "light")
  }

  function setTheme(t: Theme) {
    setThemeState(t)
    safeSet("alanya-theme", t)
    applyTheme(t)
  }

  function setPalette(next: Palette) {
    const paletteValue = next === "soft" ? "soft" : "default"
    setPaletteState(paletteValue)
    safeSet("alanya-palette", paletteValue)
    document.documentElement.setAttribute("data-palette", paletteValue)
  }

  function toggle() {
    const next = resolved === "dark" ? "light" : "dark"
    setTheme(next)
  }

  function togglePalette() {
    setPalette(palette === "soft" ? "default" : "soft")
  }

  return (
    <ThemeCtx.Provider
      value={{ theme, resolvedTheme: resolved, palette, setTheme, toggle, togglePalette }}
    >
      {children}
    </ThemeCtx.Provider>
  )
}

//
//   <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
//
export const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('alanya-theme') || 'system';
    var palette = localStorage.getItem('alanya-palette') || 'default';
    var isDark = stored === 'dark' ||
      (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-palette', palette === 'soft' ? 'soft' : 'default');
    if (isDark) document.documentElement.classList.add('dark');
  } catch(e) {}
})();
`
