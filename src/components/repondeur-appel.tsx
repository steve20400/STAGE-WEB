import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "../i18n"
import { useToast } from "./toast"
import { deposerMessagerie } from "../services/repondeur-service"

/**
 * L'ÉCRAN DU RÉPONDEUR, chez l'APPELANT.
 *
 * 🔴 C'EST LUI QUI JOUE LE RÉPONDEUR, faute de serveur média. Les appels sont en
 * pair-à-pair : personne n'ayant décroché, aucun pair n'existe pour jouer
 * l'accueil ni pour enregistrer. L'accueil est donc téléchargé et joué ICI, et
 * le message est enregistré ICI avant d'être déposé au serveur.
 *
 * ⚠️ L'APPEL EST DÉJÀ TERMINÉ quand cet écran paraît. Il fallait le terminer :
 * le laisser vivre ferait sonner le téléphone d'en face pendant qu'on parle, et
 * le destinataire décrocherait sur quelqu'un en train de dicter un message.
 *
 * Le déroulé suit celui d'un vrai répondeur, et dans cet ordre : l'accueil, le
 * bip, puis la parole.
 */

type Etape = "accueil" | "invite" | "enregistre" | "envoie" | "fini"

/** Durée maximale d'un message laissé. Au-delà, personne n'écoute. */
const MESSAGE_MAX_MS = 120_000

export function RepondeurAppel({
  callId,
  accueilUrl,
  nomCorrespondant,
  onFermer,
}: {
  callId: string
  accueilUrl: string
  nomCorrespondant: string
  onFermer: () => void
}) {
  const { t } = useTranslation()
  const { success, error } = useToast()

  const [etape, setEtape] = useState<Etape>("accueil")
  const [secondes, setSecondes] = useState(0)

  const audio = useRef<HTMLAudioElement | null>(null)
  const enregistreur = useRef<MediaRecorder | null>(null)
  const morceaux = useRef<Blob[]>([])
  const flux = useRef<MediaStream | null>(null)
  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null)

  /**
   * Coupe le micro, pour de bon.
   *
   * 🔴 SANS `stop()` SUR CHAQUE PISTE, LE VOYANT RESTE ALLUMÉ après avoir quitté
   * l'écran. Le navigateur garde l'accès tant qu'une piste vit, même
   * l'enregistreur arrêté.
   */
  const couperMicro = useCallback(() => {
    if (minuteur.current) {
      clearInterval(minuteur.current)
      minuteur.current = null
    }
    flux.current?.getTracks().forEach((piste) => piste.stop())
    flux.current = null
  }, [])

  useEffect(() => couperMicro, [couperMicro])

  /*
   * L'accueil se joue tout seul à l'ouverture.
   *
   * ⚠️ UN ÉCHEC DE LECTURE NE BLOQUE PAS. Le navigateur peut refuser de jouer
   * sans geste préalable — même si, ici, l'appel EST le geste. On passe alors
   * directement à l'invitation : mieux vaut laisser parler sans avoir entendu
   * l'accueil que de rester bloqué sur un écran muet.
   */
  useEffect(() => {
    const son = new Audio(accueilUrl)
    audio.current = son
    const suivant = () => setEtape("invite")
    son.addEventListener("ended", suivant)
    son.play().catch(suivant)
    return () => {
      son.removeEventListener("ended", suivant)
      son.pause()
    }
  }, [accueilUrl])

  const passerLAccueil = () => {
    audio.current?.pause()
    setEtape("invite")
  }

  const enregistrer = async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      flux.current = media
      morceaux.current = []
      const rec = new MediaRecorder(media)
      rec.ondataavailable = (evenement) => {
        if (evenement.data.size > 0) morceaux.current.push(evenement.data)
      }
      rec.onstop = () => void envoyer(rec.mimeType || "audio/webm")
      rec.start()
      enregistreur.current = rec
      setSecondes(0)
      setEtape("enregistre")

      minuteur.current = setInterval(() => {
        setSecondes((valeur) => {
          const suivant = valeur + 1
          // La coupe est dans le minuteur : refuser après coup ferait perdre le
          // message entier, au moment précis où l'on croit avoir fini.
          if (suivant * 1000 >= MESSAGE_MAX_MS) {
            arreter()
            return Math.floor(MESSAGE_MAX_MS / 1000)
          }
          return suivant
        })
      }, 1000)
    } catch {
      error(t("rep_micro_refuse"))
    }
  }

  const arreter = () => {
    if (minuteur.current) {
      clearInterval(minuteur.current)
      minuteur.current = null
    }
    try {
      enregistreur.current?.stop()
    } catch {
      /* déjà arrêté */
    }
  }

  const envoyer = async (mime: string) => {
    setEtape("envoie")
    const blob = new Blob(morceaux.current, { type: mime })
    couperMicro()
    // Un enregistrement vide — micro coupé, geste trop court — n'a rien à
    // déposer : on ferme plutôt que de livrer un silence.
    if (blob.size === 0) {
      onFermer()
      return
    }
    try {
      await deposerMessagerie(callId, blob, secondes * 1000)
      setEtape("fini")
      success(t("rep_depose"))
      // On laisse une seconde pour que la confirmation se lise, puis on sort.
      window.setTimeout(onFermer, 1200)
    } catch {
      error(t("rep_depot_echec"))
      onFermer()
    }
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: 24,
        textAlign: "center",
        background: "var(--bg-base, #0B0B18)",
        color: "#fff",
        zIndex: 40,
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 600 }}>{nomCorrespondant}</div>

      {etape === "accueil" && (
        <>
          <div style={{ fontSize: 14, opacity: 0.8 }}>{t("rep_lecture_accueil")}</div>
          {/* Passer l'accueil : on le connaît déjà quand on rappelle
              quelqu'un pour la troisième fois. */}
          <button className="rep-appel-btn ghost" onClick={passerLAccueil}>
            {t("rep_passer")}
          </button>
        </>
      )}

      {etape === "invite" && (
        <>
          <div style={{ fontSize: 14, opacity: 0.8 }}>{t("rep_apres_bip")}</div>
          <button className="rep-appel-btn" onClick={() => void enregistrer()}>
            ● {t("rep_laisser_message")}
          </button>
          <button className="rep-appel-btn ghost" onClick={onFermer}>
            {t("rep_raccrocher")}
          </button>
        </>
      )}

      {etape === "enregistre" && (
        <>
          <div
            style={{
              fontSize: 30,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: 1,
            }}
          >
            {mmss(secondes)}
          </div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            / {mmss(Math.floor(MESSAGE_MAX_MS / 1000))}
          </div>
          <button className="rep-appel-btn" onClick={arreter}>
            ■ {t("rep_envoyer")}
          </button>
        </>
      )}

      {etape === "envoie" && <div style={{ fontSize: 14, opacity: 0.8 }}>{t("rep_envoi")}</div>}
      {etape === "fini" && <div style={{ fontSize: 14 }}>{t("rep_depose")}</div>}

      <style>{`
        .rep-appel-btn {
          padding: 12px 22px; border-radius: 999px; cursor: pointer;
          border: none; background: var(--accent, #8A4B2B); color: #fff;
          font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
          min-width: 180px;
        }
        .rep-appel-btn.ghost {
          background: transparent; border: 1px solid rgba(255,255,255,.3);
        }
        /* Au pouce, sur un telephone : les boutons prennent la largeur. */
        @media (max-width: 420px) {
          .rep-appel-btn { width: 100%; min-width: 0; }
        }
      `}</style>
    </div>
  )
}
