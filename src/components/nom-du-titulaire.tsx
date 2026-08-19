import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../lib/alanya-number"
import { rechercherCompte } from "../services/contact-lists-service"
import { useTranslation } from "../i18n"

/**
 * Le NOM DU TITULAIRE d'un numero Alanya, lu DIRECTEMENT SOUS les chiffres.
 *
 * POURQUOI CE COMPOSANT A COTE DU PAVE. `PaveNumerique` rend deja ce service
 * pour les quatre claviers a touches (prop `afficherTitulaire`), mais tous les
 * endroits ou l'on saisit un numero Alanya n'ont pas de clavier a touches : le
 * repertoire, la fenetre de nouvelle discussion et l'invitation en reunion
 * n'ont qu'un `<input>`. La regle est pourtant la meme partout — on doit savoir
 * QUI l'on s'apprete a ajouter avant de l'ajouter — et une regle faite de course
 * reseau, d'anti-rebond et de silence prudent ne se recopie pas trois fois sans
 * qu'une des copies derive. D'ou un composant qui ne sait faire que cela, et
 * qu'un ecran pose sous son champ en une ligne.
 *
 * A NE PAS UTILISER SUR UN ECRAN PUBLIC, et c'est une regle de securite, pas de
 * gout : la route de recherche exige une session authentifiee, precisement
 * parce qu'un ecran ouvert a tous qui rendrait le nom du titulaire laisserait
 * n'importe qui balayer les numeros pour en recolter les noms. C'est la raison
 * pour laquelle l'ecran de connexion, qui saisit pourtant un numero Alanya, ne
 * porte pas cette ligne.
 */

/**
 * Anti-rebond de la recherche. Une requete par touche frappee ferait partir six
 * requetes pour un numero a six chiffres, dont cinq pour des numeros que
 * l'utilisateur n'a jamais voulu chercher. La valeur est celle du pave et de la
 * fenetre des listes de contacts : le meme geste doit repondre au meme rythme
 * partout, sans quoi la meme saisie paraitrait plus vive ici que la-bas.
 */
const DELAI_RECHERCHE_MS = 350

/**
 * Ce que l'on sait du TITULAIRE du numero en cours de saisie.
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
 * Retrouve le titulaire d'un numero saisi, et ne rend un etat que lorsqu'il
 * parle bien des chiffres AFFICHES.
 *
 * TROIS PIEGES, traites ici et nulle part ailleurs :
 *
 * 1. LA REPONSE EN RETARD. Le numero change plus vite que le reseau ne repond :
 *    « 788 » puis « 7888 » lancent deux recherches, et rien ne garantit que la
 *    premiere revienne la premiere. Deux verrous, et il en faut bien deux :
 *      - le nettoyage de l'effet eteint `vivant` des que le numero bouge, si
 *        bien qu'une reponse arrivee ensuite n'ecrit RIEN ;
 *      - l'etat porte son numero et le rendu le compare a celui du champ, ce qui
 *        couvre l'intervalle ou la frappe est deja peinte alors que l'effet du
 *        nouveau numero n'a pas encore tourne.
 *    Le premier verrou seul laisserait passer une image avec le mauvais nom, le
 *    second seul laisserait deux reponses se recouvrir dans le desordre.
 * 2. LE NOM FAUX PENDANT L'ATTENTE. Tant que la reponse n'est pas la, l'etat est
 *    `attente` : la ligne dit qu'elle cherche, elle n'avance aucun nom.
 * 3. LA PANNE QUI REMONTE. Aucune exception ne sort d'ici : ces champs servent a
 *    ajouter un contact ou a inviter quelqu'un, et une ligne d'information ne
 *    doit jamais empecher le geste qu'elle accompagne. Le `catch` de la promesse
 *    couvre l'echec reseau, le `try` qui l'entoure couvre un jet SYNCHRONE — un
 *    jet depuis un `setTimeout` ne se rattrape pas au-dessus, il file droit en
 *    erreur globale, hors de portee de toute frontiere d'erreur React.
 *
 * Le repertoire local n'est volontairement pas consulte en raccourci : la route
 * de recherche rend deja l'alias du repertoire quand il en existe un, et la
 * chercher deux fois ferait diverger le nom montre ici de celui montre par le
 * serveur — sur un compte sans nom ni pseudo, la voie locale rend d'ailleurs le
 * NUMERO, qu'on lirait alors repete sous lui-meme.
 *
 * INTERNE, et volontairement : ce module n'expose qu'un composant. Y ajouter un
 * export de fonction couperait le rafraichissement a chaud de React sur tous les
 * ecrans qui l'importent, et aucun n'a besoin de l'etat brut — ils veulent la
 * ligne, pas les quatre cas a peindre eux-memes.
 */
function useTitulaireNumero(numero: string): EtatTitulaire | null {
  const chiffres = useMemo(() => normalizeAlanyaNumber(numero), [numero])
  const [etat, setEtat] = useState<EtatTitulaire>(TITULAIRE_VIDE)

  useEffect(() => {
    // Rendre l'etat PRECEDENT quand rien ne change fait renoncer React au
    // rendu : sans cela, chaque chiffre frappe sous le seuil de recherche
    // provoquerait un rendu de plus pour aboutir au meme ecran.
    const taireSur = (cible: string) =>
      setEtat((precedent) =>
        precedent.numero === cible && precedent.etat === "muet"
          ? precedent
          : { numero: cible, etat: "muet", nom: null }
      )

    // Trop court pour etre un identifiant Alanya : rien ne s'affiche et RIEN ne
    // part sur le reseau. Annoncer « aucun compte » des le premier chiffre
    // serait faux — l'utilisateur n'a pas fini de taper.
    if (!isValidAlanyaNumber(chiffres)) {
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
            if (vivant) taireSur(chiffres)
          })
      } catch {
        if (vivant) taireSur(chiffres)
      }
    }, DELAI_RECHERCHE_MS)

    return () => {
      vivant = false
      window.clearTimeout(minuterie)
    }
  }, [chiffres])

  return etat.numero === chiffres ? etat : null
}

/**
 * Habillage de la ligne. Aucune couleur en dur : les quatre themes passent tous
 * par les memes variables, et une valeur ecrite ici serait juste dans l'un et
 * illisible dans les trois autres.
 *
 *  - `minHeight` : la ligne garde sa place meme vide, sinon le champ, le bouton
 *    et tout ce qui suit sauteraient a chaque reponse.
 *  - `overflowWrap` : le nom EST la reponse a la question posee, il se lit EN
 *    ENTIER, quitte a passer sur deux lignes — jamais tronque a l'ellipse.
 */
const LIGNE: React.CSSProperties = {
  minHeight: "1.35em",
  lineHeight: 1.35,
  overflowWrap: "anywhere",
}

/**
 * Le NOM se detache, le RESTE s'efface. Les etats se lisent au meme endroit et
 * il faut les distinguer sans les lire : le nom est la reponse a la question
 * posee, il saute aux yeux ; la mention passagere de chargement ne doit pas se
 * faire prendre pour lui le temps d'un coup d'oeil.
 */
const STYLE_NOM: React.CSSProperties = {
  ...LIGNE,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-primary)",
}

const STYLE_DISCRET: React.CSSProperties = {
  ...LIGNE,
  fontSize: 11,
  color: "var(--text-muted)",
}

export function NomDuTitulaire({
  numero,
  repli,
  style,
}: {
  /** Ce que porte le champ, formate ou non : la normalisation se fait ici. */
  numero: string
  /**
   * Ce qui occupe la ligne quand il n'y a RIEN a dire du titulaire — champ
   * vide, numero encore trop court, recherche en panne. Sert a reprendre
   * l'indication generale que l'ecran affichait deja a cet endroit, plutot
   * qu'a empiler deux lignes sous le meme champ.
   */
  repli?: ReactNode
  /** Retouches de mise en page propres a l'ecran hote (largeur, retrait). */
  style?: React.CSSProperties
}) {
  const { t } = useTranslation()
  const titulaire = useTitulaireNumero(numero)

  const nom = titulaire?.etat === "nom" ? titulaire.nom : null

  const texte =
    titulaire?.etat === "attente"
      ? t("loading")
      : titulaire?.etat === "inconnu"
        ? t("clist_dial_unknown", { numero: formatAlanyaNumber(titulaire.numero) })
        : null

  /* Ligne TOUJOURS rendue : `aria-live` ne s'annonce de facon fiable que depuis
     un element deja present a l'ecran — pose en meme temps que son texte,
     l'annonce se perd. */
  return (
    <div aria-live="polite" style={{ ...(nom ? STYLE_NOM : STYLE_DISCRET), ...style }}>
      {nom ?? texte ?? repli}
    </div>
  )
}
