/**
 * Numero Alanya (identifiant public d'un utilisateur).
 *
 * Historique : les premiers comptes ont un numero a 6 chiffres. Depuis le
 * passage a 8 chiffres, les nouveaux comptes sont generes a 8 chiffres par le
 * backend. Les deux formats coexistent : un utilisateur a 8 chiffres peut
 * ajouter un contact a 6 chiffres et inversement. Le front accepte donc les
 * deux longueurs partout ou un numero est saisi (connexion, ajout de contact,
 * nouveau chat/appel).
 */

/** Longueurs de numero acceptees (anciens comptes 6 chiffres, nouveaux 8). */
export const ALANYA_NUMBER_LENGTHS = [6, 8] as const

/** Longueur maximale a autoriser dans les champs de saisie. */
export const ALANYA_NUMBER_MAX_LENGTH = 8

/** Retire tout caractere non numerique (espaces, tirets colles au copier-coller). */
export function normalizeAlanyaNumber(value: string): string {
  return value.replace(/\D/g, "")
}

/** Vrai si la valeur est un numero Alanya valide (6 ou 8 chiffres). */
export function isValidAlanyaNumber(value: string): boolean {
  const digits = normalizeAlanyaNumber(value)
  return ALANYA_NUMBER_LENGTHS.includes(digits.length as (typeof ALANYA_NUMBER_LENGTHS)[number])
}

/**
 * Formate un numero pour l'affichage/saisie, avec des tirets :
 * - 6 chiffres  -> groupes de 3 : "123-456"
 * - 7-8 chiffres -> groupes de 2 : "12-34-56-78"
 * Les chiffres au-dela de 8 sont ignores. Utilise pendant la frappe.
 */
export function formatAlanyaNumber(value: string): string {
  const digits = normalizeAlanyaNumber(value).slice(0, ALANYA_NUMBER_MAX_LENGTH)
  const groupSize = digits.length <= 6 ? 3 : 2
  const groups: string[] = []
  for (let i = 0; i < digits.length; i += groupSize) {
    groups.push(digits.slice(i, i + groupSize))
  }
  return groups.join("-")
}

/** Longueur max d'un numero formate (8 chiffres + 3 tirets). */
export const ALANYA_NUMBER_FORMATTED_MAX_LENGTH = 11
