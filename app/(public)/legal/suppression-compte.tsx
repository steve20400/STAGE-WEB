import { useState, type FormEvent } from "react"
import { EnTetePublic, PiedPublic } from "../../../src/components/cadre-public"
import { apiRequest } from "../../../src/lib/api-client"
import "./legal.css"

/**
 * SUPPRIMER SON COMPTE DEPUIS LE WEB, SANS L'APPLICATION (18/11/2026).
 *
 * 🔴 EXIGENCE DU PLAY STORE : l'adresse de cette page est déclarée dans la
 * Play Console. Elle doit marcher pour quelqu'un qui a désinstallé
 * l'application : identifiant (e-mail ou Alanya ID) et mot de passe suffisent
 * (`POST /api/account/suppression`).
 */
export default function SuppressionComptePage() {
  const [identifiant, setIdentifiant] = useState("")
  const [motDePasse, setMotDePasse] = useState("")
  const [confirme, setConfirme] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [fait, setFait] = useState(false)

  const envoyer = async (e: FormEvent) => {
    e.preventDefault()
    if (!confirme || enCours) return
    setEnCours(true)
    setErreur(null)
    try {
      await apiRequest("/api/account/suppression", {
        method: "POST",
        body: { identifier: identifiant.trim(), password: motDePasse },
      })
      setFait(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      setErreur(message || "La suppression n'a pas abouti. Vérifiez vos identifiants.")
    } finally {
      setEnCours(false)
    }
  }

  return (
    <div className="alanya-root">
      {/* Même cadre que l'accueil — voir `page-legale.tsx` (25/11/2026). */}
      <EnTetePublic action="connexion" />
      <main className="legal-page">
      <article>
        <h1>Supprimer mon compte Alanya Work</h1>
        {fait ? (
          <p className="legal-succes">
            Votre compte a été supprimé. Vos messages, vos groupes créés, vos contacts, vos médias et votre sauvegarde
            chiffrée ont été effacés de nos serveurs.
          </p>
        ) : (
          <>
            <p>
              Vous pouvez aussi le faire dans l'application : <strong>Paramètres</strong>, puis{" "}
              <strong>Supprimer mon compte</strong>.
            </p>
            <h2>Ce qui sera supprimé</h2>
            <ul>
              <li>votre compte, votre profil et votre Alanya ID ;</li>
              <li>vos messages, vos médias, vos statuts et votre sauvegarde chiffrée ;</li>
              <li>vos contacts, vos listes et vos réglages.</li>
            </ul>
            <p>
              La suppression est <strong>définitive</strong> : rien ne pourra être récupéré. Les messages déjà reçus par
              vos correspondants restent sur leurs appareils.
            </p>
            <form className="legal-form" onSubmit={envoyer}>
              <label>
                E-mail ou Alanya ID
                <input
                  value={identifiant}
                  onChange={(e) => setIdentifiant(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Mot de passe
                <input
                  type="password"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="legal-case">
                <input type="checkbox" checked={confirme} onChange={(e) => setConfirme(e.target.checked)} />
                Je comprends que la suppression est définitive.
              </label>
              {erreur && <p className="legal-erreur">{erreur}</p>}
              <button type="submit" disabled={!confirme || enCours || !identifiant || !motDePasse}>
                {enCours ? "Suppression…" : "Supprimer définitivement mon compte"}
              </button>
            </form>
          </>
        )}
      </article>
      </main>
      <PiedPublic />
    </div>
  )
}
