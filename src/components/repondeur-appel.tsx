import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "../i18n"
import { useToast } from "./toast"
import { deposerMessagerie } from "../services/repondeur-service"

/**
 * LE RÉPONDEUR — une feuille collée au bas de l'écran d'appel.
 *
 * 🔴 C'EST LE CLIENT DE L'APPELANT QUI JOUE LE RÉPONDEUR, faute de serveur
 * média : les appels sont en pair-à-pair, et personne n'ayant décroché, aucun
 * pair n'existe pour jouer l'accueil ni pour enregistrer.
 *
 * 🔴 ELLE REMPLACE LES COMMANDES D'APPEL, elle ne se pose pas par-dessus. Deux
 * versions ont échoué avant celle-ci, et pour la même raison : un panneau
 * flottant sur un voile à demi transparent, où Micro, Haut-parleur et
 * Raccrocher transparaissaient juste derrière les boutons du répondeur. Un
 * appel terminé n'a de toute façon plus aucune commande à offrir.
 *
 * ⚠️ L'APPEL EST DÉJÀ TERMINÉ quand elle paraît, et il fallait qu'il le soit :
 * le laisser vivre ferait sonner le téléphone d'en face pendant qu'on parle, et
 * le destinataire décrocherait sur quelqu'un en train de dicter. L'ÉCRAN, lui,
 * reste — c'est là-dedans qu'on écoute puis qu'on répond.
 */

type Etape = "accueil" | "enregistre" | "envoie" | "fini"

/**
 * Durée maximale d'un message laissé.
 *
 * La vidéo est deux fois plus courte que la voix, et ce n'est pas une limite
 * d'usage mais de poids : une minute de vidéo pèse déjà plusieurs mégaoctets,
 * payés par celui qui la dépose comme par celui qui la regarde.
 */
const MESSAGE_MAX_MS = 120_000
const VIDEO_MAX_MS = 60_000

/** Hauteurs de l'onde décorative, en pourcentage. Fixes : une onde qui réagit
 *  vraiment au son demanderait une analyse audio pour un gain nul. */
const ONDE = [34, 66, 100, 44, 80, 30, 72, 26, 58, 92, 38, 64, 24, 76, 42]

export function RepondeurAppel({
  callId,
  accueilUrl,
  nom,
  video,
  onFermer,
}: {
  callId: string
  accueilUrl: string
  /** Qui l'on vient d'appeler — la feuille porte son nom. */
  nom: string
  /**
   * L'appel était-il en vidéo ?
   *
   * ⚠️ ON LAISSE ALORS UNE VIDÉO, et non un vocal. On avait appelé en vidéo :
   * répondre par la voix seule perdrait ce qu'on voulait montrer.
   */
  video: boolean
  onFermer: () => void
}) {
  const { t } = useTranslation()
  const { error } = useToast()

  const [etape, setEtape] = useState<Etape>("accueil")
  const [secondes, setSecondes] = useState(0)
  /**
   * L'accueil a-t-il pu se jouer ?
   *
   * 🔴 DEUX ÉCHECS DIFFÉRENTS, ET UN SEUL A UN REMÈDE.
   *
   * `bloquee` : le navigateur refuse de jouer sans geste — c'est la règle sur
   * mobile, et le son EST là. Un bouton suffit à le débloquer, et il ne paraît
   * que dans ce cas : quand la lecture démarre seule, on ne propose rien, on
   * écoute.
   *
   * `cassee` : le fichier lui-même ne se charge pas. Aucun bouton n'y changera
   * quoi que ce soit, et en proposer un serait mentir.
   */
  const [lecture, setLecture] = useState<"ok" | "bloquee" | "cassee">("ok")

  const audio = useRef<HTMLAudioElement | null>(null)
  const enregistreur = useRef<MediaRecorder | null>(null)
  const morceaux = useRef<Blob[]>([])
  const flux = useRef<MediaStream | null>(null)
  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null)
  const apercu = useRef<HTMLVideoElement | null>(null)
  /** Durée retenue à l'arrêt : `secondes` est figé dans la fermeture du `onstop`. */
  const dureeFinale = useRef(0)

  const maxMs = video ? VIDEO_MAX_MS : MESSAGE_MAX_MS

  /**
   * Coupe micro et caméra, pour de bon.
   *
   * 🔴 SANS `stop()` SUR CHAQUE PISTE, LE VOYANT RESTE ALLUMÉ après avoir quitté
   * l'écran : le navigateur garde l'accès tant qu'une piste vit, même
   * l'enregistreur arrêté. En vidéo, c'est la caméra qui resterait ouverte.
   */
  const couperCapture = useCallback(() => {
    if (minuteur.current) {
      clearInterval(minuteur.current)
      minuteur.current = null
    }
    flux.current?.getTracks().forEach((piste) => piste.stop())
    flux.current = null
  }, [])

  // Quitter l'écran ne doit laisser ni caméra ouverte ni accueil qui continue.
  useEffect(
    () => () => {
      couperCapture()
      audio.current?.pause()
    },
    [couperCapture],
  )

  /*
   * L'accueil se joue TOUT SEUL, comme sur un vrai répondeur. On ne propose pas
   * de l'écouter : on propose d'enregistrer un message.
   */
  useEffect(() => {
    const son = new Audio(accueilUrl)
    son.preload = "auto"
    audio.current = son
    son.play().then(
      () => setLecture("ok"),
      // Refus du navigateur : le son est là, il manque un geste.
      () => setLecture((etat) => (etat === "cassee" ? etat : "bloquee")),
    )
    // Fichier illisible — format refusé, jeton périmé : aucun geste n'y peut
    // rien, et cet état l'emporte sur le précédent.
    const surErreur = () => setLecture("cassee")
    son.addEventListener("error", surErreur)
    return () => {
      son.removeEventListener("error", surErreur)
      son.pause()
    }
  }, [accueilUrl])

  /** Relance la lecture depuis un vrai clic — le seul remède au refus. */
  const ecouter = () => {
    audio.current?.play().then(
      () => setLecture("ok"),
      () => setLecture("cassee"),
    )
  }

  const arreter = useCallback(() => {
    if (minuteur.current) {
      clearInterval(minuteur.current)
      minuteur.current = null
    }
    try {
      enregistreur.current?.stop()
    } catch {
      /* déjà arrêté */
    }
  }, [])

  const envoyer = async (mime: string) => {
    setEtape("envoie")
    const blob = new Blob(morceaux.current, { type: mime })
    couperCapture()
    // Un enregistrement vide — micro coupé, geste trop court — n'a rien à
    // déposer : on ferme plutôt que de livrer un silence.
    if (blob.size === 0) {
      onFermer()
      return
    }
    try {
      await deposerMessagerie(callId, blob, dureeFinale.current * 1000, video)
      setEtape("fini")
      // Pas de notification : la feuille affiche « Message déposé » puis se
      // ferme. Un bandeau par-dessus pour redire la même chose n'ajoutait rien.
      window.setTimeout(onFermer, 1200)
    } catch {
      error(t("rep_depot_echec"))
      onFermer()
    }
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
      const media = await navigator.mediaDevices.getUserMedia(
        video ? { audio: true, video: { facingMode: "user" } } : { audio: true },
      )
      flux.current = media
      morceaux.current = []
      const rec = new MediaRecorder(media)
      rec.ondataavailable = (evenement) => {
        if (evenement.data.size > 0) morceaux.current.push(evenement.data)
      }
      rec.onstop = () => void envoyer(rec.mimeType || (video ? "video/webm" : "audio/webm"))
      rec.start()
      enregistreur.current = rec
      setSecondes(0)
      dureeFinale.current = 0
      setEtape("enregistre")

      /*
       * ⚠️ LE COMPTE VIT DANS UNE RÉFÉRENCE, pas dans le calculateur d'état.
       * Appeler `arreter()` depuis un `setSecondes(valeur => …)` y glisserait un
       * effet de bord : React peut rejouer ces calculateurs, et la coupe
       * partirait alors deux fois.
       *
       * ⚠️ ET LA COUPE EST DANS LE MINUTEUR, pas dans un contrôle à l'envoi :
       * refuser après coup ferait perdre le message entier, au moment précis où
       * l'on croit avoir fini.
       */
      minuteur.current = setInterval(() => {
        dureeFinale.current += 1
        setSecondes(dureeFinale.current)
        if (dureeFinale.current * 1000 >= maxMs) arreter()
      }, 1000)
    } catch {
      error(t(video ? "rep_camera_refusee" : "rep_micro_refuse"))
    }
  }

  // L'image de soi n'apparaît qu'une fois l'enregistrement lancé : le flux
  // n'existe pas avant, et le brancher plus tôt donnerait un cadre noir.
  useEffect(() => {
    const el = apercu.current
    if (!el || !flux.current) return
    el.srcObject = flux.current
    void el.play().catch(() => undefined)
  }, [etape])

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
  const initiales = nom.trim().slice(0, 2).toUpperCase() || "?"

  const etat =
    etape === "accueil"
      ? lecture === "cassee"
        ? t("rep_lecture_impossible")
        : lecture === "bloquee"
          ? t("rep_accueil_attente")
          : t("rep_lecture_accueil")
      : etape === "enregistre"
        ? `${mmss(secondes)} / ${mmss(Math.floor(maxMs / 1000))}`
        : etape === "envoie"
          ? t("rep_envoi")
          : t("rep_depose")

  return (
    <div className="rep-feuille" role="dialog" aria-label={t("rep_barre_titre", { nom })}>
      <div className="rep-tete">
        <span className="rep-pastille" aria-hidden>
          {initiales}
        </span>
        <div className="rep-tete-texte">
          {/* QUI, avant QUOI : l'écran d'appel est revenu pour cela, mais le nom
              se répète ici parce que c'est la feuille qu'on regarde. */}
          <div className="rep-titre">{t("rep_barre_titre", { nom })}</div>
          <div className={`rep-etat${etape === "enregistre" ? " tnum" : ""}`}>
            {etape === "enregistre" && <span className="rep-point" aria-hidden />}
            {etat}
          </div>
        </div>
      </div>

      {/* L'onde pendant que l'accueil passe : elle dit qu'il se passe quelque
          chose, là où une ligne de texte seule laisse croire à un blocage. */}
      {etape === "accueil" && lecture === "ok" && (
        <div className="rep-onde" aria-hidden>
          {ONDE.map((h, i) => (
            <i key={i} style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }} />
          ))}
        </div>
      )}

      {/* Sa propre image pendant qu'on enregistre une vidéo : sans elle, on
          parle sans savoir si l'on est dans le cadre. */}
      {video && etape === "enregistre" && (
        <video ref={apercu} className="rep-apercu" muted playsInline />
      )}

      {etape === "accueil" && (
        <div className="rep-actions">
          <button className="rep-btn-p" onClick={() => void enregistrer()}>
            ● {t(video ? "rep_enregistrer_video" : "rep_enregistrer_message")}
          </button>
          {/* Ne paraît que si le navigateur a refusé de jouer. Quand l'accueil
              démarre seul — le cas courant — ce bouton n'existe pas. */}
          {lecture === "bloquee" && (
            <button className="rep-btn-s" onClick={ecouter}>
              ▶ {t("rep_ecouter")}
            </button>
          )}
          <button className="rep-btn-s rep-btn-court" onClick={onFermer}>
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
        /* Collée au bas de l'écran d'appel, pleine largeur, OPAQUE. Elle ne
           flotte pas : elle occupe la place que les commandes viennent de
           libérer. */
        .rep-feuille {
          display: grid; gap: 12px;
          padding: 16px 14px calc(env(safe-area-inset-bottom, 0px) + 16px);
          background: var(--bg-elevated);
          border-top: 1px solid var(--border-default);
          color: var(--text-primary);
        }
        .rep-tete { display: flex; align-items: center; gap: 10px; }
        .rep-pastille {
          width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: var(--accent); color: var(--accent-text);
          font-size: 12px; font-weight: 700;
        }
        .rep-tete-texte { flex: 1; min-width: 0; }
        .rep-titre {
          font-size: 14px; font-weight: 700;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        /* ⚠️ CETTE LIGNE CHANGE DE LONGUEUR SELON LA LANGUE — « Lecture
           impossible — le fichier n'a pas pu être chargé » tient sur un mot en
           chinois et sur deux lignes en allemand. Elle passe donc à la ligne au
           lieu d'être coupée : c'est une phrase, pas une étiquette. */
        .rep-etat {
          font-size: 12px; color: var(--text-muted); margin-top: 1px;
          overflow-wrap: anywhere;
        }
        .rep-etat.tnum { font-variant-numeric: tabular-nums; }
        .rep-point {
          display: inline-block; width: 7px; height: 7px; border-radius: 50%;
          background: var(--danger); margin-right: 6px;
          animation: rep-bat 1.1s ease-in-out infinite;
        }
        @keyframes rep-bat { 50% { opacity: .25; } }

        .rep-onde { display: flex; align-items: center; gap: 3px; height: 26px; }
        .rep-onde i {
          flex: 1; border-radius: 2px; background: var(--accent); opacity: .55;
          display: block; transform-origin: center;
          animation: rep-onde 1.05s ease-in-out infinite;
        }
        @keyframes rep-onde { 50% { transform: scaleY(.42); } }

        /* Une animation sans fin peut gêner ; on la fige sans rien faire
           disparaître — l'enregistrement doit rester signalé. */
        @media (prefers-reduced-motion: reduce) {
          .rep-point, .rep-onde i { animation: none; }
        }

        .rep-apercu {
          width: 100%; max-height: 150px; border-radius: 12px;
          background: #000; object-fit: cover;
          /* Comme un miroir : on se voit du bon côté, sinon lever la main
             droite la fait partir à gauche. */
          transform: scaleX(-1);
        }

        .rep-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        /* ⚠️ LES LIBELLÉS N'ONT PAS LA MÊME LONGUEUR DANS LES NEUF LANGUES.
           « Enregistrer un message » fait 23 signes, « Nachricht aufnehmen » 19,
           « Записать сообщение » 18, « 录制留言 » 4. Les boutons s'étirent donc
           au contenu, passent à la ligne quand la rangée ne suffit plus, et
           acceptent un libellé sur deux lignes — un texte coupé au milieu d'un
           mot serait pire qu'un bouton un peu plus haut. */
        .rep-btn-p, .rep-btn-s {
          flex: 1 1 auto; min-width: 124px;
          padding: 12px 16px; border-radius: 999px; cursor: pointer;
          font-family: inherit; font-size: 14px; font-weight: 700;
          line-height: 1.25; overflow-wrap: anywhere;
        }
        .rep-btn-p { border: none; background: var(--accent); color: var(--accent-text); }
        .rep-btn-s {
          background: transparent; color: var(--text-primary);
          border: 1px solid var(--border-default); font-weight: 500;
        }
        /* « Quitter » reste court dans toutes les langues ; on lui donne une
           largeur fixe pour que le bouton principal garde la vedette. En
           dessous de 360 px, il reprend sa place et la rangée se met en
           colonne : deux boutons serrés côte à côte n'y sont plus atteignables. */
        .rep-btn-court { flex: 0 0 auto; min-width: 96px; }
        @media (max-width: 360px) {
          .rep-actions { flex-direction: column; }
          .rep-btn-p, .rep-btn-s, .rep-btn-court { flex: 1 1 auto; width: 100%; }
        }
        .rep-btn-p:focus-visible, .rep-btn-s:focus-visible {
          outline: 2px solid var(--accent); outline-offset: 2px;
        }
      `}</style>
    </div>
  )
}
