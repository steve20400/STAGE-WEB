import { accueilDeLAppel } from "./repondeur-service"
import { resolveMediaUrl } from "./media-service"

/**
 * L'ACCUEIL DU RÉPONDEUR, TÉLÉCHARGÉ PENDANT QUE ÇA SONNE.
 *
 * 🔴 CE MODULE EXISTE POUR UNE SEULE RAISON : QUE L'ACCUEIL SE JOUE TOUT SEUL.
 *
 * Il fallait cliquer sur « Écouter l'accueil » pour l'entendre, et cela venait
 * de deux causes qu'on a longtemps confondues :
 *
 *   • le navigateur refuse de jouer un son sans geste récent — et l'accueil
 *     part TRENTE SECONDES après le dernier clic ;
 *   • l'adresse du média passe par le réseau, avec son jeton : au moment où il
 *     faudrait jouer, on attend encore une réponse, et cette attente-là s'est
 *     déjà terminée en 403.
 *
 * Précharger règle les deux D'UN COUP. On télécharge pendant la sonnerie, et
 * l'on obtient un `blob:` — une adresse LOCALE. Au moment de jouer il n'y a
 * plus AUCUNE requête : pas de latence, pas de jeton, pas de refus possible. Et
 * l'élément qui joue est déjà en train de jouer la tonalité : sa permission est
 * acquise, on ne fait que changer ce qu'il dit.
 *
 * ⚠️ LE TÉLÉCHARGEMENT S'ANNULE DÈS QU'IL N'A PLUS D'OBJET — on décroche, on
 * raccroche. Sans cela, on paierait les données d'un accueil que personne
 * n'entendra, sur un forfait mobile, à chaque appel abouti.
 */

interface Prechargement {
  callId: string
  /** L'adresse locale, une fois le fichier arrivé. */
  blob: string | null
  /** La promesse en cours : plusieurs appelants peuvent l'attendre. */
  attente: Promise<string | null>
  abandon: AbortController
}

let encours: Prechargement | null = null

/**
 * L'accueil dont la feuille du répondeur s'est saisie.
 *
 * 🔴 IL CHANGE DE MAIN, ET IL LE FAUT. Le répondeur prend le relais puis
 * RACCROCHE — et raccrocher annule le préchargement, donc libérerait l'adresse
 * locale. La feuille se retrouverait avec un `blob:` mort, et plus aucun son :
 * exactement le défaut qu'on cherche à corriger. Dès qu'elle est servie,
 * l'adresse sort du préchargement et n'est plus libérée que par
 * `libererAccueilAdopte`.
 */
let adopte: string | null = null

/** Libère l'adresse locale. Sans cela, le fichier reste en mémoire pour la vie de l'onglet. */
function liberer(p: Prechargement | null): void {
  if (p?.blob) URL.revokeObjectURL(p.blob)
}

/**
 * Arrête et oublie le préchargement en cours.
 *
 * Appelé quand l'appel aboutit ou qu'on raccroche : il n'y aura pas de
 * répondeur, et continuer à télécharger serait payer pour rien.
 */
export function annulerPrechargement(): void {
  if (!encours) return
  encours.abandon.abort()
  liberer(encours)
  encours = null
}

/**
 * Libère l'accueil que la feuille du répondeur utilisait.
 *
 * Appelé à la fermeture de la feuille et au départ d'un nouvel appel : sans
 * cela, chaque répondeur laisserait son fichier en mémoire pour la vie de
 * l'onglet — quelques mégaoctets par appel manqué, qui s'additionnent.
 */
export function libererAccueilAdopte(): void {
  if (!adopte) return
  URL.revokeObjectURL(adopte)
  adopte = null
}

/**
 * TELECHARGE L'ACCUEIL, PAR LA VOIE RAPIDE PUIS PAR LA VOIE SURE.
 *
 * 🔴 DEUX VOIES, ET IL EN FAUT DEUX.
 *
 * La rapide est l'adresse fixe du bucket ouvert : aucun jeton, aucune signature,
 * mise en cache un an. Un accueil deja entendu ne se retelecharge meme pas.
 *
 * ⚠️ MAIS UN `fetch()` VERS UN AUTRE DOMAINE EXIGE DES EN-TETES CORS. Sans regle
 * CORS sur le bucket, le navigateur refuse de LIRE la reponse — et le
 * telechargement echoue alors que le fichier est parfaitement servi. Ce depot
 * connait deja ce mur : `media-preview-cache.ts` a du se faire un proxy pour la
 * meme raison.
 *
 * La voie sure est donc `/api/media/<id>?flux=1` : meme origine, aucun CORS en
 * jeu. `flux=1` demande au serveur de servir les octets LUI-MEME au lieu de
 * rediriger vers Backblaze — sans ce parametre, la redirection nous ramenerait
 * exactement sur le mur qu'on essaie de contourner.
 *
 * ⚠️ RESULTAT : REGLER CORS EST UNE ECONOMIE DE BANDE PASSANTE, PAS UNE
 * CONDITION POUR QUE LE SON ARRIVE.
 */
async function telecharger(
  relative: string,
  publique: string | null | undefined,
  signal: AbortSignal,
): Promise<Blob | null> {
  if (publique) {
    try {
      const rapide = await fetch(publique, { signal })
      if (rapide.ok) return await rapide.blob()
    } catch {
      // CORS, reseau qui filtre les domaines tiers, bucket deplace : on ne
      // cherche pas a savoir. On reessaie par chez nous.
    }
    // ⚠️ L'ABANDON N'EST PAS UN ECHEC A RATTRAPER : l'appel a abouti ou on a
    // raccroche. Reessayer paierait les donnees d'un accueil que personne
    // n'entendra.
    if (signal.aborted) return null
  }

  const sep = relative.includes("?") ? "&" : "?"
  const sure = await fetch(resolveMediaUrl(`${relative}${sep}flux=1`), { signal })
  return sure.ok ? await sure.blob() : null
}

/**
 * Commence à télécharger l'accueil de la personne appelée.
 *
 * `urlDirecte` court-circuite la demande au serveur : en mode absence, la trame
 * `repondeur_direct` porte déjà l'adresse, et redemander serait un aller-retour
 * de plus pour une réponse qu'on a sous la main. `urlPubliqueDirecte` est son
 * équivalent rapide, que la même trame porte désormais — les deux voyagent
 * ensemble, et l'on essaie la rapide en premier.
 *
 * ⚠️ NE LÈVE JAMAIS. Un préchargement qui échoue n'est pas une panne : on
 * retombe sur l'adresse réseau, exactement comme avant. Le laisser remonter
 * ferait échouer le DÉCLENCHEMENT du répondeur pour un simple gain de confort.
 */
export function demarrerPrechargement(
  callId: string,
  urlDirecte?: string,
  urlPubliqueDirecte?: string | null,
): void {
  if (encours?.callId === callId) return
  annulerPrechargement()

  const abandon = new AbortController()
  /*
   * ⚠️ LA LIGNE EST CRÉÉE AVANT SA PROMESSE, et il le faut : la promesse écrit
   * dans `blob` quand elle aboutit, donc elle a besoin de la ligne. Les
   * construire d'un seul tenant se refermerait sur une variable pas encore
   * assignée.
   */
  const p: Prechargement = {
    callId,
    blob: null,
    abandon,
    attente: Promise.resolve(null),
  }
  p.attente = (async () => {
    try {
      let relative = urlDirecte
      let publique = urlPubliqueDirecte
      if (!relative) {
        const accueil = await accueilDeLAppel(callId)
        relative = accueil?.url
        publique = accueil?.urlPublique
      }
      if (!relative) return null
      const donnees = await telecharger(relative, publique, abandon.signal)
      if (!donnees) return null
      // L'appel a pu changer entre-temps : on ne garde pas un fichier qui n'a
      // plus de destinataire.
      if (abandon.signal.aborted) return null
      const url = URL.createObjectURL(donnees)
      p.blob = url
      return url
    } catch {
      return null
    }
  })()
  encours = p
}

/** L'accueil est-il déjà là, sans rien attendre ? */
export function accueilPret(callId: string): string | null {
  return encours?.callId === callId ? encours.blob : null
}

/**
 * Attend l'accueil préchargé, sans jamais attendre indéfiniment.
 *
 * ⚠️ `maxMs` N'EST PAS UNE PRÉCAUTION DE PRINCIPE. Sur un réseau lent, un
 * accueil de deux mégaoctets peut mettre une minute : sans plafond, la tonalité
 * jouerait tout ce temps et l'appelant croirait que ça sonne encore. Passé le
 * délai, on rend `null` et l'on retombe sur l'adresse réseau — l'écran paraît,
 * et le bouton « Écouter l'accueil » reste la sortie de secours.
 */
export async function attendreAccueil(callId: string, maxMs: number): Promise<string | null> {
  if (encours?.callId !== callId) return null
  const p = encours
  const plafond = new Promise<null>((resoudre) => window.setTimeout(() => resoudre(null), maxMs))
  const url = await Promise.race([p.attente, plafond])
  if (!url) return null

  /*
   * ⚠️ L'ADRESSE CHANGE DE MAIN ICI. Le répondeur va raccrocher juste après, et
   * raccrocher annule le préchargement — ce qui libérerait le fichier sous les
   * pieds de la feuille qui doit le jouer. En la sortant du préchargement, elle
   * survit jusqu'à `libererAccueilAdopte`.
   */
  libererAccueilAdopte()
  adopte = url
  if (encours === p) encours = null
  return url
}
