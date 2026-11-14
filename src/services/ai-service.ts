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
