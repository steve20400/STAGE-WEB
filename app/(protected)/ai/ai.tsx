import { useTranslation } from "../../../src/i18n"
import { useEffect, useRef, useState } from "react"
import { useToast } from "../../../src/components/toast"
import {
  clearAiHistory,
  fetchAiMessages,
  sendAiMessage,
  type AiMessage,
} from "../../../src/services/ai-service"
import "../chats/[chatId]/chat-room-page.css"

/**
 * Assistant IA (Gemini via le backend) — meme ecran que sur l'app mobile :
 * un fil unique par utilisateur, bulle terracotta pour soi, bulle claire
 * pour l'assistant.
 */
export default function AiAssistantPage() {
  const { t } = useTranslation()
  const { error } = useToast()
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [thinking, setThinking] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    void fetchAiMessages()
      .then((list) => {
        if (!cancelled) setMessages(list)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

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

    try {
      const reply = await sendAiMessage(text)
      setMessages((prev) => [...prev, reply])
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
    try {
      await clearAiHistory()
      setMessages([])
    } catch (err) {
      const message = err instanceof Error ? err.message : t("set_delete_failed_detail")
      error(t("error"), message)
    } finally {
      setConfirmClear(false)
    }
  }

  return (
    <div className="room-root">
      {/* En-tete facon conversation */}
      <div className="room-top">
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
        </div>
        <div className="room-actions">
          <button
            className="action-btn"
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
          <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>
            {t("loading")}
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 34, marginBottom: 12 }}>✨</div>
            <div
              style={{
                fontFamily: "'Bricolage Grotesque', sans-serif",
                fontWeight: 800,
                fontSize: 18,
                color: "var(--text-primary)",
                marginBottom: 6,
              }}
            >
              {t("ai_ask_me")}
            </div>
            <div
              style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 380, margin: "0 auto" }}
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
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {msg.content}
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
          onClick={() => setConfirmClear(false)}
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
                fontSize: 15,
                color: "var(--text-primary)",
                marginBottom: 8,
              }}
            >
              {t("ai_clear_confirm")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
              {t("ai_clear_detail")}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => setConfirmClear(false)}
                style={{
                  background: "none",
                  border: "1px solid var(--border-default)",
                  borderRadius: 8,
                  padding: "8px 14px",
                  color: "var(--text-secondary)",
                  fontSize: 12,
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
                  fontSize: 12,
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
  )
}
