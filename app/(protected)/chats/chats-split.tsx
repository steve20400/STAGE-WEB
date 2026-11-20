import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { useTranslation } from "../../../src/i18n"
import { Outlet, useMatch } from "react-router-dom"
import ChatsPage from "./chats"
import "./chats-split.css"
import { BrandName } from "../../../src/components/brand-name"

/**
 * Vue deux colonnes facon WhatsApp Web : la liste des discussions reste
 * affichee a gauche (persistante grace au routage imbrique), la conversation
 * ouverte s'affiche a droite. Sur petit ecran, une seule colonne est visible
 * a la fois (liste, ou conversation si on en a ouvert une).
 */
/*
 * LA COLONNE DES DISCUSSIONS SE REDIMENSIONNE (demande du user, 20/11/2026) :
 * on tire la poignée posée sur son bord droit. La largeur par défaut est le
 * minimum ; le maximum est de 720 px, sans dépasser 55 % de la place (la
 * conversation garde toujours la plus grande part). La largeur est retenue
 * sur cet appareil ; un double-clic sur la poignée la remet par défaut.
 * Au clavier : flèches gauche et droite quand la poignée a le focus.
 */
const CLE_LARGEUR = "alanya-largeur-liste"
const LARGEUR_MAX = 720

function lireLargeur(): number | null {
  try {
    const v = Number(localStorage.getItem(CLE_LARGEUR))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

export default function ChatsSplit() {
  const { t } = useTranslation()
  // Vrai uniquement sur /chats/:chatId (pas sur /chats).
  const roomOpen = Boolean(useMatch("/chats/:chatId"))
  const [largeur, setLargeur] = useState<number | null>(lireLargeur)
  const colonne = useRef<HTMLDivElement>(null)
  const glisse = useRef<{ x: number; depart: number } | null>(null)

  useEffect(() => {
    try {
      if (largeur === null) localStorage.removeItem(CLE_LARGEUR)
      else localStorage.setItem(CLE_LARGEUR, String(Math.round(largeur)))
    } catch {
      /* stockage indisponible : la largeur vaut pour la session */
    }
  }, [largeur])

  const debut = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!colonne.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    glisse.current = { x: e.clientX, depart: colonne.current.getBoundingClientRect().width }
    document.body.classList.add("redimension-en-cours")
  }, [])
  const deplacement = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!glisse.current) return
    setLargeur(glisse.current.depart + (e.clientX - glisse.current.x))
  }, [])
  const fin = useCallback(() => {
    glisse.current = null
    document.body.classList.remove("redimension-en-cours")
    // La largeur réelle, une fois bornée par le CSS, est celle qu'on retient.
    if (colonne.current) setLargeur(colonne.current.getBoundingClientRect().width)
  }, [])
  const clavier = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    const actuelle = colonne.current?.getBoundingClientRect().width ?? 0
    setLargeur(actuelle + (e.key === "ArrowRight" ? 24 : -24))
  }, [])

  const style = largeur === null ? undefined : ({ "--largeur-liste": `${largeur}px` } as CSSProperties)

  return (
    <div className={`chats-split ${roomOpen ? "room-open" : ""}`}>
      <div className="chats-split-list" ref={colonne} style={style}>
        <ChatsPage />
        <div
          className="chats-split-poignee"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("redimensionner_liste")}
          title={t("redimensionner_liste")}
          tabIndex={0}
          onPointerDown={debut}
          onPointerMove={deplacement}
          onPointerUp={fin}
          onPointerCancel={fin}
          onDoubleClick={() => setLargeur(null)}
          onKeyDown={clavier}
        />
      </div>
      <div className="chats-split-room">
        <Outlet />
      </div>
    </div>
  )
}

/** Etat vide affiche a droite tant qu'aucune conversation n'est ouverte. */
export function ChatEmptyState() {
  const { t } = useTranslation()
  return (
    <div className="chats-empty">
      <div className="chats-empty-badge">
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </div>
      <div className="chats-empty-title">
        <BrandName />
      </div>
      <div className="chats-empty-sub">{t("select_conversation")}</div>
    </div>
  )
}
