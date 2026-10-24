import { useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"

import "./stickers.css"

/**
 * Une fenêtre des stickers (boutique, pack, sticker reçu), montée sur
 * `<body>`. Trois sorties, comme partout dans l'application : la croix,
 * Échap, un clic sur le voile.
 */
export function FenetreSticker({
  titre,
  onFermer,
  children,
  libelleFermer,
}: {
  titre: string
  onFermer: () => void
  children: ReactNode
  libelleFermer: string
}) {
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer()
    }
    window.addEventListener("keydown", touche)
    return () => window.removeEventListener("keydown", touche)
  }, [onFermer])

  return createPortal(
    <div
      className="stk-voile"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onFermer()
      }}
    >
      <div className="stk-fenetre" role="dialog" aria-modal="true" aria-label={titre}>
        <div className="stk-entete">
          <h2>{titre}</h2>
          <button type="button" className="stk-fermer" onClick={onFermer} aria-label={libelleFermer}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
