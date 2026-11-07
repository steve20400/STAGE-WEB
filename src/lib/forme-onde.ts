/**
 * LA FORME D'ONDE D'UN MESSAGE VOCAL — 56 barres, comme le mobile.
 *
 * 🔴 LE MOBILE L'A DEPUIS LE 18/10/2026 (`lib/widgets/media/forme_onde_vocale.dart`),
 * le web affichait une simple barre de progression. Même nombre de barres, même
 * repli : une bulle vocale doit avoir la même allure sur les deux clients.
 *
 * 🔴 ET ICI ON EXTRAIT POUR DE VRAI. Le mobile ne sait pas le faire sur sa
 * version web (`audio_waveforms` n'existe que sur Android et iOS) et se rabat
 * toujours sur une onde dessinée ; un navigateur, lui, sait décoder un son avec
 * l'API Web Audio. Autant montrer la vraie voix plutôt qu'un motif.
 *
 * ⚠️ RIEN N'EST DEMANDÉ AU SERVEUR, et c'est un choix : aucune des deux
 * applications ne range la forme d'onde avec le message. L'ajouter côté serveur
 * obligerait à la calculer à l'envoi, pour tous les clients, et à la migrer pour
 * l'historique. Le calcul local coûte quelques millisecondes une seule fois.
 */

/** Nombre de barres, identique au mobile (`barresFormeOnde`). */
export const BARRES = 56

/**
 * Au-delà, on ne décode pas : on dessine.
 *
 * ⚠️ DÉCODER COÛTE DE LA MÉMOIRE — un son décodé occupe environ dix fois son
 * poids compressé, en flottants. Un vocal de quelques dizaines de secondes ne
 * pose aucun problème ; un fichier musical importé de vingt minutes ferait
 * tomber l'onglet, pour une onde que personne ne regardera.
 */
const POIDS_MAX = 8 * 1024 * 1024
const SECONDES_MAX = 10 * 60

/** Les ondes déjà calculées, par adresse. Une seule fois par média. */
const connues = new Map<string, number[]>()

/** Un entier stable à partir d'une chaîne — le pendant de `Object.hash`. */
function graineDe(texte: string): number {
  let h = 2166136261
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Des barres DÉTERMINISTES, quand l'extraction échoue ou n'est pas possible.
 *
 * 🔴 JAMAIS VIDE, ET TOUJOURS LA MÊME POUR LE MÊME MESSAGE. Une onde tirée au
 * hasard à chaque affichage ferait danser la bulle à chaque défilement — c'est
 * la règle que le mobile s'est donnée (`formeOndeDeRepli`), et elle vaut ici.
 */
export function ondeDeRepli(graine: string, dureeSecondes: number, barres = BARRES): number[] {
  const s = graineDe(`${graine}|${Math.round(dureeSecondes)}`)
  let etat = s || 1
  const suivant = () => {
    // Xorshift : court, sans dépendance, et reproductible.
    etat ^= etat << 13
    etat ^= etat >>> 17
    etat ^= etat << 5
    return ((etat >>> 0) % 1000) / 1000
  }
  return Array.from({ length: barres }, (_, i) => {
    const t = i / barres
    const onde = 0.35 + 0.45 * Math.sin(t * Math.PI * 5 + (s % 7))
    const bruit = suivant() * 0.2
    return Math.min(1, Math.max(0.08, onde + bruit))
  })
}

/** Les crêtes d'un son déjà décodé, ramenées à [barres] valeurs de 0,08 à 1. */
export function cretes(echantillons: Float32Array, barres = BARRES): number[] {
  const parBarre = Math.max(1, Math.floor(echantillons.length / barres))
  const brutes: number[] = []
  for (let b = 0; b < barres; b++) {
    const debut = b * parBarre
    const fin = Math.min(echantillons.length, debut + parBarre)
    let somme = 0
    for (let i = debut; i < fin; i++) somme += echantillons[i] * echantillons[i]
    brutes.push(fin > debut ? Math.sqrt(somme / (fin - debut)) : 0)
  }
  /*
   * ⚠️ NORMALISÉ SUR LA PLUS FORTE, pas sur 1. Une voix enregistrée au
   * téléphone dépasse rarement un cinquième de l'échelle : sans ce rapport,
   * toutes les ondes seraient des traits plats au ras du sol.
   */
  const max = Math.max(...brutes, 0.0001)
  return brutes.map((v) => Math.min(1, Math.max(0.08, v / max)))
}

/**
 * La forme d'onde du son à [url] : la vraie si on peut la lire, sinon dessinée.
 *
 * Ne lève jamais : une bulle vocale doit s'afficher même quand le son est
 * illisible, hors ligne, ou d'un format que le navigateur ne décode pas.
 */
export async function formeOnde(
  url: string,
  graine: string,
  dureeSecondes: number,
): Promise<number[]> {
  const deja = connues.get(url)
  if (deja) return deja

  const repli = ondeDeRepli(graine, dureeSecondes)
  if (dureeSecondes > SECONDES_MAX) return repli

  try {
    const Contexte =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Contexte) return repli

    const reponse = await fetch(url)
    if (!reponse.ok) return repli
    const octets = await reponse.arrayBuffer()
    if (octets.byteLength > POIDS_MAX) return repli

    /*
     * ⚠️ UN CONTEXTE HORS LIGNE, et non un `AudioContext` ordinaire : celui-ci
     * ouvrirait la carte son pour ne rien jouer, ce que certains navigateurs
     * refusent tant que l'utilisateur n'a pas cliqué.
     */
    const contexte = new OfflineAudioContext(1, 1, 44100)
    const son = await contexte.decodeAudioData(octets)
    const onde = cretes(son.getChannelData(0))
    connues.set(url, onde)
    return onde
  } catch {
    // Format refusé, réseau coupé, mémoire : l'onde dessinée fait l'affaire.
    return repli
  }
}
