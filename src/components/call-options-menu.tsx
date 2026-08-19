import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useLocation, useNavigate } from "react-router-dom"
import { useCallState } from "../hooks/use-call"
import { useContacts } from "../hooks/use-contacts"
import { useToast } from "./toast"
import { useTranslation, type Cle } from "../i18n"
import {
  inviteToCall,
  restoreActiveCall,
  setCallDisplayMode,
  transferCall,
  type CallDisplayMode,
} from "../services/call-manager"
import {
  ALANYA_NUMBER_MAX_LENGTH,
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../lib/alanya-number"
import { PaveNumerique } from "./pave-numerique"
import "./call-options-menu.css"

/** Cles, pas libelles : le menu se traduit au rendu, pas au chargement du module. */
const LIBELLE_TAILLE: Record<CallDisplayMode, Cle> = {
  small: "size_small_screen",
  medium: "size_medium_screen",
  full: "size_large_screen",
}

/**
 * Les deux AUTRES tailles : une fenetre ne se propose jamais elle-meme.
 * C'est la seule chose qui change d'une fenetre a l'autre — le reste du menu
 * est rigoureusement identique sur la petite, la moyenne et la grande.
 */
const AUTRES_TAILLES: Record<CallDisplayMode, CallDisplayMode[]> = {
  small: ["medium", "full"],
  medium: ["small", "full"],
  full: ["small", "medium"],
}

interface CallOptionsMenuProps {
  /** Le panneau est ouvert (le bouton trois points est gere par le parent). */
  open: boolean
  /** Fermeture demandee : clic exterieur, echap, ou action choisie. */
  onClose: () => void
  /**
   * Ou revenir en quittant le grand ecran. La page d'appel plein format est une
   * route : passer en petit ou moyen ecran suppose de la quitter, sinon la
   * fenetre reduite reste cachee derriere elle.
   */
  returnTo?: string
}

/**
 * Menu commun aux trois fenetres d'appel.
 *
 * Le contenu est le meme partout — taille de la fenetre, inviter, transferer —
 * pour que l'utilisateur retrouve les memes entrees au meme endroit quelle que
 * soit la taille. Seule la liste des tailles proposees s'adapte.
 *
 * Les dialogues d'invitation et de transfert partent dans un portail sur
 * <body> : la petite fenetre flottante est en overflow:hidden et les rognerait.
 */
export function CallOptionsMenu({ open, onClose, returnTo = "/calls" }: CallOptionsMenuProps) {
  const { t } = useTranslation()
  const call = useCallState()
  const navigate = useNavigate()
  const location = useLocation()
  const { contacts } = useContacts()
  const toast = useToast()

  const [vue, setVue] = useState<"racine" | "taille">("racine")
  const [dialogue, setDialogue] = useState<null | "inviter" | "transferer">(null)
  const [recherche, setRecherche] = useState("")
  /**
   * Deux facons de designer quelqu'un, au choix : le prendre dans ses contacts,
   * ou composer son Alanya ID. Le destinataire n'est pas toujours enregistre.
   */
  const [onglet, setOnglet] = useState<"contacts" | "numero">("contacts")
  const [chiffres, setChiffres] = useState("")
  const panneauRef = useRef<HTMLDivElement | null>(null)
  /**
   * Enveloppe du pave, tenue pour une seule raison : savoir si une frappe a
   * DEJA ete traitee par lui (voir l'ecoute du clavier physique, plus bas).
   */
  const zonePave = useRef<HTMLDivElement | null>(null)

  // Le menu repart toujours de sa racine : rouvrir sur le sous-menu des tailles
  // donnerait l'impression d'un menu different d'une fois a l'autre.
  useEffect(() => {
    if (!open) setVue("racine")
  }, [open])

  // Clic a l'exterieur et touche Echap. Le bouton trois points vit dans le
  // .call-opt-anchor : on l'exclut, sinon il fermerait puis rouvrirait le menu.
  useEffect(() => {
    if (!open) return
    const surClicExterieur = (e: PointerEvent) => {
      const cible = e.target as Node | null
      if (!cible) return
      if (panneauRef.current?.contains(cible)) return
      if (cible instanceof Element && cible.closest(".call-opt-anchor")) return
      onClose()
    }
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", surClicExterieur)
    document.addEventListener("keydown", surTouche)
    return () => {
      document.removeEventListener("pointerdown", surClicExterieur)
      document.removeEventListener("keydown", surTouche)
    }
  }, [open, onClose])

  const contactsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q)
    )
  }, [contacts, recherche])

  const ouvrirDialogue = (lequel: "inviter" | "transferer") => {
    setRecherche("")
    setChiffres("")
    setOnglet("contacts")
    setDialogue(lequel)
    onClose()
  }

  const fermerDialogue = useCallback(() => {
    setDialogue(null)
    setRecherche("")
    setChiffres("")
  }, [])

  const changerTaille = (mode: CallDisplayMode) => {
    onClose()
    if (mode === call.displayMode) return

    if (mode === "full") {
      const id = call.activeCallId
      restoreActiveCall()
      // Le grand ecran est une route a part entiere : il faut y aller.
      // On emporte l'endroit d'ou l'on part : a la fin de l'appel, l'ecran y
      // ramene au lieu de deposer tout le monde sur la liste des appels.
      const depart = `${location.pathname}${location.search}`
      requestAnimationFrame(() =>
        navigate(`/calls/${id}?type=${call.callType}&returnTo=${encodeURIComponent(depart)}`, {
          replace: true,
        })
      )
      return
    }

    const depuisLeGrandEcran = call.displayMode === "full"
    setCallDisplayMode(mode)
    if (depuisLeGrandEcran) navigate(returnTo)
  }

  /**
   * Envoie l'action du dialogue vers un destinataire.
   *
   * Le destinataire est toujours designe par son numero public — jamais par
   * `contact.id`, qui identifie la FICHE contact locale et non l'utilisateur
   * distant. C'est ce qui permet de traiter de la meme facon un contact choisi
   * dans la liste et un numero compose au clavier.
   */
  const valider = useCallback(
    (numero: string, nom: string) => {
      const cible = normalizeAlanyaNumber(numero) || numero
      const inviter = dialogue === "inviter"
      fermerDialogue()

      // Les deux actions sont asynchrones : un try/catch autour de l'appel ne
      // verrait jamais le rejet, et un echec passerait pour un succes.
      const demande = inviter ? inviteToCall(cible) : transferCall(cible)
      demande
        .then(() =>
          inviter
            ? toast.success(t("a2_invite_sent"), t("a2_invite_sent_detail", { name: nom }))
            : toast.info(t("a2_transfer_started"), t("a2_transfer_started_detail", { name: nom }))
        )
        .catch((err: unknown) =>
          toast.error(
            inviter ? t("a2_invite_failed") : t("a2_transfer_failed"),
            err instanceof Error ? err.message : undefined
          )
        )
    },
    [dialogue, fermerDialogue, toast, t]
  )

  // ---- Pave de saisie -------------------------------------------------------

  const numeroValide = isValidAlanyaNumber(chiffres)

  /** Un numero compose peut deja etre dans les contacts : autant le nommer. */
  const contactDuNumero = useMemo(() => {
    if (chiffres.length < 6) return null
    return contacts.find((c) => normalizeAlanyaNumber(c.phone) === chiffres) ?? null
  }, [chiffres, contacts])

  const validerLeNumero = useCallback(() => {
    if (!isValidAlanyaNumber(chiffres)) return
    valider(chiffres, contactDuNumero?.name ?? formatAlanyaNumber(chiffres))
  }, [chiffres, contactDuNumero, valider])

  /**
   * Le clavier physique doit composer aussi : on est dans un navigateur.
   *
   * Depuis la migration vers le pave partage, l'ecoute est PARTAGEE, et c'est la
   * seule subtilite qui reste ici. Le pave, lui, ecoute sur SA racine — il est
   * fait pour vivre dans une fenetre qui contient d'autres champs de saisie, et
   * un ecouteur global y volerait les chiffres tapes ailleurs (la recherche de
   * l'onglet contacts, par exemple). Il prend le focus a l'affichage
   * (`autoFocus`), donc chiffres, retour arriere et Entree lui arrivent tant
   * que le focus y reste.
   *
   * Cette ecoute-ci reste sur `document` parce que le focus peut sortir du pave
   * sans quitter le dialogue — un clic sur le titre, sur les onglets, sur le
   * fond de la fenetre — et le clavier devait deja composer dans ces cas la
   * avant la migration. D'ou la GARDE : une frappe partie de l'interieur du
   * pave a deja ete traitee par lui, et la retraiter ici doublerait le chiffre.
   *
   * Echap n'est traite que d'ici : le pave laisse expressement passer cette
   * touche a la fenetre qui le porte, faute de savoir ce qu'elle en fera.
   */
  useEffect(() => {
    if (dialogue === null || onglet !== "numero") return
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") return fermerDialogue()

      const cible = e.target
      if (cible instanceof Node && zonePave.current?.contains(cible)) return

      if (e.key === "Enter") {
        // Entree sur un bouton, c'est presser CE bouton : le navigateur en fait
        // deja un clic. Valider en plus enverrait l'invitation au moment meme ou
        // l'on presse « Annuler ».
        if (cible instanceof HTMLElement && cible.closest("button")) return
        return validerLeNumero()
      }
      if (e.key === "Backspace") {
        // Sans cela, certains navigateurs remontent d'une page a la frappe d'un
        // retour arriere hors champ de saisie.
        e.preventDefault()
        return setChiffres((actuel) => actuel.slice(0, -1))
      }
      if (/^[0-9]$/.test(e.key)) {
        // Le plafond est applique ICI aussi, et pas seulement dans le pave : le
        // pave borne ce qu'il AFFICHE, mais l'etat reste tenu par ce composant.
        // Sans cette coupe, un onzieme chiffre frappe hors du pave laisserait un
        // numero trop long dans l'etat — invalide pour `isValidAlanyaNumber`,
        // donc bouton eteint — sous des chiffres qui, eux, paraissent complets.
        setChiffres((actuel) =>
          normalizeAlanyaNumber(actuel + e.key).slice(0, ALANYA_NUMBER_MAX_LENGTH)
        )
      }
    }
    document.addEventListener("keydown", surTouche)
    return () => document.removeEventListener("keydown", surTouche)
  }, [dialogue, onglet, fermerDialogue, validerLeNumero])

  return (
    <>
      {open && (
        <div
          className="call-opt-menu"
          ref={panneauRef}
          role="menu"
          // La fenetre reduite se deplace au pointeur : sans cela, ouvrir le
          // menu ferait glisser la fenetre.
          onPointerDown={(e) => e.stopPropagation()}
        >
          {vue === "racine" ? (
            <>
              <button className="call-opt-item" role="menuitem" onClick={() => setVue("taille")}>
                <span>{t("window_size")}</span>
                <span className="call-opt-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              <button
                className="call-opt-item"
                role="menuitem"
                onClick={() => ouvrirDialogue("inviter")}
              >
                {t("invite_person")}
              </button>
              <button
                className="call-opt-item"
                role="menuitem"
                onClick={() => ouvrirDialogue("transferer")}
              >
                {t("transfer_call")}
              </button>
            </>
          ) : (
            <>
              <button className="call-opt-retour" onClick={() => setVue("racine")}>
                <span aria-hidden="true">‹</span> {t("window_size")}
              </button>
              {AUTRES_TAILLES[call.displayMode].map((mode) => (
                <button
                  key={mode}
                  className="call-opt-item"
                  role="menuitem"
                  onClick={() => changerTaille(mode)}
                >
                  {t(LIBELLE_TAILLE[mode])}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {dialogue !== null &&
        createPortal(
          <div
            className="call-opt-overlay"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (e.target === e.currentTarget) fermerDialogue()
            }}
          >
            <div className="call-opt-dialog" role="dialog" aria-modal="true">
              <div className="call-opt-dialog-title">
                {dialogue === "inviter" ? t("invite_person") : t("transfer_call")}
              </div>

              {/* Deux entrees pour la meme action : la liste des contacts, ou le
                  clavier. Un destinataire n'est pas toujours enregistre. */}
              <div className="call-opt-onglets" role="tablist">
                <button
                  className={onglet === "contacts" ? "call-opt-onglet on" : "call-opt-onglet"}
                  role="tab"
                  aria-selected={onglet === "contacts"}
                  onClick={() => setOnglet("contacts")}
                >
                  {t("contacts")}
                </button>
                <button
                  className={onglet === "numero" ? "call-opt-onglet on" : "call-opt-onglet"}
                  role="tab"
                  aria-selected={onglet === "numero"}
                  onClick={() => setOnglet("numero")}
                >
                  {t("dial_an_id")}
                </button>
              </div>

              {onglet === "contacts" ? (
                <>
                  <input
                    className="call-opt-search"
                    type="text"
                    autoFocus
                    placeholder={t("search_name_or_number")}
                    value={recherche}
                    onChange={(e) => setRecherche(e.target.value)}
                  />

                  <div className="call-opt-list">
                    {contactsFiltres.length > 0 ? (
                      contactsFiltres.map((contact) => (
                        <button
                          key={contact.id}
                          className="call-opt-contact"
                          onClick={() => valider(contact.phone, contact.name)}
                        >
                          <b>{contact.name}</b>
                          <span>{contact.phone}</span>
                        </button>
                      ))
                    ) : (
                      <div className="call-opt-vide">{t("meet_no_contact_found")}</div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* L'ENVELOPPE NE CONTIENT QUE LE PAVE ET SA LIGNE D'ETAT, et
                      le bouton de validation lui est reste dehors : elle sert de
                      repere a l'ecoute du clavier physique — « cette frappe
                      vient-elle du pave ? » —, et un bouton dedans y aurait fait
                      passer pour deja traitees les frappes recues alors qu'il a
                      le focus. Un chiffre tape apres une tabulation jusqu'au
                      bouton se serait perdu sans rien dire. La ligne d'etat, un
                      simple `div`, ne prend jamais le focus : elle peut rester. */}
                  <div className="call-opt-pave" ref={zonePave}>
                    {/* LE PAVE PARTAGE, en variante resserree — ce menu vit dans
                        un dialogue de 360 px pose par-dessus un appel en cours,
                        et le pave plein y ferait defiler ce qui doit tenir d'un
                        coup d'oeil.

                        `afficherTitulaire` : le NOM COMPLET du titulaire se lit
                        sous les chiffres, dans l'ecran du pave. Il remplace la
                        reconnaissance de contact que ce fichier faisait lui-meme
                        sur le repertoire local et ne s'y ajoute pas — une seule
                        ligne de nom, sinon deux reponses a la meme question se
                        contrediraient des que le repertoire est en retard sur le
                        serveur. Ce qu'on y gagne : le repertoire ne connait que
                        les contacts enregistres, la recherche connait tous les
                        comptes ; inviter ou transferer vers quelqu'un qu'on n'a
                        pas enregistre cesse donc de se faire a l'aveugle.

                        Pas de `sousLeNumero` : ce prop l'emporterait sur la
                        recherche et rendrait la ligne muette. */}
                    <PaveNumerique
                      valeur={chiffres}
                      onChange={setChiffres}
                      onValider={validerLeNumero}
                      autoFocus
                      compact
                      afficherTitulaire
                    />

                    {/* L'etat de la SAISIE, qui n'est pas celui du numero : il
                        dit si l'on peut valider, la ou la ligne du titulaire,
                        dans le pave, dit vers qui l'on part. */}
                    <div className="call-opt-numero-aide" aria-live="polite">
                      {chiffres.length === 0
                        ? t("dial_hint_number")
                        : numeroValide
                          ? t("number_complete")
                          : t("digits_too_short", { n: chiffres.length })}
                    </div>
                  </div>

                  <button
                    className="call-opt-valider"
                    onClick={validerLeNumero}
                    disabled={!numeroValide}
                    title={numeroValide ? undefined : t("dial_a_number")}
                  >
                    {dialogue === "inviter"
                      ? t("invite_this_number")
                      : t("transfer_to_this_number")}
                  </button>
                </>
              )}

              <button className="call-opt-annuler" onClick={fermerDialogue}>
                {t("cancel")}
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
