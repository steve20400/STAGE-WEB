/**
 * Numero Alanya (identifiant public d'un utilisateur).
 *
 * Le front n'impose plus de longueur precise. Historiquement il n'acceptait que
 * 6 ou 8 chiffres — les deux formats emis par le backend — et refusait tout le
 * reste avant meme d'appeler le serveur : un compte d'une autre longueur etait
 * donc injoignable depuis le web alors que le backend, lui, l'acceptait. Le
 * front se contente maintenant d'ecarter ce qui ne peut etre un identifiant
 * (vide, une poignee de caracteres, une saisie interminable) et laisse le
 * serveur trancher sur l'existence du compte.
 *
 * Vaut partout ou un numero est saisi : connexion, ajout de contact, nouvelle
 * discussion, composeur, invitation et transfert d'appel.
 */

/** En deca, la saisie est trop courte pour etre un identifiant. */
export const ALANYA_NUMBER_MIN_LENGTH = 3

/**
 * Plafond actuel du backend : les numeros ne depassent pas dix chiffres.
 * A relever ici seulement, le jour ou le backend en emettra de plus longs.
 */
export const ALANYA_NUMBER_MAX_LENGTH = 10

/** Retire tout caractere non numerique (espaces, tirets colles au copier-coller). */
export function normalizeAlanyaNumber(value: string): string {
  return value.replace(/\D/g, "")
}

/** Vrai si la valeur peut etre un numero Alanya. La longueur exacte n'est plus imposee. */
export function isValidAlanyaNumber(value: string): boolean {
  const digits = normalizeAlanyaNumber(value)
  return digits.length >= ALANYA_NUMBER_MIN_LENGTH && digits.length <= ALANYA_NUMBER_MAX_LENGTH
}

/**
 * Formate un numero pour l'affichage et la saisie.
 *
 * Les groupes reprennent exactement ceux de l'application mobile, pour qu'un
 * meme identifiant se lise pareil sur les deux clients :
 *   3  -> xxx            4  -> xx xx           6  -> xxx xxx
 *   8  -> xx xx xx xx    10 -> x xxx xxx xxx
 * Les longueurs intermediaires (5, 7, 9) retombent sur des groupes de deux.
 */
export function formatAlanyaNumber(value: string): string {
  const digits = normalizeAlanyaNumber(value).slice(0, ALANYA_NUMBER_MAX_LENGTH)
  const d = digits
  switch (d.length) {
    case 3:
      return d
    case 4:
      return `${d.slice(0, 2)} ${d.slice(2)}`
    case 6:
      return `${d.slice(0, 3)} ${d.slice(3)}`
    case 8:
      return `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6)}`
    case 10:
      return `${d.slice(0, 1)} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`
    default: {
      const groupes: string[] = []
      for (let i = 0; i < d.length; i += 2) groupes.push(d.slice(i, i + 2))
      return groupes.join(" ")
    }
  }
}

/** Longueur max d'un numero formate : dix chiffres et leurs trois espaces. */
export const ALANYA_NUMBER_FORMATTED_MAX_LENGTH = 13
