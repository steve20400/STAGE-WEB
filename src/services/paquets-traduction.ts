import { installerPaquetsInitiaux } from "./traduction-service"

/**
 * L'INSTALLATION DES PAQUETS DE LANGUE, AU NIVEAU DE L'APPLICATION.
 *
 * 🔴 ELLE VIVAIT DANS L'ÉCRAN DES RÉGLAGES, et l'on croyait qu'elle s'arrêtait
 * en le quittant.
 *
 * Le téléchargement ne s'arrêtait pas vraiment — une promesse en cours continue
 * — mais TOUT CE QUI LE MONTRAIT disparaissait avec l'écran : l'indicateur
 * vivait dans un `useState` du composant. En revenant, on retrouvait donc un
 * bouton « Télécharger » comme si rien ne s'était passé, et l'on relançait
 * par-dessus une installation déjà en cours.
 *
 * L'état vit ici, hors de tout composant. On peut lancer un téléchargement,
 * aller écrire dans une discussion, passer un appel, revenir : il continue, et
 * l'écran le retrouve exactement où il en est.
 *
 * ⚠️ UNE SEULE INSTALLATION À LA FOIS. Les paquets sont volumineux et le
 * navigateur les télécharge en série de toute façon ; en lancer deux ne les
 * rendrait pas plus vite, et doublerait la consommation de données de quelqu'un
 * qui aurait simplement cliqué deux fois.
 */

export interface EtatPaquets {
  /** Une installation est-elle en cours ? */
  encours: boolean
  /** Langue dont le paquet se télécharge, pour le dire à l'écran. */
  langue: string | null
  /** Progression du paquet courant, de 0 à 1. */
  fraction: number
  /** Résultat de la dernière installation terminée, ou `null`. */
  dernier: { installes: number; echecs: string[] } | null
}

let etat: EtatPaquets = { encours: false, langue: null, fraction: 0, dernier: null }
const abonnes = new Set<() => void>()
/** La promesse en cours — c'est elle qui garantit qu'on n'en lance pas deux. */
let enVol: Promise<void> | null = null

function publier(suite: Partial<EtatPaquets>): void {
  etat = { ...etat, ...suite }
  for (const abonne of abonnes) abonne()
}

export function etatPaquets(): EtatPaquets {
  return etat
}

export function abonnerPaquets(rappel: () => void): () => void {
  abonnes.add(rappel)
  return () => {
    abonnes.delete(rappel)
  }
}

/**
 * Lance l'installation, ou ne fait rien si elle tourne déjà.
 *
 * Rend la promesse en cours dans les deux cas : celui qui appelle peut donc
 * l'attendre sans savoir s'il l'a déclenchée ou rejointe.
 */
export function installerPaquets(langueCible: string): Promise<void> {
  if (enVol) return enVol

  publier({ encours: true, langue: null, fraction: 0, dernier: null })
  enVol = installerPaquetsInitiaux(langueCible, (langue, fraction) =>
    publier({ langue, fraction }),
  )
    .then((resultat) => {
      publier({ encours: false, langue: null, fraction: 0, dernier: resultat })
    })
    .catch(() => {
      // Une installation qui échoue n'empêche RIEN : la traduction repasse par
      // le réseau. On le note comme un échec complet plutôt que de le taire.
      publier({
        encours: false,
        langue: null,
        fraction: 0,
        dernier: { installes: 0, echecs: [] },
      })
    })
    .finally(() => {
      enVol = null
    })
  return enVol
}

/** Efface le résultat une fois annoncé, pour ne pas le réannoncer au retour. */
export function oublierResultatPaquets(): void {
  if (etat.dernier) publier({ dernier: null })
}
