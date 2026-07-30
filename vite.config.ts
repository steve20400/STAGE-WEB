import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {
  // Charge explicitement .env.production/.env.<mode> avant la configuration Vite.
  const env = loadEnv(mode, process.cwd(), "")
  const base = env.VITE_APP_BASE_PATH || "/"
  return { plugins: [react()], base: base.endsWith("/") ? base : `${base}/` }
})
