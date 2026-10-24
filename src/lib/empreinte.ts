/**
 * L'EMPREINTE NUMÉRIQUE d'une copie signée, telle qu'on la lit et la saisit
 * (24/10/2026) — même règle que `lib/core/empreinte_saisie.dart` du mobile.
 *
 * 32 caractères hexadécimaux, montrés en HUIT BLOCS DE QUATRE, en majuscules :
 * « 3F9A 0C1E 5B7D 2A4C 6E8F 0A1B 2C3D 4E5F », comme sur les bords du document.
 */

export const LONGUEUR_EMPREINTE = 32
const BLOC = 4

/** Seuls 0-9 et A-F restent, en majuscules (espaces, tirets… tombent). */
export function nettoyerEmpreinte(brut: string): string {
  return brut.toUpperCase().replace(/[^0-9A-F]/g, "")
}

/** « 3F9A0C1E… » → « 3F9A 0C1E … ». */
export function empreinteEnBlocs(brut: string): string {
  return (nettoyerEmpreinte(brut).match(/.{1,4}/g) ?? []).join(" ")
}

/** La forme attendue par le serveur : 32 caractères en minuscules, ou `null`. */
export function empreintePourServeur(brut: string): string | null {
  const n = nettoyerEmpreinte(brut)
  return n.length === LONGUEUR_EMPREINTE ? n.toLowerCase() : null
}

/**
 * Une frappe ou un collage : le texte remis en blocs (32 caractères utiles au
 * plus) et la place du curseur, gardé derrière le même caractère utile.
 */
export function saisirEmpreinte(texte: string, curseur: number): { texte: string; curseur: number } {
  const utilesAvant = Math.min(nettoyerEmpreinte(texte.slice(0, curseur)).length, LONGUEUR_EMPREINTE)
  const formate = empreinteEnBlocs(nettoyerEmpreinte(texte).slice(0, LONGUEUR_EMPREINTE))
  const position = utilesAvant + (utilesAvant === 0 ? 0 : Math.floor((utilesAvant - 1) / BLOC))
  return { texte: formate, curseur: Math.min(position, formate.length) }
}
