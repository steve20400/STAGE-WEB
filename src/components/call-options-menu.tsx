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
import "./call-options-menu.css"

/** Cles, pas libelles : le menu se traduit au rendu, pas au chargement du module. */
const LIBELLE_TAILLE: Record<CallDisplayMode, Cle> = {
  small: "size_small_screen",
  medium: "size_medium_screen",
  full: "size_large_screen",
}

/** Disposition d'un clavier de telephone, la meme que celle du composeur. */
const TOUCHES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""] as const

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

  const taper = useCallback((touche: string) => {
    setChiffres((actuel) =>
      normalizeAlanyaNumber(actuel + touche).slice(0, ALANYA_NUMBER_MAX_LENGTH)
    )
  }, [])

  const effacer = useCallback(() => setChiffres((actuel) => actuel.slice(0, -1)), [])

  const validerLeNumero = useCallback(() => {
    if (!isValidAlanyaNumber(chiffres)) return
    valider(chiffres, contactDuNumero?.name ?? formatAlanyaNumber(chiffres))
  }, [chiffres, contactDuNumero, valider])

  // On est dans un navigateur : le clavier physique doit composer aussi.
  useEffect(() => {
    if (dialogue === null || onglet !== "numero") return
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") return fermerDialogue()
      if (e.key === "Enter") return validerLeNumero()
      if (e.key === "Backspace") {
        e.preventDefault()
        return effacer()
      }
      if (/^[0-9]$/.test(e.key)) taper(e.key)
    }
    document.addEventListener("keydown", surTouche)
    return () => document.removeEventListener("keydown", surTouche)
  }, [dialogue, onglet, effacer, fermerDialogue, taper, validerLeNumero])

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
                <div className="call-opt-pave">
                  <div className="call-opt-numero" aria-live="polite">
                    {chiffres ? (
                      formatAlanyaNumber(chiffres)
                    ) : (
                      <span className="call-opt-numero-vide">Alanya ID</span>
                    )}
                  </div>
                  <div className="call-opt-numero-aide" aria-live="polite">
                    {chiffres.length === 0
                      ? t("dial_hint_number")
                      : contactDuNumero
                        ? contactDuNumero.name
                        : numeroValide
                          ? t("number_complete")
                          : t("digits_too_short", { n: chiffres.length })}
                  </div>

                  <div className="call-opt-touches">
                    {TOUCHES.map((touche, index) =>
                      touche === "" ? (
                        // Les cases vides tiennent la grille : le 0 reste centre
                        // sous le 8, comme sur un telephone.
                        <span key={`vide-${index}`} aria-hidden />
                      ) : (
                        <button
                          key={touche}
                          className="call-opt-touche"
                          onClick={() => taper(touche)}
                          aria-label={touche}
                        >
                          {touche}
                        </button>
                      )
                    )}
                  </div>

                  <button
                    className="call-opt-effacer"
                    onClick={effacer}
                    disabled={chiffres.length === 0}
                    aria-label={t("erase_last_digit")}
                  >
                    ⌫ {t("erase")}
                  </button>

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
                </div>
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
