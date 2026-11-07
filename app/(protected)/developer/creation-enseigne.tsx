import React, { useState } from "react"
import { api, codeErreur, messageErreur, type Enseigne } from "./enseignes-api"

/*
 * CRÉER UNE ENSEIGNE (07/11/2026).
 *
 * Deux étapes au plus :
 *   1. le nom de l'enseigne ;
 *   2. SEULEMENT si le compte a l'application Alanya sur un téléphone : le code
 *      à six chiffres envoyé dedans (la même double authentification que la
 *      connexion web). Créer une enseigne donne le droit d'écrire à n'importe
 *      qui sur Alanya : c'est une action sensible.
 *
 * Un code validé vaut 30 minutes ; quelqu'un qui vient de se connecter avec le
 * sien ne le ressaisit pas.
 */

const champ: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: "8px",
  border: "1px solid var(--dev-border)",
  background: "var(--dev-bg-page)",
  color: "var(--dev-text-primary)",
  fontSize: "15px",
  boxSizing: "border-box",
}

export default function CreationEnseigne({
  confirmationRequise,
  onCree,
}: {
  confirmationRequise: boolean
  onCree: (enseigne: Enseigne) => void
}) {
  const [nom, setNom] = useState("")
  const [defiId, setDefiId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const demanderCode = async () => {
    const r = await api.demanderCode()
    setDefiId(r.defiId)
    setCode("")
  }

  const creer = async () => {
    try {
      onCree(await api.creerEnseigne(nom.trim()))
    } catch (err) {
      // Le code a expiré entre-temps : on en redemande un, sans tout recommencer.
      if (codeErreur(err) === "CONFIRMATION_REQUISE") {
        await demanderCode()
        return
      }
      throw err
    }
  }

  const envoyerNom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (nom.trim().length < 2) return
    setErreur(null)
    setEnCours(true)
    try {
      if (confirmationRequise) await demanderCode()
      else await creer()
    } catch (err) {
      setErreur(messageErreur(err, "La création a échoué."))
    } finally {
      setEnCours(false)
    }
  }

  const envoyerCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!defiId || !/^\d{6}$/.test(code)) return
    setErreur(null)
    setEnCours(true)
    try {
      await api.confirmerCode(defiId, code)
      await creer()
    } catch (err) {
      setErreur(messageErreur(err, "Le code n'a pas été accepté."))
    } finally {
      setEnCours(false)
    }
  }

  if (defiId) {
    return (
      <form onSubmit={envoyerCode} style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "420px" }}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6 }}>
          Pour confirmer que c'est bien vous, un code à 6 chiffres vient d'être envoyé dans l'application Alanya de
          votre téléphone.
        </p>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          style={{ ...champ, letterSpacing: "6px", fontSize: "20px", textAlign: "center" }}
          autoFocus
        />
        {erreur && <div style={{ color: "#ef4444", fontSize: "14px", fontWeight: 600 }}>{erreur}</div>}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="submit"
            disabled={enCours || code.length !== 6}
            className="dev-metric-btn"
            style={{ background: "#10b981", color: "#ffffff", padding: "10px 20px" }}
          >
            {enCours ? "Vérification…" : "Confirmer et créer"}
          </button>
          <button
            type="button"
            disabled={enCours}
            className="dev-refresh-btn"
            onClick={() => {
              setErreur(null)
              demanderCode().catch((err) => setErreur(messageErreur(err, "Impossible d'envoyer le code.")))
            }}
          >
            Renvoyer un code
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={envoyerNom} style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "420px" }}>
      <label style={{ fontSize: "13px", fontWeight: 600 }} htmlFor="nom-enseigne">
        Nom de l'enseigne
      </label>
      <input
        id="nom-enseigne"
        placeholder="ex. : Pharmacie du Centre"
        value={nom}
        maxLength={60}
        onChange={(e) => setNom(e.target.value)}
        style={champ}
        autoFocus
        required
      />
      <p style={{ margin: 0, fontSize: "13px", color: "var(--dev-text-secondary)", lineHeight: 1.5 }}>
        C'est le nom que verront les personnes à qui vous écrirez. L'enseigne reçoit son propre numéro Alanya.
      </p>
      {erreur && <div style={{ color: "#ef4444", fontSize: "14px", fontWeight: 600 }}>{erreur}</div>}
      <button
        type="submit"
        disabled={enCours || nom.trim().length < 2}
        className="dev-metric-btn"
        style={{ background: "#10b981", color: "#ffffff", padding: "10px 20px", alignSelf: "flex-start" }}
      >
        {enCours ? "Un instant…" : "Créer l'enseigne"}
      </button>
    </form>
  )
}
