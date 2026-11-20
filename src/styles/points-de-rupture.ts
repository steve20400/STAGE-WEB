/**
 * LES POINTS DE RUPTURE côté code (20/11/2026), les mêmes que dans les feuilles
 * de style : voir le commentaire en tête de src/styles/globals.css.
 *
 * En dessous de 900 px, la navigation passe en tiroir ET les écrans à deux
 * colonnes n'en montrent plus qu'une : un seul seuil pour les deux, sinon une
 * bande de largeurs affiche la barre latérale avec une liste seule, ou l'inverse.
 */
export const POINT_TELEPHONE = 600
export const POINT_TABLETTE = 900
export const POINT_BUREAU = 1280
export const POINT_GRAND_ECRAN = 1600

/** Écran étroit : tiroir de navigation, une seule colonne. */
export const MEDIA_ETROIT = `(max-width: ${POINT_TABLETTE}px)`
/** Écran large : barre latérale et deux colonnes. */
export const MEDIA_LARGE = `(min-width: ${POINT_TABLETTE + 1}px)`
/** Grand écran : le panneau d'informations s'ouvre d'office. */
export const MEDIA_GRAND_ECRAN = `(min-width: ${POINT_GRAND_ECRAN}px)`
