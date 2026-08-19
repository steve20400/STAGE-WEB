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
