import { Dialer } from "./dialer"
import { useAppelsSortants } from "./appeler-numero"

/**
 * Le pavé de numérotation posé en permanence dans le grand panneau de l'écran
 * Appels (20/11/2026, demande du user) : il remplace le bouton « Composer ID »
 * qui ouvrait le composeur en plein écran. Sur téléphone, où ce panneau
 * n'existe pas, un bouton rond de la liste ouvre toujours le composeur.
 */
export default function PanneauComposeur() {
  const { appelerNumero } = useAppelsSortants()
  return <Dialer integre onCall={(numero, type) => void appelerNumero(numero, type)} />
}
