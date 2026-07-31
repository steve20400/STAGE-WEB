import { useCallback, useEffect, useState } from "react"
import {
  ALANYA_NUMBER_MAX_LENGTH,
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../../../src/lib/alanya-number"
import "./dialer.css"

/** Disposition d'un clavier de telephone, celle du composeur mobile. */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""] as const

/**
 * Composeur plein ecran : le numero en cours de composition, un clavier, et le
 * choix entre appel audio et appel video. Rien d'autre, comme sur un telephone.
 *
 * Le numero saisi est un Alanya ID, pas un numero de telephone : six chiffres
 * pour les anciens comptes, huit pour les nouveaux — les deux longueurs
 * coexistent, d'ou la validation par `isValidAlanyaNumber` plutot qu'une
 * longueur fixe.
 */
export function Dialer({
  onClose,
  onCall,
}: {
  onClose: () => void
  /** Recoit les chiffres seuls, sans les espaces d'affichage, et le type d'appel. */
  onCall: (number: string, type: "audio" | "video") => void
}) {
  const [digits, setDigits] = useState("")
  const valide = isValidAlanyaNumber(digits)

  const press = useCallback((key: string) => {
    setDigits((current) => normalizeAlanyaNumber(current + key).slice(0, ALANYA_NUMBER_MAX_LENGTH))
  }, [])

  const erase = useCallback(() => setDigits((current) => current.slice(0, -1)), [])

  const call = useCallback(
    (type: "audio" | "video") => {
      if (isValidAlanyaNumber(digits)) onCall(normalizeAlanyaNumber(digits), type)
    },
    [digits, onCall]
  )

  // Le clavier physique doit marcher aussi : on est sur un navigateur, pas
  // seulement sur un telephone.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose()
      // Entree lance un appel audio, le cas courant.
      if (event.key === "Enter") return call("audio")
      if (event.key === "Backspace") {
        event.preventDefault()
        return erase()
      }
      if (/^[0-9]$/.test(event.key)) press(event.key)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [call, erase, onClose, press])

  return (
    <div className="dialer-root" role="dialog" aria-label="Composer un numero">
      <button className="dialer-close" onClick={onClose} aria-label="Fermer le clavier">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="dialer-number-zone">
        <div className="dialer-number" aria-live="polite">
          {digits ? formatAlanyaNumber(digits) : <span className="dialer-placeholder">Alanya ID</span>}
        </div>
        <div className="dialer-hint">
          {digits.length === 0
            ? "Composez un Alanya ID de 6 ou 8 chiffres"
            : valide
              ? "Pret a appeler"
              : `${digits.length} chiffre${digits.length > 1 ? "s" : ""} — il en faut 6 ou 8`}
        </div>
      </div>

      <div className="dialer-keys">
        {KEYS.map((key, index) =>
          key === "" ? (
            // Les deux cases vides de la derniere rangee tiennent la grille en
            // place : le 0 reste centre sous le 8, comme sur un telephone.
            <span key={`vide-${index}`} aria-hidden />
          ) : (
            <button key={key} className="dialer-key" onClick={() => press(key)} aria-label={key}>
              {key}
            </button>
          )
        )}
      </div>

      <div className="dialer-actions">
        <span aria-hidden />

        {/* Deux appels possibles depuis un numero compose, comme depuis une fiche
            de contact : la voix, ou la video. */}
        <div className="dialer-call-pair">
          <button
            className="dialer-call audio"
            onClick={() => call("audio")}
            disabled={!valide}
            aria-label="Appel audio"
            title={valide ? "Appel audio" : "Composez 6 ou 8 chiffres"}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          </button>
          <button
            className="dialer-call video"
            onClick={() => call("video")}
            disabled={!valide}
            aria-label="Appel video"
            title={valide ? "Appel video" : "Composez 6 ou 8 chiffres"}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
          </button>
        </div>

        <button
          className="dialer-erase"
          onClick={erase}
          disabled={digits.length === 0}
          aria-label="Effacer le dernier chiffre"
          title="Effacer"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M21 5H9L3 12l6 7h12a1 1 0 001-1V6a1 1 0 00-1-1z" />
            <line x1="18" y1="9" x2="12" y2="15" />
            <line x1="12" y1="9" x2="18" y2="15" />
          </svg>
        </button>
      </div>
    </div>
  )
}
