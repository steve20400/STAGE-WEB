import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "../i18n"
import { useToast } from "./toast"
import {
  ACCUEIL_MAX_MS,
  ACCUEIL_MAX_OCTETS,
  activerRepondeur,
  ajouterAccueil,
  ABSENCE_MAX_MINUTES,
  choisirAccueil,
  lireMonRepondeur,
  poserAbsence,
  refusAccueil,
  retirerAccueil,
  type Accueil,
  type EtatRepondeur,
} from "../services/repondeur-service"
import { resolveMediaUrl } from "../services/media-service"

/**
 * LE LECTEUR D'UN ACCUEIL — qui dit quand il n'a pas pu lire.
 *
 * 🐛 UNE BALISE `<audio>` ÉCHOUE EN SILENCE. Fichier introuvable, jeton périmé,
 * format refusé : dans tous les cas le contrôle reste là, inerte, et cliquer
 * « écouter » ne fait RIEN. C'est ainsi qu'une adresse de média erronée est
 * passée inaperçue — la seule chose visible était l'absence de son.
 *
 * ⚠️ `preload="metadata"` EST DÉLIBÉRÉ : l'échec se déclare à l'affichage de la
 * liste, avant même qu'on ait cliqué, au lieu d'attendre un geste pour ne rien
 * faire. Le coût est faible — quelques kilo-octets d'en-tête par accueil.
 */
function LecteurAccueil({ src }: { src: string }) {
  const { t } = useTranslation()
  const [casse, setCasse] = useState(false)

  // Une nouvelle source mérite une nouvelle chance : sans cela, un accueil
  // remplacé resterait marqué en échec à cause du précédent.
  useEffect(() => setCasse(false), [src])

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <audio
        controls
        preload="metadata"
        src={src}
        onError={() => setCasse(true)}
        style={{ width: "100%", height: 34 }}
      />
      {casse && (
        <div style={{ fontSize: 11.5, color: "var(--danger)" }}>
          {t("rep_lecture_impossible")}{" "}
          <a href={src} download style={{ color: "inherit", textDecoration: "underline" }}>
            {t("download")}
          </a>
        </div>
      )}
    </div>
  )
}

/**
 * LA SECTION « RÉPONDEUR » DES RÉGLAGES.
 *
 * Un composant à part, et non quelques lignes de plus dans `settings.tsx` : ce
 * fichier frôle déjà les quatre mille lignes, et cette section porte un
 * enregistreur complet — micro, minuteur, niveau sonore, réécoute, reprise.
 *
 * ⚠️ TROIS CHEMINS MÈNENT AU MÊME ACCUEIL : l'enregistrer, l'importer, ou n'en
 * avoir aucun. L'écran doit dire lequel est en cours sans qu'on ait à cliquer
 * pour le découvrir.
 */

/** Où l'on retient le mode choisi, faute de représentation côté serveur. */
const CLE_MODE = "repondeur_mode_duree"
/** La durée posée, rattachée à SA date de fin — sinon elle survivrait à l'absence. */
const CLE_DUREE = "repondeur_duree_posee"

/**
 * L'absence que CE navigateur a posée, si elle court encore.
 *
 * Écrite seulement APRÈS une réponse du serveur : ce n'est donc pas un souhait,
 * c'est un fait confirmé, dont on garde la trace.
 */
function absenceRetenue(): string | null {
  try {
    const brut = localStorage.getItem(CLE_DUREE)
    if (!brut) return null
    const [dateFin] = brut.split("|")
    return new Date(dateFin).getTime() > Date.now() ? dateFin : null
  } catch {
    return null
  }
}

/**
 * QUI L'EMPORTE quand le serveur et ce navigateur ne disent pas la même chose ?
 *
 * 🐛 LE BANDEAU DISPARAISSAIT EN REVENANT DANS LES RÉGLAGES. Le serveur faisait
 * foi sans condition : sa réponse écrasait ce que l'on savait, et un `null` —
 * d'où qu'il vienne — effaçait une absence pourtant en cours. On se retrouvait
 * devant les champs de durée, croyant être joignable, sans bouton pour annuler
 * quoi que ce soit.
 *
 * La règle est donc asymétrique, et c'est assumé :
 *
 *  • une DATE venue du serveur l'emporte toujours — c'est ainsi qu'une absence
 *    posée ou levée depuis un autre appareil se voit ici ;
 *  • un `null` NE FAIT PAS DISPARAÎTRE une absence que ce navigateur a posée et
 *    dont la fin est encore devant nous. Elle ne s'efface que de deux façons :
 *    on l'annule ici, ou sa date passe.
 *
 * ⚠️ LE COÛT DE SE TROMPER N'EST PAS LE MÊME DES DEUX CÔTÉS. Montrer le bandeau
 * à tort est une gêne d'un instant — le bouton pour annuler est juste dessous.
 * Le cacher à tort laisse quelqu'un se croire joignable alors que plus aucun
 * appel ne lui parvient, et sans aucun moyen de s'en rendre compte.
 */
function arbitrerAbsence(duServeur: string | null): string | null {
  if (duServeur) return duServeur
  const retenue = absenceRetenue()
  if (retenue) {
    // Un désaccord mérite d'être dit : il signale soit une absence levée
    // ailleurs — normal — soit une lecture qui ne rend pas ce qu'elle devrait.
    // Sans cette trace, les deux cas se ressemblent parfaitement.
    console.warn(
      "[repondeur] le serveur ne rend aucune absence alors que celle posée ici court jusqu'à",
      retenue,
    )
  }
  return retenue
}

/** Durée lisible : « 5 h », « 1 h 30 », « 45 min ». */
function dureeLisible(minutes: number, hLabel: string, minLabel: string): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} ${minLabel}`
  if (m === 0) return `${h} ${hLabel}`
  return `${h} ${hLabel} ${m} ${minLabel}`
}

type Phase =
  | { nom: "repos" }
  | { nom: "enregistre"; depuis: number }
  | { nom: "relit"; blob: Blob; dureeMs: number }

export function RepondeurReglages() {
  const { t } = useTranslation()
  const { success, error } = useToast()

  const [actif, setActif] = useState(false)
  const [accueils, setAccueils] = useState<Accueil[]>([])
  /**
   * Fin du mode absence, ou `null`.
   *
   * ⚠️ LE SERVEUR NE LA REND QUE SI ELLE EST ENCORE DEVANT NOUS. Il n'y a donc
   * aucune comparaison à refaire ici : une valeur présente veut dire « en
   * absence », point.
   */
  const [jusquA, setJusquA] = useState<string | null>(() => {
    /*
     * 🐛 LE BANDEAU DISPARAISSAIT EN REVENANT SUR L'ÉCRAN.
     *
     * Il n'existait qu'une fois la réponse du serveur arrivée. Entre le montage
     * et cette réponse — et pour toujours si elle n'arrive pas — l'écran
     * affichait les champs de durée, comme si AUCUNE absence ne courait. On
     * croyait donc être joignable alors que plus aucun appel n'arrivait, et le
     * bouton pour annuler n'était nulle part.
     *
     * On repart donc de ce qu'on sait déjà, et le serveur corrige ensuite s'il
     * n'est pas d'accord. C'est la même règle que le reste de l'application :
     * on montre ce qu'on a, puis on se met à jour.
     */
    return absenceRetenue()
  })
  /**
   * Le mode « avec durée » est-il choisi ?
   *
   * ⚠️ DISTINCT DE `jusquA`, ET IL LE FAUT : on choisit le mode AVANT de dire
   * combien de temps. Les confondre rendrait les champs de durée invisibles
   * jusqu'à ce qu'une absence coure déjà — c'est-à-dire trop tard pour la
   * saisir.
   */
  const [modeDuree, setModeDuree] = useState(() => {
    /*
     * 🐛 LE CHOIX REPARTAIT A « NE PAS DEFINIR DE TEMPS » A CHAQUE RETOUR.
     *
     * Il ne vivait que dans ce composant, qui se démonte dès qu'on quitte les
     * réglages. On revenait donc sur l'autre mode, sans rien avoir changé.
     *
     * ⚠️ DANS LE NAVIGATEUR, ET NON EN BASE — à dessein. Tant qu'aucune durée
     * n'est posée, ce choix ne change RIEN pour ceux qui appellent : c'est une
     * préférence d'affichage, pas un réglage du compte. Le serveur, lui, ne
     * connaît que l'absence elle-même, qui est bien enregistrée.
     */
    try {
      return localStorage.getItem(CLE_MODE) === "duree"
    } catch {
      return false
    }
  })

  /** Le choix suit l'écran, et le retrouve. */
  useEffect(() => {
    try {
      localStorage.setItem(CLE_MODE, modeDuree ? "duree" : "sans")
    } catch {
      // Stockage refusé (navigation privée) : le choix ne survivra pas, et
      // c'est tout. Rien d'autre n'en dépend.
    }
  }, [modeDuree])
  /** Durée choisie, libre, de 1 minute à 24 heures. */
  const [heures, setHeures] = useState("1")
  const [minutes, setMinutes] = useState("0")
  /** Nom donné au prochain accueil — « Congés », « Bureau ». */
  const [libelle, setLibelle] = useState("")
  const [phase, setPhase] = useState<Phase>({ nom: "repos" })
  const [secondes, setSecondes] = useState(0)
  const [occupe, setOccupe] = useState(false)

  const enregistreur = useRef<MediaRecorder | null>(null)
  const morceaux = useRef<Blob[]>([])
  const flux = useRef<MediaStream | null>(null)
  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null)
  const champFichier = useRef<HTMLInputElement>(null)
  const apercuUrl = useRef<string | null>(null)
  /**
   * 🐛 LA DUREE ETAIT TOUJOURS ZERO. `rec.onstop` est defini au demarrage de
   * l'enregistrement : sa fermeture y fige `secondes` a la valeur du moment,
   * c'est-a-dire 0. Toute duree enregistree partait donc a zero. Une reference
   * echappe a ce figement.
   */
  const dureeFinale = useRef(0)

  /**
   * Relit l'état du répondeur depuis le serveur.
   *
   * 🐛 L'ÉCHEC ÉTAIT AVALÉ — `.catch(() => undefined)` — et c'est exactement ce
   * qui fait croire que « les réglages ne se sauvegardent pas ». Une lecture
   * qui échoue laisse l'écran sur ses valeurs de départ : répondeur éteint,
   * aucune absence, aucun accueil. On voit donc une remise à zéro là où il n'y
   * a qu'une réponse qui n'est pas arrivée, et rien ne permet de faire la
   * différence.
   */
  const relire = useCallback(() => {
    void lireMonRepondeur()
      .then(appliquerEtat)
      .catch(() => error(t("rep_echec")))
    // `error` et `t` sont stables ; les lister ferait relire à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    relire()
    /*
     * ⚠️ ET ON RELIT EN REVENANT SUR L'ONGLET. Une absence se périme toute
     * seule : posée pour une heure, elle est finie quand on revient, et l'écran
     * continuerait d'annoncer « actif jusqu'à 15 h 30 » une heure après. Rien
     * ne le corrigerait, puisque rien ne se passe côté client quand une date
     * est dépassée.
     */
    const surRetour = () => {
      if (document.visibilityState === "visible") relire()
    }
    document.addEventListener("visibilitychange", surRetour)
    return () => document.removeEventListener("visibilitychange", surRetour)
  }, [relire])

  /**
   * Coupe tout : minuteur, enregistreur, et SURTOUT le micro.
   *
   * 🔴 SANS `stop()` SUR CHAQUE PISTE, LE VOYANT DU MICRO RESTE ALLUMÉ. Le
   * navigateur garde l'accès ouvert tant qu'une piste vit, même l'enregistreur
   * arrêté : l'utilisateur voit son micro actif sur une page de réglages, ce qui
   * est au mieux inquiétant.
   */
  const toutArreter = useCallback(() => {
    if (minuteur.current) {
      clearInterval(minuteur.current)
      minuteur.current = null
    }
    try {
      enregistreur.current?.stop()
    } catch {
      /* déjà arrêté */
    }
    enregistreur.current = null
    flux.current?.getTracks().forEach((piste) => piste.stop())
    flux.current = null
  }, [])

  // Quitter la page pendant un enregistrement ne doit pas laisser le micro
  // ouvert derrière soi.
  useEffect(() => toutArreter, [toutArreter])

  useEffect(() => {
    return () => {
      if (apercuUrl.current) URL.revokeObjectURL(apercuUrl.current)
    }
  }, [])

  const demarrer = async () => {
    if (occupe) return
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      flux.current = media
      morceaux.current = []
      const rec = new MediaRecorder(media)
      rec.ondataavailable = (evenement) => {
        if (evenement.data.size > 0) morceaux.current.push(evenement.data)
      }
      rec.onstop = () => {
        const blob = new Blob(morceaux.current, { type: rec.mimeType || "audio/webm" })
        const duree = Math.min(dureeFinale.current * 1000, ACCUEIL_MAX_MS)
        if (apercuUrl.current) URL.revokeObjectURL(apercuUrl.current)
        apercuUrl.current = URL.createObjectURL(blob)
        setPhase({ nom: "relit", blob, dureeMs: duree })
      }
      rec.start()
      enregistreur.current = rec
      setSecondes(0)
      dureeFinale.current = 0
      setPhase({ nom: "enregistre", depuis: Date.now() })

      /*
       * ⚠️ LA COUPE AUTOMATIQUE EST DANS LE MINUTEUR, pas dans un contrôle à
       * l'envoi. Laisser enregistrer dix minutes pour refuser ensuite ferait
       * perdre dix minutes de parole — et le refus arriverait au pire moment,
       * quand on croit avoir fini.
       *
       * ⚠️ LE COMPTE VIT DANS UNE REFERENCE, pas dans le calculateur d'etat.
       * Appeler `arreter()` depuis un `setSecondes(valeur => …)` y glissait un
       * effet de bord : React peut rejouer ces calculateurs, et l'arrêt serait
       * alors déclenché deux fois.
       */
      minuteur.current = setInterval(() => {
        dureeFinale.current += 1
        setSecondes(dureeFinale.current)
        if (dureeFinale.current * 1000 >= ACCUEIL_MAX_MS) arreter()
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
    flux.current?.getTracks().forEach((piste) => piste.stop())
    flux.current = null
  }

  const valider = async () => {
    if (phase.nom !== "relit" || occupe) return
    setOccupe(true)
    try {
      const etat = await ajouterAccueil(
        phase.blob,
        `accueil-${Date.now()}.webm`,
        libelle.trim() || null,
        phase.dureeMs,
      )
      appliquerEtat(etat)
      setPhase({ nom: "repos" })
      setSecondes(0)
      setLibelle("")
      success(t("rep_enregistre"))
    } catch {
      error(t("rep_echec"))
    } finally {
      setOccupe(false)
    }
  }

  const importer = async (fichier: File | undefined) => {
    if (!fichier || occupe) return
    const refus = refusAccueil(fichier)
    if (refus === "format") {
      error(t("rep_mauvais_format"))
    } else if (refus === "taille") {
      error(t("rep_trop_lourd", { n: String(ACCUEIL_MAX_OCTETS / 1024 / 1024) }))
    }
    if (refus) {
      if (champFichier.current) champFichier.current.value = ""
      return
    }
    setOccupe(true)
    try {
      const etat = await ajouterAccueil(fichier, fichier.name, libelle.trim() || null)
      appliquerEtat(etat)
      setLibelle("")
      success(t("rep_enregistre"))
    } catch {
      error(t("rep_echec"))
    } finally {
      setOccupe(false)
      // Sans remise à zéro, réimporter le MÊME fichier n'émet aucun événement.
      if (champFichier.current) champFichier.current.value = ""
    }
  }

  const supprimer = async (id: string) => {
    if (occupe) return
    setOccupe(true)
    try {
      const etat = await retirerAccueil(id)
      appliquerEtat(etat)
    } catch {
      error(t("rep_echec"))
    } finally {
      setOccupe(false)
    }
  }

  /**
   * Range un état complet venu du serveur.
   *
   * 🔴 IL Y AVAIT SIX ENDROITS QUI LE FAISAIENT À LA MAIN, et le jour où un
   * champ s'ajoute — celui-ci, justement — il en manque toujours un. L'écran
   * affichait alors une absence levée comme si elle courait encore.
   */
  const appliquerEtat = (etat: EtatRepondeur) => {
    setActif(etat.actif)
    setAccueils(etat.accueils)
    setJusquA(arbitrerAbsence(etat.jusquA))
    // ⚠️ UNE ABSENCE EN COURS IMPOSE SON MODE : afficher « ne pas définir de
    // temps » pendant qu'une absence court dirait exactement le contraire de ce
    // que vivent ceux qui appellent.
    if (etat.jusquA || absenceRetenue()) setModeDuree(true)
  }

  /** Durée saisie, ramenée aux bornes du serveur. Rend 0 si elle est vide. */
  const dureeMinutes = () => {
    const h = Math.max(0, Math.min(24, Number(heures) || 0))
    const m = Math.max(0, Math.min(59, Number(minutes) || 0))
    return Math.min(h * 60 + m, ABSENCE_MAX_MINUTES)
  }

  const changerAbsence = async (minutesDemandees: number) => {
    if (occupe) return
    setOccupe(true)
    try {
      /*
       * ⚠️ LA TRACE S'EFFACE AVANT L'APPEL, pas après. `arbitrerAbsence` fait
       * survivre une absence retenue localement à un `null` du serveur : la
       * laisser en place le temps de la requête ferait ressusciter, à la
       * réponse, l'absence que l'on vient justement d'annuler.
       */
      if (minutesDemandees === 0) {
        try {
          localStorage.removeItem(CLE_DUREE)
        } catch {
          /* sans stockage, il n'y avait rien à effacer */
        }
      }
      const suite = await poserAbsence(minutesDemandees)
      // La durée choisie n'existe nulle part côté serveur — il ne range qu'une
      // DATE DE FIN, et c'est le bon choix. On la garde ici pour pouvoir
      // réafficher « activé pour 5 h » plutôt que le seul horaire de fin.
      try {
        if (minutesDemandees > 0 && suite.jusquA) {
          localStorage.setItem(CLE_DUREE, `${suite.jusquA}|${minutesDemandees}`)
        }
      } catch {
        /* sans stockage, on retombe sur « il reste … » */
      }
      appliquerEtat(suite)
      // Lever une absence ramène au mode par défaut : laisser les champs
      // ouverts laisserait croire qu'une durée est encore en train d'être posée.
      if (minutesDemandees === 0) setModeDuree(false)
      if (minutesDemandees > 0) success(t("rep_abs_pose"))
    } catch {
      error(t("rep_echec"))
    } finally {
      setOccupe(false)
    }
  }

  /** « 14 h 30 » — une heure de fin se vérifie sur une horloge, pas un décompte. */
  const heureFin = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })

  /** La durée posée pour CETTE absence, si on la connaît encore. */
  const dureePosee = (iso: string): string | null => {
    try {
      const brut = localStorage.getItem(CLE_DUREE)
      if (!brut) return null
      const [dateFin, minutesTexte] = brut.split("|")
      // ⚠️ RATTACHÉE À SA DATE DE FIN : sans cette comparaison, la durée d'une
      // absence terminée se réafficherait sur la suivante.
      if (dateFin !== iso) return null
      return dureeLisible(Number(minutesTexte) || 0, t("rep_abs_h"), t("rep_abs_min"))
    } catch {
      return null
    }
  }

  /** Ce qu'il reste à courir, recalculé à chaque rendu. */
  const restant = (iso: string): string => {
    const minutes = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000))
    return dureeLisible(minutes, t("rep_abs_h"), t("rep_abs_min"))
  }

  const basculer = async (valeur: boolean) => {
    // L'interrupteur bascule sous le doigt ; le serveur corrige s'il refuse.
    setActif(valeur)
    try {
      const etat = await activerRepondeur(valeur)
      appliquerEtat(etat)
    } catch {
      setActif(!valeur)
      error(t("rep_echec"))
    }
  }

  const choisir = async (id: string) => {
    if (occupe) return
    setOccupe(true)
    try {
      const etat = await choisirAccueil(id)
      appliquerEtat(etat)
    } catch {
      error(t("rep_echec"))
    } finally {
      setOccupe(false)
    }
  }

  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

  return (
    <div className="s-card">
      {/* Les styles vivent ici plutot que dans une feuille globale : cette
          section est la seule a s'en servir, et `settings.tsx` porte deja les
          siens de la meme facon. Calques sur `ringtone-import-btn`, pour que les
          deux cartes voisines ne paraissent pas venir de deux applications. */}
      <style>{`
        .rep-btn {
          padding: 10px 16px; border-radius: 9px; cursor: pointer;
          border: 1px solid var(--accent); background: var(--accent);
          color: var(--accent-text); font-family: 'DM Sans', sans-serif;
          font-size: 12.5px; font-weight: 600;
        }
        .rep-btn:disabled { cursor: progress; opacity: 0.6; }
        .rep-nom {
          width: 100%; padding: 9px 12px; border-radius: 9px;
          border: 1px solid var(--border-subtle); background: var(--bg-surface);
          color: var(--text-primary); font-family: 'DM Sans', sans-serif;
          font-size: 12.5px; outline: none;
        }
        .rep-btn-ghost {
          border: 1px dashed var(--border-default); background: var(--bg-elevated);
          color: var(--text-secondary);
        }
        .rep-btn-ghost:hover:not(:disabled) {
          color: var(--accent); border-color: var(--accent-border);
        }
        .rep-bascule {
          display: flex; align-items: center; justify-content: space-between;
          gap: 14px; width: 100%; padding: 16px 18px; border-radius: 14px;
          margin-bottom: 16px; cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-size: 14.5px; font-weight: 600;
          text-align: left; border: 1.5px solid var(--border-subtle);
          background: var(--bg-elevated); color: var(--text-primary);
          transition: background .15s, border-color .15s, color .15s;
        }
        .rep-bascule.on {
          border-color: var(--accent); background: var(--accent); color: var(--accent-text);
        }
        .rep-bascule:disabled { cursor: not-allowed; opacity: .55; }
        .rep-bascule-texte { flex: 1; min-width: 0; }
        .rep-bascule-sous {
          display: block; margin-top: 2px;
          font-size: 12px; font-weight: 400; opacity: .8;
        }
        .rep-bascule-piste {
          position: relative; flex-shrink: 0;
          width: 52px; height: 30px; border-radius: 999px;
          background: var(--border-default); transition: background .15s;
        }
        .rep-bascule.on .rep-bascule-piste { background: rgba(255,255,255,.35); }
        .rep-bascule-bouton {
          position: absolute; top: 3px; left: 3px;
          width: 24px; height: 24px; border-radius: 50%;
          background: var(--text-muted); transition: left .15s, background .15s;
        }
        .rep-bascule.on .rep-bascule-bouton { left: 25px; background: var(--accent-text); }

        /* Les deux modes : deux cartes de même poids. Une case à cocher aurait
           caché qu'il s'agit d'un choix entre deux comportements entiers. */
        .rep-modes { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; }
        .rep-mode {
          display: grid; gap: 3px; text-align: left; cursor: pointer;
          padding: 11px 13px; border-radius: 11px;
          font-family: 'DM Sans', sans-serif;
          border: 1.5px solid var(--border-subtle); background: var(--bg-surface);
          color: var(--text-primary);
        }
        .rep-mode.choisi { border-color: var(--accent); background: var(--accent-dim); }
        .rep-mode:disabled { cursor: progress; opacity: .6; }
        .rep-mode-n { font-size: 13px; font-weight: 700; }
        .rep-mode-d { font-size: 11.5px; color: var(--text-muted); line-height: 1.35; }
        /* Au pouce, deux cartes cote a cote deviennent illisibles : elles
           passent l'une sous l'autre plutot que de se serrer. */
        @media (max-width: 480px) {
          .rep-modes { grid-template-columns: 1fr; }
        }

        .rep-abs {
          margin-bottom: 16px; padding: 13px 14px; border-radius: 12px;
          border: 1px solid var(--border-subtle); background: var(--bg-elevated);
        }
        .rep-abs-titre { font-size: 13.5px; font-weight: 700; color: var(--text-primary); }
        .rep-abs-sub { font-size: 12px; color: var(--text-muted); margin: 2px 0 11px; }
        .rep-abs-duree {
          font-size: 11px; font-weight: 700; letter-spacing: .06em;
          text-transform: uppercase; color: var(--text-muted); margin-bottom: 7px;
        }
        .rep-abs-champs { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .rep-abs-champ {
          display: flex; align-items: center; gap: 5px;
          padding: 6px 11px; border-radius: 9px;
          border: 1px solid var(--border-subtle); background: var(--bg-surface);
        }
        .rep-abs-champ input {
          width: 46px; border: none; background: transparent; outline: none;
          color: var(--text-primary); font-family: 'DM Sans', sans-serif;
          font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums;
        }
        .rep-abs-champ span { font-size: 12px; color: var(--text-muted); }
        .rep-abs-bornes { font-size: 11.5px; color: var(--text-muted); margin-top: 8px; }
        /* Le bandeau se détache de ce qui le précède : collé aux deux cartes de
           mode, on lisait une seule masse et l'on ne voyait plus ce qui était
           l'état en cours et ce qui était le choix. */
        .rep-abs-actif { margin-top: 14px; }
        .rep-abs-bandeau {
          display: grid; gap: 12px;
          padding: 14px; border-radius: 12px;
          border: 1.5px solid var(--accent); background: var(--accent-dim);
        }
        .rep-abs-ligne { display: flex; align-items: flex-start; gap: 10px; }
        .rep-abs-bandeau .rep-abs-pt { margin-top: 6px; }
        .rep-abs-retour {
          font-size: 11.5px; color: var(--text-muted); text-align: center;
        }
        /* Le bouton d'annulation est PLEIN et pleine largeur : c'est la sortie
           d'un etat qui rend injoignable, pas une option parmi d'autres. */
        .rep-abs-annuler {
          width: 100%; padding: 12px 16px; border-radius: 10px; cursor: pointer;
          border: none; background: var(--danger); color: #fff;
          font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 700;
        }
        .rep-abs-annuler:disabled { cursor: progress; opacity: .6; }
        .rep-abs-annuler:focus-visible { outline: 2px solid var(--danger); outline-offset: 2px; }
        .rep-abs-pt {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
          background: var(--accent);
        }
        .rep-abs-txt { flex: 1; min-width: 140px; font-size: 13px; color: var(--text-primary); }
        .rep-abs-txt span { display: block; font-size: 11.5px; color: var(--text-muted); margin-top: 1px; }
        /* Sur un telephone, les boutons prennent la ligne entiere plutot que de
           se serrer a deux ou trois par rangee, ou aucun n'est atteignable au
           pouce. */
        @media (max-width: 520px) {
          .rep-btn { flex: 1 1 100%; }
        }
      `}</style>
      <div className="s-card-title">{t("rep_titre")}</div>
      <div className="s-hint" style={{ marginTop: 0, marginBottom: 14 }}>
        {t("rep_sub")}
      </div>

      {/*
        🔴 C'ÉTAIT UN INTERRUPTEUR MINUSCULE dans une rangée, et l'on ne savait
        ni ce qu'il allumait ni ce qu'il changeait. C'est le même bouton que
        celui de la traduction — pleine largeur, avec l'état écrit en toutes
        lettres sous son titre.
      */}
      <button
        className={`rep-bascule ${actif ? "on" : ""}`}
        role="switch"
        aria-checked={actif}
        // ⚠️ INACTIVABLE SANS ACCUEIL : allumer un répondeur muet promettrait à
        // ses correspondants un message qu'ils n'entendraient jamais.
        disabled={accueils.length === 0}
        onClick={() => void basculer(!actif)}
      >
        <span className="rep-bascule-texte">
          {t("rep_activer")}
          <span className="rep-bascule-sous">
            {actif ? t("rep_actif_sous") : t("rep_eteint_sous")}
          </span>
        </span>
        <span className="rep-bascule-piste" aria-hidden>
          <span className="rep-bascule-bouton" />
        </span>
      </button>

      {/* ── L'absence ────────────────────────────────────────────────────
          Ne paraît que si le répondeur est allumé : proposer de s'absenter
          quand personne ne répondrait à votre place n'a pas de sens. */}
      {actif && (
        <div className="rep-abs">
          <div className="rep-abs-titre" style={{ marginBottom: 10 }}>
            {t("rep_mode_titre")}
          </div>
          {/*
            🔴 LES DEUX MODES SE CHOISISSENT, ils ne se déduisent plus.
            La version précédente laissait deviner : un temps saisi valait mode
            absence, un champ vide valait mode par défaut. On ne voyait donc
            nulle part qu'il existait DEUX façons de répondre, ni laquelle était
            en cours. Chacune porte maintenant son nom et ce qu'elle fait.
          */}
          <div className="rep-modes">
            <button
              className={`rep-mode ${!jusquA && !modeDuree ? "choisi" : ""}`}
              disabled={occupe}
              // Revenir ici lève l'absence si elle courait ; sinon il n'y a que
              // le choix à défaire, et rien à demander au serveur.
              onClick={() => (jusquA ? void changerAbsence(0) : setModeDuree(false))}
            >
              <span className="rep-mode-n">{t("rep_mode_sans")}</span>
              <span className="rep-mode-d">{t("rep_mode_sans_d")}</span>
            </button>
            <button
              className={`rep-mode ${jusquA || modeDuree ? "choisi" : ""}`}
              disabled={occupe}
              // Choisir ce mode ne pose pas l'absence : il faut encore dire
              // COMBIEN DE TEMPS, et c'est le bouton d'à côté qui l'engage.
              onClick={() => setModeDuree(true)}
            >
              <span className="rep-mode-n">{t("rep_mode_avec")}</span>
              <span className="rep-mode-d">{t("rep_mode_avec_d")}</span>
            </button>
          </div>

          {jusquA ? (
            <div className="rep-abs-actif">
              {/*
                🔴 CE QUI A ÉTÉ RÉSERVÉ, ET LE GESTE POUR L'ANNULER — ENSEMBLE.

                Une absence rend injoignable : ne pas la retrouver en revenant,
                c'est se croire joignable alors que plus aucun appel n'arrive.
                Elle se lit donc en entier — la durée posée, l'heure de fin, ce
                qu'il reste — et le bouton qui l'annule vit DANS le même cadre.
                Séparés, on lisait deux blocs sans rapport, et rien ne disait que
                ce bouton-là annulait cette absence-là.
              */}
              <div className="rep-abs-bandeau">
                <div className="rep-abs-ligne">
                  <span className="rep-abs-pt" aria-hidden />
                  <span className="rep-abs-txt">
                    <b>
                      {dureePosee(jusquA)
                        ? t("rep_abs_pour", { d: dureePosee(jusquA) as string })
                        : t("rep_abs_jusqua", { h: heureFin(jusquA) })}
                    </b>
                    <span>
                      {t("rep_abs_reste", { h: heureFin(jusquA), r: restant(jusquA) })}
                    </span>
                    <span>{t("rep_abs_avert")}</span>
                  </span>
                </div>
                <button
                  className="rep-abs-annuler"
                  disabled={occupe}
                  onClick={() => void changerAbsence(0)}
                >
                  {t("rep_abs_annuler")}
                </button>
                <div className="rep-abs-retour">{t("rep_abs_retour")}</div>
              </div>
            </div>
          ) : modeDuree ? (
            <>
              <div className="rep-abs-sub" style={{ marginTop: 12, marginBottom: 8 }}>
                {t("rep_abs_sub")}
              </div>
              <div className="rep-abs-duree">{t("rep_abs_duree")}</div>
              <div className="rep-abs-champs">
                {/* Deux champs plutôt qu'une liste de durées toutes faites :
                    « une heure quarante » ne se choisit dans aucune liste, et
                    c'est pourtant une vraie durée de réunion. */}
                <label className="rep-abs-champ">
                  <input
                    id="rep-abs-h"
                    type="number"
                    min={0}
                    max={24}
                    inputMode="numeric"
                    value={heures}
                    onChange={(e) => setHeures(e.target.value)}
                  />
                  <span>{t("rep_abs_h")}</span>
                </label>
                <label className="rep-abs-champ">
                  <input
                    id="rep-abs-min"
                    type="number"
                    min={0}
                    max={59}
                    inputMode="numeric"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                  />
                  <span>{t("rep_abs_min")}</span>
                </label>
                <button
                  className="rep-btn"
                  // Une durée nulle n'est pas une absence : le bouton reste
                  // inerte plutôt que d'envoyer un ordre qui ne fait rien.
                  disabled={occupe || dureeMinutes() === 0}
                  onClick={() => void changerAbsence(dureeMinutes())}
                >
                  {t("rep_abs_poser")}
                </button>
              </div>
              <div className="rep-abs-bornes">{t("rep_abs_bornes")}</div>
            </>
          ) : null}
        </div>
      )}

      {/* ── L'accueil en place ───────────────────────────────────────────── */}
      {phase.nom === "repos" && (
        <div style={{ display: "grid", gap: 10 }}>
          {/* ══════════ LA BIBLIOTHEQUE D'ACCUEILS ══════════
              🔴 UNE LISTE, ET NON UN SEUL. On garde plusieurs messages —
              conges, bureau, week-end — et l'on choisit selon le moment. Un
              bouton « Supprimer » seul, sans voir CE QU'ON supprime, obligeait
              a se souvenir de ce qu'on avait enregistre.

              ⚠️ CHAQUE LIGNE EST ECOUTABLE. Choisir entre cinq accueils sans
              pouvoir les entendre revient a choisir au hasard. */}
          {accueils.length > 0 ? (
            <>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  letterSpacing: 0.2,
                }}
              >
                {t("rep_mes_accueils")}
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                {accueils.map((entree) => {
                  const estActif = entree.actif === 1
                  return (
                    <li
                      key={entree.id}
                      style={{
                        display: "grid",
                        gap: 6,
                        padding: 10,
                        borderRadius: 10,
                        // L'actif se reconnait a sa bordure : l'ecrire seulement
                        // obligerait a lire cinq lignes pour trouver laquelle.
                        border: `1px solid ${estActif ? "var(--accent)" : "var(--border-subtle)"}`,
                        background: "var(--bg-elevated)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 13,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {entree.libelle || t("rep_sans_nom")}
                        </span>
                        {estActif && (
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "var(--accent)",
                              color: "var(--accent-text)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {t("rep_actif_badge")}
                          </span>
                        )}
                      </div>
                      <LecteurAccueil src={resolveMediaUrl(entree.media.url)} />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {!estActif && (
                          <button
                            className="rep-btn rep-btn-ghost"
                            onClick={() => void choisir(entree.id)}
                            disabled={occupe}
                          >
                            {t("rep_choisir")}
                          </button>
                        )}
                        <button
                          className="rep-btn rep-btn-ghost"
                          onClick={() => void supprimer(entree.id)}
                          disabled={occupe}
                        >
                          {t("rep_supprimer")}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("rep_aucun")}</div>
          )}

          {/* Le nom du PROCHAIN accueil. Facultatif : sans lui la ligne
              s'appelle « Sans nom », ce qui reste lisible tant qu'il n'y en a
              qu'un ou deux. */}
          <input
            className="rep-nom"
            value={libelle}
            onChange={(evenement) => setLibelle(evenement.target.value)}
            placeholder={t("rep_nom_placeholder")}
            maxLength={60}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="rep-btn" onClick={() => void demarrer()} disabled={occupe}>
              ● {t("rep_enregistrer")}
            </button>
            <input
              ref={champFichier}
              type="file"
              accept="audio/*"
              hidden
              onChange={(evenement) => void importer(evenement.target.files?.[0])}
            />
            <button
              className="rep-btn rep-btn-ghost"
              onClick={() => champFichier.current?.click()}
              disabled={occupe}
            >
              {t("rep_importer")}
            </button>
          </div>
        </div>
      )}

      {/* ── En cours d'enregistrement ────────────────────────────────────── */}
      {phase.nom === "enregistre" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "var(--danger)",
              flexShrink: 0,
            }}
          />
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 15 }}>
            {mmss(secondes)}
          </span>
          {/* Le reste du temps disponible, pour qu'on sache où l'on va plutôt
              que d'être coupé sans prévenir. */}
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            / {mmss(Math.floor(ACCUEIL_MAX_MS / 1000))}
          </span>
          <button className="rep-btn" onClick={arreter}>
            ■ {t("rep_arreter")}
          </button>
        </div>
      )}

      {/* ── Réécoute avant de valider ────────────────────────────────────── */}
      {phase.nom === "relit" && (
        <div style={{ display: "grid", gap: 10 }}>
          <audio
            controls
            src={apercuUrl.current ?? undefined}
            style={{ width: "100%", height: 36 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="rep-btn" onClick={() => void valider()} disabled={occupe}>
              {t("rep_valider")}
            </button>
            <button
              className="rep-btn rep-btn-ghost"
              onClick={() => {
                setPhase({ nom: "repos" })
                setSecondes(0)
              }}
              disabled={occupe}
            >
              {t("rep_refaire")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
