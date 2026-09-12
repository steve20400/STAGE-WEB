import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "../i18n"
import { useToast } from "./toast"
import { deposerMessagerie } from "../services/repondeur-service"

/**
 * LE RÉPONDEUR DE L'APPELANT — un panneau flottant, posé sur l'application.
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
  nom,
  onFermer,
}: {
  callId: string
  accueilUrl: string
  /** Qui l'on vient d'appeler. Le panneau paraît loin de l'écran d'appel. */
  nom: string
  onFermer: () => void
}) {
  const { t } = useTranslation()
  const { error } = useToast()

  const [etape, setEtape] = useState<Etape>("accueil")
  const [secondes, setSecondes] = useState(0)
  /**
   * L'accueil joue-t-il vraiment ?
   *
   * 🔴 ON NE PROPOSE PAS D'ECOUTER L'ACCUEIL — il se joue tout seul, comme sur
   * un vrai repondeur. Ce qu'on propose, c'est d'enregistrer un message.
   *
   * ⚠️ MAIS UN ECHEC NE DOIT PAS ETRE MUET. Le navigateur peut refuser de jouer
   * sans geste recent, et il le fait en silence : la promesse de `play()` est
   * simplement rejetee. On lisait alors « Message d'accueil… » devant un
   * haut-parleur muet. La ligne d'etat le dit maintenant, sans rien proposer de
   * plus : il reste possible de parler sans avoir entendu l'accueil.
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
      // Pas de notification : le panneau affiche « Message déposé » puis se
      // ferme. Un bandeau par-dessus pour redire la même chose n'ajoutait rien.
      window.setTimeout(onFermer, 1200)
    } catch {
      error(t("rep_depot_echec"))
      onFermer()
    }
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

  const initiales = nom.trim().slice(0, 2).toUpperCase() || "?"

  return (
    <div className="rep-carte" role="dialog" aria-label={t("rep_barre_titre", { nom })}>
      <div className="rep-tete">
        <span className="rep-pastille" aria-hidden>
          {initiales}
        </span>
        <div className="rep-tete-texte">
          {/* QUI, avant QUOI. Le panneau peut paraître pendant qu'on écrit dans
              une tout autre discussion : sans le nom, on ne saurait pas pour qui
              l'on s'apprête à parler. */}
          <div className="rep-titre">{t("rep_barre_titre", { nom })}</div>
          <div className="rep-etat">
            {etape === "accueil" &&
              (lectureBloquee ? t("rep_lecture_impossible") : t("rep_lecture_accueil"))}
            {etape === "enregistre" && (
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                <span className="rep-point" aria-hidden /> {mmss(secondes)} /{" "}
                {mmss(Math.floor(MESSAGE_MAX_MS / 1000))}
              </span>
            )}
            {etape === "envoie" && t("rep_envoi")}
            {etape === "fini" && t("rep_depose")}
          </div>
        </div>
      </div>

      {etape === "accueil" && (
        <div className="rep-actions">
          <button className="rep-btn-p" onClick={() => void enregistrer()}>
            ● {t("rep_enregistrer_message")}
          </button>
          <button className="rep-btn-s" onClick={onFermer}>
            {t("rep_quitter")}
          </button>
        </div>
      )}

      {etape === "enregistre" && (
        <div className="rep-actions">
          <button className="rep-btn-p" onClick={arreter}>
            ■ {t("rep_envoyer")}
          </button>
        </div>
      )}

      <style>{`
        /* 🔴 CE PANNEAU NE VIT PLUS SUR L'ÉCRAN D'APPEL, et ses couleurs ont dû
           suivre. C'était une pastille sombre translucide, juste sur le fond
           noir d'un appel — posée sur une discussion en clair, elle devenait une
           tache qui n'appartenait à rien. Il prend donc les surfaces de
           l'application, et se tient par son ombre. */
        .rep-carte {
          display: grid; gap: 12px; padding: 14px;
          border-radius: 16px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-default);
          box-shadow: 0 4px 12px rgba(0,0,0,.10), 0 16px 40px rgba(0,0,0,.16);
          color: var(--text-primary);
        }
        .rep-tete { display: flex; align-items: center; gap: 11px; }
        .rep-pastille {
          width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: var(--accent); color: var(--accent-text, #fff);
          font-size: 13px; font-weight: 700; letter-spacing: .02em;
        }
        .rep-tete-texte { flex: 1; min-width: 0; }
        .rep-titre {
          font-size: 14px; font-weight: 600; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rep-etat { font-size: 12.5px; color: var(--text-muted); margin-top: 1px; }
        .rep-point {
          display: inline-block; width: 7px; height: 7px; border-radius: 50%;
          background: var(--danger); vertical-align: baseline;
          animation: rep-bat 1.1s ease-in-out infinite;
        }
        @keyframes rep-bat { 50% { opacity: .25; } }
        /* Un point qui clignote sans fin peut gêner ; on le fige alors sans le
           faire disparaître, l'enregistrement devant rester signalé. */
        @media (prefers-reduced-motion: reduce) {
          .rep-point { animation: none; }
        }

        .rep-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .rep-btn-p, .rep-btn-s {
          flex: 1; min-width: 132px;
          padding: 10px 16px; border-radius: 999px; cursor: pointer;
          font-family: inherit; font-size: 13px; font-weight: 600;
        }
        .rep-btn-p { border: none; background: var(--accent); color: var(--accent-text, #fff); }
        .rep-btn-s {
          background: transparent; color: var(--text-primary);
          border: 1px solid var(--border-default);
        }
        .rep-btn-p:focus-visible, .rep-btn-s:focus-visible {
          outline: 2px solid var(--accent); outline-offset: 2px;
        }
      `}</style>
    </div>
  )
}
