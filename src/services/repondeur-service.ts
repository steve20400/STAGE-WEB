import { apiRequest } from "../lib/api-client"
import { uploadMedia } from "./media-service"

/**
 * LE RÉPONDEUR — message d'accueil, et dépôt d'une messagerie vocale.
 *
 * 🔴 LE RÉPONDEUR EST JOUÉ PAR LE CLIENT DE L'APPELANT. Les appels sont en
 * pair-à-pair : quand personne ne décroche, il n'existe AUCUN pair pour jouer
 * l'accueil et enregistrer. À l'expiration de la sonnerie, c'est donc
 * l'application de l'appelant qui télécharge l'accueil du destinataire, le joue,
 * et propose d'enregistrer.
 *
 * L'alternative — un serveur média qui répondrait à la place du destinataire —
 * donnerait la même expérience pour le prix d'une infrastructure entière.
 *
 * ⚠️ LIMITE INHÉRENTE À CE CHOIX : si l'appelant ferme son onglet à l'instant où
 * la sonnerie expire, il n'y a pas de message. Rien ne peut l'éviter sans le
 * serveur média qu'on a justement écarté.
 */

/** Le média d'un message d'accueil, tel que le serveur le décrit. */
export interface AccueilRepondeur {
  id: string
  url: string
  mimeType: string
  durationMs: number | null
  filename: string
}

/** Un message d'accueil enregistre sur le compte. */
export interface Accueil {
  id: string
  libelle: string | null
  actif: number
  createdAt: string
  media: AccueilRepondeur
}

export interface EtatRepondeur {
  actif: boolean
  /**
   * Fin du mode absence, ou `null`.
   *
   * ⚠️ LE SERVEUR NE LA REND QUE SI ELLE EST ENCORE DEVANT NOUS : une date
   * passée n'est pas une absence, et l'écran afficherait « actif jusqu'à 9 h »
   * à midi. Le client n'a donc aucune comparaison à refaire.
   */
  jusquA: string | null
  accueils: Accueil[]
}

/**
 * Durée maximale d'une absence, en minutes — la même que celle du serveur.
 *
 * ⚠️ SI TU LA CHANGES ICI, CHANGE-LA LÀ-BAS (`ABSENCE_MAX_MINUTES`). Deux bornes
 * inégales font mentir l'une des deux : l'écran accepterait ce que la route
 * refuse, et le refus arriverait après coup sans rien expliquer.
 */
export const ABSENCE_MAX_MINUTES = 24 * 60

/**
 * Met la réponse du serveur à la forme attendue, quelle que soit sa version.
 *
 * 🔴 LE SERVEUR A CHANGÉ DE FORME EN COURS DE ROUTE : il rendait un accueil
 * unique (`accueil`), il rend maintenant une liste (`accueils`). Or le web et le
 * backend ne se déploient pas à la même minute — et pendant l'écart, un client
 * neuf face à un serveur ancien recevait une liste VIDE. L'écran annonçait alors
 * « aucun message d'accueil » à quelqu'un qui venait d'en enregistrer un, et
 * aucune réécoute n'était possible.
 *
 * ⚠️ CETTE TOLÉRANCE EST TEMPORAIRE ET DOIT LE RESTER. Elle se retire quand le
 * backend est déployé partout ; la garder indéfiniment reviendrait à entretenir
 * deux contrats pour toujours.
 */
function normaliser(brut: unknown): EtatRepondeur {
  const r = (brut ?? {}) as {
    actif?: unknown
    jusquA?: unknown
    accueils?: Accueil[]
    accueil?: AccueilRepondeur | null
  }
  if (Array.isArray(r.accueils)) {
    return {
      actif: r.actif === true,
      jusquA: typeof r.jusquA === "string" ? r.jusquA : null,
      accueils: r.accueils,
    }
  }
  // Forme ancienne : un seul accueil, qui était forcément l'actif.
  if (r.accueil) {
    return {
      actif: r.actif === true,
      jusquA: null,
      accueils: [
        {
          id: r.accueil.id,
          libelle: null,
          actif: 1,
          createdAt: new Date().toISOString(),
          media: r.accueil,
        },
      ],
    }
  }
  return { actif: r.actif === true, jusquA: null, accueils: [] }
}

/**
 * Mon répondeur : l'interrupteur, l'absence en cours, et tous mes accueils.
 *
 * ⚠️ `no-store` N'EST PAS UNE PRÉCAUTION DE PRINCIPE. Cette lecture porte une
 * absence qui se pose, se lève et se périme à la minute ; une réponse servie
 * depuis le cache du navigateur afficherait « aucune absence » à quelqu'un qui
 * vient d'en poser une — et rien à l'écran ne permettrait de s'en douter.
 */
export async function lireMonRepondeur(): Promise<EtatRepondeur> {
  return normaliser(await apiRequest<unknown>("/api/repondeur", { cache: "no-store" }))
}

/**
 * L'accueil de la personne qu'on vient d'appeler sans réponse.
 *
 * ⚠️ REND `null` PLUTÔT QUE DE LEVER quand il n'y en a pas — et c'est le cas le
 * plus fréquent, la plupart des comptes n'ayant pas de répondeur. Le serveur
 * répond alors 404, ce qui n'est pas une panne : c'est la réponse.
 */
export async function accueilDeLAppel(callId: string): Promise<AccueilRepondeur | null> {
  try {
    const reponse = await apiRequest<{ accueil?: AccueilRepondeur }>(
      `/api/repondeur?appel=${encodeURIComponent(callId)}`,
    )
    return reponse.accueil ?? null
  } catch {
    return null
  }
}

/**
 * Téléverse un fichier audio et l'ajoute à la bibliothèque d'accueils.
 *
 * ⚠️ LE NOUVEL ACCUEIL DEVIENT L'ACTIF, côté serveur, et allume le répondeur.
 * Enregistrer, puis désigner, puis chercher un interrupteur fait trois étapes
 * dont deux s'oublient — et le répondeur resterait muet sans que rien ne dise
 * pourquoi. Garder l'ancien actif reste possible : il suffit de le redésigner.
 */
export async function ajouterAccueil(
  fichier: File | Blob,
  nomFichier: string,
  libelle: string | null,
  dureeMs?: number,
): Promise<EtatRepondeur> {
  const media = await uploadMedia(fichier, nomFichier, dureeMs)
  return normaliser(
    await apiRequest<unknown>("/api/repondeur", {
      method: "POST",
      body: { mediaId: media.id, libelle },
    }),
  )
}

/** Désigne l'accueil que les appelants entendront. */
export async function choisirAccueil(id: string): Promise<EtatRepondeur> {
  return normaliser(
    await apiRequest<unknown>(`/api/repondeur?actif=${encodeURIComponent(id)}`, {
      method: "POST",
    }),
  )
}

/**
 * Pose une absence de `minutes`, ou la lève avec `0`.
 *
 * ⚠️ ON ENVOIE UNE DURÉE, LE SERVEUR RANGE UNE DATE. C'est lui qui doit fixer
 * l'instant de fin : l'horloge d'un navigateur peut avoir des minutes d'écart,
 * et une absence posée « jusqu'à 15 h 00 » selon un poste mal réglé s'arrêterait
 * au mauvais moment pour tous ceux qui appellent.
 */
export async function poserAbsence(minutes: number): Promise<EtatRepondeur> {
  return normaliser(
    await apiRequest<unknown>("/api/repondeur", {
      method: "POST",
      body: { absenceMinutes: Math.round(minutes) },
    }),
  )
}

/** Allume ou éteint le répondeur, sans toucher à l'accueil enregistré. */
export async function activerRepondeur(actif: boolean): Promise<EtatRepondeur> {
  return normaliser(
    await apiRequest<unknown>("/api/repondeur", { method: "POST", body: { actif } }),
  )
}

/**
 * Retire UN accueil.
 *
 * ⚠️ RETIRER L'ACTIF ÉTEINT LE RÉPONDEUR, côté serveur. Le laisser allumé sans
 * accueil promettrait aux appelants un message que personne n'a enregistré.
 */
export async function retirerAccueil(id: string): Promise<EtatRepondeur> {
  return normaliser(
    await apiRequest<unknown>(`/api/repondeur?accueil=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  )
}

/**
 * Dépose la messagerie vocale laissée après un appel sans réponse.
 *
 * ⚠️ LE SERVEUR VÉRIFIE TOUT : que l'appel existe, qu'on l'a initié, qu'il n'a
 * pas été décroché, qu'il est récent, qu'il n'a pas déjà sa messagerie, et que
 * le destinataire a bien un répondeur. Ces contrôles ne sont pas doublés ici —
 * les redoubler donnerait deux vérités, et celle du client ne protège personne.
 */
export async function deposerMessagerie(
  callId: string,
  enregistrement: Blob,
  dureeMs: number,
  /**
   * Vidéo plutôt que voix.
   *
   * ⚠️ NE SERT QU'AU NOM. Le conteneur est WebM dans les deux cas — c'est ce
   * que produit `MediaRecorder` — et c'est le type MIME du blob, transporté par
   * l'envoi, qui dit au serveur s'il range un son ou une image. Le nom, lui,
   * est ce qu'un humain lira dans un export ou un téléchargement : autant qu'il
   * dise de quoi il s'agit.
   */
  video = false,
): Promise<void> {
  const nom = `repondeur-${video ? "video-" : ""}${Date.now()}.webm`
  const media = await uploadMedia(enregistrement, nom, dureeMs)
  await apiRequest(`/api/calls/${encodeURIComponent(callId)}/voicemail`, {
    method: "POST",
    body: { mediaId: media.id },
  })
}

/**
 * Taille maximale d'un message d'accueil importé.
 *
 * ⚠️ CONTRÔLÉE AVANT LE TÉLÉVERSEMENT, pas après : un fichier de cent mégaoctets
 * partirait sinon en entier pour se faire refuser à l'arrivée — la donnée est
 * payée, sur mobile comme ailleurs.
 */
export const ACCUEIL_MAX_OCTETS = 5 * 1024 * 1024

/**
 * Durée maximale d'un message d'accueil.
 *
 * Trente secondes : au-delà, l'appelant raccroche avant le bip. Ce n'est pas une
 * limite technique mais une limite d'usage, et c'est pour cela qu'elle est
 * généreuse plutôt que serrée.
 */
export const ACCUEIL_MAX_MS = 30_000

/** Le fichier peut-il servir d'accueil ? Rend la raison du refus, ou `null`. */
export function refusAccueil(fichier: File): "format" | "taille" | null {
  if (!fichier.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|aac|webm|opus)$/i.test(fichier.name)) {
    return "format"
  }
  if (fichier.size > ACCUEIL_MAX_OCTETS) return "taille"
  return null
}


/* ══════════════════ LES PLAGES PROGRAMMÉES ══════════════════ */

/**
 * Une plage : un jour, une heure de début, une heure de fin.
 *
 * ⚠️ LES HEURES SONT DES MINUTES DEPUIS MINUIT, et non « 10:00 ». Une chaîne
 * se compare par ordre alphabétique — « 9:30 » y passe APRÈS « 10:00 » — et
 * deux formats finissent toujours par cohabiter. Un entier se compare comme un
 * entier.
 */
export interface PlageRepondeur {
  id: string
  /** 0 = dimanche … 6 = samedi, la convention de `Date.getDay()`. */
  jour: number
  debutMin: number
  finMin: number
  fuseau: string
  accueilId: string | null
  createdAt: string
  /** Fin de validité — deux semaines après la pose. */
  expireLe: string
}

/** Une plage a-t-elle cessé de s'appliquer ? */
export function plageExpiree(plage: PlageRepondeur): boolean {
  return new Date(plage.expireLe).getTime() <= Date.now()
}

export async function listerPlages(): Promise<PlageRepondeur[]> {
  const r = await apiRequest<{ plages?: PlageRepondeur[] }>("/api/repondeur/plages", {
    cache: "no-store",
  })
  return r.plages ?? []
}

/**
 * Pose une ou plusieurs plages d'un coup.
 *
 * ⚠️ LE FUSEAU PART D'ICI, et c'est le seul endroit qui le connaisse : le
 * serveur ne peut que deviner le sien, qui n'est presque jamais celui de
 * l'utilisateur. Un NOM de zone, jamais un décalage — un décalage figerait
 * l'heure d'été du jour où la plage a été posée.
 */
export async function ajouterPlages(
  plages: Array<{ jour: number; debutMin: number; finMin: number; accueilId?: string | null }>,
): Promise<PlageRepondeur[]> {
  const fuseau = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  const r = await apiRequest<{ plages?: PlageRepondeur[] }>("/api/repondeur/plages", {
    method: "POST",
    body: { plages: plages.map((p) => ({ ...p, fuseau })) },
  })
  return r.plages ?? []
}

export async function retirerPlage(id: string): Promise<PlageRepondeur[]> {
  const r = await apiRequest<{ plages?: PlageRepondeur[] }>(
    `/api/repondeur/plages?id=${encodeURIComponent(id)}`,
    { method: "DELETE" },
  )
  return r.plages ?? []
}
