/**
 * Numéros de téléphone : normalisation et présentation, selon le pays.
 *
 * ⚠️ **MIROIR EXACT de `backend-alanya/src/lib/telephone.mjs`**, et du miroir
 * Flutter `alanya/lib/core/telephone.dart`. La règle est décidée côté SERVEUR —
 * c'est lui qui normalise ce qui va en base, et lui seul fait foi. Toute
 * évolution se fait là-bas d'abord.
 *
 * POURQUOI ELLE EXISTE : `users.mobile` est UNIQUE, et la base portait déjà
 * deux formes du même numéro — « 657308298 » et « +237657308299 », constatées
 * le 25/08/2026. Deux formes ne se ressemblent pas pour PostgreSQL : la même
 * personne peut s'inscrire deux fois, et la recherche par numéro n'en trouve
 * qu'une.
 */

/**
 * Groupement des chiffres à l'affichage, par code ISO 3166-1 alpha-2.
 *
 * ⚠️ CE N'EST QUE DE LA PRÉSENTATION. Rien de ce qui est envoyé au serveur n'en
 * dépend : `normaliserTelephone` produit toujours la même chaîne.
 */
const GROUPES: Record<string, number[]> = {
  // Amérique du Nord : 3-3-4, universellement lu ainsi.
  US: [3, 3, 4],
  CA: [3, 3, 4],
  // Royaume-Uni : 4-6 sur les mobiles (07xxx xxxxxx).
  GB: [4, 6],
}

/** Par défaut : des paires. « 6 91 23 45 67 » se lit sans effort. */
const GROUPE_DEFAUT = 2

const chiffres = (v: string | null | undefined) =>
  typeof v === "string" ? v.replace(/\D/g, "") : ""

/**
 * La forme CANONIQUE : `+` suivi de l'indicatif et du numéro national, sans
 * séparateur. C'est celle qui part au serveur.
 *
 * Absorbe les trois façons de saisir le même numéro : national tel qu'on le
 * dicte, national avec le zéro de service, ou déjà international (`+` ou `00`).
 *
 * ⚠️ LE ZÉRO INITIAL EST RETIRÉ : préfixe d'acheminement INTERNE au pays, il
 * n'a aucun sens derrière un indicatif — « +33 0 6 … » n'appelle personne.
 *
 * ⚠️ L'INDICATIF N'EST RETIRÉ QU'UNE FOIS. Le retirer en boucle mutilerait un
 * numéro national commençant par les chiffres de son propre indicatif, qu'on ne
 * peut pas distinguer d'un doublon.
 */
export function normaliserTelephone(saisie: string, prefixePays: string): string {
  let n = chiffres(saisie)
  if (n === "") return ""

  /*
   * 🔴 UN « + » EN TÊTE DIT « CE NUMÉRO EST DÉJÀ COMPLET » — on n'y ajoute rien.
   *
   * Sans cette sortie, l'indicatif du compte se collait devant un numéro
   * étranger : « +221 34543678 » sur un compte déclaré en France ressortait
   * « +3322134543678 », injoignable — et `users.mobile` est UNIQUE.
   *
   * Le cas est fréquent et légitime : on vit dans un pays et on garde une ligne
   * d'un autre. C'est la raison même pour laquelle changer de pays ne touche
   * pas au numéro.
   *
   * ⚠️ Le test porte sur la SAISIE BRUTE : `chiffres()` a déjà retiré le « + ».
   */
  if (saisie.trim().startsWith("+")) return `+${n}`

  const indicatif = chiffres(prefixePays)

  // « 00 » international : la forme longue de « + ».
  if (n.startsWith("00")) n = n.slice(2)

  if (indicatif !== "" && n.startsWith(indicatif)) n = n.slice(indicatif.length)

  n = n.replace(/^0+/, "")

  if (n === "") return ""
  return indicatif === "" ? `+${n}` : `+${indicatif}${n}`
}

/** Le numéro tel qu'on le LIT : « +237 6 91 23 45 67 ». */
export function formaterTelephone(
  saisie: string,
  prefixePays: string,
  iso2: string | null = null,
): string {
  const canonique = normaliserTelephone(saisie, prefixePays)
  if (canonique === "") return ""

  const indicatif = chiffres(prefixePays)

  /*
   * 🔴 LE NUMÉRO NE PORTE PAS L'INDICATIF DEMANDÉ : on le rend tel quel.
   *
   * Le découpage suppose que `canonique` commence par `indicatif` pour savoir
   * où finit l'indicatif. Sinon la soustraction de longueurs mange des chiffres
   * et en réattribue d'autres : « +33612345678 » présenté avec « +237 »
   * ressortait « +237 12 34 56 78 » — un AUTRE numéro, pas une mise en forme.
   */
  if (indicatif !== "" && !canonique.startsWith(`+${indicatif}`)) {
    return canonique
  }

  const national = canonique.slice(1 + indicatif.length)
  if (national === "") return `+${indicatif}`

  const decoupe = GROUPES[(iso2 ?? "").toUpperCase()]
  const morceaux: string[] = []

  if (decoupe) {
    let reste = national
    for (const taille of decoupe) {
      if (reste === "") break
      morceaux.push(reste.slice(0, taille))
      reste = reste.slice(taille)
    }
    // Ce qui dépasse le découpage annoncé est conservé, jamais coupé.
    if (reste !== "") morceaux.push(reste)
  } else {
    // Paires, EN PARTANT DE LA FIN. Les numéros d'Afrique francophone comptent
    // 9 chiffres, un nombre IMPAIR : grouper depuis le début laisserait un
    // chiffre orphelin à la fin, alors que l'usage local isole le premier —
    // « 6 91 23 45 67 », la façon dont ces numéros se dictent.
    let reste = national
    while (reste.length > GROUPE_DEFAUT) {
      morceaux.unshift(reste.slice(-GROUPE_DEFAUT))
      reste = reste.slice(0, -GROUPE_DEFAUT)
    }
    if (reste !== "") morceaux.unshift(reste)
  }

  return `+${indicatif} ${morceaux.join(" ")}`
}
