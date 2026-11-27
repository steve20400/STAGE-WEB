/**
 * LE PARTAGE DE SHAMIR — contacts de récupération (27/11/2026, chantier 2).
 *
 * 🔴 JUMEAU DE `alanya/lib/services/e2ee/e2ee_shamir.dart` : mêmes octets pour
 * les mêmes coefficients (vecteurs figés dans les deux bancs).
 *
 * Chaque octet du secret est le terme constant d'un polynôme de degré k − 1 à
 * coefficients tirés au sort, dans le corps à 256 éléments d'AES (polynôme
 * x⁸ + x⁴ + x³ + x + 1). La part d'indice x est la valeur du polynôme en x.
 * Avec k parts, l'interpolation de Lagrange en 0 rend le secret ; avec moins,
 * TOUTES les valeurs du secret restent également possibles — une part seule
 * ne dit rien.
 *
 * ⚠️ PAS D'INDICE 0 : la valeur en 0 EST le secret.
 */

export interface Part {
  /** L'abscisse, de 1 à 255. */
  indice: number
  valeur: Uint8Array
}

/** Produit dans GF(2⁸), réduction par 0x11b. */
export function multiplier(a: number, b: number): number {
  let p = 0
  while (b) {
    if (b & 1) p ^= a
    const haut = a & 0x80
    a = (a << 1) & 0xff
    if (haut) a ^= 0x1b
    b >>= 1
  }
  return p
}

/** Inverse dans GF(2⁸) : a²⁵⁴. */
export function inverser(a: number): number {
  if (a === 0) throw new Error("zéro n'a pas d'inverse")
  let r = 1
  let x = a
  let e = 254
  while (e) {
    if (e & 1) r = multiplier(r, x)
    x = multiplier(x, x)
    e >>= 1
  }
  return r
}

/**
 * Partage [secret] en [n] parts dont [k] suffisent. [alea] : pour les
 * vecteurs seulement — il rend les (k − 1) × longueur coefficients.
 */
export function partager(
  secret: Uint8Array,
  n: number,
  k: number,
  alea: (longueur: number) => Uint8Array = (l) => crypto.getRandomValues(new Uint8Array(l)),
): Part[] {
  if (k < 2 || n < k || n > 255) throw new Error("partage impossible")
  const coef = alea(secret.length * (k - 1))
  const parts: Part[] = []
  for (let x = 1; x <= n; x++) {
    const valeur = new Uint8Array(secret.length)
    for (let i = 0; i < secret.length; i++) {
      // Horner : a(k−1)·x^(k−1) + … + a1·x + secret[i].
      let y = 0
      for (let j = k - 2; j >= 0; j--) y = multiplier(y, x) ^ coef[j * secret.length + i]
      valeur[i] = multiplier(y, x) ^ secret[i]
    }
    parts.push({ indice: x, valeur })
  }
  return parts
}

/** Rend le secret à partir de parts d'indices distincts (autant que le seuil). */
export function assembler(parts: Part[]): Uint8Array {
  if (parts.length < 2) throw new Error("il faut au moins deux parts")
  const longueur = parts[0].valeur.length
  if (new Set(parts.map((p) => p.indice)).size !== parts.length) throw new Error("indices en double")
  const secret = new Uint8Array(longueur)
  for (const pj of parts) {
    // Coefficient de Lagrange en 0 : Π x_m / (x_m − x_j), soustraction = XOR.
    let num = 1
    let den = 1
    for (const pm of parts) {
      if (pm === pj) continue
      num = multiplier(num, pm.indice)
      den = multiplier(den, pm.indice ^ pj.indice)
    }
    const l = multiplier(num, inverser(den))
    for (let i = 0; i < longueur; i++) secret[i] ^= multiplier(pj.valeur[i], l)
  }
  return secret
}
