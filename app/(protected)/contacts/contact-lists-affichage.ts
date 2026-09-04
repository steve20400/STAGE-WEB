import { CONTACT_COLORS, type ContactColor } from "../../../src/data/contacts"
import { customRingtones, RINGTONES } from "../../../src/services/ringtones"

/**
 * Le peu que la section des listes et sa fenetre d'edition doivent lire de la
 * meme facon : la teinte d'une liste et le nom de sa sonnerie. Un module a part
 * plutot qu'un export depuis l'un des deux composants — la fenetre est importee
 * par la section, l'inverse ferait un cycle, et un fichier de composant qui
 * exporte autre chose que des composants casse le rafraichissement a chaud.
 */

/**
 * La palette est FIXE, et c'est le point : `couleur` est une chaine libre cote
 * service, mais un choix libre laisse prendre un jaune illisible sur le fond
 * creme du theme clair. Ces cinq teintes sont celles des avatars, deja accordees
 * aux quatre themes.
 */
export const PALETTE: ContactColor[] = ["amber", "blue", "violet", "teal", "rose"]

/**
 * LA PALETTE DES LISTES — vingt teintes, l'arc-en-ciel compris.
 *
 * Cinq ne suffisaient pas : au-dela de cinq listes, deux d'entre elles
 * portaient forcement la meme pastille, et la couleur cessait de distinguer
 * quoi que ce soit. Le rouge, en particulier, manquait — c'est la teinte qu'on
 * cherche en premier pour une liste qui compte.
 *
 * ⚠️ EN HEXADECIMAL, et non en jetons de theme comme les avatars. Un jeton
 * demande deux declarations CSS par teinte — clair et sombre — soit quarante
 * lignes a tenir pour vingt couleurs. Ces valeurs-ci sont choisies dans la
 * bande MOYENNE : assez foncees pour se lire sur le creme du theme clair,
 * assez claires pour se lire sur le nuit. Une seule valeur, les deux themes.
 *
 * Le champ est partage avec l'application mobile, qui ne connait pas les
 * variables CSS du web : une couleur ecrite en hexadecimal y arrive telle
 * quelle et s'affiche pareil. C'est aussi ce que `teinteCss` accepte deja.
 */
export const PALETTE_LISTES: string[] = [
  // L'arc-en-ciel, dans son ordre.
  "#e53935", // rouge
  "#f4511e", // vermillon
  "#fb8c00", // orange
  "#fdd835", // jaune
  "#c0ca33", // citron
  "#7cb342", // vert clair
  "#43a047", // vert
  "#00897b", // sarcelle
  "#00acc1", // cyan
  "#039be5", // bleu ciel
  "#1e88e5", // bleu
  "#3949ab", // indigo
  "#5e35b1", // violet
  "#8e24aa", // pourpre
  "#d81b60", // magenta
  // Quelques teintes sourdes, pour les listes qu'on ne veut pas voir crier.
  "#6d4c41", // brun
  "#546e7a", // ardoise
  "#795548", // terre
  "#8d6e63", // taupe
  "#607d8b", // gris bleu
]

/**
 * La couleur est rangee sous le NOM de sa teinte (`blue`) et non sous la
 * variable CSS qui la dessine : le champ est partage avec l'application mobile,
 * qui ne connait pas les variables du web. Une valeur venue d'ailleurs n'est
 * reprise que si elle a la forme d'une couleur CSS ecrite en hexadecimal —
 * n'importe quoi d'autre pose dans `--clist-teinte` rendrait la pastille
 * invisible plutot que de la laisser retomber sur la couleur d'accent.
 */
export function teinteCss(couleur: string | null): string | null {
  if (!couleur) return null
  const connue = CONTACT_COLORS[couleur as ContactColor]
  if (connue) return connue.fg
  return /^#[0-9a-f]{3,8}$/i.test(couleur) ? couleur : null
}

/**
 * Libelle d'une sonnerie, ou `null` quand l'identifiant n'est dans aucun
 * catalogue local : une sonnerie importee depuis un autre navigateur n'est
 * connue que par son URL, et l'appelant decide de ce qu'il montre a la place.
 */
export function nomSonnerie(id: string): string | null {
  const fournie = RINGTONES.find((sonnerie) => sonnerie.file === id)
  if (fournie) return fournie.label
  return customRingtones().find((sonnerie) => sonnerie.url === id)?.label ?? null
}
