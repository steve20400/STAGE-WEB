import { uploadMedia } from "./media-service"
import { deposerEnregistrementAppel } from "./calls-service"

/**
 * Enregistre une conversation d'agent, sur autorisation du serveur, cote WEB.
 *
 * 🔴 **MIROIR DU MOBILE** (`EnregistreurAppel` Flutter), MÊME CONTRAT SERVEUR :
 * deux pistes separees (voix de l'agent = micro local, voix du client = flux
 * distant), televersees telles quelles, le serveur les mixe. Ici pas de
 * `MediaCodec` : le navigateur enregistre chaque piste avec `MediaRecorder`
 * (webm/opus), que ffmpeg lit sans probleme cote serveur — il autodetecte le
 * format, quel que soit le nom du fichier.
 *
 * ⚠️ **DEUX PISTES, ATTACHÉES À DEUX MOMENTS.** La piste locale existe des le
 * decrochage ; la DISTANTE n'arrive qu'apres la negociation WebRTC (`ontrack`).
 * D'ou [attacherVoixDistante], appele quand le flux distant apparait.
 *
 * ⚠️ **AUCUNE ANNONCE AU CORRESPONDANT** — decision explicite du user
 * (20/08/2026). Rien n'est joue ni affiche de son cote.
 *
 * ⚠️ **DURABILITÉ.** Le depot est retente en memoire (l'onglet reste vivant
 * pendant et apres l'appel), et `cleEnvoi` le rend idempotent. On ne replique
 * PAS la file persistante du mobile (IndexedDB) : un navigateur ne tue pas un
 * onglet en plein appel comme Android tue un processus — la fenetre de risque
 * (onglet ferme pendant les quelques secondes d'upload) ne le justifie pas.
 */

/** Une piste en cours d'enregistrement : un `MediaRecorder` et ses morceaux. */
class EnregistreurPiste {
  private readonly rec: MediaRecorder
  private readonly morceaux: Blob[] = []
  private readonly type: string

  constructor(piste: MediaStreamTrack) {
    this.type = choisirTypeMime()
    this.rec = new MediaRecorder(
      new MediaStream([piste]),
      this.type ? { mimeType: this.type } : undefined
    )
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.morceaux.push(e.data)
    }
    // Timeslice : le contenu est vide sur le disque du navigateur jusqu'a un
    // `dataavailable`. Un decoupage regulier garantit qu'un arret brutal laisse
    // quand meme la quasi-totalite de l'audio deja capture.
    this.rec.start(1000)
  }

  /** Arrete et rend le blob complet, ou `null` si rien n'a ete capture. */
  async arreter(): Promise<Blob | null> {
    if (this.rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        this.rec.onstop = () => resolve()
        // ⚠️ Appele SYNCHRONEMENT ici : l'appelant declenche l'arret AVANT que
        // le mesh ne coupe les pistes, pour que le dernier morceau soit vide
        // pendant que la piste est encore vivante.
        this.rec.stop()
      })
    }
    if (this.morceaux.length === 0) return null
    // 🔴 TYPE SANS PARAMÈTRE. Le navigateur produit « audio/webm;codecs=opus »,
    // mais la liste blanche du serveur (`isAllowedMime`) fait un match EXACT et
    // rejette le « ;codecs=… » par un 415 (constaté le 20/08/2026 : Firefox, 4
    // essais tous en 415). On ne garde que le conteneur — accepté tel quel — et
    // ffmpeg autodétecte le codec au mélange, l'extension et les paramètres ne
    // comptent pas pour lui.
    const type = (this.rec.mimeType || this.type || "audio/webm").split(";")[0].trim()
    return new Blob(this.morceaux, { type })
  }
}

/** Le premier type accepte par ce navigateur, ou "" pour laisser le defaut. */
function choisirTypeMime(): string {
  const candidats = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
  if (typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function") {
    for (const c of candidats) {
      if (MediaRecorder.isTypeSupported(c)) return c
    }
  }
  return ""
}

// --- État singleton : un enregistrement appartient à un APPEL. ---
let callId: string | null = null
let companyId: number | null = null
let debut = 0
let recAgent: EnregistreurPiste | null = null
let recClient: EnregistreurPiste | null = null
let distantAttache = false

export function enregistrementEnCours(): boolean {
  return callId !== null
}

/**
 * Demarre l'enregistrement de la voix de l'agent (piste audio locale). Rend faux
 * si rien n'est enregistrable — l'appel se poursuit alors sans trace. Ne lance
 * jamais : un enregistrement rate ne doit pas gener un appel.
 */
export function demarrerEnregistrement(
  id: string,
  company: number,
  local: MediaStream
): boolean {
  if (callId === id) return true
  if (callId !== null) annuler()
  const piste = local.getAudioTracks()[0]
  if (!piste) return false
  try {
    recAgent = new EnregistreurPiste(piste)
  } catch (e) {
    console.error("[enregistrement-appel] demarrage impossible :", e)
    return false
  }
  callId = id
  companyId = company
  debut = Date.now()
  distantAttache = false
  return true
}

/**
 * Branche la voix du correspondant des que sa piste distante est la. Idempotent :
 * ne rebranche pas si c'est deja fait.
 */
export function attacherVoixDistante(remote: MediaStream): void {
  if (callId === null || distantAttache) return
  const piste = remote.getAudioTracks()[0]
  if (!piste) return
  try {
    recClient = new EnregistreurPiste(piste)
    distantAttache = true
  } catch (e) {
    console.error("[enregistrement-appel] voix distante :", e)
  }
}

/**
 * Arrete l'enregistrement et depose les deux pistes. À appeler AVANT de couper
 * le mesh (voir `EnregistreurPiste.arreter`). Ne lance jamais.
 *
 * ⚠️ **LES DEUX PISTES SONT EXIGÉES** : une seule ne prouve rien. Si l'une
 * manque, on ne depose pas.
 */
export async function arreterEtDeposer(): Promise<void> {
  if (callId === null) return
  const id = callId
  const company = companyId
  const t0 = debut
  const ra = recAgent
  const rc = recClient
  callId = null
  companyId = null
  recAgent = null
  recClient = null
  distantAttache = false

  try {
    const [blobAgent, blobClient] = await Promise.all([
      ra ? ra.arreter() : Promise.resolve(null),
      rc ? rc.arreter() : Promise.resolve(null),
    ])
    if (!blobAgent || !blobClient || company === null) return
    await deposerAvecReprises({
      callId: id,
      company,
      blobAgent,
      blobClient,
      dureeMs: Date.now() - t0,
      cleEnvoi: fabriquerCle(),
    })
  } catch (e) {
    console.error("[enregistrement-appel] arret/depot :", e)
  }
}

/** Referme sans deposer : changement d'appel, ou nouvel enregistrement. */
function annuler(): void {
  const ra = recAgent
  const rc = recClient
  callId = null
  companyId = null
  recAgent = null
  recClient = null
  distantAttache = false
  // Arret sans exploitation des blobs : on ne veut rien de cet enregistrement-la.
  void ra?.arreter()
  void rc?.arreter()
}

/**
 * Depose les deux pistes puis les rattache a un enregistrement, avec quelques
 * reprises. `cleEnvoi` est posee UNE fois : les ids media deja obtenus sont
 * conserves d'un essai a l'autre, et le serveur, idempotent sur la cle, rend 200
 * si l'enregistrement est deja passe.
 */
async function deposerAvecReprises(p: {
  callId: string
  company: number
  blobAgent: Blob
  blobClient: Blob
  dureeMs: number
  cleEnvoi: string
}): Promise<void> {
  let mediaAgentId: string | null = null
  let mediaClientId: string | null = null
  for (let essai = 0; essai < 4; essai++) {
    try {
      if (!mediaAgentId) {
        const m = await uploadMedia(p.blobAgent, `appel-${p.cleEnvoi}-agent.webm`, p.dureeMs)
        mediaAgentId = m.id
      }
      if (!mediaClientId) {
        const m = await uploadMedia(p.blobClient, `appel-${p.cleEnvoi}-client.webm`, p.dureeMs)
        mediaClientId = m.id
      }
      await deposerEnregistrementAppel({
        callId: p.callId,
        companyId: p.company,
        mediaAgentId,
        mediaClientId,
        dureeMs: p.dureeMs,
        cleEnvoi: p.cleEnvoi,
      })
      return
    } catch (e) {
      console.error(`[enregistrement-appel] depot essai ${essai + 1} :`, e)
      await new Promise((r) => setTimeout(r, 1000 * (essai + 1)))
    }
  }
  console.error("[enregistrement-appel] depot abandonne apres reprises")
}

function fabriquerCle(): string {
  const alea = Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36)).join("")
  return `ap-${Date.now()}-${alea}`
}
