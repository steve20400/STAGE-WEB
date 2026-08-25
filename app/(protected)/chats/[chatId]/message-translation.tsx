import { useEffect, useState, type MouseEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation, type Cle } from "../../../../src/i18n"
import {
  TraductionError,
  detecterLangueMessage,
  moteurLocalPresent,
  telechargerComposants,
  traduireMessage,
  type CodeErreurTraduction,
  type ResultatTraduction,
} from "../../../../src/services/traduction-service"
import { moteurSurAppareil, nomMoteur } from "../../../../src/services/traduction-fournisseurs"

/**
 * Traduction d'un message, affichee DANS la bulle sous le texte d'origine.
 *
 * Jamais une fenetre a part : l'original et sa traduction se lisent d'un seul
 * regard, et le fil ne perd pas sa place. La bulle s'agrandit, rien ne se
 * superpose.
 *
 * Le composant vit dans son propre fichier parce que `chat.tsx` frole deja les
 * six mille lignes, et il porte son propre `useTranslation` : la langue de
 * lecture est a la fois celle de ses libelles et la CIBLE de la traduction,
 * donc un changement de langue relance le travail sans qu'on ait a le cabler.
 */

/**
 * Les libelles d'erreur se relisent ici, et non depuis `TraductionError.message`
 * : ce dernier est fige a la langue du moment ou l'erreur a ete construite,
 * alors que la bulle doit suivre la langue courante.
 */
export const CLE_ERREUR: Record<CodeErreurTraduction | "inconnue", Cle> = {
  "meme-langue": "trad_err_same_language",
  "local-indisponible": "trad_err_local_unavailable",
  "moteur-indisponible": "trad_err_engine_unavailable",
  quota: "trad_err_quota",
  service: "trad_err_service",
  inconnue: "thr_trad_failed",
}

type Etat =
  | { phase: "chargement" }
  | { phase: "pret"; resultat: ResultatTraduction }
  | { phase: "erreur"; code: CodeErreurTraduction | "inconnue" }

/**
 * Emis quand une traduction AUTOMATIQUE echoue, avec `{ code }` en detail.
 *
 * Passe par un evenement plutot que par une remontee de props : la bulle est
 * enfouie sous plusieurs composants, et faire traverser un rappel a toute cette
 * pile pour un signal aussi rare coute plus cher qu'il ne rapporte.
 */
export const EVENEMENT_ECHEC_AUTO = "alanya:traduction-echec-auto"

export function MessageTranslation({
  texte,
  automatique = false,
}: {
  texte: string
  /**
   * Vrai quand le bloc s'ouvre de lui-meme, sans qu'on l'ait demande.
   *
   * Il ne change pas ce qui est traduit, seulement le poids visuel : en
   * automatique la traduction est CE QU'ON LIT, l'original n'etant plus qu'une
   * reference. Le mode a la demande garde l'equilibre inverse.
   */
  automatique?: boolean
}) {
  const { t, language } = useTranslation()
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" })
  // Un compteur plutot qu'un booleen : deux echecs de suite doivent relancer
  // l'effet, ce qu'une valeur qui ne change pas ne ferait pas.
  const [essai, setEssai] = useState(0)
  /**
   * L'appareil est-il, en lui-meme, incapable de traduire ?
   *
   * Ce n'est pas la meme chose qu'un echec : c'est une PROPRIETE de l'appareil,
   * constante pour toute la session et identique pour tous les messages. Elle ne
   * se repare pas depuis une bulle, seulement en choisissant un autre moteur
   * dans les Parametres — qui l'annoncent deja.
   */
  const appareilSansMoteur =
    etat.phase === "erreur" &&
    (etat.code === "moteur-indisponible" ||
      (etat.code === "local-indisponible" && !moteurLocalPresent()))

  useEffect(() => {
    let vivant = true
    setEtat({ phase: "chargement" })
    traduireMessage(texte, language)
      .then((resultat) => {
        if (vivant) setEtat({ phase: "pret", resultat })
      })
      .catch((erreur: unknown) => {
        if (!vivant) return
        setEtat({
          phase: "erreur",
          code: erreur instanceof TraductionError ? erreur.code : "inconnue",
        })
      })
    // Une reponse arrivee apres la fermeture du bloc ne doit rien remettre a
    // l'ecran : l'utilisateur a deja demande a revenir a l'original.
    return () => {
      vivant = false
    }
  }, [texte, language, essai])

  /**
   * En automatique, un echec ne s'ecrit PAS sous la bulle.
   *
   * L'utilisateur n'a rien demande : lui repeter sous chaque message qu'une
   * traduction n'a pas pu se faire — ou qu'elle etait inutile, le message etant
   * deja dans sa langue — remplit le fil d'une ligne grise par bulle, pour une
   * information qui est la MEME partout. Elle se dit une fois, en passant, par
   * la notification que `chat.tsx` declenche sur cet evenement.
   *
   * En manuel, au contraire, l'explication reste : quelqu'un a clique, il a
   * droit a une reponse a l'endroit ou il l'attend.
   */
  useEffect(() => {
    if (!automatique || etat.phase !== "erreur") return
    try {
      window.dispatchEvent(new CustomEvent(EVENEMENT_ECHEC_AUTO, { detail: { code: etat.code } }))
    } catch {
      // Hors navigateur : personne n'ecoute.
    }
  }, [automatique, etat])

  if (automatique && etat.phase === "erreur") return null

  return (
    // La zone vivante est le bloc entier : le passage de l'attente au resultat
    // se fait au meme endroit, et un lecteur d'ecran annonce la traduction sans
    // qu'il faille lui redonner le focus.
    <div className={`msg-trad${automatique ? " msg-trad-auto" : ""}`} aria-live="polite">
      <div className="msg-trad-sep" aria-hidden />
      {etat.phase === "chargement" && (
        <div className="msg-trad-attente">{t("thr_trad_loading")}</div>
      )}
      {etat.phase === "pret" && (
        <>
          <div className="msg-trad-texte" lang={language}>
            {etat.resultat.texte}
          </div>
          {/* L'origine de la traduction est annoncee message par message, et
              le fournisseur est NOMME : l'utilisateur doit pouvoir voir chez
              qui ce texte-la est parti, sans avoir a se souvenir du reglage en
              vigueur au moment ou la bulle a ete traduite. Le moteur vient du
              resultat, pas du reglage courant : une traduction relue depuis le
              cache reste creditee a celui qui l'a produite. */}
          <div className="msg-trad-pied">
            {moteurSurAppareil(etat.resultat.moteur)
              ? t("thr_trad_by_device")
              : t("thr_trad_by_engine", { moteur: nomMoteur(etat.resultat.moteur, language) })}
          </div>
        </>
      )}
      {/* L'APPAREIL QUI NE SAIT PAS TRADUIRE SE TAIT, ET NE LE REPETE PAS.
          
          Quand le navigateur n'a pas de moteur de traduction, l'echec est le
          MEME pour tous les messages et ne changera pas de la session. Or la
          traduction automatique demande une traduction par bulle : l'avis
          s'affichait donc sous CHACUNE, et le fil se remplissait d'une meme
          phrase repetee a l'infini, qui n'apprenait rien de plus la centieme
          fois que la premiere.
          
          Ce cas-la se dit UNE FOIS, et a l'endroit ou l'on peut y remedier :
          les Parametres l'annoncent deja dans la section des traductions, avec
          la marche a suivre. Ici, on n'affiche plus rien.
          
          Les autres echecs restent affiches : un paquet de langue a installer
          ou un moteur momentanement injoignable se REPARENT depuis la bulle, et
          les taire priverait l'utilisateur du bouton qui debloque. */}
      {etat.phase === "erreur" && !appareilSansMoteur && (
        <EchecTraduction
          code={etat.code}
          texte={texte}
          automatique={automatique}
          onReessayer={() => setEssai((n) => n + 1)}
        />
      )}
    </div>
  )
}

/**
 * Un echec n'est pas toujours une panne : le plus souvent, le moteur choisi ne
 * peut pas repondre. On explique donc, et on propose l'action qui debloque —
 * le changement de moteur se fait dans les Parametres, seul endroit ou le prix
 * et le trajet des donnees sont presentes avant le choix.
 */
function EchecTraduction({
  code,
  texte,
  automatique,
  onReessayer,
}: {
  code: CodeErreurTraduction | "inconnue"
  /** Sert a connaitre la langue de depart, donc le couple a installer. */
  texte: string
  automatique: boolean
  onReessayer: () => void
}) {
  const { t, language } = useTranslation()
  const navigate = useNavigate()
  const [progression, setProgression] = useState<number | null>(null)
  const [installEchouee, setInstallEchouee] = useState(false)
  /**
   * Langue de depart resolue AVANT tout clic.
   *
   * Chrome n'autorise l'installation que pendant l'activation transitoire qui
   * suit un geste, et cette fenetre se referme au bout de quelques secondes.
   * Detecter la langue dans le gestionnaire de clic consommerait ce delai en
   * attente asynchrone et l'installation partirait hors activation — d'ou une
   * detection faite d'avance, pour que le clic n'ait plus qu'a lancer.
   */
  const [source, setSource] = useState<string | null>(null)

  const moteurPresent = moteurLocalPresent()
  const paquetManquant = code === "local-indisponible" && moteurPresent

  useEffect(() => {
    if (!paquetManquant) return
    let vivant = true
    void detecterLangueMessage(texte)
      .then((langue) => {
        if (vivant) setSource(langue)
      })
      .catch(() => undefined)
    return () => {
      vivant = false
    }
  }, [paquetManquant, texte])

  const peutInstaller = paquetManquant && source !== null && progression === null
  // Sans moteur du navigateur, ou sans langue de depart identifiable, il n'y a
  // rien a installer : le seul recours reste le choix d'un autre moteur.
  const versParametres =
    (code === "local-indisponible" && !peutInstaller && progression === null) ||
    code === "moteur-indisponible"

  const installer = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!source) return
    setInstallEchouee(false)
    setProgression(0)
    // Appel direct, sans `await` prealable : l'activation du clic doit encore
    // etre valide au moment ou le navigateur ouvre le telechargement.
    telechargerComposants(source, language, (fraction) => setProgression(fraction))
      .then((installe) => {
        setProgression(null)
        if (installe) onReessayer()
        else setInstallEchouee(true)
      })
      .catch(() => {
        setProgression(null)
        setInstallEchouee(true)
      })
  }

  if (progression !== null) {
    return (
      <div className="msg-trad-note">
        {t("thr_trad_installing", { pct: Math.round(progression * 100) })}
      </div>
    )
  }

  return (
    <div className="msg-trad-note">
      {installEchouee ? t("thr_trad_install_failed") : t(CLE_ERREUR[code])}
      {/* En automatique on epargne la question : l'utilisateur n'a rien demande,
          lui poser un choix de moteur sous chaque bulle serait du harcelement.
          L'action reste offerte juste en dessous. */}
      {versParametres && !automatique && <> {t("thr_trad_choose_engine_q")}</>}
      {code !== "meme-langue" && (
        <div className="msg-trad-pied">
          {peutInstaller ? (
            <button type="button" className="msg-trad-lien" onClick={installer}>
              {t("thr_trad_install")}
            </button>
          ) : versParametres ? (
            <button
              type="button"
              className="msg-trad-lien"
              onClick={(event) => {
                event.stopPropagation()
                navigate("/settings")
              }}
            >
              {t("thr_trad_open_settings")}
            </button>
          ) : (
            <button
              type="button"
              className="msg-trad-lien"
              onClick={(event) => {
                event.stopPropagation()
                onReessayer()
              }}
            >
              {t("thr_trad_retry")}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
