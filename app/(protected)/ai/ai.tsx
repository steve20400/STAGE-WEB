import { useTranslation } from "../../../src/i18n"
import { FenetreSignalement } from "../../../src/components/signalement"
import { Icone } from "../../../src/components/icone"
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useToast } from "../../../src/components/toast"
import { RowActionsMenu } from "../../../src/components/row-actions-menu"
import {
  envoyerMessageIa,
  listerConversationsIa,
  messagesConversationIa,
  supprimerConversationIa,
  type AiConversation,
  type AiMessage,
} from "../../../src/services/ai-service"
import "../chats/[chatId]/chat-room-page.css"
import "./ai-page.css"

// La mise en forme des reponses, chargee a la demande (01/11/2026) : voir
// `texte-markdown.tsx`.
const TexteMarkdown = lazy(() => import("../../../src/components/texte-markdown"))

/**
 * Assistant Alanya (via le backend) — meme ecran que sur l'app mobile :
 * un fil unique par utilisateur, bulle terracotta pour soi, bulle claire
 * pour l'assistant.
 */
/** Une réponse enregistrée a un identifiant serveur ; une réponse en cours, non. */
const ID_SERVEUR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function AiAssistantPage() {
  /** La réponse ouverte dans la fenêtre « Signaler » (18/11/2026). */
  const [aSignaler, setASignaler] = useState<string | null>(null)
  const { t } = useTranslation()
  const { error } = useToast()
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [thinking, setThinking] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  /*
   * LES CONVERSATIONS (20/11/2026), comme sur le mobile : la liste à gauche,
   * la conversation ouverte à droite. À l'ouverture de l'écran, la plus
   * récente s'affiche ; « + » en commence une nouvelle, dont l'identifiant
   * arrive avec la première réponse. Sur téléphone, une seule colonne à la
   * fois : la conversation, et la liste derrière le bouton de l'en-tête.
   */
  const [conversations, setConversations] = useState<AiConversation[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [listeVisible, setListeVisible] = useState(false)
  /** Conversation à supprimer depuis la liste (sinon : la conversation ouverte). */
  const [aSupprimer, setASupprimer] = useState<string | null>(null)
  /** Ignore une réponse qui arrive pour une conversation qu'on a quittée. */
  const conversationAffichee = useRef<string | null>(null)

  const rafraichirListe = useCallback(async () => {
    try {
      const liste = await listerConversationsIa()
      setConversations(liste)
      return liste
    } catch {
      return null
    }
  }, [])

  const ouvrirConversation = useCallback(
    async (id: string) => {
      conversationAffichee.current = id
      setThreadId(id)
      setListeVisible(false)
      setLoading(true)
      try {
        const liste = await messagesConversationIa(id)
        if (conversationAffichee.current === id) setMessages(liste)
      } catch (err) {
        error(t("assistant"), err instanceof Error ? err.message : t("ai_unavailable"))
      } finally {
        if (conversationAffichee.current === id) setLoading(false)
      }
    },
    [error, t]
  )

  const nouvelleConversation = useCallback(() => {
    conversationAffichee.current = null
    setThreadId(null)
    setMessages([])
    setListeVisible(false)
    setLoading(false)
    inputRef.current?.focus()
  }, [])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // À l'ouverture : la liste, puis la conversation la plus récente.
  useEffect(() => {
    let annule = false
    void (async () => {
      const liste = await rafraichirListe()
      if (annule) return
      if (liste && liste.length > 0) await ouvrirConversation(liste[0].id)
      else setLoading(false)
    })()
    return () => {
      annule = true
    }
  }, [ouvrirConversation, rafraichirListe])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, thinking])

  const send = async () => {
    const text = input.trim()
    if (!text || thinking) return

    const optimistic: AiMessage = {
      id: `tmp-${Date.now()}`,
      role: "USER",
      content: text,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])
    setInput("")
    setThinking(true)

    const depuis = threadId
    try {
      const { threadId: recu, reply } = await envoyerMessageIa(text, depuis)
      // On a pu changer de conversation pendant que l'assistant réfléchissait.
      if (conversationAffichee.current === depuis) {
        conversationAffichee.current = recu
        setThreadId(recu)
        setMessages((prev) => [...prev, reply])
      }
      // Une nouvelle conversation apparaît en tête ; une ancienne y remonte.
      void rafraichirListe()
    } catch (err) {
      const message = err instanceof Error ? err.message : t("ai_unavailable")
      error(t("assistant"), message)
    } finally {
      setThinking(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const handleClear = async () => {
    const cible = aSupprimer ?? threadId
    try {
      if (cible) await supprimerConversationIa(cible)
      if (cible === threadId) nouvelleConversation()
      setConversations((liste) => liste.filter((c) => c.id !== cible))
    } catch (err) {
      const message = err instanceof Error ? err.message : t("set_delete_failed_detail")
      error(t("error"), message)
    } finally {
      setConfirmClear(false)
      setASupprimer(null)
    }
  }

  const titreOuvert = conversations.find((c) => c.id === threadId)?.title

  return (
    <div className={`ia-page${listeVisible ? " liste-visible" : ""}`}>
      <aside className="ia-liste" aria-label={t("ai_my_conversations")}>
        <div className="ia-liste-tete">
          <h2 className="ia-liste-titre">{t("ai_my_conversations")}</h2>
          <button
            type="button"
            className="ia-nouvelle"
            onClick={nouvelleConversation}
            aria-label={t("ai_new_conversation")}
            title={t("ai_new_conversation")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
        {conversations.length === 0 ? (
          <p className="ia-liste-vide">{t("ai_empty")}</p>
        ) : (
          <ul className="ia-conversations">
            {conversations.map((c) => (
              <li key={c.id}>
                <div
                  className={`ia-conversation${c.id === threadId ? " active" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-current={c.id === threadId ? "true" : undefined}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('[aria-haspopup="menu"], [role="menu"]')) return
                    void ouvrirConversation(c.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) void ouvrirConversation(c.id)
                  }}
                >
                  <span className="ia-conversation-icone" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                  </span>
                  <span className="ia-conversation-texte">
                    <span className="ia-conversation-titre">{c.title}</span>
                    {c.lastMessage && <span className="ia-conversation-apercu">{c.lastMessage}</span>}
                  </span>
                  <RowActionsMenu
                    ariaLabel={t("l2_actions_for", { nom: c.title })}
                    actions={[
                      {
                        label: t("delete"),
                        danger: true,
                        onSelect: () => {
                          setASupprimer(c.id)
                          setConfirmClear(true)
                        },
                      },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>

    <div className="room-root ia-fil">
      {/* En-tete facon conversation */}
      <div className="room-top">
        {/* Sur téléphone : la liste des conversations, derrière ce bouton. */}
        <button
          type="button"
          className="action-btn ia-voir-liste"
          onClick={() => setListeVisible(true)}
          aria-label={t("ai_my_conversations")}
          title={t("ai_my_conversations")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M8 6h13M8 12h13M8 18h13" />
            <circle cx="3.5" cy="6" r="1.2" />
            <circle cx="3.5" cy="12" r="1.2" />
            <circle cx="3.5" cy="18" r="1.2" />
          </svg>
        </button>
        <div className="room-av" style={{ background: "var(--brand)", color: "var(--brand-text)" }}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
            <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
          </svg>
        </div>
        <div className="room-info">
          <div className="room-name">{t("s2_ai_name")}</div>
          <div className="room-sub">{titreOuvert ?? t("ai_new_conversation")}</div>
        </div>
        <div className="room-actions">
          <button
            className="action-btn ia-nouvelle-tete"
            onClick={nouvelleConversation}
            title={t("ai_new_conversation")}
            aria-label={t("ai_new_conversation")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            className="action-btn"
            disabled={!threadId}
            onClick={() => setConfirmClear(true)}
            title={t("ai_clear")}
            aria-label={t("ai_clear")}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Fil de discussion */}
      <div className="room-body">
        {loading && (
          <div style={{ padding: 20, color: "var(--text-muted)", fontSize: "0.8125rem" }}>
            {t("loading")}
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ marginBottom: 12, color: "var(--accent)" }}><Icone nom="etincelles" taille={34} /></div>
            <div
              style={{
                fontFamily: "'Bricolage Grotesque', sans-serif",
                fontWeight: 800,
                fontSize: "1.125rem",
                color: "var(--text-primary)",
                marginBottom: 6,
              }}
            >
              {t("ai_ask_me")}
            </div>
            <div
              style={{ fontSize: "0.8125rem", color: "var(--text-muted)", maxWidth: 380, margin: "0 auto" }}
            >
              {t("ai_intro")}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isMe = msg.role === "USER"
          return (
            <div
              key={msg.id}
              style={{
                display: "flex",
                justifyContent: isMe ? "flex-end" : "flex-start",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  maxWidth: "76%",
                  background: isMe ? "var(--bubble-me-bg)" : "var(--bubble-them-bg)",
                  color: isMe ? "var(--bubble-me-text)" : "var(--bubble-them-text)",
                  padding: "10px 14px",
                  borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  fontSize: "0.8125rem",
                  lineHeight: 1.6,
                  // Mes messages gardent leurs retours a la ligne ; la reponse
                  // de l'assistant est mise en forme (titres, listes, code…).
                  whiteSpace: isMe ? "pre-wrap" : "normal",
                  wordBreak: "break-word",
                }}
              >
                {isMe ? (
                  msg.content
                ) : (
                  <Suspense fallback={<span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>}>
                    <TexteMarkdown texte={msg.content} />
                  </Suspense>
                )}
                {/* SIGNALER UNE RÉPONSE (18/11/2026, exigence du Play Store pour
                    l'IA générative). Seulement une réponse enregistrée. */}
                {!isMe && ID_SERVEUR.test(msg.id) && (
                  <button type="button" className="ai-signaler" onClick={() => setASignaler(msg.id)}>
                    {t("sig_signaler")}
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {thinking && (
          <div className="typing-indicator">
            <div className="typing-av" style={{ background: "var(--brand)", color: "#fff" }}>
              {t("s2_ai_short")}
            </div>
            <div className="typing-bubble">
              <div className="td" />
              <div className="td" />
              <div className="td" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
        {aSignaler && (<FenetreSignalement cible={{ type: "ia", aiMessageId: aSignaler }} onFermer={() => setASignaler(null)} />)}
      </div>

      {/* Zone de saisie */}
      <div className="room-input-wrap">
        <div className="room-input-row">
          <textarea
            ref={inputRef}
            className="room-textarea"
            placeholder={t("ai_placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            aria-label={t("s2_write_to_assistant")}
          />
          <button
            className="send-btn"
            onClick={() => void send()}
            disabled={!input.trim() || thinking}
            aria-label={t("send")}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--bg-base)"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div className="input-hint">{t("ai_enter_hint")}</div>
      </div>

      {confirmClear && (
        <div
          onClick={() => {
            setConfirmClear(false)
            setASupprimer(null)
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 8500,
            background: "var(--overlay)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(360px, 100%)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 14,
              padding: 20,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: "0.9375rem",
                color: "var(--text-primary)",
                marginBottom: 8,
              }}
            >
              {t("ai_clear_confirm")}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 16 }}>
              {t("ai_delete_conversation_body")}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => {
                  setConfirmClear(false)
                  setASupprimer(null)
                }}
                style={{
                  background: "none",
                  border: "1px solid var(--border-default)",
                  borderRadius: 8,
                  padding: "8px 14px",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => void handleClear()}
                style={{
                  background: "var(--danger)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 14px",
                  color: "#fff",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t("erase")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
