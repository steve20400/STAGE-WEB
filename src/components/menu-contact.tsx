import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { startOutgoingCall } from "../services/call-manager"
import { createPrivateChat } from "../services/chats-service"
import { formatAlanyaNumber, normalizeAlanyaNumber } from "../lib/alanya-number"
import { useTranslation } from "../i18n"
import { useAuth } from "./auth-provider"
import { useToast } from "./toast"
import "./menu-contact.css"

/**
 * LE menu « trois points » d'un contact.
 *
 * Partout ou un contact apparait — reglages d'un groupe, participants d'une
 * reunion, repertoire, liste d'appel — les trois memes actions doivent etre a
 * portee : lui ECRIRE, l'appeler en AUDIO, l'appeler en VIDEO. Un seul
 * composant les porte, pour que le menu se ferme de la meme facon, s'ouvre du
 * meme cote et propose les memes entrees d'un ecran a l'autre.
 *
 * Rien de neuf sous le capot : la conversation se cree par `createPrivateChat`
 * et l'appel part par `startOutgoingCall`, exactement comme le fait deja le
 * repertoire. Ce composant ne fait que reunir ces chemins derriere un bouton.
 */
export interface MenuContactProps {
  /**
   * Identifiant du compte, quand l'ecran appelant le connait.
   *
   * Aucune des trois actions n'en a besoin — le backend designe toujours le
   * destinataire par son numero public. Il sert ici a UNE chose : reconnaitre
   * le titulaire de la session quand l'ecran a oublie de passer `estMoi`.
   */
  userId?: string | null
  /** Numero Alanya du contact. Toujours requis : c'est lui qui designe la cible. */
  numero: string
  /** Nom affiche, pour les libelles et le titre de l'appel. */
  nom?: string | null
  /**
   * Le contact EST le titulaire de la session.
   *
   * Seul « ecrire » garde un sens : le backend accepte la conversation avec
   * soi-meme (le « Moi » de WhatsApp, pour se garder des notes), mais s'appeler
   * soi-meme n'aboutirait nulle part. Le menu ne propose donc pas deux actions
   * qui echoueraient a coup sur.
   */
  estMoi?: boolean
  /** Variante resserree, pour une ligne dense. */
  compact?: boolean
  /**
   * Sort le panneau du flux et le pose a l'ecran.
   *
   * A utiliser dans un conteneur qui DECOUPE ses debordements. La bande des
   * participants d'une reunion defile a l'horizontale : `overflow-x: auto` force
   * l'axe vertical a etre decoupe lui aussi — c'est la regle CSS qui lie les
   * deux axes — et un panneau pose sous le bouton y etait tranche net par le
   * bord. Le menu y etait donc simplement absent, ce qui laissait un ecran
   * incoherent avec tous les autres.
   */
  flottant?: boolean
}

/** Ce qu'une entree du menu declenche. */
type Action = "ecrire" | "audio" | "video"

function IconeEcrire() {
  return (
    <svg
      className="mc-icone"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.9L3 20.5l1.6-4.1A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
    </svg>
  )
}

function IconeAudio() {
  return (
    <svg
      className="mc-icone"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.5 16.9v2.6a1.8 1.8 0 0 1-2 1.8 17.6 17.6 0 0 1-7.7-2.7 17.4 17.4 0 0 1-5.3-5.3A17.6 17.6 0 0 1 3.8 5.5a1.8 1.8 0 0 1 1.8-2h2.6a1.8 1.8 0 0 1 1.8 1.5c.1.9.3 1.7.6 2.5a1.8 1.8 0 0 1-.4 1.9l-1.1 1.1a14 14 0 0 0 5.3 5.3l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.6.5 2.5.6a1.8 1.8 0 0 1 1.6 1.9Z" />
    </svg>
  )
}

function IconeVideo() {
  return (
    <svg
      className="mc-icone"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m23 7-6 4.5L23 16V7Z" />
      <rect x="1" y="5" width="15" height="14" rx="2.5" />
    </svg>
  )
}

export function MenuContact({
  userId,
  numero,
  nom,
  estMoi,
  compact,
  flottant,
}: MenuContactProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const [ouvert, setOuvert] = useState(false)
  const [versLeHaut, setVersLeHaut] = useState(false)
  /** Place a l'ecran quand le panneau flotte. Nulle tant qu'il n'est pas mesure. */
  const [coordonnees, setCoordonnees] = useState<{ top: number; right: number } | null>(null)
  const [enCours, setEnCours] = useState(false)
  const ancre = useRef<HTMLDivElement>(null)
  const panneau = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  /** L'entree a mettre sous le focus a l'ouverture au clavier : premiere ou derniere. */
  const focusALOuverture = useRef<"premiere" | "derniere" | null>(null)
  /** Le composant peut disparaitre pendant l'appel reseau (ligne retiree de la liste). */
  const monte = useRef(true)

  useEffect(() => {
    monte.current = true
    return () => {
      monte.current = false
    }
  }, [])

  const numeroNormalise = useMemo(() => normalizeAlanyaNumber(numero), [numero])

  /**
   * Filet de securite : un ecran qui oublie `estMoi` afficherait deux actions
   * d'appel vouees a l'echec sur sa propre ligne. On reconnait donc aussi le
   * titulaire par son numero — ou par son identifiant quand l'appelant le
   * fournit. `estMoi` reste prioritaire : lui seul sait, par exemple, qu'une
   * ligne represente le compte alors que le numero n'y figure pas.
   */
  const cestMoi =
    estMoi ??
    ((numeroNormalise.length > 0 && normalizeAlanyaNumber(user?.phone ?? "") === numeroNormalise) ||
      (!!userId && !!user?.id && userId === user.id))

  /** Nom utilisable, sinon le numero mis en forme : jamais un libelle vide. */
  const libelleCible = (nom ?? "").trim() || formatAlanyaNumber(numeroNormalise)

  const fermer = useCallback(() => setOuvert(false), [])

  /** Fermer ET rendre le focus au bouton : au clavier, on ne le perd jamais. */
  const fermerEtRevenir = useCallback(() => {
    setOuvert(false)
    bouton.current?.focus()
  }, [])

  // Clic exterieur, Echap, et defilement de la liste. Repris du menu d'une
  // ligne de liste, y compris sa subtilite : cliquer le bouton lui donne le
  // focus, le navigateur fait alors defiler pour l'amener a l'ecran, et ce
  // defilement refermait le menu dans l'instant. On ignore donc les
  // defilements de la toute premiere frame.
  useEffect(() => {
    if (!ouvert) return

    const surClicExterieur = (e: PointerEvent) => {
      if (ancre.current && !ancre.current.contains(e.target as Node)) fermer()
    }
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        fermerEtRevenir()
      }
    }

    let ouvertureTerminee = false
    const fin = requestAnimationFrame(() => {
      ouvertureTerminee = true
    })
    const surDefilement = () => {
      if (ouvertureTerminee) fermer()
    }

    document.addEventListener("pointerdown", surClicExterieur)
    document.addEventListener("keydown", surTouche)
    window.addEventListener("scroll", surDefilement, true)
    return () => {
      cancelAnimationFrame(fin)
      document.removeEventListener("pointerdown", surClicExterieur)
      document.removeEventListener("keydown", surTouche)
      window.removeEventListener("scroll", surDefilement, true)
    }
  }, [ouvert, fermer, fermerEtRevenir])

  /**
   * Sens d'ouverture mesure sur le panneau REEL, une fois rendu.
   *
   * L'estimation a partir d'une hauteur supposee se trompe des qu'un libelle
   * passe sur deux lignes — un nom long, une langue verbeuse — et le menu
   * debordait alors en bas de l'ecran sans que le calcul s'en apercoive.
   */
  useEffect(() => {
    if (!ouvert) return
    const cadre = panneau.current
    const ancrage = ancre.current
    if (!cadre || !ancrage) return
    const place = ancrage.getBoundingClientRect()
    const hauteur = cadre.getBoundingClientRect().height
    const enDessous = window.innerHeight - place.bottom
    const enDessus = place.top
    // On ne bascule que s'il y a vraiment plus de place au-dessus : sinon on
    // garde le sens naturel et le panneau defile.
    const versHaut = hauteur + 12 > enDessous && enDessus > enDessous
    setVersLeHaut(versHaut)
    // Flottant : le panneau quitte le flux, il faut donc lui donner sa place a
    // l'ecran. `right` plutot que `left` pour qu'il reste aligne sur le bouton
    // quand il est plus large que lui, comme dans le flux.
    if (flottant) {
      setCoordonnees({
        top: versHaut ? place.top - hauteur - 6 : place.bottom + 6,
        right: Math.max(8, window.innerWidth - place.right),
      })
    }
  }, [ouvert, cestMoi, flottant])

  // Ouverture au clavier : le focus part sur l'entree demandee une fois le
  // panneau rendu.
  useEffect(() => {
    if (!ouvert || focusALOuverture.current === null) return
    const entrees = panneau.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']")
    if (entrees && entrees.length > 0) {
      const cible =
        focusALOuverture.current === "derniere" ? entrees[entrees.length - 1] : entrees[0]
      cible.focus()
    }
    focusALOuverture.current = null
  }, [ouvert])

  /**
   * Ouvre la conversation directe avec ce numero.
   *
   * Le meme appel sert au « Moi » : le backend rend la conversation a un seul
   * participant quand le numero est celui de la session. Rien de special a
   * faire ici, l'ecran de discussion se charge du reste.
   */
  const lancer = useCallback(
    async (action: Action) => {
      if (enCours) return
      setEnCours(true)
      try {
        const conversation = await createPrivateChat(numeroNormalise)
        if (action === "ecrire") {
          navigate(`/chats/${conversation.id}`)
          return
        }
        const callId = await startOutgoingCall(conversation.id, action, libelleCible)
        // On emporte l'endroit d'ou l'on part : a la fin de l'appel, l'ecran y
        // ramene au lieu de deposer tout le monde sur la liste des appels.
        const depart = `${location.pathname}${location.search}`
        navigate(`/calls/${callId}?type=${action}&returnTo=${encodeURIComponent(depart)}`)
      } catch (err) {
        const detail = err instanceof Error ? err.message : undefined
        if (action === "ecrire") {
          toast.error(t("error"), detail ?? t("conv_create_failed"))
        } else {
          toast.error(t("call_failed"), detail ?? t("call_failed_now"))
        }
      } finally {
        // Le composant peut avoir disparu entre-temps : la ligne quitte la
        // liste, ou la navigation a demonte l'ecran entier.
        if (monte.current) setEnCours(false)
      }
    },
    [enCours, numeroNormalise, libelleCible, navigate, location, toast, t]
  )

  const choisir = (action: Action) => {
    fermer()
    void lancer(action)
  }

  /** Deplacement du focus d'une entree a l'autre, en boucle. */
  const surToucheDansLeMenu = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return
    const entrees = Array.from(
      panneau.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []
    )
    if (entrees.length === 0) return
    e.preventDefault()
    const position = entrees.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === "Home") return entrees[0].focus()
    if (e.key === "End") return entrees[entrees.length - 1].focus()
    const pas = e.key === "ArrowDown" ? 1 : -1
    const suivante = (position + pas + entrees.length) % entrees.length
    entrees[suivante].focus()
  }

  const surToucheDuBouton = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    e.preventDefault()
    const depuisLaFin = e.key === "ArrowUp"

    // Menu deja ouvert (a la souris) : le focus n'est pas encore entre dedans,
    // et il n'y aura pas de nouveau rendu pour l'y mettre. On l'y place ici.
    if (ouvert) {
      const entrees = panneau.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']")
      if (entrees && entrees.length > 0) {
        ;(depuisLaFin ? entrees[entrees.length - 1] : entrees[0]).focus()
      }
      return
    }

    focusALOuverture.current = depuisLaFin ? "derniere" : "premiere"
    setOuvert(true)
  }

  /**
   * Sans numero, les trois actions echoueraient : mieux vaut pas de menu qu'un
   * menu qui ne mene nulle part.
   */
  if (numeroNormalise.length === 0) return null

  const libelleEcrire = cestMoi
    ? t("mc_note_to_self")
    : (nom ?? "").trim()
      ? t("mc_write_to", { nom: libelleCible })
      : t("send_message")

  const libelleBouton = (nom ?? "").trim()
    ? t("mc_actions_for", { nom: libelleCible })
    : t("mc_actions")

  return (
    <div className="mc-ancre" ref={ancre}>
      <button
        type="button"
        ref={bouton}
        className={`mc-bouton${ouvert ? " ouvert" : ""}${compact ? " compact" : ""}`}
        aria-label={libelleBouton}
        title={libelleBouton}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        onKeyDown={surToucheDuBouton}
        onClick={(e) => {
          // La ligne entiere porte souvent sa propre action — ouvrir une
          // discussion, rejoindre un appel : elle ne doit pas se declencher
          // en ouvrant le menu.
          e.stopPropagation()
          setOuvert((valeur) => !valeur)
        }}
      >
        <svg
          width={compact ? 13 : 15}
          height={compact ? 13 : 15}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {ouvert && (
        <div
          role="menu"
          aria-label={libelleBouton}
          ref={panneau}
          className={`mc-menu${versLeHaut ? " vers-le-haut" : ""}`}
          onKeyDown={surToucheDansLeMenu}
          onClick={(e) => e.stopPropagation()}
          // Le menu sert aussi dans la fenetre d'appel reduite, qui se deplace
          // au pointeur : sans cela, l'ouvrir ferait glisser la fenetre.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="mc-item"
            disabled={enCours}
            onClick={() => choisir("ecrire")}
          >
            <IconeEcrire />
            <span className="mc-item-texte">{libelleEcrire}</span>
          </button>

          {/* S'appeler soi-meme n'aboutirait nulle part : les deux entrees
              d'appel disparaissent plutot que d'echouer sous les yeux. */}
          {!cestMoi && (
            <>
              <button
                type="button"
                role="menuitem"
                className="mc-item"
                disabled={enCours}
                onClick={() => choisir("audio")}
              >
                <IconeAudio />
                <span className="mc-item-texte">{t("audio_call")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="mc-item"
                disabled={enCours}
                onClick={() => choisir("video")}
              >
                <IconeVideo />
                <span className="mc-item-texte">{t("video_call")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
