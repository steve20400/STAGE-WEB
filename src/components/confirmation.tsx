import { useEffect, useRef } from "react"
import { createRoot } from "react-dom/client"
import "./confirmation.css"

/**
 * DEMANDER CONFIRMATION AVANT UNE SUPPRESSION (27/11/2026, demande du user :
 * « ajoute toujours un systeme de confirmer le choix pour les suppressions »).
 *
 * Une fonction, pas un composant a poser : `await confirmer({...})` rend
 * `true` si l'on confirme, `false` si l'on annule (bouton, Echap, clic hors
 * de la boite). La boite se monte d'elle-meme sur la page et disparait ensuite.
 *
 * Les libelles viennent de l'appelant, deja traduits : cette boite ne connait
 * pas la langue.
 */
export interface OptionsConfirmation {
  titre: string
  texte?: string
  confirmer: string
  annuler: string
  /** Rouge pour une suppression (par defaut). */
  danger?: boolean
}

function Boite({
  options,
  repondre,
}: {
  options: OptionsConfirmation
  repondre: (oui: boolean) => void
}) {
  const bouton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    bouton.current?.focus()
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") repondre(false)
    }
    document.addEventListener("keydown", touche)
    return () => document.removeEventListener("keydown", touche)
  }, [repondre])

  return (
    <div className="confirmation-voile" onClick={() => repondre(false)}>
      <div
        className="confirmation-boite"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-titre"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirmation-titre">{options.titre}</h2>
        {options.texte && <p>{options.texte}</p>}
        <div className="confirmation-actions">
          <button type="button" ref={bouton} onClick={() => repondre(false)}>
            {options.annuler}
          </button>
          <button
            type="button"
            className={options.danger === false ? "principal" : "danger"}
            onClick={() => repondre(true)}
          >
            {options.confirmer}
          </button>
        </div>
      </div>
    </div>
  )
}

export function confirmer(options: OptionsConfirmation): Promise<boolean> {
  return new Promise((resolve) => {
    const hote = document.createElement("div")
    document.body.appendChild(hote)
    const racine = createRoot(hote)
    let fini = false
    const repondre = (oui: boolean) => {
      if (fini) return
      fini = true
      resolve(oui)
      // Demonte apres le clic, pas pendant.
      setTimeout(() => {
        racine.unmount()
        hote.remove()
      }, 0)
    }
    racine.render(<Boite options={options} repondre={repondre} />)
  })
}
