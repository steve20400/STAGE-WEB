import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "../i18n"
import { useToast } from "./toast"
import { deposerMessagerie } from "../services/repondeur-service"

/**
 * LE RÉPONDEUR, SUR L'ÉCRAN D'APPEL DE L'APPELANT.
 *
 * 🔴 C'EST LUI QUI JOUE LE RÉPONDEUR, faute de serveur média : les appels sont
 * en pair-à-pair, et personne n'ayant décroché, aucun pair n'existe pour jouer
 * l'accueil ni pour enregistrer.
 *
 * 🔴 IL NE RECOUVRE PLUS L'ÉCRAN D'APPEL — correction d'une première version qui
 * posait un panneau plein par-dessus. On restait alors devant quelque chose qui
 * ne ressemblait plus à un appel, et les commandes habituelles disparaissaient
 * sans raison. Ce n'est qu'une BARRE de deux boutons qui s'ajoute aux autres :
 * l'appel qu'on vient de passer reste à l'écran, ce qui est exactement ce qui se
 * passe.
 *
 * ⚠️ L'APPEL EST DÉJÀ TERMINÉ quand cette barre paraît, et il fallait qu'il le
 * soit : le laisser vivre ferait sonner le téléphone d'en face pendant qu'on
 * parle, et le destinataire décrocherait sur quelqu'un en train de dicter.
 */

type Etape = "accueil" | "enregistre" | "envoie" | "fini"

/** Durée maximale d'un message laissé. Au-delà, personne n'écoute. */
const MESSAGE_MAX_MS = 120_000

export function RepondeurAppel({
  callId,
  accueilUrl,
  onFermer,
}: {
  callId: string
  accueilUrl: string
  onFermer: () => void
}) {
  const { t } = useTranslation()
  const { success, error } = useToast()

  const [etape, setEtape] = useState<Etape>("accueil")
  const [secondes, setSecondes] = useState(0)
  /**
   * L'accueil joue-t-il vraiment ?
   *
   * 🔴 LE NAVIGATEUR PEUT REFUSER DE JOUER SANS GESTE RECENT, et il le fait en
   * silence : la promesse de `play()` est simplement rejetee. On lisait alors
   * « Message d'accueil… » devant un haut-parleur muet, sans rien pour y
   * remedier. Un bouton parait donc des que la lecture n'a pas demarre.
   */
  const [lectureBloquee, setLectureBloquee] = useState(false)

  const audio = useRef<HTMLAudioElement | null>(null)
  const enregistreur = useRef<MediaRecorder | null>(null)
  const morceaux = useRef<Blob[]>([])
  const flux = useRef<MediaStream | null>(null)
  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null)
  /** Durée retenue à l'arrêt : `secondes` est figé dans la fermeture du `onstop`. */
  const dureeFinale = useRef(0)

  /**
   * Coupe le micro, pour de bon.
   *
   * 🔴 SANS `stop()` SUR CHAQUE PISTE, LE VOYANT RESTE ALLUMÉ après avoir quitté
   * l'écran : le navigateur garde l'accès tant qu'une piste vit, même
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

  // Quitter l'écran ne doit laisser ni micro ouvert ni accueil qui continue.
  useEffect(
    () => () => {
      couperMicro()
      audio.current?.pause()
    },
    [couperMicro],
  )

  /*
   * L'accueil se joue tout seul.
   *
   * ⚠️ UN ÉCHEC DE LECTURE NE BLOQUE PAS. Le navigateur peut refuser de jouer
   * sans geste préalable ; on laisse alors simplement le bouton disponible.
   * Mieux vaut pouvoir parler sans avoir entendu l'accueil que rester bloqué.
   */
  useEffect(() => {
    const son = new Audio(accueilUrl)
    son.preload = "auto"
    audio.current = son
    // ⚠️ L'ECHEC EST RETENU, PAS AVALE : c'est lui qui fait paraitre le bouton.
    son.play().then(
      () => setLectureBloquee(false),
      () => setLectureBloquee(true),
    )
    // Un fichier illisible — format refuse, jeton perime — se signale ici et
    // nulle part ailleurs : sans cet ecouteur, l'echec serait muet.
    const surErreur = () => setLectureBloquee(true)
    son.addEventListener("error", surErreur)
    return () => {
      son.removeEventListener("error", surErreur)
      son.pause()
    }
  }, [accueilUrl])

  /** Relance la lecture, cette fois depuis un vrai clic. */
  const ecouter = () => {
    audio.current?.play().then(
      () => setLectureBloquee(false),
      () => error(t("rep_lecture_impossible")),
    )
  }

  /**
   * Démarre l'enregistrement.
   *
   * 🔴 COUPE L'ACCUEIL D'ABORD. On clique « Enregistrer » parce qu'on a compris
   * le message, souvent avant la fin : le laisser continuer ferait parler
   * par-dessus, et la voix du correspondant se retrouverait dans le message.
   */
  const enregistrer = async () => {
    audio.current?.pause()
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
      dureeFinale.current = 0
      setEtape("enregistre")

      minuteur.current = setInterval(() => {
        setSecondes((valeur) => {
          const suivant = valeur + 1
          dureeFinale.current = suivant
          // La coupe est dans le minuteur : refuser après coup ferait perdre le
          // message entier, au moment précis où l'on croit avoir fini.
          if (suivant * 1000 >= MESSAGE_MAX_MS) arreter()
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
      await deposerMessagerie(callId, blob, dureeFinale.current * 1000)
      setEtape("fini")
      success(t("rep_depose"))
      window.setTimeout(onFermer, 1200)
    } catch {
      error(t("rep_depot_echec"))
      onFermer()
    }
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

  return (
    <div className="rep-barre">
      {etape === "accueil" && (
        <>
          <span className="rep-barre-texte">{t("rep_lecture_accueil")}</span>
          {lectureBloquee && (
            <button className="rep-barre-btn ghost" onClick={ecouter}>
              ▶ {t("rep_ecouter")}
            </button>
          )}
          <button className="rep-barre-btn" onClick={() => void enregistrer()}>
            ● {t("rep_enregistrer_message")}
          </button>
          <button className="rep-barre-btn ghost" onClick={onFermer}>
            {t("rep_quitter")}
          </button>
        </>
      )}

      {etape === "enregistre" && (
        <>
          <span className="rep-barre-texte" style={{ fontVariantNumeric: "tabular-nums" }}>
            ● {mmss(secondes)} / {mmss(Math.floor(MESSAGE_MAX_MS / 1000))}
          </span>
          <button className="rep-barre-btn" onClick={arreter}>
            ■ {t("rep_envoyer")}
          </button>
        </>
      )}

      {etape === "envoie" && <span className="rep-barre-texte">{t("rep_envoi")}</span>}
      {etape === "fini" && <span className="rep-barre-texte">{t("rep_depose")}</span>}

      <style>{`
        .rep-barre {
          display: flex; align-items: center; justify-content: center;
          gap: 10px; flex-wrap: wrap; padding: 12px 16px;
          border-radius: 14px; margin: 0 auto 12px; max-width: 560px;
          background: rgba(0,0,0,.45); backdrop-filter: blur(6px);
          color: #fff;
        }
        .rep-barre-texte { font-size: 13px; opacity: .9; }
        .rep-barre-btn {
          padding: 9px 16px; border-radius: 999px; cursor: pointer; border: none;
          background: var(--accent, #8A4B2B); color: #fff;
          font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600;
        }
        .rep-barre-btn.ghost {
          background: transparent; border: 1px solid rgba(255,255,255,.35);
        }
        /* Au pouce : chaque bouton prend sa ligne plutot que de se serrer a
           trois, ou aucun n'est atteignable. */
        @media (max-width: 480px) {
          .rep-barre { flex-direction: column; align-items: stretch; }
          .rep-barre-btn { width: 100%; }
          .rep-barre-texte { text-align: center; }
        }
      `}</style>
    </div>
  )
}
