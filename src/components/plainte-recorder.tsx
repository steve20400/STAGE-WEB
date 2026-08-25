import { useEffect, useRef, useState } from "react"
import type { IvrSession } from "../services/call-manager"
import { sendIvrBackToMenu } from "../services/call-manager"
import { uploadMedia } from "../services/media-service"
import { deposerPlainte } from "../services/plaintes-service"

type Etat = "bip" | "enregistrement" | "pause" | "relecture" | "envoi" | "envoye" | "echec"

/**
 * Enregistrement d'une plainte vocale, sur la touche 0 d'un centre vocal.
 *
 * MIROIR du `PlainteRecorder` de l'app mobile, et volontairement : les deux
 * clients doivent se comporter pareil devant le meme evenement `ivr_record`.
 * Les regles qui comptent y sont donc les memes, y compris celles qui ne se
 * devinent pas — a commencer par la cle d'idempotence.
 *
 * ⚠️ **L'ENREGISTREMENT NE DEMARRE PAS A L'APPUI SUR 0**, mais a la FIN DU BIP.
 * Le serveur donne le depart et l'URL ; c'est ici qu'on enchaine, parce que
 * seul le lecteur sait quand l'annonce se termine. Sans bip configure, on
 * demarre tout de suite : une variable oubliee ne doit pas rendre la touche
 * inutilisable.
 *
 * ⚠️ Le navigateur, lui, sait melanger — mais il n'y a rien a melanger ici :
 * une plainte n'enregistre QUE le micro de l'appelant, pas la conversation.
 */
export function PlainteRecorder({ session }: { session: IvrSession }) {
  const [etat, setEtat] = useState<Etat>("bip")
  const [duree, setDuree] = useState(0)
  const [erreur, setErreur] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const morceauxRef = useRef<Blob[]>([])
  const blobRef = useRef<Blob | null>(null)
  const urlRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  /**
   * Cumul des segments deja enregistres, pauses EXCLUES.
   *
   * 🔴 Sans ce cumul, la duree mentirait des la premiere pause : un temps de mur
   * compte les pauses. Meme correction que sur mobile.
   */
  const cumulRef = useRef(0)
  const debutSegmentRef = useRef<number | null>(null)

  /**
   * 🔴 POSEE UNE FOIS A L'ARRET DU MICRO, JAMAIS REGENEREE. C'est elle qui rend
   * l'envoi idempotent : un reessai apres echec reseau reutilise la meme cle, et
   * le serveur rend la plainte deja enregistree au lieu d'en creer une seconde.
   */
  const cleRef = useRef<string | null>(null)

  const etatRef = useRef<Etat>("bip")
  etatRef.current = etat

  /** Duree reelle a cet instant, pauses exclues. */
  function dureeCourante(): number {
    const debut = debutSegmentRef.current
    return cumulRef.current + (debut == null ? 0 : Date.now() - debut)
  }

  useEffect(() => {
    let vivant = true

    async function lancerMicro() {
      if (!vivant || etatRef.current !== "bip") return
      try {
        const flux = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (!vivant) {
          flux.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = flux
        morceauxRef.current = []
        const rec = new MediaRecorder(flux)
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) morceauxRef.current.push(e.data)
        }
        recorderRef.current = rec
        rec.start()
        cumulRef.current = 0
        debutSegmentRef.current = Date.now()
        setEtat("enregistrement")
      } catch {
        // Permission refusee, ou aucun micro. On le DIT : un panneau qui reste
        // a zero sans rien expliquer se lit comme une panne.
        if (vivant) {
          setErreur("Micro indisponible. Autorise l'acces dans le navigateur.")
          setEtat("echec")
        }
      }
    }

    const bip = session.bipEnregistrementUrl
    if (!bip) {
      void lancerMicro()
    } else {
      const audio = new Audio(bip)
      audio.onended = () => void lancerMicro()
      // Un bip injoignable ne doit pas bloquer : on demarre quand meme.
      audio.onerror = () => void lancerMicro()
      void audio.play().catch(() => void lancerMicro())
      // Filet, si ni `onended` ni `onerror` ne partent jamais.
      const filet = setTimeout(() => void lancerMicro(), 8000)
      return () => {
        vivant = false
        clearTimeout(filet)
        audio.pause()
      }
    }

    return () => {
      vivant = false
    }
    // Une seule fois : le bip et le micro ne se relancent pas a chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ⚠️ NETTOYAGE AU DEMONTAGE. L'ecran peut partir en plein enregistrement —
  // l'appelant raccroche, le serveur renvoie le menu. Sans cela, le micro
  // resterait OUVERT : sur un navigateur, la pastille rouge de l'onglet reste
  // allumee et la permission parait detournee.
  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop()
      } catch {
        /* deja arrete */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      audioRef.current?.pause()
    }
  }, [])

  // Le minuteur. Il lit la MEME mesure que celle qui partira au serveur :
  // impossible d'afficher un chiffre et d'en envoyer un autre.
  useEffect(() => {
    if (etat !== "enregistrement") return
    const t = setInterval(() => {
      const d = dureeCourante()
      setDuree(d)
      if (d >= session.plainteMaxMs) void arreter()
    }, 200)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etat, session.plainteMaxMs])

  function basculerPause() {
    const rec = recorderRef.current
    if (!rec) return
    if (etat === "enregistrement") {
      // Le segment est ferme AVANT l'appel natif : le compter gonflerait la
      // duree d'autant a chaque pause.
      cumulRef.current += Date.now() - (debutSegmentRef.current ?? Date.now())
      debutSegmentRef.current = null
      rec.pause()
      setEtat("pause")
    } else if (etat === "pause") {
      rec.resume()
      debutSegmentRef.current = Date.now()
      setEtat("enregistrement")
    }
  }

  async function arreter() {
    const rec = recorderRef.current
    if (!rec || (etatRef.current !== "enregistrement" && etatRef.current !== "pause")) return
    const dureeFinale = dureeCourante()
    const fini = new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
    })
    try {
      rec.stop()
    } catch {
      /* deja arrete */
    }
    await fini
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null

    // 🔴 TYPE SANS PARAMÈTRE — meme regle que `enregistrement-appel.ts`.
    //
    // Le navigateur produit « audio/webm;codecs=opus ». La liste blanche du
    // serveur comparait la chaine ENTIERE et rejetait le « ;codecs=… » par un
    // 415, que le panneau affiche « Ce type de fichier n'est pas pris en
    // compte » (signale par le user le 25/08/2026). Le mobile passait, lui :
    // il produit « audio/mp4 », sans parametre.
    //
    // Le serveur normalise desormais de son cote, ce qui repare aussi les
    // navigateurs deja ouverts. On garde neanmoins la coupe ici, pour que les
    // DEUX enregistreurs de ce depot se comportent pareil — c'est d'avoir
    // corrige le premier seul qui a laisse celui-ci casse pendant cinq jours.
    const typeBlob = (rec.mimeType || "audio/webm").split(";")[0].trim()
    const blob = new Blob(morceauxRef.current, { type: typeBlob })
    // ⚠️ Un enregistrement VIDE n'est pas envoyable, et le dire vaut mieux que
    // de deposer un fichier que personne ne pourra ecouter.
    if (blob.size === 0) {
      setErreur("Enregistrement vide. Reessaie.")
      setEtat("echec")
      return
    }
    blobRef.current = blob
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = URL.createObjectURL(blob)
    cleRef.current = cleRef.current ?? fabriquerCle()
    setDuree(dureeFinale)
    setEtat("relecture")
  }

  function basculerRelecture() {
    const url = urlRef.current
    if (!url) return
    if (!audioRef.current) audioRef.current = new Audio(url)
    const a = audioRef.current
    if (a.paused) void a.play()
    else a.pause()
  }

  /**
   * Recommencer : on jette tout, Y COMPRIS la cle d'envoi.
   *
   * ⚠️ C'est le SEUL endroit qui a le droit de la jeter — c'est un nouvel
   * enregistrement, donc une nouvelle plainte. La jeter a un reessai d'envoi
   * casserait l'idempotence.
   */
  function recommencer() {
    audioRef.current?.pause()
    audioRef.current = null
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    blobRef.current = null
    cleRef.current = null
    cumulRef.current = 0
    debutSegmentRef.current = null
    setDuree(0)
    setErreur(null)
    setEtat("bip")
    // Le bip n'est PAS rejoue : l'appelant vient de l'entendre.
    void (async () => {
      try {
        const flux = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = flux
        morceauxRef.current = []
        const rec = new MediaRecorder(flux)
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) morceauxRef.current.push(e.data)
        }
        recorderRef.current = rec
        rec.start()
        debutSegmentRef.current = Date.now()
        setEtat("enregistrement")
      } catch {
        setErreur("Micro indisponible.")
        setEtat("echec")
      }
    })()
  }

  async function envoyer() {
    const blob = blobRef.current
    const cle = cleRef.current
    if (!blob || !cle) return
    audioRef.current?.pause()
    setEtat("envoi")
    setErreur(null)
    try {
      const extension = blob.type.includes("ogg") ? "ogg" : "webm"
      const fichier = new File([blob], `plainte-${cle}.${extension}`, { type: blob.type })
      const media = await uploadMedia(fichier, fichier.name)
      await deposerPlainte({
        centerId: session.centerId,
        mediaId: media.id,
        cleEnvoi: cle,
        dureeMs: Math.round(duree),
      })
      /*
       * ⚠️ ON QUITTE « ENVOI » AVANT de demander le retour au menu.
       *
       * Le panneau ne disparait que lorsque le SERVEUR renvoie le menu. Tant
       * qu'on laissait tourner en attendant, une trame perdue laissait
       * l'appelant devant un chargement infini sur une plainte POURTANT
       * ENREGISTREE — defaut vecu sur mobile le 20/08/2026.
       */
      setEtat("envoye")
      sendIvrBackToMenu()
    } catch (e) {
      // ⚠️ La cle est CONSERVEE : « Reessayer » renverra la MEME, et le serveur
      // ne creera pas de doublon si la premiere tentative avait en fait abouti.
      setErreur(e instanceof Error ? e.message : "Envoi impossible.")
      setEtat("echec")
    }
  }

  return (
    <div style={styleBoite}>
      <span style={{ fontSize: 16 }}>{etat === "echec" ? "⚠️" : "🎙️"}</span>
      <span style={styleTexte}>{libelle(etat, erreur)}</span>
      {etat !== "echec" && etat !== "envoye" && (
        <span style={styleChrono}>{mmss(duree)}</span>
      )}
      {(etat === "enregistrement" || etat === "pause") && (
        <>
          <Bouton titre={etat === "pause" ? "Reprendre" : "Pause"} onClick={basculerPause}>
            {etat === "pause" ? "▶" : "⏸"}
          </Bouton>
          <Bouton titre="Terminer" onClick={() => void arreter()}>
            ⏹
          </Bouton>
        </>
      )}
      {etat === "relecture" && (
        <>
          <Bouton titre="Ecouter" onClick={basculerRelecture}>
            ▶
          </Bouton>
          <Bouton titre="Refaire" onClick={recommencer}>
            ↻
          </Bouton>
          <Bouton titre="Envoyer" accent onClick={() => void envoyer()}>
            ➤
          </Bouton>
        </>
      )}
      {etat === "echec" && (
        <>
          <Bouton titre="Refaire" onClick={recommencer}>
            ↻
          </Bouton>
          {/* N'apparait que s'il y a quelque chose a renvoyer : un echec de
              micro n'a produit aucun fichier. */}
          {blobRef.current && (
            <Bouton titre="Reessayer" accent onClick={() => void envoyer()}>
              ➤
            </Bouton>
          )}
        </>
      )}
    </div>
  )
}

function libelle(etat: Etat, erreur: string | null): string {
  if (etat === "echec") return erreur ?? "Echec"
  if (etat === "bip") return "Annonce…"
  if (etat === "pause") return "Pause"
  if (etat === "relecture") return "Ecoutez"
  if (etat === "envoi") return "Envoi…"
  if (etat === "envoye") return "Envoyee ✓"
  return ""
}

function mmss(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = String(Math.floor(total / 60)).padStart(2, "0")
  const s = String(total % 60).padStart(2, "0")
  return `${m}:${s}`
}

function fabriquerCle(): string {
  const alea = Math.random().toString(36).slice(2, 10)
  return `pl-${Date.now()}-${alea}`
}

function Bouton({
  children,
  titre,
  accent,
  onClick,
}: {
  children: React.ReactNode
  titre: string
  accent?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={titre}
      aria-label={titre}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        marginLeft: 4,
        borderRadius: "50%",
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        color: "#fff",
        background: accent
          ? "color-mix(in srgb, var(--danger) 85%, transparent)"
          : "rgba(255,255,255,0.22)",
      }}
    >
      {children}
    </button>
  )
}

const styleBoite: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  marginBottom: 12,
  borderRadius: 12,
  background: "rgba(0,0,0,0.55)",
  border: "1px solid rgba(255,255,255,0.18)",
}

const styleTexte: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  color: "#fff",
  fontSize: 12,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}

const styleChrono: React.CSSProperties = {
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  // Chiffres a chasse fixe : sans eux le minuteur tressaute chaque seconde et
  // tout ce qui le suit bouge avec.
  fontVariantNumeric: "tabular-nums",
}
