/**
 * LA PAGE ENTRE LA CONNEXION ET LA SESSION : l'historique chiffré revient.
 *
 * 🔴 JUMELLE DE `alanya/lib/features/auth/screens/restauration_screen.dart`.
 *
 * 🐛 « UN NOUVEAU NAVIGATEUR NE CHARGE PAS L'ARCHIVE » (user, 28/09/2026). La
 * restauration tournait en fond, invisible, et ses échecs finissaient dans la
 * console. Cette page récupère l'archive, la déchiffre, la range dans ce
 * navigateur, et montre où elle en est.
 *
 * ⚠️ « CONTINUER EN ARRIÈRE-PLAN » (choix du user) : la restauration continue
 * sans la page — elle vit dans ce module, pas dans le composant.
 *
 * ⚠️ MODE STRICT : React lance les effets deux fois en développement. La
 * restauration est donc tenue AU NIVEAU DU MODULE : un second effet reprend
 * celle qui tourne au lieu d'en lancer une autre — ou de consommer le mot de
 * passe à vide et de sortir.
 */
import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  restaurerALaConnexionSuivie,
  type IssueConnexion,
} from "../../../src/services/e2ee-sauvegarde"
import { reprendreMotDePasse } from "../../../src/services/restauration-en-attente"
import { cacheMessage } from "../../../src/services/indexeddb-cache"
import { entreeCacheDechiffree } from "../../../src/services/e2ee-entree-cache"
import { restaurerTousLesTrousseaux } from "../../../src/services/e2ee-groupe-fil"
import type { MessageArchive } from "../../../src/services/e2ee-archive"
import {
  compteur,
  fractionGlobale,
  libelleEtape,
  type ProgressionRestauration,
} from "../../../src/lib/restauration-progression"

type Resultat = Awaited<ReturnType<typeof restaurerALaConnexionSuivie>>

/* ── L'état de la restauration, hors du composant ─────────────────────── */

let enCours: Promise<Resultat> | null = null
/** Gardé le temps de la page, pour « Réessayer ». Effacé en la quittant. */
let motDePasse: string | null = null
let derniere: ProgressionRestauration = { etape: "ouverture", fait: 0 }
const abonnes = new Set<(p: ProgressionRestauration) => void>()

// La même fabrique que la relève : un média restauré se range COMPLET, avec
// sa clé, et se rouvre donc sur ce nouvel appareil (chapitre 23).
const ranger = (m: MessageArchive) => cacheMessage(entreeCacheDechiffree(m))

function lancer(mdp: string): Promise<Resultat> {
  derniere = { etape: "ouverture", fait: 0 }
  const tour = restaurerALaConnexionSuivie(mdp, ranger, (p) => {
    derniere = p
    for (const f of abonnes) f(p)
  })
  enCours = tour
  void tour.finally(() => {
    if (enCours === tour) enCours = null
  })
  /*
   * 🔴 ET LES CLÉS DES GROUPES CHIFFRÉS (lot 6, chapitre 35) : l'archive est
   * ouverte, mes copies de trousseau s'ouvrent avec elle. Sans attendre — le
   * fil les reprendrait de toute façon à la demande (`trousseauAvecRepli`).
   */
  void tour.then((r) => {
    if (r.issue === "restauree" || r.issue === "rienARestaurer") {
      void restaurerTousLesTrousseaux().catch(() => undefined)
    }
  })
  return tour
}

function oublier() {
  motDePasse = null
}

/* ── La page ──────────────────────────────────────────────────────────── */

export default function RestaurationPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const suite = (location.state as { suite?: string } | null)?.suite ?? "/chats"

  const [progression, setProgression] = useState<ProgressionRestauration>(derniere)
  const [issue, setIssue] = useState<IssueConnexion | null>(null)
  const [essai, setEssai] = useState(0)

  const entrer = () => {
    oublier()
    navigate(suite, { replace: true })
  }

  useEffect(() => {
    let actif = true
    let tour = enCours
    if (!tour) {
      if (essai === 0) motDePasse = reprendreMotDePasse() ?? motDePasse
      if (!motDePasse) {
        // Rechargement, ou arrivée sans connexion : rien à restaurer ici.
        navigate(suite, { replace: true })
        return
      }
      tour = lancer(motDePasse)
    }
    abonnes.add(setProgression)
    setProgression(derniere)
    void tour.then((r) => {
      if (!actif) return
      if (r.issue === "restauree" || r.issue === "rienARestaurer") {
        oublier()
        navigate(suite, { replace: true })
      } else {
        setIssue(r.issue)
      }
    })
    return () => {
      actif = false
      abonnes.delete(setProgression)
    }
    // `essai` relance : « Réessayer ».
  }, [essai, navigate, suite])

  const fraction = fractionGlobale(progression)
  const texteCompteur = compteur(progression)

  return (
    <div className="restauration">
      <style>{STYLE}</style>
      <div className="carte" role="status" aria-live="polite">
        <div className="icone" aria-hidden>
          🔒
        </div>
        <h1>
          {issue === null
            ? "Récupération de vos messages"
            : issue === "fermee"
              ? "Votre sauvegarde reste fermée"
              : "La récupération n’a pas abouti"}
        </h1>

        {issue === null && (
          <>
            <p className="sous">
              Vos conversations chiffrées sont déchiffrées dans ce navigateur. Personne
              d’autre, pas même Alanya, ne peut les lire.
            </p>
            <p className="etape">{libelleEtape(progression.etape)}</p>
            <div
              className={`piste${fraction === null ? " animee" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
            >
              <div
                className="remplissage"
                style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
              />
            </div>
            <p className="compteur">{texteCompteur ?? " "}</p>
            <button type="button" className="secondaire" onClick={entrer}>
              Continuer en arrière-plan
            </button>
            <p className="note">
              La récupération se poursuit pendant que vous utilisez Alanya.
            </p>
          </>
        )}

        {issue === "fermee" && (
          <>
            <p className="sous">
              Votre mot de passe n’ouvre pas votre sauvegarde. Il a peut-être changé depuis
              sa création, ou elle n’est protégée que par votre clé de récupération (les 12
              mots).
            </p>
            <button
              type="button"
              className="principal"
              onClick={() => {
                oublier()
                navigate("/settings?section=security", { replace: true })
              }}
            >
              Utiliser ma clé de récupération
            </button>
            <button type="button" className="secondaire" onClick={entrer}>
              Continuer sans l’historique
            </button>
          </>
        )}

        {issue === "echec" && (
          <>
            <p className="sous">
              Le serveur n’a pas pu être joint, ou n’a pas répondu comme prévu. Votre
              historique est intact : réessayez maintenant, ou plus tard depuis Réglages ›
              Sécurité.
            </p>
            <button
              type="button"
              className="principal"
              onClick={() => {
                setIssue(null)
                setEssai((n) => n + 1)
              }}
            >
              Réessayer
            </button>
            <button type="button" className="secondaire" onClick={entrer}>
              Continuer sans l’historique
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const STYLE = `
  .restauration {
    min-height: 100vh; background: var(--bg-base); color: var(--text-primary);
    display: flex; align-items: center; justify-content: center; padding: 24px 16px;
  }
  .restauration .carte {
    width: 100%; max-width: 420px; display: flex; flex-direction: column;
    gap: 12px; text-align: center;
  }
  .restauration .icone { font-size: 44px; line-height: 1; }
  .restauration h1 { font-size: 22px; font-weight: 700; margin: 4px 0; }
  .restauration .sous { font-size: 14px; line-height: 1.6; color: var(--text-muted); margin: 0 0 12px; }
  .restauration .etape { font-size: 15px; margin: 8px 0 0; text-align: left; }
  .restauration .piste {
    position: relative; height: 8px; border-radius: 6px; overflow: hidden;
    background: var(--accent-dim);
  }
  .restauration .remplissage {
    height: 100%; background: var(--accent); border-radius: 6px;
    transition: width .25s ease-out;
  }
  .restauration .piste.animee .remplissage {
    position: absolute; width: 35%; animation: restauration-va-vient 1.2s ease-in-out infinite;
  }
  @keyframes restauration-va-vient { 0% { left: -35%; } 100% { left: 100%; } }
  @media (prefers-reduced-motion: reduce) {
    .restauration .piste.animee .remplissage { animation: none; left: 0; width: 100%; opacity: .5; }
  }
  .restauration .compteur { font-size: 12px; color: var(--text-muted); text-align: right; margin: 0 0 12px; }
  .restauration button {
    font: inherit; font-size: 15px; padding: 11px 16px; border-radius: 10px; cursor: pointer;
  }
  .restauration .principal { background: var(--accent); color: #fff; border: none; }
  .restauration .secondaire {
    background: transparent; color: var(--text-primary); border: 1px solid var(--accent);
  }
  .restauration .note { font-size: 12px; color: var(--text-muted); margin: 0; }
`
