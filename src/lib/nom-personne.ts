/**
 * UN NOM DE PERSONNE A DE VRAIES LETTRES (13/11/2026, demande du user).
 *
 * « 2 caracteres minimum » laissait passer « .. », « -- » ou deux caracteres
 * INVISIBLES (espace sans largeur, remplissage coreen, espace braille…), que
 * `trim()` ne retire pas : le compte s'affichait sans nom.
 *
 * ⚠️ JUMEAU DU SERVEUR (`banc-backend-alanya/src/lib/validation.ts`) et du
 * mobile (`lib/core/nom_personne.dart`). Le serveur fait foi ; cet echo sert a
 * refuser dans le formulaire, avant l'envoi.
 */
// Les caracteres qui s'accolent au precedent (U+034F, U+17B4-5, U+180B-F)
// sont en alternatives : dans une classe, ESLint les refuse a juste titre.
const INVISIBLES =
  /[\u00AD\u061C\u115F\u1160\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]|\u034F|\u17B4|\u17B5|\u180B|\u180C|\u180D|\u180E|\u180F/g

/** Invisibles retires, espaces regroupes, bords coupes. */
export function nettoyerNom(brut: string): string {
  return brut.replace(INVISIBLES, "").replace(/\s+/gu, " ").trim()
}

/** Au moins deux lettres ou chiffres, de n'importe quelle ecriture. */
export function nomPersonneValide(nom: string): boolean {
  return (nettoyerNom(nom).match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 2
}
