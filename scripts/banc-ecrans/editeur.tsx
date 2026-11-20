/**
 * BANC VISUEL de l'éditeur de photo (20/11/2026) : la VRAIE composante
 * `EditeurStatut`, sur une image fabriquée, sans connexion ni serveur.
 * Ouvert par `scripts/banc-ecrans/banc-editeur.mjs` (Playwright).
 */
import "../../src/styles/globals.css"
import { createRoot } from "react-dom/client"
import { useEffect, useState } from "react"
import { LanguageProvider } from "../../src/i18n"
import { EditeurStatut } from "../../src/components/editeur-statut"

function imageEssai(): Promise<File> {
  const c = document.createElement("canvas")
  c.width = 1200
  c.height = 900
  const g = c.getContext("2d")!
  const d = g.createLinearGradient(0, 0, 1200, 900)
  d.addColorStop(0, "#2d6a4f")
  d.addColorStop(1, "#e9c46a")
  g.fillStyle = d
  g.fillRect(0, 0, 1200, 900)
  return new Promise((r) => c.toBlob((b) => r(new File([b!], "essai.png", { type: "image/png" })), "image/png"))
}

function Banc() {
  const [fichier, setFichier] = useState<File | null>(null)
  const [resultat, setResultat] = useState("")
  useEffect(() => {
    void imageEssai().then(setFichier)
  }, [])
  if (!fichier) return null
  return (
    <>
      <EditeurStatut
        fichier={fichier}
        onAnnuler={() => setResultat("annule")}
        onValider={(f) => {
          ;(window as unknown as { __publie?: File }).__publie = f
          setResultat(`publie:${f.type}:${f.size}`)
        }}
      />
      <output id="resultat" style={{ position: "fixed", bottom: 0, left: 0, zIndex: 99999 }}>
        {resultat}
      </output>
    </>
  )
}

createRoot(document.getElementById("root")!).render(
  <LanguageProvider>
    <Banc />
  </LanguageProvider>,
)
