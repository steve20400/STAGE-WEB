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
export const ALANYA_NUMBER_MAX_LENGTH = 10

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
 * Formate un numéro Alanya avec des espaces, pendant la saisie et à l'affichage.
 * 1-3: 123 | 4: 12 34 | 5: 12 34 5 | 6: 123 456 | 7: 123 456 7
 * 8: 12 34 56 78 | 9: 123 456 789 | 10: 1 234 567 890.
 */
export function formatAlanyaNumber(value: string): string {
  const digits = normalizeAlanyaNumber(value).slice(0, ALANYA_NUMBER_MAX_LENGTH)
  const length = digits.length
  if (length <= 3) return digits
  if (length === 4) return `${digits.slice(0, 2)} ${digits.slice(2)}`
  if (length === 5) return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`
  if (length === 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`
  if (length === 7) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
  if (length === 8) return digits.match(/.{1,2}/g)?.join(" ") ?? digits
  if (length === 9) return digits.match(/.{1,3}/g)?.join(" ") ?? digits
  return `${digits.slice(0, 1)} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
}

/** Longueur max d'un numero formate (8 chiffres + 3 tirets). */
export const ALANYA_NUMBER_FORMATTED_MAX_LENGTH = 13
