import { apiRequest } from "../lib/api-client"

/**
 * Message du fil de discussion avec l'Assistant Alanya.
 *
 * Le client ne sait RIEN de ce qui repond derriere, et c'est voulu : le
 * fournisseur ne doit apparaitre nulle part hors de `src/lib/assistant.ts`,
 * cote serveur. Ces deux depots sont publics.
 */
export interface AiMessage {
  id: string
  role: "USER" | "MODEL"
  content: string
  createdAt: string
}

/** GET /api/ai/messages — historique du fil unique de l'utilisateur. */
export async function fetchAiMessages(): Promise<AiMessage[]> {
  const response = await apiRequest<{ threadId: string | null; messages: AiMessage[] }>(
    "/api/ai/messages"
  )
  return response.messages ?? []
}

/** POST /api/ai/chat — envoie un message et renvoie la reponse de l'assistant. */
export async function sendAiMessage(message: string): Promise<AiMessage> {
  const response = await apiRequest<{ threadId: string; reply: AiMessage }>("/api/ai/chat", {
    method: "POST",
    body: { message },
    // ⚠️ 75 S ET NON 20 (14/11/2026) : l'assistant peut chercher sur Internet
    // et lire des pages avant de repondre. Le serveur borne ce travail (35 s
    // d'outils, puis une derniere reponse) ; le delai ordinaire l'aurait coupe.
    signal: AbortSignal.timeout(75_000),
  })
  return response.reply
}

/** DELETE /api/ai/messages — efface tout l'historique. */
export async function clearAiHistory(): Promise<void> {
  await apiRequest("/api/ai/messages", { method: "DELETE" })
}

/*
 * LES CONVERSATIONS AVEC L'ASSISTANT (20/11/2026), comme sur le mobile
 * (`ai_repository.dart`). Le serveur les tient depuis longtemps ; le web, lui,
 * ne connaissait que l'ancien fil unique (`/api/ai/messages`).
 */

/** Résumé d'une conversation, pour la liste (de la plus récente à la plus ancienne). */
export interface AiConversation {
  id: string
  title: string
  updatedAt: string | null
  lastMessage: string | null
}

export async function listerConversationsIa(): Promise<AiConversation[]> {
  const reponse = await apiRequest<{
    threads?: Array<{ id: string; title?: string | null; updatedAt?: string | null; lastMessage?: string | null }>
  }>("/api/ai/threads")
  return (reponse?.threads ?? []).map((t) => ({
    id: t.id,
    title: t.title || "Conversation",
    updatedAt: t.updatedAt ?? null,
    lastMessage: t.lastMessage ?? null,
  }))
}

export async function messagesConversationIa(threadId: string): Promise<AiMessage[]> {
  const reponse = await apiRequest<{ messages?: AiMessage[] }>(
    `/api/ai/threads/${encodeURIComponent(threadId)}/messages`
  )
  return reponse?.messages ?? []
}

/**
 * Envoie un message dans une conversation ; `threadId` nul en ouvre une
 * nouvelle. Rend l'identifiant de la conversation, pour la poursuivre.
 * 75 secondes : l'assistant peut chercher sur Internet avant de répondre.
 */
export async function envoyerMessageIa(
  message: string,
  threadId: string | null
): Promise<{ threadId: string; reply: AiMessage }> {
  return apiRequest<{ threadId: string; reply: AiMessage }>("/api/ai/chat", {
    method: "POST",
    body: threadId ? { message, threadId } : { message },
    signal: AbortSignal.timeout(75_000),
  })
}

export async function supprimerConversationIa(threadId: string): Promise<void> {
  await apiRequest(`/api/ai/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" })
}
