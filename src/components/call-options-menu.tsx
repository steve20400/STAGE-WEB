import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import { useCallState } from "../hooks/use-call"
import { useContacts } from "../hooks/use-contacts"
import { useToast } from "./toast"
import {
  restoreActiveCall,
  setCallDisplayMode,
  transferCall,
  type CallDisplayMode,
} from "../services/call-manager"
import "./call-options-menu.css"

const LIBELLE_TAILLE: Record<CallDisplayMode, string> = {
  small: "Petit ecran",
  medium: "Ecran moyen",
  full: "Grand ecran",
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
  const call = useCallState()
  const navigate = useNavigate()
  const { contacts } = useContacts()
  const toast = useToast()

  const [vue, setVue] = useState<"racine" | "taille">("racine")
  const [dialogue, setDialogue] = useState<null | "inviter" | "transferer">(null)
  const [recherche, setRecherche] = useState("")
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
    setDialogue(lequel)
    onClose()
  }

  const fermerDialogue = () => {
    setDialogue(null)
    setRecherche("")
  }

  const changerTaille = (mode: CallDisplayMode) => {
    onClose()
    if (mode === call.displayMode) return

    if (mode === "full") {
      const id = call.activeCallId
      restoreActiveCall()
      // Le grand ecran est une route a part entiere : il faut y aller.
      requestAnimationFrame(() => navigate(`/calls/${id}?type=${call.callType}`, { replace: true }))
      return
    }

    const depuisLeGrandEcran = call.displayMode === "full"
    setCallDisplayMode(mode)
    if (depuisLeGrandEcran) navigate(returnTo)
  }

  const inviter = (nom: string) => {
    // TODO: envoyer l'invitation par WebSocket quand le signal existera cote
    // serveur. En attendant, l'utilisateur a au moins un retour explicite.
    fermerDialogue()
    toast.info("Invitation a venir", `L'invitation de ${nom} n'est pas encore transmise.`)
  }

  /**
   * Le destinataire est designe par son numero public : `contact.id` est
   * l'identifiant de la FICHE contact, pas celui de l'utilisateur distant.
   */
  const transferer = (numero: string, nom: string) => {
    fermerDialogue()
    // transferCall est asynchrone : un try/catch autour de l'appel ne verrait
    // jamais le rejet, l'echec passerait pour un succes.
    transferCall(numero)
      .then(() => toast.success("Transfert demande", `L'appel est transfere vers ${nom}.`))
      .catch((err: unknown) =>
        toast.error("Transfert impossible", err instanceof Error ? err.message : undefined)
      )
  }

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
                <span>Taille de la fenetre</span>
                <span className="call-opt-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              <button
                className="call-opt-item"
                role="menuitem"
                onClick={() => ouvrirDialogue("inviter")}
              >
                Inviter une personne
              </button>
              <button
                className="call-opt-item"
                role="menuitem"
                onClick={() => ouvrirDialogue("transferer")}
              >
                Transferer l'appel
              </button>
            </>
          ) : (
            <>
              <button className="call-opt-retour" onClick={() => setVue("racine")}>
                <span aria-hidden="true">‹</span> Taille de la fenetre
              </button>
              {AUTRES_TAILLES[call.displayMode].map((mode) => (
                <button
                  key={mode}
                  className="call-opt-item"
                  role="menuitem"
                  onClick={() => changerTaille(mode)}
                >
                  {LIBELLE_TAILLE[mode]}
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
                {dialogue === "inviter" ? "Inviter une personne" : "Transferer l'appel"}
              </div>

              <input
                className="call-opt-search"
                type="text"
                autoFocus
                placeholder="Rechercher par nom ou numero..."
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />

              <div className="call-opt-list">
                {contactsFiltres.length > 0 ? (
                  contactsFiltres.map((contact) => (
                    <button
                      key={contact.id}
                      className="call-opt-contact"
                      onClick={() =>
                        dialogue === "inviter"
                          ? inviter(contact.name)
                          : transferer(contact.phone, contact.name)
                      }
                    >
                      <b>{contact.name}</b>
                      <span>{contact.phone}</span>
                    </button>
                  ))
                ) : (
                  <div className="call-opt-vide">Aucun contact trouve</div>
                )}
              </div>

              <button className="call-opt-annuler" onClick={fermerDialogue}>
                Annuler
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
