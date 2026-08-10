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
export default function ChatsSplit() {
  // Vrai uniquement sur /chats/:chatId (pas sur /chats).
  const roomOpen = Boolean(useMatch("/chats/:chatId"))

  return (
    <div className={`chats-split ${roomOpen ? "room-open" : ""}`}>
      <div className="chats-split-list">
        <ChatsPage />
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
