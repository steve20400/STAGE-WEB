import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {
  const base = process.env.VITE_APP_BASE_PATH || "/"
  return { plugins: [react()], base: base.endsWith("/") ? base : `${base}/` }
})
