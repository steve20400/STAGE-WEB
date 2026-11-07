import { apiRequest, ApiError } from "../../../src/lib/api-client"

/*
 * LES APPELS DE LA CONSOLE DÉVELOPPEUR (07/11/2026).
 *
 * Une personne se connecte avec son compte Alanya, puis crée une ENSEIGNE : un
 * nom et un numéro Alanya propres. Les clés, le journal et le webhook
 * appartiennent à l'enseigne, et c'est elle qui envoie les messages de l'API.
 * Voir `backend-alanya/src/lib/developer/enseignes.ts`.
 *
 * 🔴 RIEN N'EST CRÉÉ À LA LECTURE : ouvrir la console ne fait plus de personne
 * un développeur. Une enseigne n'existe que si on la crée.
 */

export interface Enseigne {
  id: string
  nom: string
  /** Le numéro Alanya de l'enseigne : l'expéditeur des messages. */
  numero: string
  clesActives: number
  creeLe: string
}

export interface EtatEnseignes {
  /** Faux pour un agent, un centre d'appels, un centre vocal. */
  autorise: boolean
  limite: number
  /** Le compte a l'application : un code y sera envoyé avant de créer. */
  confirmationRequise: boolean
  enseignes: Enseigne[]
}

export interface Cle {
  id: string
  name: string
  /** Les 12 premiers caractères, les mêmes que dans le journal. */
  prefix: string
  isActive: boolean
  lastUsedAt: string | null
  createdAt: string
}

export interface Webhook {
  url: string
  /** Réaffichable à volonté (décision du 07/11/2026), comme chez Stripe. */
  secretKey: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface LigneJournal {
  id: string
  endpoint: string
  method: string
  statusCode: number
  latencyMs: number
  keyPrefix: string | null
  createdAt: string
}

export interface Journal {
  logs: LigneJournal[]
  nextCursor: string | null
  total: number
  avgLatencyMs: number
  successRatePercent: number
}

/** Le `code` d'une erreur du serveur — c'est sur lui qu'on branche, jamais sur le texte. */
export function codeErreur(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null
  const code = (err.payload as { error?: { code?: unknown } } | undefined)?.error?.code
  return typeof code === "string" ? code : null
}

export function messageErreur(err: unknown, repli: string): string {
  return err instanceof Error && err.message ? err.message : repli
}

const parametre = (enseigneId: string) => `enseigne=${encodeURIComponent(enseigneId)}`

export const api = {
  etat: () => apiRequest<EtatEnseignes>("/api/developer/enseignes"),

  creerEnseigne: async (nom: string) =>
    (await apiRequest<{ enseigne: Enseigne }>("/api/developer/enseignes", { method: "POST", body: { nom } }))
      .enseigne,

  supprimerEnseigne: (id: string) =>
    apiRequest(`/api/developer/enseignes/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Envoie un code dans l'application Alanya. */
  demanderCode: () =>
    apiRequest<{ defiId: string; expireDans: number }>("/api/developer/confirmation", { method: "POST" }),

  confirmerCode: (defiId: string, code: string) =>
    apiRequest("/api/developer/confirmation", { method: "PUT", body: { defiId, code } }),

  cles: async (enseigneId: string) =>
    (await apiRequest<{ cles: Cle[] }>(`/api/developer/keys?${parametre(enseigneId)}`)).cles,

  creerCle: (enseigneId: string, nom: string) =>
    apiRequest<{ cleComplete: string; cle: Cle }>("/api/developer/keys", {
      method: "POST",
      body: { enseigneId, nom },
    }),

  revoquerCle: (enseigneId: string, cleId: string) =>
    apiRequest("/api/developer/keys", { method: "DELETE", body: { enseigneId, cleId } }),

  webhook: async (enseigneId: string) =>
    (await apiRequest<{ webhook: Webhook | null }>(`/api/developer/webhooks?${parametre(enseigneId)}`)).webhook,

  enregistrerWebhook: async (enseigneId: string, url: string, changerSecret = false) =>
    (
      await apiRequest<{ webhook: Webhook }>("/api/developer/webhooks", {
        method: "POST",
        body: { enseigneId, url, changerSecret },
      })
    ).webhook,

  supprimerWebhook: (enseigneId: string) =>
    apiRequest("/api/developer/webhooks", { method: "DELETE", body: { enseigneId } }),

  journal: (enseigneId: string) => apiRequest<Journal>(`/api/developer/logs?${parametre(enseigneId)}`),
}
