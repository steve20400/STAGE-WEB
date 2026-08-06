import type { LanguageCode } from "./catalogue"

/**
 * Nom d'un pays dans la langue de l'utilisateur.
 *
 * Le serveur n'envoie plus de libelles traduits : il envoie un code ISO 3166,
 * et chaque client traduit localement. `Intl.DisplayNames` fait ce travail
 * nativement dans toutes les langues du navigateur, sans table a maintenir —
 * c'est ce qui evite d'ajouter une colonne de libelles par langue en base.
 */

/**
 * Traducteurs deja construits, une fois par langue.
 *
 * `Intl.DisplayNames` a un cout de construction non negligeable ; l'appeler
 * pour chaque ligne d'une liste de 66 pays se verrait a l'affichage.
 */
const traducteurs = new Map<string, Intl.DisplayNames | null>()

function traducteur(langue: LanguageCode): Intl.DisplayNames | null {
  const deja = traducteurs.get(langue)
  if (deja !== undefined) return deja
  let instance: Intl.DisplayNames | null = null
  try {
    instance = new Intl.DisplayNames([langue], { type: "region" })
  } catch {
    // Navigateur sans support, ou langue inconnue de l'implementation : on
    // retombera sur le libelle du serveur plutot que de ne rien afficher.
    instance = null
  }
  traducteurs.set(langue, instance)
  return instance
}

/**
 * Traduit un pays, avec repli sur le libelle du serveur.
 *
 * Trois raisons de retomber sur `libelle` : le pays n'a pas encore de code ISO
 * en base, le navigateur ne connait pas `Intl.DisplayNames`, ou il ne sait pas
 * traduire ce code precis. Dans les trois cas on affiche ce que le serveur a
 * envoye — soit exactement le comportement d'avant, jamais du vide.
 */
export function nomDuPays(
  iso2: string | null | undefined,
  libelle: string,
  langue: LanguageCode
): string {
  const code = iso2?.trim().toUpperCase()
  if (!code || code.length !== 2) return libelle

  const nom = traducteur(langue)?.of(code)
  // `of()` renvoie le code lui-meme quand il ne sait pas traduire : ce n'est
  // pas un nom de pays, c'est un aveu d'echec. On prefere le libelle serveur.
  if (!nom || nom === code) return libelle
  return nom
}
