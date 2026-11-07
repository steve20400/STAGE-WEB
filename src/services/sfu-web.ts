import { apiRequest } from "../lib/api-client"

/**
 * LE SFU DE CLOUDFLARE, COTE WEB (07/11/2026) — pour les appels de groupe et
 * les reunions que le serveur a places en SFU (reglage de la console).
 *
 * En mesh, chaque participant ouvre une connexion vers chacun des autres. Ici,
 * UNE seule connexion, vers Cloudflare :
 *  1. on y PUBLIE ses pistes (micro, camera) : notre offre, sa reponse ;
 *  2. le serveur previent les autres (trame `sfu_pistes`), qui viennent les
 *     chercher ; on fait de meme pour les leurs (et, en arrivant, pour ceux
 *     qui publient deja) : Cloudflare rend alors SON offre, a laquelle on
 *     repond.
 *
 * Chaque piste recue arrive sous un `mid` que le serveur nous a donne avec le
 * nom de son auteur : c'est ce qui rattache chaque voix et chaque image a un
 * participant.
 *
 * ⚠️ LE JETON DE L'APPLICATION SFU NE QUITTE JAMAIS LE SERVEUR : tout passe par
 * nos routes `/api/sfu/...`.
 *
 * ⚠️ LES NEGOCIATIONS PASSENT UNE PAR UNE (`enFile`). Une connexion WebRTC ne
 * supporte qu'une negociation a la fois.
 *
 * `call-manager.ts` garde sa table de pairs : en SFU, elle se remplit de
 * `PairSfu`, des pairs VIRTUELS qui offrent la meme surface qu'une
 * `PeerSession` et s'adossent tous au meme `MoteurSfuWeb`. Le reste du
 * gestionnaire d'appel ne voit pas la difference.
 */

type Description = { type: "offer" | "answer"; sdp: string }
type PisteRecue = { mid: string; userId: string; nom: string }
type PisteDemandee = { userId: string; nom: string }

const sfuApi = {
  async creerSession(salle: string): Promise<string> {
    const r = await apiRequest<{ sessionId: string }>("/api/sfu/sessions", { method: "POST", body: { salle } })
    return r.sessionId
  },
  async publier(
    sessionId: string,
    offre: string,
    pistes: Array<{ mid: string; nom: string; genre: string }>
  ): Promise<string> {
    const r = await apiRequest<{ reponse: Description }>(`/api/sfu/sessions/${sessionId}/publier`, {
      method: "POST",
      body: { offre: { type: "offer", sdp: offre }, pistes },
    })
    return r.reponse.sdp
  },
  async recevoir(
    sessionId: string,
    pistes: PisteDemandee[]
  ): Promise<{ offre: string | null; pistes: PisteRecue[] }> {
    const r = await apiRequest<{ offre: Description | null; pistes: PisteRecue[] }>(
      `/api/sfu/sessions/${sessionId}/recevoir`,
      { method: "POST", body: { pistes } }
    )
    return { offre: r.offre?.sdp ?? null, pistes: r.pistes ?? [] }
  },
  async renegocier(sessionId: string, reponse: string): Promise<void> {
    await apiRequest(`/api/sfu/sessions/${sessionId}/renegocier`, {
      method: "PUT",
      body: { reponse: { type: "answer", sdp: reponse } },
    })
  },
  async fermer(sessionId: string, mids: string[]): Promise<string | null> {
    const r = await apiRequest<{ offre: Description | null }>(`/api/sfu/sessions/${sessionId}/fermer`, {
      method: "POST",
      body: { mids },
    })
    return r.offre?.sdp ?? null
  },
  async raccrocher(sessionId: string): Promise<void> {
    await apiRequest(`/api/sfu/sessions/${sessionId}/fermer`, { method: "POST", body: { tout: true } })
  },
  async pistesDeLaSalle(salle: string): Promise<Array<{ userId: string; nom: string; genre: string }>> {
    const r = await apiRequest<{ pistes: Array<{ userId: string; nom: string; genre: string }> }>(
      `/api/sfu/salles/${encodeURIComponent(salle)}/pistes`
    )
    return r.pistes ?? []
  },
}

/** Le moteur d'une reunion : demande au serveur AVANT d'entrer. Serveur anterieur → mesh. */
export async function moteurDeLaReunion(meetingId: number): Promise<"mesh" | "sfu"> {
  try {
    const r = await apiRequest<{ moteur?: string }>(`/api/meetings/${meetingId}/moteur`, {
      method: "POST",
      body: {},
    })
    return r.moteur === "sfu" ? "sfu" : "mesh"
  } catch (e) {
    const statut = (e as { status?: number } | null)?.status
    if (statut === 404) return "mesh"
    throw e
  }
}

export class MoteurSfuWeb {
  private pc: RTCPeerConnection | null = null
  private sessionId: string | null = null
  private local: MediaStream | null = null
  private ferme = false
  private demarrage: Promise<void> | null = null
  private file: Promise<void> = Promise.resolve()

  private readonly pairs = new Set<string>()
  private readonly partis = new Set<string>()
  /** Ce que chacun publie : nom de piste → genre. */
  private readonly publiees = new Map<string, Map<string, string>>()
  private readonly auteurDuMid = new Map<string, string>()
  private readonly midsDe = new Map<string, Map<string, string>>()
  private readonly flux = new Map<string, MediaStream>()

  /** Nos pistes publiees : identifiant de piste → nom. */
  private readonly nosPistes = new Map<string, string>()
  private numeroPiste = 0
  private reprises = 0

  connexionFaible = false

  constructor(
    /** `call:<id>` ou `meeting:<id>`. */
    readonly salle: string,
    private readonly moi: string,
    private readonly iceServers: RTCIceServer[],
    /** Un flux distant est apparu, a change ou a disparu. */
    private readonly surMaj: () => void,
    /** La connexion vacille (vrai) ou revient (faux), pour tous les pairs. */
    private readonly surReconnexion: (actif: boolean) => void,
    /** Debit video maximal de nos emissions, en bit/s. */
    private readonly debitVideoMax: number
  ) {}

  private enFile<T>(operation: () => Promise<T>): Promise<T> {
    const suite = this.file.then(operation)
    this.file = suite.then(
      () => undefined,
      () => undefined
    )
    return suite
  }

  /** Ouvre la connexion et publie [local] (nul : ecoute seule). Une fois. */
  demarrer(local: MediaStream | null): Promise<void> {
    if (!this.demarrage) {
      this.local = local
      this.demarrage = this.enFile(() => this.connecter()).catch((e) => {
        this.demarrage = null
        throw e
      })
    }
    return this.demarrage
  }

  private async connecter(): Promise<void> {
    if (this.ferme || this.pc) return
    const sessionId = await sfuApi.creerSession(this.salle)
    const pc = new RTCPeerConnection({
      // Le STUN de Cloudflare d'abord : c'est vers son reseau que l'on va.
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, ...this.iceServers],
      bundlePolicy: "max-bundle",
    })
    pc.addEventListener("track", (e) => this.surPiste(e))
    pc.addEventListener("connectionstatechange", () => this.surEtat(pc))
    this.pc = pc
    this.sessionId = sessionId

    const local = this.local
    if (local) await this.publierLocal(local.getTracks())

    // Ceux qui publient deja : personne ne nous les annoncera.
    try {
      const deja = await sfuApi.pistesDeLaSalle(this.salle)
      for (const p of deja) this.noterPubliee(p.userId, p.nom, p.genre)
      const aRecevoir = deja.filter((p) => !this.partis.has(p.userId)).map(({ userId, nom }) => ({ userId, nom }))
      if (aRecevoir.length > 0) await this.recevoir(aRecevoir)
    } catch (e) {
      console.warn("[sfu] pistes de la salle illisibles", e)
    }
  }

  private noterPubliee(userId: string, nom: string, genre: string) {
    let m = this.publiees.get(userId)
    if (!m) {
      m = new Map()
      this.publiees.set(userId, m)
    }
    m.set(nom, genre)
  }

  private async publierLocal(pistes: MediaStreamTrack[]): Promise<void> {
    const pc = this.pc
    const sessionId = this.sessionId
    if (!pc || !sessionId || pistes.length === 0) return
    const flux = this.local ?? new MediaStream(pistes)

    const nouvelles: Array<{ piste: MediaStreamTrack; transceiver: RTCRtpTransceiver; nom: string }> = []
    for (const piste of pistes) {
      if (this.nosPistes.has(piste.id)) continue
      const transceiver = pc.addTransceiver(piste, { direction: "sendonly", streams: [flux] })
      let nom: string = piste.kind
      while ([...this.nosPistes.values()].includes(nom)) nom = `${piste.kind}${++this.numeroPiste}`
      this.nosPistes.set(piste.id, nom)
      nouvelles.push({ piste, transceiver, nom })
    }
    if (nouvelles.length === 0) return

    const offre = await pc.createOffer()
    await pc.setLocalDescription(offre)
    const declarees = nouvelles
      .filter((n) => n.transceiver.mid)
      .map((n) => ({ mid: n.transceiver.mid as string, nom: n.nom, genre: n.piste.kind }))
    const reponse = await sfuApi.publier(sessionId, pc.localDescription?.sdp ?? offre.sdp ?? "", declarees)
    await pc.setRemoteDescription({ type: "answer", sdp: reponse })
    await this.reglerEmission(nouvelles.map((n) => n.transceiver.sender))
  }

  /** Son prioritaire, video plafonnee a la qualite de l'appel — comme le mesh. */
  private async reglerEmission(emetteurs: RTCRtpSender[]) {
    for (const emetteur of emetteurs) {
      const nature = emetteur.track?.kind
      if (!nature) continue
      try {
        const p = emetteur.getParameters()
        if (!p.encodings || p.encodings.length === 0) p.encodings = [{}]
        for (const e of p.encodings) {
          if (nature === "audio") {
            e.priority = "high"
            e.networkPriority = "high"
          } else {
            e.maxBitrate = this.debitVideoMax
            e.priority = "low"
            e.networkPriority = "low"
          }
        }
        await emetteur.setParameters(p)
      } catch {
        // Un navigateur qui refuse un reglage garde son comportement par defaut.
      }
    }
  }

  /** Les `mid` sont notes AVANT d'appliquer l'offre : les pistes arrivent pendant. */
  private async recevoir(pistes: PisteDemandee[]): Promise<void> {
    const pc = this.pc
    const sessionId = this.sessionId
    if (!pc || !sessionId || pistes.length === 0) return
    const r = await sfuApi.recevoir(sessionId, pistes)
    for (const p of r.pistes) {
      this.auteurDuMid.set(p.mid, p.userId)
      let m = this.midsDe.get(p.userId)
      if (!m) {
        m = new Map()
        this.midsDe.set(p.userId, m)
      }
      m.set(p.nom, p.mid)
    }
    if (!r.offre) return
    await pc.setRemoteDescription({ type: "offer", sdp: r.offre })
    const reponse = await pc.createAnswer()
    await pc.setLocalDescription(reponse)
    await sfuApi.renegocier(sessionId, pc.localDescription?.sdp ?? reponse.sdp ?? "")
  }

  private surPiste(e: RTCTrackEvent) {
    const mid = e.transceiver?.mid
    const auteur = mid ? this.auteurDuMid.get(mid) : undefined
    if (!auteur) {
      console.warn(`[sfu] piste recue sans auteur connu (mid=${mid})`)
      return
    }
    // Un flux par participant, voix et image reunies : comme une PeerSession.
    let cible = this.flux.get(auteur)
    if (!cible) {
      cible = new MediaStream()
      this.flux.set(auteur, cible)
    }
    for (const ancienne of cible.getTracks()) {
      if (ancienne.kind === e.track.kind && ancienne.id !== e.track.id) cible.removeTrack(ancienne)
    }
    if (!cible.getTracks().some((t) => t.id === e.track.id)) cible.addTrack(e.track)
    // Une nouvelle instance : React voit le changement de flux.
    this.flux.set(auteur, new MediaStream(cible.getTracks()))
    this.surMaj()
  }

  private surEtat(pc: RTCPeerConnection) {
    if (pc !== this.pc) return
    if (pc.connectionState === "connected") {
      this.reprises = 0
      if (this.connexionFaible) {
        this.connexionFaible = false
        this.surReconnexion(false)
        this.surMaj()
      }
    } else if (pc.connectionState === "disconnected") {
      this.connexionFaible = true
      this.surReconnexion(true)
      this.surMaj()
    } else if (pc.connectionState === "failed") {
      void this.reprendre()
    }
  }

  /** Connexion perdue : nouvelle session, republication, nouvelles receptions. */
  private async reprendre(): Promise<void> {
    if (this.ferme || this.reprises >= 3) return
    this.reprises += 1
    this.connexionFaible = true
    this.surReconnexion(true)
    this.surMaj()
    await this.enFile(async () => {
      const ancienne = this.pc
      const ancienneSession = this.sessionId
      this.pc = null
      this.sessionId = null
      this.auteurDuMid.clear()
      this.midsDe.clear()
      this.nosPistes.clear()
      ancienne?.close()
      if (ancienneSession) void sfuApi.raccrocher(ancienneSession).catch(() => undefined)
      try {
        await this.connecter()
      } catch (e) {
        console.warn(`[sfu] reprise ${this.reprises} impossible`, e)
      }
    })
  }

  relancer() {
    if (this.pc?.connectionState === "connected") return
    void this.reprendre()
  }

  /** [userId] est dans l'appel. Revenu apres un depart : on rechercher ses pistes. */
  async ajouterPair(userId: string): Promise<void> {
    if (userId === this.moi) return
    this.pairs.add(userId)
    const revenu = this.partis.delete(userId)
    const connues = this.publiees.get(userId)
    if (revenu && connues && connues.size > 0) {
      await this.enFile(() => this.recevoir([...connues.keys()].map((nom) => ({ userId, nom }))))
    }
  }

  async retirerPair(userId: string): Promise<void> {
    this.pairs.delete(userId)
    this.partis.add(userId)
    this.flux.delete(userId)
    const mids = [...(this.midsDe.get(userId)?.values() ?? [])]
    this.midsDe.delete(userId)
    for (const m of mids) this.auteurDuMid.delete(m)
    this.surMaj()
    if (mids.length > 0) await this.enFile(() => this.fermerMids(mids))
  }

  /**
   * Trame `sfu_pistes`. Une nouvelle annonce remplace la precedente (l'auteur
   * a pu se reconnecter avec une nouvelle session) : les anciennes receptions
   * sont fermees d'abord.
   */
  async surPistes(trame: Record<string, unknown>): Promise<void> {
    if (this.ferme || trame.salle !== this.salle) return
    const auteur = String(trame.userId ?? "")
    if (!auteur || auteur === this.moi) return
    const pistes: PisteDemandee[] = []
    for (const p of (trame.pistes as Array<{ nom?: unknown; genre?: unknown }> | undefined) ?? []) {
      const nom = String(p.nom ?? "")
      if (!nom) continue
      this.noterPubliee(auteur, nom, String(p.genre ?? "audio"))
      pistes.push({ userId: auteur, nom })
    }
    if (pistes.length === 0 || this.partis.has(auteur) || !this.pc) return
    await this.enFile(async () => {
      const anciens: string[] = []
      for (const p of pistes) {
        const mid = this.midsDe.get(auteur)?.get(p.nom)
        if (mid) {
          this.midsDe.get(auteur)?.delete(p.nom)
          this.auteurDuMid.delete(mid)
          anciens.push(mid)
        }
      }
      if (anciens.length > 0) await this.fermerMids(anciens)
      await this.recevoir(pistes)
    })
  }

  private async fermerMids(mids: string[]): Promise<void> {
    const pc = this.pc
    const sessionId = this.sessionId
    if (!pc || !sessionId || mids.length === 0) return
    try {
      const offre = await sfuApi.fermer(sessionId, mids)
      if (offre) {
        await pc.setRemoteDescription({ type: "offer", sdp: offre })
        const reponse = await pc.createAnswer()
        await pc.setLocalDescription(reponse)
        await sfuApi.renegocier(sessionId, pc.localDescription?.sdp ?? reponse.sdp ?? "")
      }
    } catch (e) {
      console.warn("[sfu] fermeture de pistes impossible", e)
    }
  }

  fluxDe(userId: string): MediaStream | null {
    return this.flux.get(userId) ?? null
  }

  /**
   * Une piste locale a emettre (micro accorde en cours de reunion, passage en
   * video). Idempotent : appele une fois PAR PAIR par le gestionnaire d'appel,
   * elle n'est publiee qu'une fois. Vrai si elle vient d'etre publiee.
   */
  async ajouterPiste(piste: MediaStreamTrack, flux: MediaStream): Promise<boolean> {
    this.local = flux
    if (this.nosPistes.has(piste.id)) return false
    if (!this.pc) {
      await this.demarrer(flux)
      return true
    }
    await this.enFile(() => this.publierLocal([piste]))
    return true
  }

  /**
   * Remplace notre image (camera retournee, partage d'ecran) ou la coupe
   * (`null`). Un emetteur video existe : `replaceTrack`, sans renegociation.
   * Sinon la piste est publiee comme une nouvelle. Idempotent.
   */
  async remplacerVideo(piste: MediaStreamTrack | null): Promise<void> {
    const pc = this.pc
    if (!pc) return
    const emetteur = pc
      .getTransceivers()
      .find((t) => t.direction === "sendonly" && (t.sender.track?.kind === "video" || this.estLigneVideo(t)))?.sender
    if (emetteur) {
      if (emetteur.track?.id === piste?.id) return
      await emetteur.replaceTrack(piste)
      if (piste) this.nosPistes.set(piste.id, this.nomDeLaLigneVideo() ?? "video")
      return
    }
    if (piste) await this.ajouterPiste(piste, this.local ?? new MediaStream([piste]))
  }

  private estLigneVideo(t: RTCRtpTransceiver): boolean {
    return t.receiver.track?.kind === "video"
  }

  private nomDeLaLigneVideo(): string | null {
    for (const nom of this.nosPistes.values()) if (nom.startsWith("video")) return nom
    return null
  }

  /** Qui parle : `inbound-rtp` par `mid`, `media-source` pour notre micro. */
  async niveauxAudio(moiCle: string, micOn: boolean): Promise<Map<string, number> | null> {
    const pc = this.pc
    if (!pc) return null
    const niveaux = new Map<string, number>()
    const rapports = await pc.getStats()
    rapports.forEach((r: RTCStats & { kind?: string; audioLevel?: number; mid?: string }) => {
      if (r.kind !== "audio" || typeof r.audioLevel !== "number") return
      if (r.type === "inbound-rtp") {
        const auteur = r.mid ? this.auteurDuMid.get(r.mid) : undefined
        if (auteur) niveaux.set(auteur, r.audioLevel)
      } else if (r.type === "media-source") {
        niveaux.set(moiCle, micOn ? r.audioLevel : 0)
      }
    })
    return niveaux
  }

  fermer() {
    this.ferme = true
    const session = this.sessionId
    this.sessionId = null
    if (session) void sfuApi.raccrocher(session).catch(() => undefined)
    this.pc?.close()
    this.pc = null
    this.flux.clear()
  }
}

type SignalControle = { kind?: string; enabled?: boolean }

/**
 * Un pair VIRTUEL : la surface d'une `PeerSession`, adossee au moteur SFU
 * commun. Les petits messages de controle (camera coupee, passage en video)
 * passent toujours par le socket, de pair a pair.
 */
export class PairSfu {
  cameraDistanteActive = true

  constructor(
    private readonly peerId: string,
    private readonly moteur: MoteurSfuWeb,
    private readonly fluxLocal: () => MediaStream | null,
    private readonly envoyer: (signal: SignalControle) => void,
    private readonly surPassageVideo: (peerId: string) => void,
    private readonly surCamera: () => void
  ) {}

  async start(): Promise<void> {
    await this.moteur.demarrer(this.fluxLocal())
    await this.moteur.ajouterPair(this.peerId)
  }

  get remoteStream(): MediaStream | null {
    return this.moteur.fluxDe(this.peerId)
  }

  get connexionFaible(): boolean {
    return this.moteur.connexionFaible
  }

  /** Pas de connexion propre : « qui parle » se lit sur le moteur. */
  get connexion(): RTCPeerConnection | null {
    return null
  }

  async handleSignal(signal: SignalControle): Promise<void> {
    if (signal?.kind === "video_upgrade") this.surPassageVideo(this.peerId)
    else if (signal?.kind === "camera_state") {
      this.cameraDistanteActive = signal.enabled !== false
      this.surCamera()
    }
    // Offre, reponse, candidat ICE : rien de pair a pair en SFU.
  }

  close() {
    void this.moteur.retirerPair(this.peerId)
  }

  envoyerEtatCamera(active: boolean) {
    this.envoyer({ kind: "camera_state", enabled: active })
  }

  annoncerPassageVideo() {
    this.envoyer({ kind: "video_upgrade" })
  }

  async ajouterVideo(piste: MediaStreamTrack, flux: MediaStream): Promise<void> {
    await this.moteur.ajouterPiste(piste, flux)
  }

  ajouterPisteLocale(piste: MediaStreamTrack, flux: MediaStream): Promise<boolean> {
    return this.moteur.ajouterPiste(piste, flux)
  }

  /** La publication a deja eu lieu dans le moteur. */
  async renegocier(): Promise<void> {}

  /** Toujours faux : rien a renegocier de pair a pair. */
  async replaceVideoTrack(piste: MediaStreamTrack | null): Promise<boolean> {
    await this.moteur.remplacerVideo(piste)
    return false
  }

  relancerApresChangementDeReseau() {
    this.moteur.relancer()
  }
}
