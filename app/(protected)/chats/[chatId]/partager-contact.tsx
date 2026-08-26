import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PaveNumerique } from "../../../../src/components/pave-numerique"
import { useTranslation } from "../../../../src/i18n"
import { CONTACT_COLORS, type Contact } from "../../../../src/data/contacts"
import { fetchContacts } from "../../../../src/services/contacts-service"
import { avatarDisplaySrc } from "../../../../src/lib/avatar"
import {
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../../../../src/lib/alanya-number"
import {
  LONGUEUR_MAX_CONTENU,
  encodeContacts,
  type SharedContact,
} from "../../../../src/services/message-payload"
import type { CompteTrouve } from "../../../../src/services/contact-lists-service"
import "./partager-contact.css"

/**
 * Fenetre d'envoi d'une FICHE DE CONTACT dans une discussion.
 *
 * DEUX VOIES, une seule corbeille. On choisit dans le repertoire, ou l'on
 * compose un numero Alanya au clavier ; les deux alimentent la meme selection,
 * et un seul bouton part avec tout. Le pave affiche le NOM DU TITULAIRE sous
 * les chiffres : c'est ce qui evite d'envoyer la fiche de quelqu'un d'autre
 * pour une faute de frappe, et c'est la raison pour laquelle on reutilise
 * `PaveNumerique` plutot que de poser un champ texte.
 *
 * CE COMPOSANT NE PARLE PAS AU RESEAU POUR ENVOYER : il rend la charge JSON
 * deja encodee et le fil de discussion l'envoie par le chemin des messages
 * ordinaires (`sendChatMessage`, type CONTACT). Il n'existe pas de seconde
 * route, et il ne doit pas en exister.
 */

/**
 * Combien de fiches au maximum dans UN message.
 *
 * 🔴 CE N'EST PAS UN CHOIX D'INTERFACE : `litContacts` cote serveur fait
 * `slice(0, 10)`, et la feuille de partage du mobile
 * (`lib/widgets/contact_share_sheet.dart`) borne au meme nombre. Au-dela, les
 * fiches en trop seraient silencieusement perdues en route.
 */
const MAX_CONTACTS = 10

/**
 * La charge encodee, si elle tient dans la colonne — sinon `null`.
 *
 * 🔴 LE PIEGE DE CE CHANTIER, et il est invisible a la relecture. `content` est
 * un VARCHAR(500) et le serveur REFUSE une charge CONTACT plus longue au lieu
 * de la couper (`tronqueContenu`, `motif: "CONTENU_TROP_LONG"`) — couper du
 * JSON le detruirait. Or une fiche complete avec sa photo pese pres de
 * 130 caracteres : quatre contacts choisis a la souris suffisent a franchir la
 * borne, et sans ce controle l'envoi echouerait sans que rien n'explique
 * pourquoi.
 *
 * L'AVATAR EST SACRIFIE AVANT LE CONTACT. La photo est une decoration ; le nom,
 * le numero et l'identifiant sont l'information. Quand la charge ne tient pas,
 * on retire donc les photos de TOUTES les fiches — pas de quelques-unes, sinon
 * la carte recue montrerait une photo sur deux sans qu'on sache pourquoi — et
 * l'on ne renonce qu'ensuite.
 */
function chargeQuiTient(contacts: SharedContact[]): string | null {
  if (contacts.length === 0 || contacts.length > MAX_CONTACTS) return null
  const complete = encodeContacts(contacts)
  if (complete.length <= LONGUEUR_MAX_CONTENU) return complete
  const sansPhoto = encodeContacts(contacts.map((c) => ({ ...c, avatarUrl: null })))
  return sansPhoto.length <= LONGUEUR_MAX_CONTENU ? sansPhoto : null
}

/** Fiche partageable tiree d'une ligne du repertoire. */
function ficheDepuisContact(contact: Contact): SharedContact {
  const numero = (contact.phone ?? "").trim()
  return {
    name: contact.name,
    phones: numero.length > 0 ? [numero] : [],
    // `alanyaId` dit « cette personne a un compte Alanya » : on ne le renseigne
    // que si le numero du repertoire en est bien un. Un numero de telephone
    // classique importe du carnet n'en est pas un.
    alanyaId: isValidAlanyaNumber(numero) ? normalizeAlanyaNumber(numero) : null,
    // Une data-URL est un apercu LOCAL : elle ne veut rien dire chez le
    // destinataire et pese des dizaines de milliers de caracteres, soit cent
    // fois la place disponible. Seule l'URL servie par le serveur voyage.
    avatarUrl:
      contact.avatar && !contact.avatar.startsWith("data:") ? contact.avatar : null,
  }
}

function IconeLoupe() {
  return (
    <svg
      className="pc-loupe"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  )
}

export function PartagerContact({
  onFermer,
  onEnvoyer,
}: {
  onFermer: () => void
  /** Recoit la charge JSON deja encodee et valide. L'envoi appartient au parent. */
  onEnvoyer: (charge: string) => void
}) {
  const { t } = useTranslation()

  const [onglet, setOnglet] = useState<"repertoire" | "composer">("repertoire")
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [enPanne, setEnPanne] = useState(false)
  const [recherche, setRecherche] = useState("")
  const [retenus, setRetenus] = useState<Set<string>>(new Set())
  const [compose, setCompose] = useState("")
  /**
   * Ce que le pave a trouve, et POUR QUEL numero. Sans ce numero, la reponse en
   * retard d'une recherche precedente collerait le nom du titulaire de « 7888 »
   * sous les chiffres « 788 ».
   */
  const [titulaire, setTitulaire] = useState<{ numero: string; compte: CompteTrouve | null }>({
    numero: "",
    compte: null,
  })
  /** Mention affichee quand un ajout a ete refuse (corbeille pleine). */
  const [refus, setRefus] = useState<string | null>(null)

  const cadre = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let annule = false
    void fetchContacts()
      .then((liste) => {
        if (annule) return
        setContacts(
          [...liste].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        )
      })
      .catch(() => {
        // `fetchContacts` retombe deja sur le cache local et ne jette qu'en
        // dernier recours. On le dit plutot que d'afficher un repertoire vide,
        // qui ferait croire a un carnet d'adresses efface.
        if (!annule) setEnPanne(true)
      })
    return () => {
      annule = true
    }
  }, [])

  // Echap ferme, et le focus part dans la fenetre a l'ouverture : sans lui, la
  // frappe continuerait d'arriver dans le champ de saisie reste derriere.
  /**
   * Le focus se pose UNE FOIS, a l'ouverture — et jamais plus.
   *
   * Cet effet dependait de `onFermer`, que le parent recree a chaque rendu. Or
   * l'ecran de discussion se rerend tout seul toutes les trente secondes, et a
   * chaque message recu, chaque indicateur de frappe, chaque changement de
   * presence. L'effet se rejouait donc sans cesse et ARRACHAIT le focus vers la
   * racine du dialogue : les lettres tapees dans la recherche n'allaient plus
   * nulle part, et sur l'onglet « Composer » les chiffres non plus — le pave
   * lit les touches sur sa propre racine, et Entree ne validait donc plus.
   *
   * La fermeture passe par une reference : l'ecouteur appelle toujours la
   * derniere version, sans que sa nouvelle identite ne redeclenche le focus.
   */
  const fermer = useRef(onFermer)
  fermer.current = onFermer
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        fermer.current()
      }
    }
    document.addEventListener("keydown", surTouche)
    cadre.current?.focus()
    return () => document.removeEventListener("keydown", surTouche)
  }, [])

  const listeFiltree = useMemo(() => {
    const source = contacts ?? []
    const q = recherche.trim().toLowerCase()
    if (q.length === 0) return source
    // Les chiffres de la recherche sont compares aux chiffres du numero : taper
    // « 69 12 » doit retrouver « 691234567 », que l'on ait mis les espaces ou non.
    const chiffres = normalizeAlanyaNumber(q)
    return source.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (chiffres.length > 0 && normalizeAlanyaNumber(c.phone).includes(chiffres))
    )
  }, [contacts, recherche])

  /** Fiches retenues au repertoire, dans l'ordre de la LISTE et non des clics. */
  const fichesRepertoire = useMemo(
    () => (contacts ?? []).filter((c) => retenus.has(c.id)).map(ficheDepuisContact),
    [contacts, retenus]
  )

  /**
   * La fiche du numero en cours de composition.
   *
   * Elle compte des que le numero est complet, meme si aucun compte n'a ete
   * trouve. Ce n'est pas une negligence : `onTitulaire` rend `null` pour TROIS
   * situations qu'il ne distingue pas — numero trop court, aucun compte, et
   * recherche EN PANNE. Bloquer l'envoi dessus interdirait d'envoyer un numero
   * parfaitement valide des que le reseau hoquette. L'utilisateur, lui, lit
   * sous les chiffres ce que le pave sait : c'est la sa verification.
   *
   * `alanyaId` n'est renseigne que si un compte a REELLEMENT ete trouve — le
   * champ signifie « cette personne a un compte Alanya », et l'affirmer sans
   * l'avoir verifie serait un mensonge. Le numero reste dans `phones`, la fiche
   * reste donc exploitable de l'autre cote.
   */
  const ficheComposee = useMemo<SharedContact | null>(() => {
    const chiffres = normalizeAlanyaNumber(compose)
    if (!isValidAlanyaNumber(chiffres)) return null
    const connu = titulaire.numero === chiffres ? titulaire.compte : null
    return {
      name: connu?.nom ?? null,
      phones: [chiffres],
      alanyaId: connu ? chiffres : null,
      avatarUrl: null,
    }
  }, [compose, titulaire])

  /**
   * Tout ce qui part. Le numero compose s'ajoute a la selection du repertoire,
   * sauf s'il y figure deja : composer le numero d'un contact deja coche ne
   * doit pas envoyer deux fois la meme personne.
   */
  const aEnvoyer = useMemo<SharedContact[]>(() => {
    if (!ficheComposee) return fichesRepertoire
    const numero = ficheComposee.phones[0]
    const deja = fichesRepertoire.some((f) =>
      f.phones.some((p) => normalizeAlanyaNumber(p) === numero)
    )
    return deja ? fichesRepertoire : [...fichesRepertoire, ficheComposee]
  }, [fichesRepertoire, ficheComposee])

  const charge = useMemo(() => chargeQuiTient(aEnvoyer), [aEnvoyer])
  /** Selection non vide mais impossible a faire tenir dans un seul message. */
  const tropLourd = aEnvoyer.length > 0 && charge === null

  /**
   * Coche ou decoche une ligne.
   *
   * Le calcul est fait ICI et non dans la fonction de mise a jour de `retenus` :
   * un `setRefus` pose a l'interieur partirait deux fois en mode strict, React
   * rejouant volontairement les mises a jour pour debusquer les effets de bord.
   */
  const basculer = useCallback(
    (contact: Contact) => {
      setRefus(null)
      if (retenus.has(contact.id)) {
        const suivant = new Set(retenus)
        suivant.delete(contact.id)
        setRetenus(suivant)
        return
      }
      // On refuse l'ajout PLUTOT que de le laisser passer et d'eteindre le
      // bouton d'envoi : un ecran qui accepte puis se bloque laisse
      // l'utilisateur sans issue visible.
      const projection = [
        ...(contacts ?? [])
          .filter((c) => retenus.has(c.id) || c.id === contact.id)
          .map(ficheDepuisContact),
        ...(ficheComposee ? [ficheComposee] : []),
      ]
      if (chargeQuiTient(projection) === null) {
        setRefus(projection.length > MAX_CONTACTS ? t("pc_full") : t("pc_too_heavy"))
        return
      }
      const suivant = new Set(retenus)
      suivant.add(contact.id)
      setRetenus(suivant)
    },
    [contacts, ficheComposee, retenus, t]
  )

  const envoyer = useCallback(() => {
    if (charge === null) return
    onEnvoyer(charge)
    onFermer()
  }, [charge, onEnvoyer, onFermer])

  /** Entree dans le champ de recherche : c'est une validation, pas un saut de ligne. */
  const surEntreeRecherche = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    envoyer()
  }

  const chargement = contacts === null && !enPanne

  return (
    <div className="pc-voile" onClick={onFermer}>
      <div
        ref={cadre}
        className="pc-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("pc_title")}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pc-tete">
          <div className="pc-titre">{t("pc_title")}</div>
          <button
            type="button"
            className="pc-fermer"
            onClick={onFermer}
            aria-label={t("cancel")}
            title={t("cancel")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="pc-corps">
          {/* Les deux voies. `aria-pressed` pour que le choix s'entende aussi. */}
          <div className="pc-modes" role="group" aria-label={t("pc_title")}>
            <button
              type="button"
              className={`pc-mode${onglet === "repertoire" ? " pc-mode-on" : ""}`}
              aria-pressed={onglet === "repertoire"}
              onClick={() => setOnglet("repertoire")}
            >
              {t("clist_mode_contacts")}
            </button>
            <button
              type="button"
              className={`pc-mode${onglet === "composer" ? " pc-mode-on" : ""}`}
              aria-pressed={onglet === "composer"}
              onClick={() => setOnglet("composer")}
            >
              {t("clist_mode_dial")}
            </button>
          </div>

          {onglet === "repertoire" ? (
            <>
              <div className="pc-recherche">
                <IconeLoupe />
                <input
                  className="pc-recherche-input"
                  type="search"
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  onKeyDown={surEntreeRecherche}
                  placeholder={t("search_contact")}
                  aria-label={t("search_contact")}
                  autoFocus
                />
              </div>

              <ul className="pc-liste">
                {chargement && <li className="pc-vide">{t("cinfo_loading_contacts")}</li>}
                {enPanne && <li className="pc-vide">{t("pc_load_failed")}</li>}

                {!chargement &&
                  !enPanne &&
                  listeFiltree.map((contact) => {
                    const coche = retenus.has(contact.id)
                    const photo = avatarDisplaySrc(contact.avatar)
                    const teinte = CONTACT_COLORS[contact.color]
                    return (
                      <li key={contact.id}>
                        <button
                          type="button"
                          className={`pc-ligne${coche ? " pc-ligne-on" : ""}`}
                          aria-pressed={coche}
                          onClick={() => basculer(contact)}
                        >
                          <span
                            className="pc-avatar"
                            style={{ background: teinte.bg, color: teinte.fg }}
                            aria-hidden="true"
                          >
                            {photo ? <img src={photo} alt="" /> : contact.initials}
                          </span>
                          <span className="pc-ligne-texte">
                            <span className="pc-ligne-nom">{contact.name}</span>
                            <span className="pc-ligne-num">
                              {isValidAlanyaNumber(contact.phone)
                                ? formatAlanyaNumber(contact.phone)
                                : contact.phone}
                            </span>
                          </span>
                          <span className="pc-case" aria-hidden="true">
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                            >
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          </span>
                        </button>
                      </li>
                    )
                  })}

                {!chargement && !enPanne && listeFiltree.length === 0 && (
                  <li className="pc-vide">
                    {recherche ? t("meet_no_contact_found") : t("no_contact_yet")}
                  </li>
                )}
              </ul>
            </>
          ) : (
            <div className="pc-composer">
              <span className="pc-label">{t("clist_dial_ph")}</span>
              {/* `afficherTitulaire` : le pave cherche LUI-MEME le titulaire et
                  l'ecrit sous les chiffres — anti-rebond, course reseau et
                  silence prudent compris. `onTitulaire` nous rend le compte
                  trouve, ce qui evite de relancer la meme recherche a cote.

                  `onValider` : Entree, quand la racine du pave a le focus,
                  ENVOIE. C'est la validation demandee au clavier, le bouton du
                  pied faisant la meme chose a la souris. */}
              <PaveNumerique
                valeur={compose}
                onChange={(chiffres) => {
                  setRefus(null)
                  setCompose(chiffres)
                }}
                onValider={envoyer}
                afficherTitulaire
                onTitulaire={(compte, numero) => setTitulaire({ numero, compte })}
                autoFocus
                compact
              />
            </div>
          )}
        </div>

        <div className="pc-pied">
          <span className="pc-pied-info">
            {refus ??
              (tropLourd
                ? t("pc_too_heavy")
                : aEnvoyer.length > 0
                  ? t("pc_count", { count: aEnvoyer.length })
                  : t("pc_none"))}
          </span>
          <button type="button" className="pc-annuler" onClick={onFermer}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="pc-valider"
            onClick={envoyer}
            disabled={charge === null}
          >
            {t("send")}
          </button>
        </div>
      </div>
    </div>
  )
}
