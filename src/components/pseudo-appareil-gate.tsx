import { useEffect, useState } from "react"
import { useAuth } from "./auth-provider"
import { enregistrerPseudo, pseudoManquant } from "../services/pseudo-appareil-service"

/**
 * Demande le pseudo de cet appareil, une fois par compte.
 *
 * Monte au-dessus de l'application authentifiee plutot que dans l'ecran de
 * connexion : l'inscription enchaine directement sur la session, et une
 * demande posee dans le formulaire de connexion serait sautee dans ce cas. Ici,
 * les deux chemins passent par le meme endroit.
 *
 * Le pseudo n'est pas un nom d'affichage : il distingue les appareils d'un MEME
 * compte — cas d'un numero professionnel partage entre plusieurs agents — et
 * aucun autre compte ne le voit jamais.
 */
export function PseudoAppareilGate() {
  const { isAuthenticated, user } = useAuth()
  const [demande, setDemande] = useState(false)
  const [pseudo, setPseudo] = useState("")
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      setDemande(false)
      return
    }
    let annule = false
    void pseudoManquant().then((manquant) => {
      if (!annule && manquant) setDemande(true)
    })
    return () => {
      annule = true
    }
    // La cle du cache depend du compte : changer de compte doit reposer la
    // question, puisque c'est un autre poste du point de vue de ce compte.
  }, [isAuthenticated, user?.phone])

  if (!demande) return null

  const valider = async () => {
    const propre = pseudo.trim()
    if (!propre || envoi) return
    setEnvoi(true)
    setErreur(null)
    try {
      await enregistrerPseudo(propre)
      setDemande(false)
      setPseudo("")
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Enregistrement impossible.")
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className="pseudo-gate-overlay" role="dialog" aria-modal="true">
      <div className="pseudo-gate">
        <div className="pseudo-gate-titre">Nommez cet appareil</div>
        <p className="pseudo-gate-sous">
          Ce nom apparait au-dessus des messages envoyes depuis cet appareil, et uniquement pour les
          autres appareils connectes a ce compte. Vos correspondants ne le voient jamais.
        </p>

        <input
          className="pseudo-gate-champ"
          autoFocus
          maxLength={50}
          placeholder="Poste accueil, Bureau d'Awa..."
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void valider()
          }}
          aria-label="Nom de cet appareil"
        />

        {erreur && <div className="pseudo-gate-erreur">{erreur}</div>}

        <button
          className="pseudo-gate-valider"
          onClick={() => void valider()}
          disabled={!pseudo.trim() || envoi}
        >
          {envoi ? "Enregistrement..." : "Enregistrer"}
        </button>
        <p className="pseudo-gate-note">Modifiable a tout moment dans Parametres.</p>
      </div>
    </div>
  )
}
