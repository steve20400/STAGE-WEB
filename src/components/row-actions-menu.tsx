import { useCallback, useEffect, useRef, useState } from "react"

export interface RowAction {
  label: string
  onSelect: () => void
  /** Action destructrice : affichee en rouge. */
  danger?: boolean
}

/**
 * Menu d'actions d'une ligne de liste, ouvert par les trois points.
 *
 * Sur une ligne de contact, les quatre actions occupaient chacune leur bouton.
 * Empilees par la classe partagee avec la page Appels — prevue pour une heure
 * au-dessus des boutons — elles portaient la hauteur d'une ligne a 176 px, soit
 * 7 000 px pour quarante contacts, et trois contacts visibles a la fois sur un
 * telephone. Un seul bouton suffit, le reste se deroule.
 */
export function RowActionsMenu({
  actions,
  ariaLabel = "Actions",
}: {
  actions: RowAction[]
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [above, setAbove] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return

    // Meme comportement que le menu d'un message : tout clic ailleurs ferme.
    const onPointerDown = (event: PointerEvent) => {
      if (host.current && !host.current.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    /**
     * La liste defile sous le menu : le laisser ouvert le detacherait de sa
     * ligne. Mais cliquer un bouton lui donne le focus, et le navigateur fait
     * alors defiler pour l'amener a l'ecran — un defilement qui refermait le
     * menu dans l'instant, donnant l'impression d'un bouton qui ne tient que
     * tant qu'on garde le clic enfonce. On ignore donc les defilements de la
     * toute premiere frame.
     */
    let ouvertureTerminee = false
    const fin = requestAnimationFrame(() => {
      ouvertureTerminee = true
    })
    const onScroll = () => {
      if (ouvertureTerminee) close()
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      cancelAnimationFrame(fin)
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [open, close])

  /**
   * Sens d'ouverture mesure sur le menu REEL, une fois rendu.
   *
   * L'estimation a partir d'une hauteur de ligne constante se trompe des qu'un
   * libelle passe sur deux lignes : le menu debordait alors en bas de l'ecran
   * sans que le calcul s'en apercoive.
   */
  useEffect(() => {
    if (!open) return
    const panneau = menu.current
    const bouton = host.current
    if (!panneau || !bouton) return
    const place = bouton.getBoundingClientRect()
    const hauteur = panneau.getBoundingClientRect().height
    const enDessous = window.innerHeight - place.bottom
    const enDessus = place.top
    // On ne bascule vers le haut que s'il y a vraiment plus de place la-haut :
    // sinon on garde le sens naturel et le menu defile.
    setAbove(hauteur + 12 > enDessous && enDessus > enDessous)
  }, [open, actions.length])

  const toggle = (event: React.MouseEvent) => {
    // La ligne entiere peut porter sa propre action : elle ne doit pas se
    // declencher en ouvrant le menu.
    event.stopPropagation()
    // Le sens d'ouverture est decide apres le rendu, sur la hauteur reelle.
    setOpen((value) => !value)
  }

  return (
    <div ref={host} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={toggle}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={ariaLabel}
        style={{
          background: open ? "var(--bg-surface)" : "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 8,
          padding: "7px 9px",
          color: "var(--text-secondary)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          ref={menu}
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            right: 0,
            [above ? "bottom" : "top"]: "calc(100% + 6px)",
            zIndex: 60,
            minWidth: 188,
            // Ni plus haut que l'ecran, ni plus large : un menu qui deborde
            // n'est pas atteignable, quel que soit le sens d'ouverture.
            maxHeight: "min(60vh, 360px)",
            maxWidth: "min(280px, calc(100vw - 24px))",
            overflowY: "auto",
            padding: 6,
            borderRadius: 12,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "0 18px 40px var(--overlay)",
          }}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              onClick={() => {
                close()
                action.onSelect()
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                borderRadius: 8,
                border: "none",
                background: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
                color: action.danger ? "var(--danger)" : "var(--text-primary)",
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
