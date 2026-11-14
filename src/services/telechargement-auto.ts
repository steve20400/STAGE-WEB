/**
 * LE TÉLÉCHARGEMENT AUTOMATIQUE DES MÉDIAS REÇUS.
 *
 * 🐛 Retour des testeurs du 14/11/2026 : « il n'y a pas d'option pour
 * désactiver le téléchargement automatique ». Ouvrir une discussion faisait
 * venir, sans rien demander, chaque photo en entier, chaque vocal en entier
 * (pour dessiner sa forme d'onde), le début de chaque vidéo et chaque PDF à
 * prévisualiser. Sur un forfait mobile, c'est de la donnée payée pour des
 * fichiers qu'on ne regardera peut-être pas.
 *
 * Une famille ÉTEINTE ne télécharge plus rien tant qu'on n'a pas touché le
 * média : la bulle montre sa place, son poids, et un bouton.
 *
 * ⚠️ ALLUMÉ = EXACTEMENT LE COMPORTEMENT D'AVANT, et c'est le défaut. Rien ne
 * change pour qui ne touche pas au réglage. En particulier, une vidéo, un
 * vocal ou un document CHIFFRÉS restaient déjà en attente d'un geste : les
 * allumer ne les fait pas télécharger d'office.
 *
 * ⚠️ RÉGLAGE DE CET APPAREIL, pas du compte : le téléphone en 4G et l'ordinateur
 * au bureau n'ont pas le même forfait. C'est aussi le choix de WhatsApp.
 *
 * Les médias que J'ENVOIE ne sont jamais retenus : je les ai déjà.
 */

export const FAMILLES_MEDIA = ["photo", "audio", "video", "document"] as const
export type FamilleMedia = (typeof FAMILLES_MEDIA)[number]
export type ReglagesTelechargement = Readonly<Record<FamilleMedia, boolean>>

const CLE = "alanya-telechargement-auto-v1"

const DEFAUTS: ReglagesTelechargement = {
  photo: true,
  audio: true,
  video: true,
  document: true,
}

let courant: ReglagesTelechargement = lire()
const auditeurs = new Set<() => void>()

function lire(): ReglagesTelechargement {
  try {
    const brut = localStorage.getItem(CLE)
    if (!brut) return DEFAUTS
    const lu = JSON.parse(brut) as Partial<Record<FamilleMedia, unknown>>
    // Famille absente ou illisible : son défaut. Une famille ajoutée plus tard
    // ne doit pas s'éteindre chez ceux qui ont déjà réglé les autres.
    const r = { ...DEFAUTS }
    for (const f of FAMILLES_MEDIA) if (typeof lu[f] === "boolean") r[f] = lu[f] as boolean
    return r
  } catch {
    return DEFAUTS
  }
}

export function reglagesTelechargement(): ReglagesTelechargement {
  return courant
}

export function changerTelechargement(famille: FamilleMedia, actif: boolean): void {
  if (courant[famille] === actif) return
  courant = { ...courant, [famille]: actif }
  try {
    localStorage.setItem(CLE, JSON.stringify(courant))
  } catch {
    /* le réglage vaut au moins pour cette visite */
  }
  auditeurs.forEach((f) => f())
}

/** S'abonner aux changements ; rend la fonction de désabonnement. */
export function surChangementTelechargement(f: () => void): () => void {
  auditeurs.add(f)
  return () => {
    auditeurs.delete(f)
  }
}

// Un autre onglet a changé le réglage : celui-ci le suit sans rechargement.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== CLE) return
    courant = lire()
    auditeurs.forEach((f) => f())
  })
}

/**
 * La famille d'un média, d'après son type MIME et, à défaut, le type du
 * message. `null` : rien à retenir (texte, fiche de contact, position…).
 */
export function familleDuMedia(mime?: string | null, typeMessage?: string): FamilleMedia | null {
  const m = (mime ?? "").toLowerCase()
  if (m.startsWith("image/")) return "photo"
  if (m.startsWith("video/")) return "video"
  if (m.startsWith("audio/")) return "audio"
  if (typeMessage === "image") return "photo"
  if (typeMessage === "video") return "video"
  if (typeMessage === "audio") return "audio"
  if (typeMessage === "file" || m) return "document"
  return null
}
