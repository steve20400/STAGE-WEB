import { useCallState } from "../hooks/use-call"
import { quitterRepondeur } from "../services/call-manager"
import { RepondeurAppel } from "./repondeur-appel"

/**
 * LE RÉPONDEUR, MONTÉ AU NIVEAU DE L'APPLICATION.
 *
 * 🔴 IL VIVAIT DANS L'ÉCRAN D'APPEL, ET DEUX DÉFAUTS EN DÉCOULAIENT.
 *
 * Le premier : quand on écrit pendant un appel, la fenêtre se réduit en
 * vignette et l'écran d'appel n'est plus monté. Si la sonnerie expirait à ce
 * moment-là, le répondeur prenait bien la main — mais nulle part. L'appel se
 * terminait en silence, et l'écran ne reparaissait qu'à l'appel SUIVANT, par
 * dessus lui.
 *
 * Le second : quand il s'affichait, le panneau de fin d'appel se superposait à
 * lui, et l'on lisait « Appel terminé » deux fois.
 *
 * Or le répondeur n'a besoin de rien de tout cela : jouer un son, et
 * enregistrer. Monté ici, il paraît où que l'on soit — dans une discussion, aux
 * réglages, sur la liste des appels — et l'écran d'appel redevient un écran
 * d'appel, libre de se fermer normalement.
 */
export function RepondeurFlottant() {
  const call = useCallState()
  if (!call.repondeur) return null

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        // Au-dessus de la barre de navigation du bas sur téléphone, pour ne pas
        // recouvrir ce qui sert à naviguer.
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)",
        zIndex: 70,
        display: "flex",
        justifyContent: "center",
        padding: "0 12px",
        // ⚠️ Le conteneur laisse passer les clics : il occupe toute la largeur,
        // et sans cela il rendrait inatteignable tout ce qui se trouve à sa
        // hauteur, de part et d'autre de la barre.
        pointerEvents: "none",
      }}
    >
      <div style={{ pointerEvents: "auto", width: "100%", maxWidth: 560 }}>
        <RepondeurAppel
          callId={call.repondeur.callId}
          accueilUrl={call.repondeur.accueilUrl}
          onFermer={quitterRepondeur}
        />
      </div>
    </div>
  )
}
