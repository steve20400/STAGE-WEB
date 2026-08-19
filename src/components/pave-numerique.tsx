import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  ALANYA_NUMBER_MAX_LENGTH,
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../lib/alanya-number"
import { rechercherCompte, type CompteTrouve } from "../services/contact-lists-service"
import { useTranslation } from "../i18n"
import "./pave-numerique.css"

/** Disposition d'un clavier de telephone, celle du composeur d'appel. */
const TOUCHES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""] as const

/**
 * Anti-rebond de la recherche du titulaire. Une requete par touche pressee
 * ferait partir six requetes pour un numero a six chiffres, dont cinq pour des
 * numeros que l'utilisateur n'a jamais voulu chercher. La valeur est celle deja
 * retenue par la fenetre des listes de contacts, qui a fait ce chemin la
 * premiere : le meme geste doit repondre au meme rythme partout.
 */
const DELAI_RECHERCHE_MS = 350

/**
 * Ce que l'on sait du TITULAIRE du numero en cours de composition.
 *
 * L'etat porte le numero auquel il se rapporte, et ce n'est pas une precaution
 * de trop : l'effet de recherche ne s'execute qu'APRES la peinture du rendu
 * declenche par la frappe. Sans cette comparaison, le rendu qui suit un chiffre
 * de plus afficherait encore, l'espace d'une image, le nom du numero precedent
 * sous des chiffres qui ne sont plus les siens.
 *
 *  - `muet`    : rien a dire — numero trop court, compte sans nom, ou recherche
 *                en panne. On se tait plutot que d'affirmer quelque chose de faux.
 *  - `attente` : la recherche court. Surtout pas de nom a cet instant.
 *  - `nom`     : le nom complet du titulaire, et rien d'autre.
 *  - `inconnu` : aucun compte ne porte ce numero, et le serveur l'a dit.
 */
interface EtatTitulaire {
  /** Chiffres auxquels cet etat se rapporte. */
  numero: string
  etat: "muet" | "attente" | "nom" | "inconnu"
  /** Renseigne seulement quand `etat` vaut `nom`. */
  nom: string | null
}

const TITULAIRE_VIDE: EtatTitulaire = { numero: "", etat: "muet", nom: null }

/**
 * Retrouve le titulaire du numero compose, et ne rend un etat que lorsqu'il
 * parle bien des chiffres AFFICHES.
 *
 * TROIS PIEGES, traites ici et nulle part ailleurs — c'est tout l'interet de
 * les tenir dans le pave plutot que dans chacun des quatre claviers :
 *
 * 1. LA REPONSE EN RETARD. Le numero change plus vite que le reseau ne repond :
 *    « 788 » puis « 7888 » lancent deux recherches, et rien ne garantit que la
 *    premiere revienne la premiere. Deux verrous, et il en faut bien deux :
 *      - le nettoyage de l'effet eteint `vivant` des que le numero bouge, si
 *        bien qu'une reponse arrivee ensuite n'ecrit RIEN ;
 *      - l'etat porte son numero et le rendu le compare a celui de l'ecran, ce
 *        qui couvre l'intervalle ou la frappe est deja peinte alors que l'effet
 *        du nouveau numero n'a pas encore tourne.
 *    Le premier verrou seul laisserait passer une image avec le mauvais nom, le
 *    second seul laisserait deux reponses se recouvrir dans le desordre.
 * 2. LE NOM FAUX PENDANT L'ATTENTE. Tant que la reponse n'est pas la, l'etat
 *    est `attente` : la ligne dit qu'elle cherche, elle n'avance aucun nom.
 * 3. LA PANNE QUI REMONTE. Aucune exception ne sort d'ici : un pave qui casse
 *    empecherait de composer, c'est-a-dire d'appeler. Le `catch` de la promesse
 *    couvre l'echec reseau, le `try` qui l'entoure couvre un jet SYNCHRONE — un
 *    jet depuis un `setTimeout` ne se rattrape pas au-dessus, il file droit en
 *    erreur globale, hors de portee de toute frontiere d'erreur React.
 *
 * Le repertoire local n'est volontairement pas consulte en raccourci : la route
 * de recherche rend deja l'alias du repertoire quand il en existe un, et la
 * chercher deux fois ferait diverger le nom montre par ce pave de celui montre
 * par le serveur le jour ou l'alias change ailleurs.
 */
function useTitulaire(
  chiffres: string,
  actif: boolean,
  onTitulaire?: (compte: CompteTrouve | null, numero: string) => void
): EtatTitulaire | null {
  const [etat, setEtat] = useState<EtatTitulaire>(TITULAIRE_VIDE)
  // La reference evite de relancer la recherche parce que le parent a redefini
  // sa fonction au rendu — cas normal quand elle n'est pas memorisee.
  // Le numero CHERCHE voyage avec la reponse, et ce n'est pas une commodite.
  //
  // `prevenir.current` est reecrit a chaque rendu : le rappel qui parle est donc
  // celui du DERNIER rendu, dont la fermeture designe les chiffres AFFICHES et non
  // ceux qui ont ete cherches. Un parent qui appariait la reponse avec sa propre
  // variable de fermeture pouvait donc coller le compte du numero precedent au
  // numero courant. Le drapeau `vivant` ne l'en protege pas : il ne s'eteint qu'au
  // nettoyage de l'effet, une tache APRES le rendu, et une reponse resolue dans
  // cette fenetre passe encore. Le pave affichait alors correctement le nom du
  // numero courant — c'est-a-dire rien — pendant que le bouton du parent
  // s'allumait sur un compte perime.
  const prevenir = useRef(onTitulaire)
  prevenir.current = onTitulaire

  useEffect(() => {
    // Rendre l'etat PRECEDENT quand rien ne change fait renoncer React au
    // rendu : sans cela, chaque chiffre frappe sous le seuil de recherche
    // provoquerait un rendu de plus pour aboutir au meme ecran.
    const taireSur = (numero: string) =>
      setEtat((precedent) =>
        precedent.numero === numero && precedent.etat === "muet"
          ? precedent
          : { numero, etat: "muet", nom: null }
      )

    // Pave qui n'affiche pas le titulaire : pas de requete, et l'etat retombe a
    // vide pour qu'un nom trouve avant l'extinction ne reparaisse pas tel quel
    // si le parent rallume l'affichage sur le meme numero.
    if (!actif) {
      setEtat((precedent) => (precedent === TITULAIRE_VIDE ? precedent : TITULAIRE_VIDE))
      return
    }

    // Trop court pour etre un identifiant Alanya : rien ne s'affiche et RIEN ne
    // part sur le reseau. Annoncer « aucun compte » des le premier chiffre
    // serait faux — l'utilisateur n'a pas fini de taper.
    if (!isValidAlanyaNumber(chiffres)) {
      prevenir.current?.(null, chiffres)
      taireSur(chiffres)
      return
    }

    setEtat({ numero: chiffres, etat: "attente", nom: null })

    let vivant = true
    const minuterie = window.setTimeout(() => {
      try {
        void rechercherCompte(chiffres)
          .then((compte) => {
            if (!vivant) return
            // Le parent recoit le compte AVANT l'affichage : c'est ce qui lui
            // evite de lancer sa propre recherche pour la meme question, et donc
            // d'afficher un nom pendant que son bouton reste eteint.
            prevenir.current?.(compte ?? null, chiffres)
            if (!compte) {
              setEtat({ numero: chiffres, etat: "inconnu", nom: null })
            } else if (compte.nom) {
              setEtat({ numero: chiffres, etat: "nom", nom: compte.nom })
            } else {
              // Le compte existe mais ne porte aucun nom : il n'y a rien a
              // lire, et « aucun compte » serait un mensonge. On se tait.
              taireSur(chiffres)
            }
          })
          .catch(() => {
            // Recherche en panne : on ne sait rien. Se taire est la seule
            // reponse vraie — annoncer un compte introuvable ferait accuser le
            // numero d'un defaut qui est le notre.
            if (vivant) {
              prevenir.current?.(null, chiffres)
              taireSur(chiffres)
            }
          })
      } catch {
        if (vivant) taireSur(chiffres)
      }
    }, DELAI_RECHERCHE_MS)

    return () => {
      vivant = false
      window.clearTimeout(minuterie)
    }
  }, [actif, chiffres])

  return actif && etat.numero === chiffres ? etat : null
}

/**
 * Pave numerique reutilisable : un numero Alanya en cours de composition, les
 * dix chiffres, un effacement d'un chiffre et un effacement total — et, s'il le
 * faut, le NOM DU TITULAIRE lu sous les chiffres.
 *
 * POURQUOI CE COMPOSANT alors que `app/(protected)/calls/dialer.tsx` fait deja
 * ce clavier. Le composeur d'appel est un ECRAN : il occupe la fenetre, il
 * porte ses boutons d'appel et sa fermeture, et il decide lui-meme de ce qu'on
 * fait du numero. On a maintenant besoin du meme clavier POSE DANS une autre
 * interface — la fenetre des listes de contacts, ou l'on ajoute un membre par
 * son numero. D'ou un composant qui ne sait que composer : le numero est tenu
 * par le parent (`valeur` / `onChange`), et ce qu'on en fait lui appartient.
 * Pas de bouton d'appel ici, pas de bouton de fermeture.
 *
 * POURQUOI LA RECHERCHE DU TITULAIRE EST ICI ET NON CHEZ LES PARENTS. Le nom se
 * lit sous les chiffres partout ou l'on compose un numero Alanya : le composeur
 * d'appel, l'invitation et le transfert en cours d'appel, l'invitation en
 * reunion. Quatre claviers, une seule regle — et une regle qui tient de la
 * course reseau, de l'anti-rebond et du silence prudent, c'est-a-dire tout ce
 * qu'on ne recopie pas quatre fois sans qu'une des copies derive. Le parent
 * demande le service d'un mot (`afficherTitulaire`) et n'a plus rien a savoir.
 *
 * POURQUOI LE CLAVIER PHYSIQUE EST ECOUTE SUR LA RACINE ET NON SUR `document`.
 * C'est le seul vrai piege du composant. Le composeur plein ecran, lui, ecoute
 * `document` : il est seul a l'ecran, aucune autre saisie ne peut lui disputer
 * une frappe. Ce pave-ci vit dans une fenetre qui contient AUSSI des champs
 * texte — le nom de la liste, la recherche de contacts. Un ecouteur global y
 * volerait les chiffres tapes dans ces champs : « Astreinte 2 » deviendrait
 * « Astreinte » dans le champ et « 2 » dans le pave, sans que rien ne
 * l'explique. L'ecoute est donc attachee a la racine du composant, qui prend
 * le focus (`tabIndex`), et ne recoit que ce qui est frappe pendant qu'elle,
 * ou l'une de ses touches, a le focus.
 */
export function PaveNumerique({
  valeur,
  onChange,
  onValider,
  autoFocus,
  sousLeNumero,
  afficherTitulaire,
  onTitulaire,
  emphaseSousLeNumero,
  compact,
}: {
  /** Chiffres seuls, sans les espaces d'affichage. Le parent tient l'etat. */
  valeur: string
  onChange: (chiffres: string) => void
  /** Appele sur Entree, quand la racine a le focus. Facultatif. */
  onValider?: () => void
  autoFocus?: boolean
  /**
   * Contenu place DIRECTEMENT sous les chiffres, a l'interieur de l'ecran du
   * pave — le nom du titulaire du numero, en pratique.
   *
   * Ce prop existe parce que le poser a cote du pave ne marche pas : les
   * chiffres sont dessines DANS le composant, en tete de sa grille, et un frere
   * suivant se retrouve donc apres les douze touches et la rangee d'effacement,
   * soit plus de quatre cents pixels plus bas. Sur telephone il fallait faire
   * defiler par-dessus tout le clavier pour lire le nom du numero qu'on venait
   * de composer, et les deux n'etaient jamais visibles ensemble.
   *
   * PRIORITAIRE sur `afficherTitulaire` : un parent qui fournit son propre
   * contenu garde la main, et le pave ne cherche alors rien — il ne se contente
   * pas de cacher sa ligne, il ne PART PAS sur le reseau, pour ne pas facturer
   * une requete par frappe a un ecran qui n'en lira jamais la reponse.
   */
  sousLeNumero?: ReactNode
  /**
   * Le pave retrouve LUI-MEME le titulaire du numero et l'affiche sous les
   * chiffres. Sans effet si `sousLeNumero` est fourni.
   *
   * A n'allumer que derriere une session authentifiee. La route de recherche
   * l'exige, et ce n'est pas un hasard : un ecran PUBLIC qui donnerait le nom du
   * titulaire laisserait n'importe qui balayer les numeros pour en recolter les
   * noms. C'est la raison pour laquelle l'ecran de connexion, qui compose
   * pourtant un numero Alanya, n'allume pas ce prop.
   */
  afficherTitulaire?: boolean
  /**
   * Prevenu du compte trouve, ou de `null` quand il n'y en a pas — numero trop
   * court, aucun titulaire, ou recherche en panne.
   *
   * Existe parce qu'un parent a souvent besoin du compte LUI-MEME et pas
   * seulement de son nom : pour activer un bouton « ajouter », pour retenir
   * l'identifiant, pour savoir si la personne est deja au repertoire. Sans ce
   * rappel, ces parents lancaient leur PROPRE recherche a cote de celle du
   * pave — deux requetes pour la meme question, a deux rythmes differents, et
   * un ecran qui se contredit : le nom du titulaire affiche sous les chiffres
   * pendant que le bouton reste eteint parce que l'autre requete n'a pas encore
   * repondu.
   */
  onTitulaire?: (compte: CompteTrouve | null, numero: string) => void
  /**
   * Met `sousLeNumero` en valeur comme le fait le pave quand il cherche
   * lui-meme : encre pleine et graisse, au lieu du gris d'accompagnement.
   *
   * Sans ce prop, la fenetre qui fournit son propre contenu affichait le nom du
   * titulaire MOINS en evidence que les paves censes l'imiter, et ne le
   * distinguait plus de la mention passagere « Chargement ». C'est le parent qui
   * decide, parce que lui seul sait si ce qu'il pose est une reponse ou une
   * attente.
   */
  emphaseSousLeNumero?: boolean
  /**
   * Variante resserree, pour un pave pose dans un menu deroulant ou dans le
   * panneau lateral d'une salle de reunion : la ou la place manque, ce sont les
   * ecarts et le plafond des touches qui cedent, jamais la cible tactile de
   * 44 px ni la lisibilite du numero.
   */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const racine = useRef<HTMLDivElement>(null)

  // Le parent peut poser n'importe quoi dans `valeur` (un collage, un numero
  // deja formate) : on ne fait confiance qu'a la version normalisee et bornee.
  const chiffres = useMemo(
    () => normalizeAlanyaNumber(valeur).slice(0, ALANYA_NUMBER_MAX_LENGTH),
    [valeur]
  )

  // `sousLeNumero` fourni, meme vide, veut dire « c'est moi qui remplis cette
  // ligne » : le pave se tait et, surtout, ne cherche pas.
  const chercheSeul = afficherTitulaire === true && sousLeNumero === undefined
  const titulaire = useTitulaire(chiffres, chercheSeul, onTitulaire)

  /**
   * Ce qui se lit sous les chiffres. Le nom seul quand on le tient — pas le
   * numero repete, pas un etat technique, pas « hors repertoire » a sa place.
   */
  const ligneTitulaire = useMemo(() => {
    if (!titulaire) return null
    if (titulaire.etat === "nom") return titulaire.nom
    if (titulaire.etat === "attente") return t("loading")
    if (titulaire.etat === "inconnu") {
      return t("clist_dial_unknown", { numero: formatAlanyaNumber(titulaire.numero) })
    }
    return null
  }, [t, titulaire])

  /**
   * Le NOM se detache, l'ATTENTE s'efface. Les trois etats se lisent au meme
   * endroit et il faut les distinguer sans les lire : le nom est la reponse a
   * la question posee, il saute aux yeux ; la mention passagere de chargement
   * ne doit pas se faire prendre pour lui le temps d'un coup d'oeil.
   */
  const classeSousNumero =
    titulaire?.etat === "nom"
      ? "pave-sous-numero pave-titulaire"
      : titulaire?.etat === "attente"
        ? "pave-sous-numero pave-titulaire-attente"
        : "pave-sous-numero"

  const taper = useCallback(
    (touche: string) => {
      const suivant = normalizeAlanyaNumber(chiffres + touche).slice(0, ALANYA_NUMBER_MAX_LENGTH)
      // Au plafond, la frappe ne change rien : ne pas prevenir le parent lui
      // evite un rendu pour rien a chaque touche pressee dans le vide.
      if (suivant !== chiffres) onChange(suivant)
    },
    [chiffres, onChange]
  )

  const effacer = useCallback(() => {
    if (chiffres) onChange(chiffres.slice(0, -1))
  }, [chiffres, onChange])

  const vider = useCallback(() => {
    if (chiffres) onChange("")
  }, [chiffres, onChange])

  const surFrappe = useCallback(
    (evenement: React.KeyboardEvent<HTMLDivElement>) => {
      if (/^[0-9]$/.test(evenement.key)) {
        evenement.preventDefault()
        return taper(evenement.key)
      }
      if (evenement.key === "Backspace" || evenement.key === "Delete") {
        // Sans cela, certains navigateurs remontent d'une page a la frappe
        // d'un retour arriere hors champ de saisie.
        evenement.preventDefault()
        return effacer()
      }
      if (evenement.key === "Enter") {
        // Entree sur une touche du pave, c'est presser CETTE touche : le
        // navigateur en fait deja un clic, on ne le double pas d'une
        // validation qui fermerait la fenetre au premier chiffre.
        const cible = evenement.target as HTMLElement
        if (cible !== evenement.currentTarget && cible.closest("button")) return
        onValider?.()
      }
      // Tout le reste (Echap en particulier) poursuit sa route : c'est la
      // fenetre qui porte le pave qui decide de s'en servir.
    },
    [effacer, onValider, taper]
  )

  // Le clic sur une touche ne doit pas laisser le focus la ou il etait — dans
  // le champ du nom, par exemple : la frappe suivante y partirait au lieu
  // d'arriver ici. On empeche donc le deplacement de focus par la souris et on
  // le ramene a la racine, seule porteuse de l'ecoute clavier.
  const surSouris = useCallback((evenement: React.MouseEvent<HTMLDivElement>) => {
    evenement.preventDefault()
    racine.current?.focus()
  }, [])

  useEffect(() => {
    if (autoFocus) racine.current?.focus()
  }, [autoFocus])

  return (
    <div
      ref={racine}
      className={compact ? "pave-root pave-compact" : "pave-root"}
      role="group"
      aria-label={t("dial_an_id")}
      tabIndex={0}
      onKeyDown={surFrappe}
      onMouseDown={surSouris}
    >
      {/* Le numero s'annonce a chaque chiffre : sans lecture a voix haute, un
          pave tactile ne dit pas ce qu'il a compris. */}
      <div className="pave-ecran">
        <div className="pave-numero" aria-live="polite">
          {chiffres ? formatAlanyaNumber(chiffres) : <span className="pave-vide">Alanya ID</span>}
        </div>

        {chercheSeul ? (
          /* Ligne TOUJOURS rendue quand le pave cherche lui-meme : `aria-live`
             ne s'annonce de facon fiable que depuis un element deja present a
             l'ecran — pose en meme temps que son texte, l'annonce se perd. */
          <div className={classeSousNumero} aria-live="polite">
            {ligneTitulaire}
          </div>
        ) : sousLeNumero ? (
          <div
            className={
              emphaseSousLeNumero ? "pave-sous-numero pave-titulaire" : "pave-sous-numero"
            }
          >
            {sousLeNumero}
          </div>
        ) : null}
      </div>

      <div className="pave-touches">
        {TOUCHES.map((touche, index) =>
          touche === "" ? (
            // Les deux cases vides de la derniere rangee tiennent la grille en
            // place : le 0 reste centre sous le 8, comme sur un telephone.
            <span key={`vide-${index}`} aria-hidden />
          ) : (
            <button
              key={touche}
              type="button"
              className="pave-touche"
              onClick={() => taper(touche)}
              aria-label={touche}
            >
              {touche}
            </button>
          )
        )}
      </div>

      <div className="pave-actions">
        <span aria-hidden />

        <button
          type="button"
          className="pave-vider"
          onClick={vider}
          disabled={chiffres.length === 0}
        >
          {t("erase")}
        </button>

        <button
          type="button"
          className="pave-effacer"
          onClick={effacer}
          disabled={chiffres.length === 0}
          aria-label={t("erase_last_digit")}
          title={t("erase_last_digit")}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M21 5H9L3 12l6 7h12a1 1 0 001-1V6a1 1 0 00-1-1z" />
            <line x1="18" y1="9" x2="12" y2="15" />
            <line x1="12" y1="9" x2="18" y2="15" />
          </svg>
        </button>
      </div>
    </div>
  )
}
