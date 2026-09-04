import { useEffect, useId, useMemo, useRef, useState } from "react"
import { CONTACT_COLORS, type Contact } from "../../../src/data/contacts"
import { PaveNumerique } from "../../../src/components/pave-numerique"
import { useToast } from "../../../src/components/toast"
import { useTranslation, type Cle } from "../../../src/i18n"
import {
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../../../src/lib/alanya-number"
import { avatarDisplaySrc } from "../../../src/lib/avatar"
import {
  creerListe,
  modifierListe,
  rechercherCompte,
  ErreurListeContacts,
  type ChoixMembres,
  type CompteTrouve,
  type ListeContacts,
  type ResultatEcriture,
} from "../../../src/services/contact-lists-service"
import {
  customRingtones,
  previewRingtone,
  stopRingtonePreview,
  RINGTONES,
} from "../../../src/services/ringtones"
import { nomSonnerie, PALETTE_LISTES } from "./contact-lists-affichage"

/**
 * Fenetre de creation et de modification d'une liste de contacts : son nom, sa
 * couleur, sa sonnerie, et ses membres — pris au repertoire ou composes au
 * clavier.
 *
 * C'est ELLE qui appelle le service, et non la section qui l'ouvre : l'erreur de
 * nom deja pris se montre sur le champ du nom, pas dans un toast, et seul le
 * formulaire sait ou est ce champ. La section, elle, recoit le resultat et se
 * charge de ce qui la regarde — rafraichir la rangee, annoncer le succes,
 * signaler les numeros introuvables.
 */

/**
 * Un membre retenu dans le formulaire, quelle que soit la facon dont il y est
 * entre. L'identite est le NUMERO en chiffres seuls : c'est ce qui permet a un
 * numero compose au clavier de cocher la ligne du repertoire qui le porte, au
 * lieu d'entrer deux fois la meme personne.
 */
interface MembreChoisi {
  cle: string
  /**
   * Identifiant de COMPTE, connu des seuls membres deja enregistres : le
   * repertoire du web ne porte que l'identifiant de la ligne de contact, qui
   * n'est pas celui du compte qu'attend `identifiants`.
   */
  idCompte: string | null
  /** Chiffres seuls. Vide seulement si le serveur n'a pas rendu de numero. */
  numero: string
  nom: string | null
  /**
   * Appartenance au repertoire, telle que LE SERVEUR l'a calculee — et `null`
   * quand on ne la connait pas encore.
   *
   * Le troisieme etat n'est pas un ornement. Un numero compose puis ajoute
   * avant que la recherche ait repondu ne nous apprend rien sur son titulaire :
   * ecrire `false` reviendrait a le declarer hors repertoire sur la foi d'une
   * reponse qui n'est pas arrivee, c'est-a-dire a reproduire par une autre
   * porte le message que l'utilisateur a rejete. On se tait a la place, et le
   * serveur tranchera a l'enregistrement.
   */
  estContact: boolean | null
}

function membresInitiaux(liste: ListeContacts | null, contacts: Contact[]): MembreChoisi[] {
  if (!liste) return []
  return liste.membres.map((membre) => {
    const chiffres = normalizeAlanyaNumber(membre.numero)
    const contact = chiffres
      ? (contacts.find((c) => normalizeAlanyaNumber(c.phone) === chiffres) ?? null)
      : null
    return {
      cle: chiffres || `compte:${membre.id}`,
      idCompte: membre.id,
      numero: chiffres,
      nom: membre.nom ?? contact?.name ?? null,
      estContact: membre.estContact,
    }
  })
}

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
interface EtatIdentite {
  /** Chiffres auxquels cet etat se rapporte. */
  numero: string
  etat: "muet" | "attente" | "trouve" | "inconnu"
  /**
   * Le compte rendu par le serveur, ENTIER. Renseigne seulement quand `etat`
   * vaut `trouve`.
   *
   * On garde l'objet et non le seul nom parce que cette fenetre ne fait pas
   * qu'afficher : elle AJOUTE le membre, et son appartenance au repertoire
   * (`estContact`) comme son identifiant de compte viennent de la meme reponse
   * que le nom. Les jeter ici obligerait a les recalculer ailleurs, et le seul
   * recalcul possible cote client — chercher le numero dans le repertoire deja
   * charge — se trompe des que le repertoire a bouge sans la page.
   *
   * `trouve` avec un compte sans nom n'est pas une contradiction : le compte
   * existe, on ne peut simplement rien lire sous les chiffres.
   */
  compte: CompteTrouve | null
}

const IDENTITE_VIDE: EtatIdentite = { numero: "", etat: "muet", compte: null }

/**
 * Anti-rebond de la recherche du titulaire. Une requete par touche pressee
 * ferait partir six requetes pour un numero a six chiffres, dont cinq pour des
 * numeros que l'utilisateur n'a jamais voulu chercher.
 */
const DELAI_RECHERCHE_MS = 350

/*
 * Il y avait ici un `STYLE_TITULAIRE` — centrage, hauteur minimale, retour a la
 * ligne — declare et jamais applique a quoi que ce soit. Il est retire plutot
 * que branche : `.pave-sous-numero`, la classe que le pave pose lui-meme autour
 * de `sousLeNumero`, porte deja exactement ces trois regles. Le poser en plus
 * aurait fait vivre deux sources pour un meme habillage, dont l'une invisible a
 * qui lit la feuille de style.
 */

export function ContactListModal({
  liste,
  contacts,
  onFermer,
  onEnregistre,
}: {
  /** `null` en creation. */
  liste: ListeContacts | null
  contacts: Contact[]
  onFermer: () => void
  onEnregistre: (resultat: ResultatEcriture, creation: boolean) => void
}) {
  const { t } = useTranslation()
  const { error } = useToast()
  const creation = liste === null

  const [nom, setNom] = useState(liste?.nom ?? "")
  const [couleur, setCouleur] = useState<string | null>(liste?.couleur ?? null)
  const [sonnerie, setSonnerie] = useState<string | null>(liste?.sonnerie ?? null)
  const [mode, setMode] = useState<"contacts" | "numero">("contacts")
  const [recherche, setRecherche] = useState("")
  const [compose, setCompose] = useState("")
  const [membres, setMembres] = useState<MembreChoisi[]>(() => membresInitiaux(liste, contacts))
  const [erreurNom, setErreurNom] = useState<Cle | null>(null)
  const [enregistrement, setEnregistrement] = useState(false)
  const [identite, setIdentite] = useState<EtatIdentite>(IDENTITE_VIDE)

  const champNom = useRef<HTMLInputElement>(null)
  const champRecherche = useRef<HTMLInputElement>(null)
  /**
   * Enveloppe du pave, seul moyen d'atteindre sa racine sans qu'il expose de
   * ref. Elle est en `display: contents` : elle ne cree aucune boite, le pave
   * reste l'enfant direct de la colonne `.clist-champ` et en garde l'ecart.
   */
  const zonePave = useRef<HTMLDivElement>(null)
  const idTitre = useId()
  const idErreurNom = useId()
  const idLabelMembres = useId()

  useEffect(() => {
    champNom.current?.focus()
  }, [])

  // L'extrait ne doit pas continuer a jouer une fois la fenetre refermee.
  useEffect(() => () => stopRingtonePreview(), [])

  const importees = useMemo(() => customRingtones(), [])

  /**
   * La sonnerie deja enregistree est retenue a l'ouverture : importee depuis un
   * autre navigateur, elle n'est dans aucun catalogue local, et sans une entree
   * a son nom le menu la remplacerait en silence par « aucune ».
   */
  const [sonnerieInitiale] = useState(liste?.sonnerie ?? null)
  const optionsSonnerie = useMemo(() => {
    const options = [
      ...RINGTONES.map((entree) => ({ valeur: entree.file, libelle: entree.label })),
      ...importees.map((entree) => ({ valeur: entree.url, libelle: entree.label })),
    ]
    if (sonnerieInitiale && !options.some((option) => option.valeur === sonnerieInitiale)) {
      options.push({
        valeur: sonnerieInitiale,
        libelle: nomSonnerie(sonnerieInitiale) ?? t("set_ringtone_imported"),
      })
    }
    return options
  }, [importees, sonnerieInitiale, t])

  const ecouter = () => {
    if (!sonnerie) return
    // L'ecoute echoue quand le navigateur n'a pas encore recu de geste de
    // l'utilisateur, ou quand le media a disparu : ce n'est pas une panne de
    // l'enregistrement, elle ne merite pas d'interrompre la saisie.
    void previewRingtone(sonnerie).catch(() => undefined)
  }

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (contact) => contact.name.toLowerCase().includes(q) || contact.phone.includes(q)
    )
  }, [contacts, recherche])

  const cleDeContact = (contact: Contact) =>
    normalizeAlanyaNumber(contact.phone) || `contact:${contact.id}`

  const estRetenu = (cle: string) => membres.some((membre) => membre.cle === cle)

  const retirer = (cle: string) =>
    setMembres((precedents) => precedents.filter((membre) => membre.cle !== cle))

  const basculerContact = (contact: Contact) => {
    const cle = cleDeContact(contact)
    if (estRetenu(cle)) return retirer(cle)
    setMembres((precedents) => [
      ...precedents,
      {
        cle,
        idCompte: null,
        // Le numero part meme s'il n'a pas la forme d'un identifiant Alanya : le
        // service le rendra parmi les introuvables, et l'utilisateur l'apprendra,
        // la ou l'ecarter ici le ferait disparaitre sans un mot.
        numero: normalizeAlanyaNumber(contact.phone),
        nom: contact.name,
        estContact: true,
      },
    ])
  }

  const numeroCompose = normalizeAlanyaNumber(compose)
  const composeUtilisable = isValidAlanyaNumber(compose) && !estRetenu(numeroCompose)

  /**
   * Recherche du titulaire du numero compose.
   *
   * TROIS PIEGES, traites ici et pas ailleurs :
   *
   * 1. La reponse en retard. Le numero change plus vite que le reseau ne
   *    repond : « 788 » puis « 7888 » lancent deux recherches, et rien ne
   *    garantit que la premiere revienne la premiere. Le nettoyage de l'effet
   *    eteint `vivant` des que le numero bouge, et une reponse arrivee ensuite
   *    n'ecrit RIEN.
   * 2. Le nom encore affiche sous d'autres chiffres. L'etat porte son numero,
   *    et l'affichage le compare a celui de l'ecran (voir `identiteVisible`).
   * 3. Le nom faux pendant l'attente. Tant que la reponse n'est pas la, l'etat
   *    est `attente` : la ligne dit qu'elle cherche, elle n'avance aucun nom.
   *
   * LE REPERTOIRE LOCAL N'EST PLUS CONSULTE EN RACCOURCI, et c'est une
   * correction, pas une simplification. Il repondait sans le reseau quand le
   * numero compose etait deja un contact — mais il ne repondait pas la MEME
   * chose que le serveur. Le nom venait alors de `contacts-service.ts`, qui
   * retombe sur le NUMERO quand le compte n'a ni nom ni pseudo, la ou la route
   * de recherche rend `null` pour laisser le client se taire. On lisait
   * « 788853 » sous « 788 853 » : le numero repete sous lui-meme, exactement ce
   * que cette ligne existe pour eviter. Le raccourci faisait par ailleurs
   * diverger le nom montre ici de celui que le serveur enregistrera, le jour ou
   * un alias change ailleurs sans que la page soit rechargee.
   */
  useEffect(() => {
    // Le pave est le seul endroit ou l'on compose : chercher pour un pave qui
    // n'est pas a l'ecran ferait partir une requete que personne ne lira.
    if (mode !== "numero") return

    // Trop court pour etre un identifiant Alanya. Annoncer « aucun compte » des
    // le premier chiffre serait faux : l'utilisateur n'a pas fini de taper.
    if (!isValidAlanyaNumber(numeroCompose)) {
      setIdentite({ numero: numeroCompose, etat: "muet", compte: null })
      return
    }

    setIdentite({ numero: numeroCompose, etat: "attente", compte: null })

    let vivant = true
    const minuterie = window.setTimeout(() => {
      void rechercherCompte(numeroCompose)
        .then((compte) => {
          if (!vivant) return
          // Le compte entre ENTIER dans l'etat, meme sans nom : `ajouterCompose`
          // y prendra son appartenance au repertoire, que le serveur seul sait.
          setIdentite(
            compte
              ? { numero: numeroCompose, etat: "trouve", compte }
              : { numero: numeroCompose, etat: "inconnu", compte: null }
          )
        })
        .catch(() => {
          // Recherche en panne : on ne sait rien. Se taire est la seule reponse
          // vraie — annoncer un compte introuvable ferait accuser le numero.
          if (vivant) setIdentite({ numero: numeroCompose, etat: "muet", compte: null })
        })
    }, DELAI_RECHERCHE_MS)

    return () => {
      vivant = false
      window.clearTimeout(minuterie)
    }
  }, [mode, numeroCompose])

  /** L'etat courant, mais seulement s'il parle bien des chiffres affiches. */
  const identiteVisible = identite.numero === numeroCompose ? identite : null

  const ajouterCompose = () => {
    if (!composeUtilisable) return
    /**
     * LE COMPTE RENDU PAR LE SERVEUR, ET LUI SEUL. Il n'est retenu que s'il
     * concerne CES chiffres, meme regle qu'a l'affichage.
     *
     * L'appartenance au repertoire se lisait auparavant dans le tableau local
     * des contacts. C'etait la recalculer alors que la reponse l'apportait
     * deja, et la recalculer FAUX : le tableau est celui du chargement de la
     * page, ou celui du cache au demarrage hors ligne. Un contact ajoute depuis
     * le telephone entre-temps n'y figure pas, et la pastille annoncait « hors
     * repertoire » sur quelqu'un qui y est — le texte meme que l'utilisateur a
     * rejete, revenu par une autre porte. Le serveur, lui, repond sur l'etat du
     * repertoire a l'instant de la recherche.
     */
    const compte = identiteVisible?.etat === "trouve" ? identiteVisible.compte : null
    setMembres((precedents) => [
      ...precedents,
      {
        cle: numeroCompose,
        idCompte: compte?.id ?? null,
        numero: numeroCompose,
        nom: compte?.nom ?? null,
        // `null` et non `false` quand la recherche n'a pas encore repondu :
        // voir `MembreChoisi.estContact`.
        estContact: compte ? compte.estContact : null,
      },
    ])
    setCompose("")
  }

  const enregistrer = async () => {
    if (enregistrement) return
    const nomNet = nom.trim()
    if (!nomNet) {
      setErreurNom("clist_name_required")
      champNom.current?.focus()
      return
    }

    // Les membres partent par leur NUMERO : c'est la seule identite que les deux
    // modes de choix ont en commun, et elle resout le meme compte que l'ajout
    // d'un contact. L'identifiant de compte ne sert qu'aux membres deja
    // enregistres dont le serveur n'a rendu aucun numero.
    const choix: ChoixMembres = {
      numeros: membres.filter((membre) => membre.numero).map((membre) => membre.numero),
      identifiants: membres
        .filter((membre) => !membre.numero && membre.idCompte)
        .map((membre) => membre.idCompte as string),
    }

    setErreurNom(null)
    setEnregistrement(true)
    try {
      const resultat = liste
        ? await modifierListe(liste.id, { nom: nomNet, sonnerie, couleur, membres: choix })
        : await creerListe(nomNet, choix, sonnerie, couleur)
      onEnregistre(resultat, creation)
    } catch (err) {
      if (err instanceof ErreurListeContacts && err.code === "nom-pris") {
        setErreurNom("clist_name_taken")
        champNom.current?.focus()
      } else {
        error(
          t("clist_error"),
          err instanceof Error && !(err instanceof ErreurListeContacts) ? err.message : undefined
        )
      }
    } finally {
      setEnregistrement(false)
    }
  }

  /**
   * Entree dans le champ du NOM.
   *
   * En MODIFICATION, le raccourci est legitime : la liste a deja ses membres,
   * et il ne reste bien souvent que le nom a corriger.
   *
   * En CREATION, la meme touche enregistrait une liste VIDE — elle annoncait
   * « Liste creee » et refermait la fenetre avant qu'un seul membre ait ete
   * choisi, en partant sur `memberIds` et `memberNumbers` vides. Le raccourci
   * n'est donc garde que lorsque le formulaire est COMPLET, c'est-a-dire des
   * qu'un membre est retenu ; sinon Entree conduit a l'etape suivante, le choix
   * des membres, au lieu de sauter par-dessus.
   *
   * Pourquoi ne pas plutot EXIGER un membre au bouton de creation : une liste
   * qu'on remplira plus tard reste legitime, et le service ne l'interdit pas.
   * Le defaut n'etait pas la liste vide, c'etait de la creer SANS QUE PERSONNE
   * NE LE DEMANDE. Le bouton, lui, est un geste delibere : il garde son droit.
   */
  const surEntreeDansNom = () => {
    if (!creation || membres.length > 0) {
      void enregistrer()
      return
    }

    // Le nom se verifie tout de meme : sans lui, rien ne sera enregistrable, et
    // l'apprendre maintenant vaut mieux qu'apres avoir choisi les membres.
    if (!nom.trim()) {
      setErreurNom("clist_name_required")
      return
    }

    /**
     * L'etape suivante, c'est le choix des membres — et elle ne se trouve pas
     * au meme endroit selon le mode.
     *
     * En mode « Composer », la ligne se terminait par un focus sur la ref du
     * champ de RECHERCHE. Or cette ref n'est rattachee qu'au champ du mode
     * « Contacts », qui n'est alors pas monte : elle valait `null`, l'appel
     * optionnel ne faisait rien, et Entree ne produisait RIEN — ni erreur, ni
     * deplacement, ni message. Le commentaire s'appuyait sur l'`autoFocus` du
     * pave, qui ne joue qu'a son affichage : arrive ici, le focus est dans le
     * champ du nom depuis longtemps, et le pave ne le reprend pas tout seul.
     *
     * Le pave n'expose pas de ref, d'ou le passage par son enveloppe. On vise
     * `role="group"` et non une classe : c'est le role que le pave porte sur sa
     * racine, celle qui tient le `tabIndex` et l'ecoute du clavier physique —
     * une classe d'habillage pourrait etre renommee, ce role decrit ce que la
     * racine EST.
     */
    if (mode === "numero") {
      zonePave.current?.querySelector<HTMLElement>('[role="group"]')?.focus()
      return
    }

    champRecherche.current?.focus()
  }

  return (
    <div className="clist-voile" onClick={() => !enregistrement && onFermer()}>
      <div
        className="clist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        tabIndex={-1}
        onClick={(evenement) => evenement.stopPropagation()}
        onKeyDown={(evenement) => {
          if (evenement.key === "Escape" && !enregistrement) onFermer()
        }}
      >
        <div className="clist-modal-tete">
          <div className="clist-modal-titre" id={idTitre}>
            {creation ? t("clist_new") : t("clist_edit")}
          </div>
          <button
            type="button"
            className="clist-fermer"
            onClick={onFermer}
            aria-label={t("close")}
            disabled={enregistrement}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              aria-hidden
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="clist-modal-corps">
          <div className="clist-champ">
            <label className="clist-label" htmlFor={`${idTitre}-nom`}>
              {t("clist_name")}
            </label>
            <input
              id={`${idTitre}-nom`}
              ref={champNom}
              className="clist-input"
              value={nom}
              placeholder={t("clist_name_ph")}
              maxLength={60}
              aria-invalid={erreurNom !== null}
              aria-describedby={erreurNom ? idErreurNom : undefined}
              onChange={(evenement) => {
                setNom(evenement.target.value)
                // L'erreur porte sur ce qui a ete envoye : des que la saisie
                // change, elle ne dit plus rien de vrai.
                if (erreurNom) setErreurNom(null)
              }}
              onKeyDown={(evenement) => {
                if (evenement.key === "Enter") surEntreeDansNom()
              }}
            />
            {erreurNom && (
              <div className="clist-erreur" id={idErreurNom} role="alert">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {t(erreurNom)}
              </div>
            )}
          </div>

          {/* La palette n'a pas d'etiquette : le catalogue n'a pas de cle pour la
              nommer, et un texte francais en dur mentirait dans les onze autres
              langues. Chaque pastille porte son rang, qui se lit dans toutes. */}
          <div className="clist-champ">
            <div className="clist-couleurs">
              {PALETTE_LISTES.map((teinte, rang) => {
                const choisie = couleur === teinte
                return (
                  <button
                    key={teinte}
                    type="button"
                    className={choisie ? "clist-couleur clist-couleur-on" : "clist-couleur"}
                    // La teinte EST la valeur enregistree : plus de table de
                    // correspondance entre un nom et sa variable CSS, donc plus
                    // d'ecart possible entre ce qu'on voit et ce qu'on garde.
                    style={{ "--clist-teinte": teinte } as React.CSSProperties}
                    aria-pressed={choisie}
                    onClick={() => setCouleur(choisie ? null : teinte)}
                  >
                    <span className="clist-hors-ecran">{rang + 1}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="clist-champ">
            <label className="clist-label" htmlFor={`${idTitre}-sonnerie`}>
              {t("clist_ringtone")}
            </label>
            <div className="clist-sonnerie-ligne">
              <select
                id={`${idTitre}-sonnerie`}
                className="clist-select"
                value={sonnerie ?? ""}
                onChange={(evenement) => setSonnerie(evenement.target.value || null)}
              >
                <option value="">{t("clist_ringtone_none")}</option>
                {optionsSonnerie.map((option) => (
                  <option key={option.valeur} value={option.valeur}>
                    {option.libelle}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="clist-ecouter"
                onClick={ecouter}
                disabled={!sonnerie}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
                {t("clist_preview")}
              </button>
            </div>
            <p className="clist-aide">{t("clist_ringtone_hint")}</p>
          </div>

          <div className="clist-champ">
            <div className="clist-champ-tete">
              <span className="clist-label" id={idLabelMembres}>
                {t("clist_members")}
              </span>
              <span className="clist-champ-valeur">
                {t("clist_members_count", { count: membres.length })}
              </span>
            </div>

            {/* Classes PROPRES a cette fenetre. Elles empruntaient `filter-btn`
                a `calls-page.css` « deja chargee par la page » — ce qui est faux
                dans le paquet produit : toutes les feuilles y sont concatenees,
                et la regle non scopee qui l'emportait etait celle de
                `chats-page.css`, posterieure, que cette page n'importe meme pas.
                La fenetre prenait donc une hauteur figee venue d'ailleurs, et
                une retouche de la liste des discussions l'aurait restylee en
                silence. */}
            <div className="clist-modes" role="group" aria-labelledby={idLabelMembres}>
              <button
                type="button"
                className={mode === "contacts" ? "clist-mode clist-mode-on" : "clist-mode"}
                aria-pressed={mode === "contacts"}
                onClick={() => setMode("contacts")}
              >
                {t("clist_mode_contacts")}
              </button>
              <button
                type="button"
                className={mode === "numero" ? "clist-mode clist-mode-on" : "clist-mode"}
                aria-pressed={mode === "numero"}
                onClick={() => setMode("numero")}
              >
                {t("clist_mode_dial")}
              </button>
            </div>

            {membres.length > 0 && (
              <div className="clist-jetons">
                {membres.map((membre) => (
                  <button
                    key={membre.cle}
                    type="button"
                    className="clist-jeton"
                    onClick={() => retirer(membre.cle)}
                  >
                    {membre.nom ?? formatAlanyaNumber(membre.numero)}
                    {/* La comparaison est stricte : `!membre.estContact` aurait
                        aussi attrape le `null` de « on ne sait pas encore », et
                        la mention n'est affirmee que lorsque le serveur a dit
                        que ce membre est hors repertoire. */}
                    {membre.estContact === false && (
                      <span className="clist-membre-num">{t("clist_not_contact")}</span>
                    )}
                    <span className="clist-hors-ecran">{t("set_remove")}</span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                ))}
              </div>
            )}

            {mode === "contacts" ? (
              <>
                <div className="clist-recherche">
                  <svg
                    className="clist-recherche-icone"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    ref={champRecherche}
                    className="clist-recherche-input"
                    value={recherche}
                    placeholder={t("clist_pick_members")}
                    onChange={(evenement) => setRecherche(evenement.target.value)}
                  />
                </div>

                <ul className="clist-liste-membres">
                  {filtres.map((contact) => {
                    const cle = cleDeContact(contact)
                    const coche = estRetenu(cle)
                    const teinte = CONTACT_COLORS[contact.color]
                    const photo = avatarDisplaySrc(contact.avatar)
                    return (
                      <li key={contact.id}>
                        <button
                          type="button"
                          className={coche ? "clist-membre clist-membre-on" : "clist-membre"}
                          aria-pressed={coche}
                          onClick={() => basculerContact(contact)}
                        >
                          <span
                            className="clist-membre-av"
                            style={{ background: teinte.bg, color: teinte.fg }}
                          >
                            {photo ? <img src={photo} alt="" /> : contact.initials}
                          </span>
                          {/* Des blocs et non des `span` : le nom se tronque par
                              `text-overflow`, qui ne mord pas sur une boite en
                              ligne. */}
                          <span className="clist-membre-texte">
                            <div className="clist-membre-nom">{contact.name}</div>
                            <div className="clist-membre-num">
                              {formatAlanyaNumber(contact.phone)}
                            </div>
                          </span>
                          <span className="clist-case" aria-hidden>
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                            >
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          </span>
                        </button>
                      </li>
                    )
                  })}

                  {filtres.length === 0 && (
                    <li className="clist-membres-vide">
                      {recherche ? t("no_contact_found") : t("no_contact_yet")}
                    </li>
                  )}
                </ul>
              </>
            ) : (
              <>
                <span className="clist-label">{t("clist_dial_ph")}</span>
                {/* `autoFocus` : le pave ecoute le clavier physique sur SA
                    racine, et non sur le document — il ne recoit donc rien tant
                    que personne ne la lui donne. Sans ce prop, presser 5 au
                    clavier en arrivant sur « Composer » ne faisait rien, et il
                    fallait d'abord cliquer une touche a la souris. */}
                <div ref={zonePave} style={{ display: "contents" }}>
                  <PaveNumerique
                    valeur={compose}
                    onChange={setCompose}
                    onValider={ajouterCompose}
                    autoFocus
                    emphaseSousLeNumero={identiteVisible?.etat === "trouve"}
                    sousLeNumero={
                      /* LE NOM DU TITULAIRE, sous les chiffres — a l'INTERIEUR
                         du pave, et c'est tout l'interet du prop. Rendu a cote,
                         il tombait apres les douze touches et la rangee
                         d'effacement, plus de quatre cents pixels sous le
                         numero auquel il se rapporte : sur telephone il fallait
                         faire defiler par-dessus le clavier pour le lire.

                         Le nom complet, et rien d'autre : ni le numero repete,
                         ni un etat technique, ni « hors repertoire » a sa place.

                         POURQUOI `sousLeNumero` ET NON `afficherTitulaire`,
                         alors que le pave sait chercher tout seul. Parce que
                         cette fenetre ne fait pas qu'AFFICHER : elle ajoute le
                         membre, et il lui faut du compte trouve ce que le pave
                         ne rend a personne — son appartenance au repertoire et
                         son identifiant. Elle doit donc chercher de toute
                         facon, et lui passer le resultat est justement ce qui
                         evite le double : `sousLeNumero` fourni, le pave ne
                         part PAS sur le reseau de son cote. Le jour ou le pave
                         rendra le compte a son parent, cette recherche-ci
                         disparaitra et le prop d'un mot suffira.

                         Ligne TOUJOURS rendue : `aria-live` ne s'annonce de
                         facon fiable que depuis un element deja present. */
                      <span aria-live="polite">
                        {identiteVisible?.etat === "trouve" && identiteVisible.compte?.nom}
                        {identiteVisible?.etat === "attente" && t("loading")}
                        {identiteVisible?.etat === "inconnu" &&
                          t("clist_dial_unknown", { numero: formatAlanyaNumber(numeroCompose) })}
                      </span>
                    }
                  />
                </div>
                <button
                  type="button"
                  className="clist-valider"
                  onClick={ajouterCompose}
                  disabled={!composeUtilisable}
                >
                  {t("clist_dial_add")}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="clist-modal-pied">
          <button
            type="button"
            className="clist-annuler"
            onClick={onFermer}
            disabled={enregistrement}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="clist-valider"
            onClick={() => void enregistrer()}
            disabled={enregistrement}
          >
            {creation ? t("clist_create") : t("clist_save")}
          </button>
        </div>
      </div>
    </div>
  )
}
