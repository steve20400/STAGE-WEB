import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation, type Cle } from "../../../../src/i18n"
import {
  TraductionError,
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
const CLE_ERREUR: Record<CodeErreurTraduction | "inconnue", Cle> = {
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

export function MessageTranslation({ texte }: { texte: string }) {
  const { t, language } = useTranslation()
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" })
  // Un compteur plutot qu'un booleen : deux echecs de suite doivent relancer
  // l'effet, ce qu'une valeur qui ne change pas ne ferait pas.
  const [essai, setEssai] = useState(0)

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

  return (
    // La zone vivante est le bloc entier : le passage de l'attente au resultat
    // se fait au meme endroit, et un lecteur d'ecran annonce la traduction sans
    // qu'il faille lui redonner le focus.
    <div className="msg-trad" aria-live="polite">
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
      {etat.phase === "erreur" && (
        <EchecTraduction code={etat.code} onReessayer={() => setEssai((n) => n + 1)} />
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
  onReessayer,
}: {
  code: CodeErreurTraduction | "inconnue"
  onReessayer: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const versParametres = code === "local-indisponible" || code === "moteur-indisponible"

  return (
    <div className="msg-trad-note">
      {t(CLE_ERREUR[code])}
      {versParametres && <> {t("thr_trad_choose_engine_q")}</>}
      {code !== "meme-langue" && (
        <div className="msg-trad-pied">
          {versParametres ? (
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
