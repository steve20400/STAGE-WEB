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
  type ListeContacts,
  type ResultatEcriture,
} from "../../../src/services/contact-lists-service"
import {
  customRingtones,
  previewRingtone,
  stopRingtonePreview,
  RINGTONES,
} from "../../../src/services/ringtones"
import { nomSonnerie, PALETTE } from "./contact-lists-affichage"

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
  estContact: boolean
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
  etat: "muet" | "attente" | "nom" | "inconnu"
  /** Renseigne seulement quand `etat` vaut `nom`. */
  nom: string | null
}

const IDENTITE_VIDE: EtatIdentite = { numero: "", etat: "muet", nom: null }

/**
 * Anti-rebond de la recherche du titulaire. Une requete par touche pressee
 * ferait partir six requetes pour un numero a six chiffres, dont cinq pour des
 * numeros que l'utilisateur n'a jamais voulu chercher.
 */
const DELAI_RECHERCHE_MS = 350

/**
 * Habillage de la ligne du titulaire, pose ici parce que `contact-lists.css` ne
 * fait pas partie de ce chantier — et parce que deux de ces trois regles
 * corrigent l'emprunt d'une classe faite pour ailleurs :
 *
 *  - `textAlign` : le pave centre ses chiffres. Un nom cale a gauche ne se
 *    lirait pas comme appartenant au numero qui le surplombe.
 *  - `minHeight` : la ligne garde sa place meme vide, sinon le bouton d'ajout
 *    sauterait a chaque reponse — meme raison que le `min-height` de
 *    `.pave-numero`.
 *  - `whiteSpace` / `overflow` / `overflowWrap` : `.clist-membre-nom` tronque a
 *    l'ellipse, ce qu'il faut dans une rangee de repertoire mais pas ici. Ce
 *    nom EST la reponse a la question posee : il se lit EN ENTIER, quitte a
 *    passer sur deux lignes.
 */
const STYLE_TITULAIRE: React.CSSProperties = {
  textAlign: "center",
  minHeight: "1.4em",
  whiteSpace: "normal",
  overflow: "visible",
  overflowWrap: "anywhere",
}

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
  const contactCompose = useMemo(
    () =>
      numeroCompose
        ? (contacts.find((c) => normalizeAlanyaNumber(c.phone) === numeroCompose) ?? null)
        : null,
    [contacts, numeroCompose]
  )
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
   */
  useEffect(() => {
    // Le pave est le seul endroit ou l'on compose : chercher pour un pave qui
    // n'est pas a l'ecran ferait partir une requete que personne ne lira.
    if (mode !== "numero") return

    // Trop court pour etre un identifiant Alanya. Annoncer « aucun compte » des
    // le premier chiffre serait faux : l'utilisateur n'a pas fini de taper.
    if (!isValidAlanyaNumber(numeroCompose)) {
      setIdentite({ numero: numeroCompose, etat: "muet", nom: null })
      return
    }

    // Le repertoire deja charge repond sans le reseau : le nom d'un contact
    // connu parait des la frappe, et aucune requete ne part pour quelqu'un dont
    // on tient deja le nom.
    if (contactCompose) {
      setIdentite({ numero: numeroCompose, etat: "nom", nom: contactCompose.name })
      return
    }

    setIdentite({ numero: numeroCompose, etat: "attente", nom: null })

    let vivant = true
    const minuterie = window.setTimeout(() => {
      void rechercherCompte(numeroCompose)
        .then((compte) => {
          if (!vivant) return
          if (!compte) {
            setIdentite({ numero: numeroCompose, etat: "inconnu", nom: null })
          } else if (compte.nom) {
            setIdentite({ numero: numeroCompose, etat: "nom", nom: compte.nom })
          } else {
            // Le compte existe mais ne porte aucun nom : il n'y a rien a lire,
            // et « aucun compte » serait un mensonge. On se tait.
            setIdentite({ numero: numeroCompose, etat: "muet", nom: null })
          }
        })
        .catch(() => {
          // Recherche en panne : on ne sait rien. Se taire est la seule reponse
          // vraie — annoncer un compte introuvable ferait accuser le numero.
          if (vivant) setIdentite({ numero: numeroCompose, etat: "muet", nom: null })
        })
    }, DELAI_RECHERCHE_MS)

    return () => {
      vivant = false
      window.clearTimeout(minuterie)
    }
  }, [contactCompose, mode, numeroCompose])

  /** L'etat courant, mais seulement s'il parle bien des chiffres affiches. */
  const identiteVisible = identite.numero === numeroCompose ? identite : null

  const ajouterCompose = () => {
    if (!composeUtilisable) return
    // Le nom trouve par la recherche entre avec le membre : la pastille porte
    // alors le nom complet du titulaire au lieu des seuls chiffres. Il n'est
    // retenu que s'il concerne CES chiffres, meme regle qu'a l'affichage.
    const titulaire = identiteVisible?.etat === "nom" ? identiteVisible.nom : null
    setMembres((precedents) => [
      ...precedents,
      {
        cle: numeroCompose,
        idCompte: null,
        numero: numeroCompose,
        nom: contactCompose?.name ?? titulaire,
        estContact: contactCompose !== null,
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

    // Le pave, lui, prend le focus tout seul a son affichage (`autoFocus`) :
    // en mode « Composer », il n'y a rien de plus a faire ici.
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
              {PALETTE.map((teinte, rang) => {
                const choisie = couleur === teinte
                return (
                  <button
                    key={teinte}
                    type="button"
                    className={choisie ? "clist-couleur clist-couleur-on" : "clist-couleur"}
                    style={{ "--clist-teinte": CONTACT_COLORS[teinte].fg } as React.CSSProperties}
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

            {/* `filter-group` et `filter-btn` viennent de `calls-page.css`, deja
                chargee par la page : c'est la rangee de pastilles de toute
                l'application, et `contact-lists.css` n'en dessine pas. */}
            <div className="filter-group" role="group" aria-labelledby={idLabelMembres}>
              <button
                type="button"
                className={mode === "contacts" ? "filter-btn on" : "filter-btn"}
                aria-pressed={mode === "contacts"}
                onClick={() => setMode("contacts")}
              >
                {t("clist_mode_contacts")}
              </button>
              <button
                type="button"
                className={mode === "numero" ? "filter-btn on" : "filter-btn"}
                aria-pressed={mode === "numero"}
                onClick={() => setMode("numero")}
              >
                {t("clist_mode_dial")}
              </button>
            </div>

            {membres.length > 0 && (
              <div className="filter-group">
                {membres.map((membre) => (
                  <button
                    key={membre.cle}
                    type="button"
                    className="filter-btn"
                    onClick={() => retirer(membre.cle)}
                  >
                    {membre.nom ?? formatAlanyaNumber(membre.numero)}
                    {!membre.estContact && (
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
                <PaveNumerique
                  valeur={compose}
                  onChange={setCompose}
                  onValider={ajouterCompose}
                  autoFocus
                />
                {/* LE NOM DU TITULAIRE, sous les chiffres. Le nom complet, et
                    rien d'autre : ni le numero repete, ni un etat technique, ni
                    la mention « hors repertoire » a la place du nom.

                    Ligne TOUJOURS rendue : `aria-live` ne s'annonce de facon
                    fiable que depuis un element deja present a l'ecran, un
                    element qui apparait avec son texte passant souvent inapercu
                    des lecteurs d'ecran. */}
                <p
                  className={identiteVisible?.etat === "nom" ? "clist-membre-nom" : "clist-aide"}
                  style={STYLE_TITULAIRE}
                  aria-live="polite"
                >
                  {identiteVisible?.etat === "nom" && identiteVisible.nom}
                  {identiteVisible?.etat === "attente" && t("loading")}
                  {identiteVisible?.etat === "inconnu" &&
                    t("clist_dial_unknown", { numero: formatAlanyaNumber(numeroCompose) })}
                </p>
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
