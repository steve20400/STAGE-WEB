import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "../i18n"
import { sendMeetingMessage, subscribeToMeetingEvents } from "../services/websocket-service"
import { getMyUserId } from "../data/session-user"
import "./meeting-chat.css"

interface MessageSalle {
  /** Composee : le serveur ne numerote pas un fil qu'il ne conserve pas. */
  cle: string
  auteurId: string
  auteur: string
  texte: string
  envoyeA: string
}

/**
 * Fil de discussion de la salle de reunion.
 *
 * Reprend la grammaire du fil des discussions — bulles a droite pour soi, a
 * gauche pour les autres, nom de l'auteur au-dessus, heure sous le texte — pour
 * qu'il n'y ait rien a reapprendre en passant de l'un a l'autre.
 *
 * Mais il n'en est pas une copie : le fil est EPHEMERE. Rien n'est ecrit en
 * base, rien n'est mis en cache, et qui arrive en cours de reunion ne voit pas
 * ce qui a ete dit avant — le serveur n'a aucun historique a lui renvoyer. D'ou
 * l'absence de tout ce que suppose un fil durable : pagination, accuses de
 * lecture, reponses, medias, edition. Les proposer laisserait croire a une
 * permanence qui n'existe pas.
 *
 * On n'affiche pas non plus le message avant sa confirmation : le serveur le
 * renvoie a son auteur comme aux autres, et c'est son ordre qui fait foi.
 */
export function MeetingChat({ meetingId }: { meetingId: number }) {
  const { t, language } = useTranslation()
  const monId = useMemo(() => getMyUserId(), [])
  const [messages, setMessages] = useState<MessageSalle[]>([])
  const [brouillon, setBrouillon] = useState("")
  const basRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return subscribeToMeetingEvents((event) => {
      if (event.type !== "meeting_message") return
      if (Number(event.meetingId) !== meetingId) return
      const envoyeA = String(event.sentAt ?? "")
      const auteurId = String(event.fromUserId ?? "")
      setMessages((precedents) => [
        ...precedents,
        {
          cle: `${auteurId}-${envoyeA}-${precedents.length}`,
          auteurId,
          auteur: String(event.displayName ?? ""),
          texte: String(event.text ?? ""),
          envoyeA,
        },
      ])
    })
  }, [meetingId])

  // Le fil suit toujours le dernier message : il est court et se lit d'un bloc,
  // personne ne remonte dans un fil qui disparaitra a la fin de la reunion.
  useEffect(() => {
    basRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const envoyer = () => {
    const texte = brouillon.trim()
    if (!texte) return
    sendMeetingMessage(meetingId, texte)
    setBrouillon("")
  }

  const heure = (iso: string) => {
    const date = new Date(iso)
    return isNaN(date.getTime())
      ? ""
      : date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })
  }

  return (
    <section className="salle-fil" aria-label={t("meet_chat_title")}>
      <header className="salle-fil-tete">
        <span>{t("meet_chat_title")}</span>
        {/* Dit d'emblee ce que le fil ne fera pas : on ne decouvre pas a la fin
            que la conversation a disparu. */}
        <small>{t("meet_chat_ephemeral")}</small>
      </header>

      <div className="salle-fil-corps">
        {messages.length === 0 ? (
          <p className="salle-fil-vide">{t("meet_chat_empty")}</p>
        ) : (
          messages.map((message) => {
            const deMoi = message.auteurId === monId
            return (
              <div key={message.cle} className={`salle-msg${deMoi ? " de-moi" : ""}`}>
                {!deMoi && <span className="salle-msg-auteur">{message.auteur}</span>}
                <span className="salle-msg-texte">{message.texte}</span>
                <span className="salle-msg-heure">{heure(message.envoyeA)}</span>
              </div>
            )
          })
        )}
        <div ref={basRef} />
      </div>

      <div className="salle-fil-saisie">
        <input
          value={brouillon}
          onChange={(e) => setBrouillon(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              envoyer()
            }
          }}
          placeholder={t("meet_chat_placeholder")}
          aria-label={t("meet_chat_placeholder")}
          maxLength={2000}
        />
        <button onClick={envoyer} disabled={!brouillon.trim()} aria-label={t("send")}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
    </section>
  )
}
