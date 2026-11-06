/**
 * Sortie audio d'un appel : haut-parleur ou ecoute a l'oreille.
 *
 * Le mobile change le routage au niveau du systeme
 * (`Helper.setSpeakerphoneOn`, `call_controller.dart`). Le web ne peut pas : aucune
 * API ne choisit entre l'ecouteur d'oreille et le haut-parleur, et `setSinkId`
 * n'existe pas sur Android. Ce que le navigateur permet, c'est le NIVEAU de
 * sortie — ce qui correspond exactement a ce que demande le proprietaire :
 * « ecoute a l'oreille (petit volume) » contre haut-parleur.
 *
 * La bascule agit donc sur le volume des elements audio distants. C'est une
 * approximation assumee, pas un routage : sur un telephone, Chrome envoie de toute
 * facon la sortie vers l'ecouteur d'oreille des qu'une capture micro est active,
 * sans qu'aucun code puisse s'y opposer.
 *
 * Limite connue : Safari iOS ignore l'ecriture de HTMLMediaElement.volume (le
 * volume y est reserve aux boutons physiques), la bascule y est donc sans effet.
 * Un contournement par WebAudio (GainNode) existe mais fragiliserait le chemin
 * audio WebRTC qui fonctionne ; on ne l'introduit pas sans appareil pour le
 * verifier.
 *
 * Ne s'applique qu'aux appels AUDIO. Un appel video reste toujours au
 * haut-parleur, sans bascule possible.
 */
export type AudioOutputMode = "earpiece" | "speaker"

/** Niveau de sortie de chaque mode, applique aux elements audio distants. */
export const OUTPUT_VOLUME: Record<AudioOutputMode, number> = {
  // Assez bas pour une ecoute a l'oreille, assez haut pour rester audible si
  // l'appareil est deja pres de l'oreille.
  earpiece: 0.35,
  speaker: 1,
}

export const OUTPUT_LABELS: Record<AudioOutputMode, string> = {
  earpiece: "Ecoute a l'oreille",
  speaker: "Haut-parleur",
}

/**
 * Libelles courts pour la barre de controles d'appel : « Ecoute a l'oreille »
 * y elargissait son bouton (~95 px) et faisait passer la barre sur deux lignes
 * a 320 px, la plus petite largeur supportee.
 */
export const OUTPUT_LABELS_COURTS: Record<AudioOutputMode, string> = {
  earpiece: "Oreille",
  speaker: "Haut-parleur",
}

/**
 * Mode par defaut a la prise d'un appel audio. Preference d'appareil : elle
 * survit a la deconnexion, comme le theme ou le choix des sonneries.
 */
const STORAGE_KEY = "alanya-audio-output-default"

/**
 * Sans reglage, l'ecoute a l'oreille : c'est la demande du proprietaire, et le
 * comportement du mobile, dont `isSpeakerOn` vaut `false` a l'ouverture d'un appel
 * un-a-un.
 */
export const DEFAULT_OUTPUT_MODE: AudioOutputMode = "earpiece"

export function defaultAudioOutput(): AudioOutputMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "earpiece" || stored === "speaker") return stored
  } catch {
    // stockage indisponible : on garde le defaut
  }
  return DEFAULT_OUTPUT_MODE
}

export function setDefaultAudioOutput(mode: AudioOutputMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // stockage indisponible : le choix ne survivra pas a la session
  }
}

/*
 * LE CHOIX DE LA SORTIE (06/11/2026) : la ou le navigateur sait diriger le son
 * vers un appareil precis (`setSinkId` — Chrome, Edge, Firefox sur ordinateur),
 * l'ecran propose la liste des sorties : haut-parleurs, casque, Bluetooth.
 * Ailleurs — Android, Safari iOS — la bascule oreille / haut-parleur ci-dessus
 * reste la seule possible.
 */
export const SORTIE_CHOISISSABLE =
  typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype

const CLE_SORTIE = "alanya.appel.sortie"

/** La sortie retenue sur cet appareil ; nulle = celle du systeme. */
export function sortieRetenue(): string | null {
  try {
    return localStorage.getItem(CLE_SORTIE)
  } catch {
    return null
  }
}

export function retenirSortie(id: string | null): void {
  try {
    if (id) localStorage.setItem(CLE_SORTIE, id)
    else localStorage.removeItem(CLE_SORTIE)
  } catch {
    // Non retenue : elle vaudra pour cet appel seulement.
  }
}

/** Dirige [el] vers la sortie [id] (nulle = celle du systeme). Sans effet ailleurs. */
export function appliquerSortie(el: HTMLMediaElement, id: string | null): void {
  if (!SORTIE_CHOISISSABLE) return
  const media = el as HTMLMediaElement & { sinkId?: string; setSinkId(id: string): Promise<void> }
  const cible = id ?? ""
  if ((media.sinkId ?? "") === cible) return
  // Appareil debranche depuis : le son reste ou il est.
  void media.setSinkId(cible).catch(() => undefined)
}
