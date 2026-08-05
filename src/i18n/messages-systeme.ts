import type { Cle } from "./index"

/**
 * Messages systeme : ceux que le serveur depose dans une conversation et qui
 * s'affichent centres, sans appartenir a personne.
 *
 * Leur texte n'est jamais fige en base. Deux raisons :
 * - chacun lit l'application dans SA langue, et un message enregistre en
 *   francais resterait francais pour tout le monde ;
 * - certains avis ne disent pas la meme chose selon qui lit — celui qui a
 *   bloque ne lit pas la meme phrase que celui qui a ete bloque.
 *
 * Le serveur enregistre donc un code et ses parametres, en JSON, et c'est le
 * client qui compose. Ce module est le seul endroit qui connait ce format.
 */

/** Charge utile d'un message systeme, telle qu'enregistree par le serveur. */
interface ChargeSysteme {
  code: string
  [parametre: string]: unknown
}

function texte(valeur: unknown): string {
  return typeof valeur === "string" ? valeur : ""
}

/**
 * Lit la charge d'un message systeme.
 *
 * Renvoie null si le contenu n'est pas une charge reconnaissable : un message
 * systeme plus ancien porte une phrase en clair, et il vaut mieux l'afficher
 * telle quelle qu'afficher du vide.
 */
function lireCharge(contenu: string | null | undefined): ChargeSysteme | null {
  if (!contenu) return null
  const debut = contenu.trimStart()
  if (!debut.startsWith("{")) return null
  try {
    const objet: unknown = JSON.parse(debut)
    if (typeof objet !== "object" || objet === null) return null
    const code = (objet as { code?: unknown }).code
    return typeof code === "string" ? (objet as ChargeSysteme) : null
  } catch {
    return null
  }
}

/**
 * Compose la phrase a afficher pour un message systeme.
 *
 * `monId` sert aux avis dont la formulation depend du lecteur. Un contenu non
 * reconnu est rendu tel quel : mieux vaut une phrase figee dans une seule
 * langue qu'une bulle vide.
 */
export function composerMessageSysteme(
  contenu: string | null | undefined,
  monId: string | null,
  t: (cle: Cle) => string
): string {
  const charge = lireCharge(contenu)
  if (!charge) return contenu ?? ""

  switch (charge.code) {
    case "blocked_notice": {
      // Le meme message, lu des deux cotes, ne dit pas la meme chose.
      const jeSuisLeBloqueur = monId !== null && texte(charge.blockerId) === monId
      const modele = jeSuisLeBloqueur ? t("system_you_blocked") : t("system_you_were_blocked")
      const nom = jeSuisLeBloqueur ? texte(charge.blockedName) : texte(charge.blockerName)
      return modele.replace("{name}", nom)
    }
    default:
      // Code inconnu — client plus ancien que le serveur. On n'invente pas de
      // phrase : on ne montre rien plutot qu'un JSON brut.
      return ""
  }
}
