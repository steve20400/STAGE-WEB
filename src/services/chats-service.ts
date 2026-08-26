import { loadLocalConversations } from "../data/local-conversations"
import { loadLocalGroups, toConversationMock } from "../data/local-groups"
import { type ConversationMock, type MessageType } from "../mocks/chat-data"
import { getMyUserId, loadSessionUser, toInitials } from "../data/session-user"
import { apiRequest } from "../lib/api-client"
import { langueInitiale, traduire } from "../i18n"
import {
  cacheConversations,
  loadCachedConversations,
  loadCachedConversation,
} from "./indexeddb-cache"

/**
 * Aggregation purement locale (localStorage + groupes crees en local).
 * Conserve pour le dashboard tant qu'il n'a pas son propre endpoint.
 */
export function getChatConversations(): ConversationMock[] {
  const localConversations = loadLocalConversations()
  const groupFallbacks = loadLocalGroups()
    .map(toConversationMock)
    .filter(
      (conversation) =>
        !localConversations.some((localConversation) => localConversation.id === conversation.id)
    )
  return [...localConversations, ...groupFallbacks]
}

/**
 * Conversation de la liste, augmentee de ce que le web seul a besoin de savoir.
 *
 * `ConversationMock` est la forme partagee par tous les ecrans ; ce complement
 * n'existe que pour la conversation avec soi-meme, et vit donc ici plutot que
 * dans le type commun. Comme il l'etend, tout ce qui attend une
 * `ConversationMock` accepte encore une `ConversationListItem`.
 */
export interface ConversationListItem extends ConversationMock {
  /**
   * Mes notes personnelles — le « Moi » de WhatsApp.
   *
   * Vient du serveur tel quel (voir `BackendConversation.isSelf`). On ne le
   * rededuit jamais de la forme des membres : c'est SA definition, et une
   * seconde regle finirait par diverger de la sienne.
   */
  isSelf?: boolean
}

/** Conversation telle que renvoyee par GET /api/conversations. */
interface BackendConversation {
  id: string
  isGroup: boolean
  title: string | null
  /**
   * Vrai pour la conversation du compte avec lui-meme (non-groupe, un seul
   * participant). Le serveur l'envoie explicitement pour qu'aucun client n'ait
   * a reconnaitre cette forme par lui-meme.
   */
  isSelf?: boolean
  avatarUrl?: string | null
  members?: Array<{
    id: string
    pseudo: string | null
    publicNumber: string
    role?: string
    /** 1 = en ligne. Masque a 0 par le backend si le pair cache sa presence. */
    isOnline?: number
    lastSeen?: string | null
  }>
  lastMessage?: {
    id: string
    content: string | null
    type: string
    senderId: string
    createdAt: string
  } | null
  unread?: number
  /** Verrou pose par un appareil du compte courant, ou null. */
  lock?: { appareilId: number; detenteur: string | null; expiresAt: string } | null
  updatedAt?: string
}

/**
 * Type du dernier message, tel que la liste des discussions le comprend.
 *
 * 🔴 LES TYPES STRUCTURES DOIVENT FIGURER ICI. Le contenu d'un message CONTACT
 * ou LOCATION n'est pas du texte mais du JSON (voir `services/message-payload`,
 * miroir du format que le serveur impose aux trois clients). Tant qu'ils
 * retombaient sur `"text"`, la liste ne pouvait pas les reconnaitre et affichait
 * la charge brute — `{"v":1,"contacts":[…]}` — sous le nom de la conversation,
 * a l'expediteur comme au destinataire.
 *
 * Le RESUME, lui, ne se calcule pas ici mais au rendu (`chats.tsx`) : la langue
 * y est relue a chaque affichage, alors qu'un libelle fige ici garderait la
 * langue du chargement jusqu'au prochain passage sur le reseau.
 */
function mapLastMessageType(type?: string): MessageType {
  const t = (type ?? "").toUpperCase()
  if (t === "IMAGE") return "image"
  if (t === "AUDIO") return "audio"
  if (t === "FILE" || t === "VIDEO") return "file"
  if (t === "CONTACT") return "contact"
  if (t === "LOCATION") return "location"
  return "text"
}

function formatTime(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
}

function pickColorIdx(id: string): number {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return sum % 5
}

function toFrontConversation(c: BackendConversation): ConversationListItem {
  const isSelf = c.isSelf === true

  /*
   * LE TITRE DU « MOI » EST TRADUIT ICI, PAS PRIS TEL QUEL.
   *
   * Le serveur rend « Moi » — le mot francais, en dur dans la route. Il convient
   * a un client francais et a lui seul, alors que le web parle neuf langues. On
   * le remplace donc par la traduction de la langue courante.
   *
   * Lue au chargement et non au rendu : c'est la limite de l'endroit. L'ecran
   * des discussions reprend la traduction a chaque rendu (voir `ConvItem`), un
   * changement de langue s'y voit donc aussitot ; les autres ecrans la rattrapent
   * a leur prochain chargement.
   */
  const name = isSelf ? traduire(langueInitiale(), "l2_me") : (c.title ?? "Conversation")

  // GET /api/conversations renvoie isOnline pour chaque membre (deja masque a 0
  // par le backend si le pair a choisi de cacher sa presence).
  const myId = getMyUserId()
  /*
   * Mes notes n'ont pas de correspondant, donc pas de pastille verte.
   *
   * Le `find` ci-dessous suffirait presque — le seul membre EST moi, il serait
   * ecarte. Presque : quand la session locale est incomplete, `getMyUserId()`
   * rend `null`, plus rien n'est ecarte, et je me verrais annonce « en ligne »
   * au-dessus de mes propres notes. `isSelf` tranche avant d'en arriver la.
   */
  const peer = c.isGroup || isSelf ? undefined : c.members?.find((m) => m.id !== myId)

  return {
    id: c.id,
    isSelf,
    name,
    initials: toInitials(name),
    colorIdx: pickColorIdx(c.id),
    lastMessage: c.lastMessage?.content ?? "",
    lastMessageType: mapLastMessageType(c.lastMessage?.type),
    time: formatTime(c.updatedAt ?? c.lastMessage?.createdAt),
    unread: c.unread ?? 0,
    online: peer?.isOnline === 1,
    isGroup: Boolean(c.isGroup),
    members: c.members?.map((m) => toInitials(m.pseudo ?? m.publicNumber)),
    membersInfo: c.members,
    avatar: c.avatarUrl ?? null,
    lock: c.lock ?? null,
  }
}

/**
 * GET /api/conversations — Liste des conversations de l'utilisateur.
 * Persiste le résultat dans IndexedDB pour un affichage instantané au prochain chargement.
 * En cas d'erreur, retombe sur le cache IndexedDB puis sur les conversations locales.
 */
export async function fetchChatConversations(): Promise<ConversationListItem[]> {
  try {
    const response = await apiRequest<{ conversations: BackendConversation[] }>(
      "/api/conversations"
    )
    const conversations = (response.conversations ?? []).map(toFrontConversation)

    // Persiste en IndexedDB pour le cache-first
    void cacheConversations(
      (response.conversations ?? []).map((c) => ({
        id: c.id,
        isGroup: c.isGroup,
        // Le drapeau voyage avec la conversation : sans lui, au demarrage a
        // froid, la liste relit le cache, ne reconnait plus mes notes et leur
        // rend le titre francais fige au dernier passage sur le reseau.
        isSelf: c.isSelf,
        title: c.title,
        avatarUrl: c.avatarUrl,
        members: c.members,
        lastMessage: c.lastMessage,
        unread: c.unread,
        // Le verrou voyage avec la conversation qui le porte : au prochain
        // demarrage, la liste affiche la reservation immediatement, sans
        // attendre le reseau. Sans cette ligne le cache la perdait, et une
        // conversation reservee paraissait libre une fraction de seconde.
        //
        // Pas de magasin IndexedDB dedie : le verrou n'a pas de vie propre, il
        // est un attribut de la conversation. Un second magasin serait une
        // deuxieme source de verite a garder d'accord avec la premiere.
        lock: c.lock ?? null,
        updatedAt: c.updatedAt ? new Date(c.updatedAt).getTime() : Date.now(),
      }))
    )

    return conversations
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[chats] fetch a echoue, tentative cache IndexedDB", error)
    // Tentative de fallback IndexedDB
    try {
      const cached = await loadCachedConversations()
      if (cached.length > 0) {
        return cached.map((c) => toFrontConversation(c as unknown as BackendConversation))
      }
    } catch {
      // IndexedDB indisponible, on continue
    }
    return getChatConversations()
  }
}

/**
 * Stratégie cache-first pour les conversations :
 * 1. Appelle onCached() immédiatement avec les données IndexedDB (~2ms)
 * 2. Fetch le backend en arrière-plan
 * 3. Appelle onFresh() avec les données fraîches
 *
 * Utilisée par chats.tsx pour un affichage instantané.
 */
export async function fetchChatConversationsCacheFirst(
  onCached: (conversations: ConversationListItem[]) => void,
  onFresh: (conversations: ConversationListItem[]) => void
): Promise<void> {
  // Étape 1 : lecture cache instantanée
  try {
    const cached = await loadCachedConversations()
    if (cached.length > 0) {
      onCached(cached.map((c) => toFrontConversation(c as unknown as BackendConversation)))
    }
  } catch {
    // IndexedDB indisponible, on attend le réseau
  }

  // Étape 2 : fetch réseau si en ligne
  if (!navigator.onLine) return

  try {
    const fresh = await fetchChatConversations()
    onFresh(fresh)
  } catch {
    // Erreur réseau — le cache est déjà affiché
  }
}

/**
 * POST /api/conversations — Cree (ou recupere si elle existe deja) une conversation
 * directe avec le numero Alanya du contact. Renvoie l'id backend.
 *
 * Composer SON PROPRE numero est un usage prevu : le serveur rend alors la
 * conversation du compte avec lui-meme et le signale par `isSelf`. Aucun appelant
 * n'a de cas particulier a traiter — c'est le meme appel, et l'ecran de
 * discussion s'ouvre pareil.
 */
export async function createPrivateChat(
  publicNumber: string
): Promise<{ id: string; isSelf: boolean }> {
  const response = await apiRequest<{ id: string; isGroup: boolean; isSelf?: boolean }>(
    "/api/conversations",
    {
      method: "POST",
      body: { publicNumber },
    }
  )
  return { id: response.id, isSelf: response.isSelf === true }
}

/**
 * Ouvre (ou cree) MES notes personnelles — le « Moi » de WhatsApp.
 *
 * Le numero de la session est resolu ici, une fois, plutot que dans chaque ecran
 * qui offre l'entree : le repertoire ne peut pas fournir ce contact, le serveur
 * refusant de s'ajouter soi-meme (`POST /api/contacts` -> 400 SELF). Sans ce
 * point unique, chaque appelant irait rechercher le numero a sa facon.
 *
 * Rejette quand la session locale n'a pas de numero — le serveur ne saurait pas
 * qui ouvrir, et un appel sans numero echouerait de toute facon plus loin.
 */
export async function createSelfChat(): Promise<{ id: string; isSelf: boolean }> {
  const monNumero = (loadSessionUser()?.phone ?? "").replace(/\D/g, "")
  if (monNumero === "") throw new Error("SESSION_SANS_NUMERO")
  return createPrivateChat(monNumero)
}

/**
 * POST /api/conversations — Cree un groupe avec les membres listes
 * (numeros Alanya, en plus du createur ajoute automatiquement).
 */
export async function createGroupChat(
  name: string,
  memberNumbers: string[]
): Promise<{ id: string }> {
  const response = await apiRequest<{ id: string; isGroup: boolean }>("/api/conversations", {
    method: "POST",
    body: { name, memberNumbers },
  })
  return { id: response.id }
}

/**
 * Recupere une conversation precise par son id.
 * Essaie d'abord le cache IndexedDB pour un résultat instantané,
 * puis la liste backend pour les données les plus fraîches.
 */
export async function fetchConversationById(
  conversationId: string
): Promise<ConversationListItem | null> {
  // Essai cache IndexedDB d'abord
  try {
    const cached = await loadCachedConversation(conversationId)
    if (cached) {
      // On lance quand même le fetch backend en fond pour mettre à jour
      void fetchChatConversations().catch(() => undefined)
      return toFrontConversation(cached as unknown as BackendConversation)
    }
  } catch {
    // IndexedDB indisponible
  }

  const all = await fetchChatConversations()
  return all.find((c) => c.id === conversationId) ?? null
}

/**
 * POST /api/conversations/:id/members — Ajoute des membres a un groupe existant.
 * Envoie les numeros Alanya des nouveaux membres.
 */
export async function addMembersToGroup(convId: string, memberNumbers: string[]): Promise<void> {
  await apiRequest<void>(`/api/conversations/${convId}/members`, {
    method: "POST",
    body: { publicNumbers: memberNumbers },
  })
}

export async function removeGroupMember(convId: string, userId: string) {
  return apiRequest(`/api/conversations/${convId}/members?userId=${encodeURIComponent(userId)}`, {
    method: "DELETE",
  })
}
export async function setGroupMemberRole(convId: string, userId: string, role: "ADMIN" | "MEMBER") {
  return apiRequest(`/api/conversations/${convId}/members`, {
    method: "PATCH",
    body: { userId, role },
  })
}
export async function leaveGroup(convId: string) {
  return apiRequest(`/api/conversations/${convId}/leave`, { method: "POST" })
}

export async function deleteGroupConversation(convId: string) {
  return apiRequest(`/api/conversations/${convId}/delete`, { method: "DELETE" })
}
