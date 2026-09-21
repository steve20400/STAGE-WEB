import { apiRequest } from "../lib/api-client"
import { API_BASE_URL } from "../config/runtime"
import { loadSessionToken } from "../data/session-auth"

/**
 * L'EXPORT DES MÉDIAS REÇUS.
 *
 * 🔴 L'ARCHIVE N'EST PAS CONSTRUITE ICI, ET C'EST DÉLIBÉRÉ. La fabriquer dans
 * le navigateur obligerait à télécharger chaque fichier dans la page, à le
 * garder en mémoire, puis à le réécrire : deux fois le transfert, et un plafond
 * atteint vers quelques centaines de mégaoctets — un onglet qui se ferme tout
 * seul au milieu d'un export d'un an. Le serveur lit son stockage et écrit
 * l'archive au fil de l'eau ; le navigateur ne fait que la recevoir.
 *
 * ⚠️ ET C'EST UN VRAI TÉLÉCHARGEMENT DE NAVIGATEUR, pas un `fetch`. C'est ce
 * qui permet de quitter l'écran sans rien interrompre : le gestionnaire de
 * téléchargements poursuit, affiche sa progression et prévient à la fin. Un
 * `fetch` mourrait avec le composant, et garderait tout en mémoire d'ici là.
 */

/** Les familles proposées — mêmes noms qu'en base, pour éviter une traduction. */
export const FAMILLES = ["photo", "video", "audio", "document"] as const
export type Famille = (typeof FAMILLES)[number]

export interface CriteresExport {
  /** Vide = toutes mes discussions. */
  conversations: string[]
  familles: Famille[]
  /** Bornes locales « YYYY-MM-DDTHH:mm », ou chaîne vide. */
  du: string
  au: string
}

export interface ChiffrageExport {
  fichiers: number
  octets: number
  plafondOctets: number
}

/**
 * Les critères, mis en paramètres d'URL.
 *
 * ⚠️ LES DATES PARTENT EN ISO AVEC LEUR FUSEAU. Un champ `datetime-local` rend
 * « 2026-09-21T10:00 » sans aucun fuseau : envoyé tel quel, le serveur le lirait
 * comme de l'UTC, et quelqu'un à Douala exporterait une tranche décalée d'une
 * heure sans jamais comprendre pourquoi. `new Date(...)` l'interprète dans le
 * fuseau du navigateur — celui de l'utilisateur — et `toISOString` le rend
 * absolu.
 */
function parametres(criteres: CriteresExport): URLSearchParams {
  const p = new URLSearchParams()
  p.set("familles", criteres.familles.join(","))
  if (criteres.conversations.length > 0) {
    p.set("conversations", criteres.conversations.join(","))
  }
  if (criteres.du) p.set("du", new Date(criteres.du).toISOString())
  if (criteres.au) p.set("au", new Date(criteres.au).toISOString())
  return p
}

/** Combien de fichiers, et quel poids — avant de s'engager. */
export async function chiffrerExport(criteres: CriteresExport): Promise<ChiffrageExport> {
  const p = parametres(criteres)
  p.set("compter", "1")
  return apiRequest<ChiffrageExport>(`/api/exports/medias?${p.toString()}`, {
    // Un décompte se périme dès qu'un message arrive : jamais depuis un cache.
    cache: "no-store",
  })
}

/**
 * Lance le téléchargement de l'archive.
 *
 * ⚠️ LE JETON VOYAGE DANS L'URL, faute d'alternative : un téléchargement de
 * navigateur ne porte aucun en-tête qu'on choisit. C'est le même mécanisme que
 * les médias affichés dans les discussions, et le serveur ne l'accepte que pour
 * un jeton d'accès en cours de validité.
 */
export function lancerTelechargement(criteres: CriteresExport): void {
  const p = parametres(criteres)
  const jeton = loadSessionToken()
  if (jeton) p.set("token", jeton)

  /*
   * Un `<a download>` cliqué plutôt qu'un `location.href` : ce dernier fait
   * paraître une navigation, et certains navigateurs mobiles interrompent alors
   * l'application. L'ancre, elle, ne déclenche qu'un téléchargement.
   */
  const lien = document.createElement("a")
  lien.href = `${API_BASE_URL}/api/exports/medias?${p.toString()}`
  lien.rel = "noopener"
  lien.style.display = "none"
  document.body.appendChild(lien)
  lien.click()
  // Retiré tout de suite : le téléchargement est déjà pris en charge par le
  // navigateur, l'élément n'a plus aucun rôle.
  document.body.removeChild(lien)
}

/** « 1,4 Go », « 812 Mo » — la taille telle qu'on la lit. */
export function tailleLisible(octets: number, langue: string): string {
  if (octets <= 0) return "0 o"
  const unites = ["o", "Ko", "Mo", "Go", "To"]
  const rang = Math.min(unites.length - 1, Math.floor(Math.log(octets) / Math.log(1024)))
  const valeur = octets / Math.pow(1024, rang)
  // Une décimale au-delà du kilo-octet, aucune en dessous : « 1,4 Go » se lit,
  // « 1,437 Go » se déchiffre.
  return `${valeur.toLocaleString(langue, { maximumFractionDigits: rang > 1 ? 1 : 0 })} ${unites[rang]}`
}
