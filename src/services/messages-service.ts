import { ApiError, apiRequest } from "../lib/api-client"
import { langueInitiale, traduire } from "../i18n"
import { type ChatMessageMock, type MessageStatus, type MessageType } from "../mocks/chat-data"
import { getMyUserId } from "../data/session-user"
import {
  forwardMessageOverSocket,
  publishRead,
  publishPinMessage,
  sendDeleteMessage,
  sendMessageOverSocket,
  type WsMessagePayload,
} from "./websocket-service"
import {
  cacheMessages,
  cacheMessage,
  dequeueOffline,
  getOfflineQueue,
  getOfflineQueueForConversation,
  loadCachedMessages,
  patchOfflineQueueItem,
  removeMessageFromCache,
  enqueueOffline,
} from "./indexeddb-cache"
import { uploadMedia } from "./media-service"
import { estChiffree, envoyerChiffre, releverEtDechiffrer } from "./e2ee-fil"

/** Message tel que renvoye par le backend Next.js (REST et WebSocket). */
export interface BackendMessage {
  id: string
  convId: string
  senderId: string // UUID de l'expediteur
  content: string | null
  type?: string // TEXT | IMAGE | FILE | AUDIO | VIDEO
  status?: string // SENT | DELIVERED | READ
  createdAt?: string
  replyToId?: string | null
  replyTo?: {
    id: string
    senderId: string
    type: string
    content: string | null
    isDeleted: boolean
  } | null
  deletedAt?: string | null
  /**
   * Date de la derniere modification, ou null si le message n'a jamais ete
   * modifie. Servie par `GET /api/conversations/{id}/messages` comme par le
   * cache IndexedDB, qui la range au meme nom.
   */
  editedAt?: string | null
  /**
   * Appel que ce message PROLONGE : renseigne, c'est une messagerie vocale
   * laissee apres un appel sans reponse.
   *
   * Facultatif : un backend anterieur ne l'envoie pas, et le message s'affiche
   * alors comme le vocal ordinaire qu'il est — ce qui reste juste.
   */
  callId?: string | null
  /**
   * Les mentions `@` du message.
   *
   * Facultatif : un backend anterieur ne les envoie pas, et le message
   * s'affiche alors comme une phrase ordinaire — le texte portant deja
   * « @Dominique » en clair. C'est tout l'interet de ne pas avoir encode les
   * mentions DANS le texte.
   */
  mentions?: Array<{ userId: string; libelle: string }>
  media?: Array<{
    id: string
    url: string
    filename: string
    mimeType: string
    sizeBytes: number
    durationMs: number | null
  }>
}

interface ListMessagesResponse {
  messages: BackendMessage[]
  nextCursor?: string | null
}

function mapType(type?: string): MessageType {
  const t = (type ?? "").toUpperCase()
  if (t === "IMAGE") return "image"
  if (t === "AUDIO") return "audio"
  // VIDEO etait replie sur "file" : une video envoyee depuis le mobile
  // s'affichait donc comme une piece jointe, sans lecteur.
  if (t === "VIDEO") return "video"
  if (t === "FILE") return "file"
  if (t === "SYSTEM") return "system"
  // Sans ces deux lignes, une fiche de contact ou une position reçue retombait
  // sur "text" et affichait sa charge JSON brute dans la bulle.
  if (t === "CONTACT") return "contact"
  if (t === "LOCATION") return "location"
  return "text"
}

function mapStatus(status?: string): MessageStatus {
  const s = (status ?? "").toUpperCase()
  if (s === "DELIVERED") return "delivered"
  if (s === "READ") return "read"
  /*
   * 🔴 `PENDING` RETOMBAIT SUR « ENVOYE », ce qui etait un MENSONGE.
   *
   * C'est l'etat que le cache local pose sur un message ecrit hors ligne, qui
   * n'a donc jamais quitte l'appareil. Apres un rechargement de page, la bulle
   * relue depuis le cache affichait la coche simple : l'utilisateur croyait son
   * message parti alors qu'il attendait encore le reseau — et pouvait fermer
   * l'onglet en toute confiance.
   *
   * La pastille d'attente dit la verite, et c'est elle que la file d'attente
   * remplacera par une vraie coche quand le message partira.
   */
  if (s === "PENDING") return "sending"
  return "sent"
}

function toBackendType(type: MessageType): string {
  if (type === "image") return "IMAGE"
  if (type === "audio") return "AUDIO"
  // "video" manquait : il retombait sur le return final, donc une video
  // partait etiquetee TEXT. Le mobile affichait alors « [TEXT] », et le
  // serveur WebSocket rejetait meme le message en silence, car il refuse un
  // TEXT sans contenu (ws-server.mjs, handleSend).
  if (type === "video") return "VIDEO"
  if (type === "file") return "FILE"
  if (type === "system") return "SYSTEM"
  if (type === "contact") return "CONTACT"
  if (type === "location") return "LOCATION"
  return "TEXT"
}

/**
 * Taille d'une piece jointe, telle qu'elle s'affiche sous la bulle.
 *
 * L'unite se traduit : « Ko » et « Mo » sont des abreviations francaises, et
 * elles restaient telles quelles pour un lecteur anglophone ou russophone.
 */
export function formatBytes(size?: number): string | undefined {
  if (!size || size <= 0) return undefined
  const langue = langueInitiale()
  if (size < 1024 * 1024) {
    return traduire(langue, "v2_size_kb", { taille: Math.max(1, Math.round(size / 1024)) })
  }
  return traduire(langue, "v2_size_mb", { taille: (size / 1024 / 1024).toFixed(1) })
}

/** Transforme la reponse backend vers le type front, en distinguant "me" vs autre. */
export function toFrontMessage(
  m: BackendMessage | WsMessagePayload,
  myId: string | null
): ChatMessageMock {
  const isMine = myId !== null && m.senderId === myId
  // Le PREMIER media alimente les champs simples, que tout le rendu lit deja.
  // La liste complete voyage a cote, pour les messages qui en portent plusieurs
  // — ce que fait le mobile quand on envoie un lot de fichiers d'un coup.
  const media = m.media?.[0]
  const deletedAt = (m as BackendMessage).deletedAt ?? null

  // Le cache IndexedDB repasse par cette fonction (`fetchMessagesCacheFirst` le
  // relit en `BackendMessage`), et il peut avoir range la date en horodatage
  // numerique la ou le REST envoie une chaine ISO. `new Date` accepte les deux ;
  // reste a ecarter une valeur illisible, qui donnerait une Date « Invalid »
  // affichee telle quelle.
  const brutEdite = (m as BackendMessage).editedAt ?? null
  const dateEditee = brutEdite ? new Date(brutEdite) : null

  return {
    id: m.id,
    senderId: isMine ? "me" : m.senderId,
    content: m.content ?? "",
    type: media?.mimeType?.startsWith("video/") ? "video" : mapType(m.type),
    status: mapStatus(m.status),
    // Les mentions accompagnent le message. Absentes d'un backend anterieur :
    // le texte porte deja « @Dominique » en clair, la bulle reste juste.
    mentions: (m as BackendMessage).mentions ?? undefined,
    mentionTousLibelle:
      (m as { mentionTousLibelle?: string | null }).mentionTousLibelle ?? null,
    statutCite: (m as { statutCite?: ChatMessageMock["statutCite"] }).statutCite ?? null,
    // Le serveur ne met ce champ que dans la charge des appareils du compte
    // emetteur : le recevoir suffit a avoir le droit de l'afficher.
    nomAgent: (m as { nomAgent?: string | null }).nomAgent ?? null,
    appareilId: (m as { appareilId?: number | null }).appareilId ?? null,
    timestamp: m.createdAt ? new Date(m.createdAt) : new Date(),
    replyTo: m.replyToId ?? undefined,
    replySnapshot: m.replyTo
      ? {
          senderId: myId !== null && m.replyTo.senderId === myId ? "me" : m.replyTo.senderId,
          content: m.replyTo.content,
          type: mapType(m.replyTo.type),
          isDeleted: m.replyTo.isDeleted,
        }
      : undefined,
    callId: (m as BackendMessage).callId ?? null,
    mediaUrl: media?.url,
    mediaMime: media?.mimeType,
    medias: m.media,
    durationMs: media?.durationMs ?? undefined,
    fileName: media?.filename,
    fileSize: formatBytes(media?.sizeBytes),
    isDeleted: Boolean(deletedAt),
    editedAt: dateEditee && !Number.isNaN(dateEditee.getTime()) ? dateEditee : undefined,
  }
}

/**
 * Taille du premier lot.
 *
 * Etait a 100, ce qui retardait le premier affichage et faisait rendre cent
 * bulles d'un coup. Les messages arrivent du plus recent au plus ancien : trente
 * suffisent a remplir plusieurs hauteurs d'ecran, le reste vient au defilement.
 */
export const INITIAL_PAGE_SIZE = 30

/** Taille des pages suivantes, chargees en remontant l'historique. */
export const OLDER_PAGE_SIZE = 30

/** Enregistre un lot du backend dans IndexedDB, pour le cache-first. */
function cacheBackendMessages(backendMessages: BackendMessage[]): void {
  void cacheMessages(
    backendMessages.map((m) => ({
      id: m.id,
      conversationId: m.convId,
      senderId: m.senderId,
      content: m.content,
      type: m.type,
      status: m.status,
      createdAt: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
      replyToId: m.replyToId,
      replyTo: m.replyTo,
      deletedAt: m.deletedAt,
      // Sans cette ligne, la mention « modifie » disparaissait au rechargement
      // suivant : le cache-first reaffiche d'abord ce qui est range ici, et il
      // aurait rendu le bon texte sans dire qu'il avait ete modifie.
      editedAt: m.editedAt,
      /*
       * 🐛 SANS CETTE LIGNE, LA MESSAGERIE VOCALE PERDAIT SON APPEL HORS LIGNE.
       *
       * Ce cache n'ecrit PAS le message tel quel : il enumere les champs a
       * garder, un par un. Un champ oublie ici ne disparait pas a l'ecran tout
       * de suite — le reseau le rend a chaque fois qu'il repond — il disparait
       * SEULEMENT quand on relit sans reseau. C'est le pire des oublis : celui
       * qui ne se voit qu'au moment ou l'on ne peut plus rien verifier.
       *
       * `callId` est ce qui relie une messagerie vocale a l'appel manque
       * qu'elle suit. Sans lui, le bloc qui les reunit ne se forme pas, et le
       * vocal retombe en piece jointe — nom de fichier et taille compris.
       */
      callId: m.callId,
      media: m.media,
    }))
  )
}

/** GET /api/conversations/{id}/messages — historique (renvoye du plus recent au plus ancien).
 *  Persiste les messages dans IndexedDB pour le cache-first. */
export async function fetchMessages(chatId: string): Promise<ChatMessageMock[]> {
  const response = await apiRequest<ListMessagesResponse>(
    `/api/conversations/${chatId}/messages?limit=${INITIAL_PAGE_SIZE}`
  )
  const myId = getMyUserId()
  const backendMessages = response.messages ?? []

  cacheBackendMessages(backendMessages)

  // Le backend pagine en ordre descendant ; l'UI affiche en ordre chronologique.
  const messages = backendMessages.map((m) => toFrontMessage(m, myId)).reverse()

  /*
   * ══════════════ LE CONTENU CHIFFRÉ REJOINT SON MESSAGE ══════════════
   *
   * 🔴 LE SERVEUR REND DES LIGNES SANS TEXTE. Pour une conversation chiffrée,
   * `content` est nul : le texte vit dans les enveloppes, qu'on relève et
   * qu'on déchiffre ICI, puis qu'on rapproche par identifiant de message.
   *
   * ⚠️ LA RELÈVE RAMÈNE TOUT CE QUI ATTEND CET APPAREIL, pas seulement ce fil.
   * C'est voulu : les enveloppes n'ont pas d'autre moment pour être lues, et
   * les laisser en attente parce qu'on regarde ailleurs les ferait s'accumuler
   * jusqu'à la prochaine ouverture de LA bonne conversation.
   *
   * ⚠️ ON NE LA FAIT QUE POUR UN FIL CHIFFRÉ. La déclencher partout ajouterait
   * un appel réseau à chaque ouverture de conversation, pour rien dans
   * l'immense majorité des cas.
   */
  if (estChiffree(chatId)) {
    const clairs = await releverEtDechiffrer()
    for (const m of messages) {
      const clair = clairs.get(m.id)
      if (clair !== undefined) m.content = clair
    }
  }

  return messages
}

/**
 * Page precedente de l'historique, en remontant.
 *
 * Le curseur est l'identifiant du plus ancien message deja affiche, exactement
 * comme le mobile (`chat_repository.dart`) : le backend accepte donc ce parametre,
 * et le web n'avait simplement jamais fait de pagination — il demandait un gros
 * lot unique et n'offrait aucun moyen de remonter plus loin.
 *
 * Renvoie les messages en ordre chronologique, et un lot vide quand on a atteint
 * le debut de la conversation.
 */
export async function fetchOlderMessages(
  chatId: string,
  cursor: string
): Promise<ChatMessageMock[]> {
  const response = await apiRequest<ListMessagesResponse>(
    `/api/conversations/${chatId}/messages?cursor=${encodeURIComponent(cursor)}&limit=${OLDER_PAGE_SIZE}`
  )
  const myId = getMyUserId()
  const backendMessages = response.messages ?? []

  cacheBackendMessages(backendMessages)

  return backendMessages.map((m) => toFrontMessage(m, myId)).reverse()
}

/**
 * Stratégie cache-first pour les messages :
 * 1. Appelle onCached() immédiatement avec les messages IndexedDB (~2ms)
 * 2. Fetch le backend en arrière-plan
 * 3. Appelle onFresh() avec les messages frais
 *
 * Utilisée par chat.tsx pour un affichage instantané de l'historique.
 */
export async function fetchMessagesCacheFirst(
  chatId: string,
  onCached: (messages: ChatMessageMock[]) => void,
  onFresh: (messages: ChatMessageMock[]) => void
): Promise<void> {
  const myId = getMyUserId()

  // Étape 1 : lecture cache instantanée
  try {
    const cached = await loadCachedMessages(chatId, INITIAL_PAGE_SIZE)
    if (cached.length > 0) {
      onCached(cached.map((m) => toFrontMessage(m as unknown as BackendMessage, myId)))
    }
  } catch {
    // IndexedDB indisponible, on attend le réseau
  }

  // Étape 2 : fetch réseau si en ligne
  if (!navigator.onLine) return

  try {
    const fresh = await fetchMessages(chatId)
    onFresh(fresh)
  } catch {
    // Erreur réseau — le cache est déjà affiché
  }
}

/** POST /api/conversations/{id}/read + notification temps reel aux autres participants. */
export async function markChatAsRead(chatId: string): Promise<void> {
  publishRead(chatId)
  try {
    await apiRequest<void>(`/api/conversations/${chatId}/read`, { method: "POST" })
  } catch {
    // Pas critique : le pointeur de lecture sera mis a jour a la prochaine ouverture.
  }
}

interface SendOptions {
  replyToId?: string
  mediaId?: string
  /** Les comptes vises par un `@`. Le serveur les refiltre sur les membres. */
  mentions?: Array<{ userId: string; libelle: string }>
  /**
   * Le message mentionne TOUT le groupe : le texte tape apres le « @ ».
   *
   * Un libelle et non un booleen — c'est lui qui permet de surligner, et il
   * depend de la langue de l'AUTEUR. Absent = pas de mention collective.
   */
  mentionTousLibelle?: string
  /**
   * Le statut auquel ce message repond.
   *
   * Le serveur RECOPIE le statut cite plutot que d'y pointer : un statut est
   * purge au bout de 24 h, et une citation qui le referencerait disparaitrait
   * avec lui. Il verifie aussi qu'on avait le droit de le voir.
   */
  statutCite?: string
}

interface DeliveryPayload {
  content?: string
  msgType: string
  tempId: string
  mediaId?: string
  replyToId?: string
  mentions?: Array<{ userId: string; libelle: string }>
  /**
   * Le message mentionne TOUT le groupe : le texte tape apres le « @ ».
   *
   * Un libelle et non un booleen — c'est lui qui permet de surligner, et il
   * depend de la langue de l'AUTEUR. Absent = pas de mention collective.
   */
  mentionTousLibelle?: string
  /**
   * Le statut auquel ce message repond.
   *
   * Le serveur RECOPIE le statut cite plutot que d'y pointer : un statut est
   * purge au bout de 24 h, et une citation qui le referencerait disparaitrait
   * avec lui. Il verifie aussi qu'on avait le droit de le voir.
   */
  statutCite?: string
}

/**
 * Achemine un message : d'abord le WebSocket ({ type: "send" }), car c'est lui
 * qui declenche la diffusion temps reel aux autres participants sur ce backend ;
 * a defaut, le POST REST (persistance sans broadcast).
 */
async function deliverMessage(
  chatId: string,
  payload: DeliveryPayload
): Promise<BackendMessage | WsMessagePayload> {
  try {
    return await sendMessageOverSocket(chatId, payload)
  } catch {
    return await apiRequest<BackendMessage>(`/api/conversations/${chatId}/messages`, {
      method: "POST",
      body: {
        content: payload.content,
        type: payload.msgType,
        mediaId: payload.mediaId,
        replyToId: payload.replyToId,
        // Le repli REST porte les MEMES mentions que le WebSocket : sans cela,
        // la notification dependrait de l'etat du reseau au moment de l'envoi.
        mentions: payload.mentions,
        // Le serveur decide : `mentionneTous` n'a d'effet qu'en groupe, et le
        // libelle est indispensable au surlignage.
        mentionneTous: payload.mentionTousLibelle ? true : undefined,
        mentionTousLibelle: payload.mentionTousLibelle,
        statutCite: payload.statutCite,
      },
    })
  }
}

/** Persiste en IndexedDB un message confirme par le backend. */
function cacheDeliveredMessage(message: BackendMessage | WsMessagePayload): void {
  void cacheMessage({
    id: message.id,
    conversationId: message.convId,
    senderId: message.senderId,
    content: message.content,
    type: message.type,
    status: message.status,
    createdAt: message.createdAt ? new Date(message.createdAt).getTime() : Date.now(),
    replyToId: message.replyToId,
    replyTo: message.replyTo,
    deletedAt: (message as BackendMessage).deletedAt ?? null,
    // Jumeau de `cacheBackendMessages` : sans lui, une messagerie vocale
    // confirmee a l'instant perdrait son appel des la premiere relecture hors
    // ligne, et se relirait en piece jointe.
    callId: message.callId ?? null,
    media: message.media,
  })
}

/**
 * Envoie un message. On privilegie le WebSocket ({ type: "send" }) car c'est lui
 * qui declenche la diffusion temps reel aux autres participants sur ce backend ;
 * en cas d'echec, on retombe sur le POST REST (persistance sans broadcast).
 * Si complètement hors ligne, le message est mis en file d'attente (outbox).
 */
export async function sendChatMessage(
  chatId: string,
  content: string,
  type: MessageType = "text",
  options: SendOptions = {}
): Promise<ChatMessageMock> {
  const myId = getMyUserId()
  const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const msgType = toBackendType(type)

  /*
   * ══════════════ LE CHEMIN CHIFFRÉ, ET IL S'ARRÊTE ICI ══════════════
   *
   * 🔴 UNE BRANCHE QUI SORT, PAS UN DÉTOUR. Tout ce qui suit — file hors
   * ligne, affichage optimiste, remise par WebSocket, repli REST — suppose
   * que le serveur voit le texte. Aucun de ces mécanismes ne s'applique à un
   * message chiffré, et les adapter un par un reviendrait à mêler deux
   * régimes dans la même fonction : c'est exactement ce qu'on a refusé de
   * faire dans la table `message`, et pour les mêmes raisons.
   *
   * ⚠️ CE QU'ON PERD, ET QU'IL FAUT SAVOIR :
   *
   *   · LA FILE HORS LIGNE. Un message chiffré ne part pas si le réseau est
   *     coupé — on le dit tout de suite au lieu de le mettre en attente. La
   *     file recopierait le TEXTE EN CLAIR dans IndexedDB, ce qui reviendrait
   *     à ranger en clair ce qu'on vient de chiffrer ;
   *
   *   · LA REMISE INSTANTANÉE. Le destinataire lira à sa prochaine relève.
   *
   * ⚠️ SEUL LE TEXTE EST COUVERT. Un média chiffré demanderait de chiffrer le
   * fichier lui-même, ce qui est un autre chantier. On laisse donc passer les
   * médias par le chemin ordinaire plutôt que de les refuser en silence — mais
   * ils NE SONT PAS chiffrés, et l'écran doit finir par le dire.
   */
  if (estChiffree(chatId) && type === "text" && (content ?? "").trim() !== "") {
    if (!navigator.onLine) {
      throw new Error(
        "Pas de réseau : un message chiffré ne peut pas être mis en attente.",
      )
    }
    const cree = await envoyerChiffre(chatId, content)
    /*
     * ⚠️ ON NE MET PAS LE CLAIR EN CACHE. `cacheMessage` écrit dans IndexedDB,
     * qui n'est pas chiffré : y recopier le texte annulerait le bénéfice pour
     * l'expéditeur, dont l'appareil est justement celui qu'on protège en cas
     * de vol. L'écran l'affiche depuis la mémoire, le temps de la session.
     */
    return {
      id: cree.id,
      senderId: "me",
      content,
      type,
      status: "sent",
      timestamp: new Date(cree.createdAt),
    }
  }

  // Hors ligne → outbox pour envoi ultérieur
  if (!navigator.onLine) {
    const pending = await enqueueOffline({
      conversationId: chatId,
      senderId: myId ?? undefined,
      content: content || undefined,
      type: msgType,
      mediaId: options.mediaId,
      replyToId: options.replyToId,
    })
    // Persiste le message optimiste en cache pour affichage immédiat
    await cacheMessage({
      id: pending.tempId,
      conversationId: chatId,
      senderId: myId ?? "",
      content: content || null,
      type: msgType,
      status: "PENDING",
      createdAt: pending.createdAt,
    })
    return {
      id: pending.tempId,
      senderId: "me",
      content: content ?? "",
      type,
      status: "sending",
      timestamp: new Date(pending.createdAt),
    }
  }

  let message: BackendMessage | WsMessagePayload
  try {
    message = await deliverMessage(chatId, {
      content: content || undefined,
      msgType,
      tempId,
      mediaId: options.mediaId,
      replyToId: options.replyToId,
      mentions: options.mentions,
      mentionTousLibelle: options.mentionTousLibelle,
      statutCite: options.statutCite,
    })
  } catch (err) {
    /**
     * Blocage : le message reste « en cours d'envoi », pour toujours.
     *
     * C'est le comportement demande — ni confirmation, ni erreur. L'expediteur
     * ne doit pas apprendre qu'il a ete bloque (sauf avis systeme, decide par
     * le serveur selon les accuses de lecture du bloque).
     *
     * On s'appuie sur le refus du serveur plutot que sur une liste locale : lui
     * seul fait autorite, et cela evite de promener l'etat de blocage dans tout
     * l'ecran de discussion. Le message n'est PAS mis en file d'attente : la
     * file reessaie au retour du reseau, et il repartirait indefiniment.
     */
    if (estRefusPourBlocage(err)) {
      await cacheMessage({
        id: tempId,
        conversationId: chatId,
        senderId: myId ?? "",
        content: content || null,
        type: msgType,
        status: "PENDING",
        createdAt: Date.now(),
      })
      return {
        id: tempId,
        senderId: "me",
        content: content ?? "",
        type,
        status: "sending",
        timestamp: new Date(),
      }
    }
    throw err
  }
  cacheDeliveredMessage(message)
  return toFrontMessage(message, myId)
}

/**
 * Le serveur refuse-t-il ce message parce que les deux personnes sont bloquees ?
 *
 * Le code `BLOCKED` est la reponse de la route REST, celle sur laquelle le
 * client bascule quand le WebSocket n'acquitte pas — ce qui est precisement ce
 * qui se passe entre deux personnes bloquees.
 */
function estRefusPourBlocage(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 403) return false
  // Le code voyage dans la charge : { error: { message, code } }.
  const charge = err.payload as { error?: { code?: unknown } } | undefined
  return charge?.error?.code === "BLOCKED"
}

/**
 * L'ECHEC VIENT-IL DU RESEAU, ou le serveur a-t-il REFUSE ?
 *
 * 🔴 TOUTE LA DIFFERENCE EST LA. Un refus du serveur — fichier trop lourd,
 * personne bloquee, conversation disparue — ne se repare pas en reessayant :
 * mettre l'envoi en file le ferait echouer indefiniment, en silence, et
 * l'utilisateur croirait son message parti. Une panne de reseau, elle, se
 * repare toute seule des que la connexion revient : c'est le seul cas ou garder
 * le fichier et le renvoyer plus tard est le bon comportement.
 *
 * ⚠️ `status === 0` EST LE DISCRIMINANT, et il est fiable : `api-client` ne pose
 * ce zero que lorsqu'AUCUNE reponse HTTP n'est arrivee — coupure, DNS muet,
 * delai depasse. Tout code renvoye par le serveur, meme 500, signifie qu'il a
 * repondu, donc qu'il a decide. On ne met pas sa decision en file d'attente.
 */
export function estPanneReseau(err: unknown): boolean {
  if (!navigator.onLine) return true
  return err instanceof ApiError && err.status === 0
}

/**
 * Met un MEDIA en file d'attente, OCTETS COMPRIS, pour l'envoyer au retour du
 * reseau.
 *
 * 🔴 CE SONT LES OCTETS QUI SONT RANGES, PAS UNE REFERENCE — et c'est ce qui
 * manquait. Un media s'envoie en DEUX TEMPS : televerser le fichier pour obtenir
 * un identifiant, puis envoyer le message qui le cite. Hors ligne, le premier
 * temps est impossible, donc il n'existe AUCUN identifiant a mettre en file. La
 * file d'attente, qui n'acceptait qu'un `mediaId`, ne pouvait donc rien faire
 * d'un envoi hors ligne : le fichier etait perdu et l'ecran annoncait un echec.
 *
 * IndexedDB range un `Blob` tel quel — le clonage structure le sait faire — et
 * le fichier survit donc a la fermeture de l'onglet.
 *
 * ⚠️ [tempId] EST CELUI DE LA BULLE DEJA AFFICHEE. Le serveur le renvoie dans
 * son echo, et c'est ainsi que la bulle « en cours d'envoi » devient le message
 * confirme, au lieu d'apparaitre en double a cote de lui.
 */
export async function mettreMediaEnFile(
  chatId: string,
  media: {
    tempId: string
    blob: Blob
    filename: string
    mime: string
    type: MessageType
    durationMs?: number
    caption?: string
    replyToId?: string
  }
): Promise<void> {
  const myId = getMyUserId()
  const msgType = toBackendType(media.type)

  await enqueueOffline({
    tempId: media.tempId,
    conversationId: chatId,
    senderId: myId ?? undefined,
    content: media.caption || undefined,
    type: msgType,
    replyToId: media.replyToId,
    mediaBlob: media.blob,
    mediaNom: media.filename,
    mediaMime: media.mime,
    mediaDureeMs: media.durationMs,
  })

  // Le message optimiste est aussi mis en cache : sans lui, recharger la page
  // ferait disparaitre de l'ecran un envoi qui, lui, attend toujours son tour.
  await cacheMessage({
    id: media.tempId,
    conversationId: chatId,
    senderId: myId ?? "",
    content: media.caption || null,
    type: msgType,
    status: "PENDING",
    createdAt: Date.now(),
  })
}

/**
 * Les apercus locaux des medias qui attendent le reseau, par identifiant de
 * bulle.
 *
 * 🔴 SANS CELA, RECHARGER LA PAGE CASSE L'APERCU. La bulle en attente affiche
 * son image depuis une URL `blob:`, fabriquee en memoire au moment de l'envoi.
 * Ces URL meurent avec la page : au rechargement, le message revient du cache
 * avec une adresse qui ne pointe plus sur rien, et la bulle montre une image
 * brisee — alors que le fichier, lui, est toujours la, range en base locale.
 *
 * On refabrique donc les URL depuis les octets de la file.
 *
 * ⚠️ L'APPELANT DOIT LIBERER CES URL en quittant l'ecran (`revokeObjectURL`) :
 * chacune retient son fichier en memoire tant qu'elle vit, et une conversation
 * qu'on ouvre et ferme dix fois en retiendrait dix copies.
 */
export async function apercusMediasEnAttente(
  chatId: string
): Promise<Map<string, { url: string; mime?: string; nom?: string; durationMs?: number }>> {
  const apercus = new Map<
    string,
    { url: string; mime?: string; nom?: string; durationMs?: number }
  >()
  try {
    const file = await getOfflineQueueForConversation(chatId)
    for (const item of file) {
      const tempId = typeof item.tempId === "string" ? item.tempId : ""
      if (!tempId || !(item.mediaBlob instanceof Blob)) continue
      apercus.set(tempId, {
        url: URL.createObjectURL(item.mediaBlob),
        mime: typeof item.mediaMime === "string" ? item.mediaMime : undefined,
        nom: typeof item.mediaNom === "string" ? item.mediaNom : undefined,
        durationMs: typeof item.mediaDureeMs === "number" ? item.mediaDureeMs : undefined,
      })
    }
  } catch {
    // IndexedDB indisponible : les bulles resteront sans apercu, ce qui est
    // moins grave que de faire echouer l'ouverture de la conversation.
  }
  return apercus
}

/** Un seul drain a la fois : "online" et le montage peuvent se declencher ensemble. */
let draining = false

/**
 * Renvoie les messages ecrits hors ligne (outbox IndexedDB). Sans ce drain, la
 * file d'attente grossit sans jamais partir : le message reste affiche comme
 * « en cours d'envoi » indefiniment. Retourne le nombre de messages envoyes.
 */
export async function drainOfflineOutbox(): Promise<number> {
  if (draining || !navigator.onLine) return 0
  draining = true
  let sent = 0

  try {
    const pending = await getOfflineQueue()
    // Ordre chronologique : les messages doivent arriver dans l'ordre d'ecriture.
    pending.sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0))

    for (const item of pending) {
      const chatId = typeof item.conversationId === "string" ? item.conversationId : ""
      const tempId = typeof item.tempId === "string" ? item.tempId : ""
      if (!tempId) continue
      if (!chatId) {
        // Entree corrompue : inutile de bloquer la file dessus.
        await dequeueOffline(tempId)
        continue
      }

      try {
        let mediaId = typeof item.mediaId === "string" ? item.mediaId : undefined

        /*
         * LES OCTETS D'ABORD, LE MESSAGE ENSUITE.
         *
         * ⚠️ L'IDENTIFIANT OBTENU EST RANGE AVANT MEME QUE LE MESSAGE PARTE, et
         * les octets sont jetes dans le meme geste. Sans cela, un envoi qui
         * echoue APRES un televersement reussi ferait tout recommencer au
         * passage suivant : le meme fichier partirait une seconde fois, deux
         * lignes en base pour un seul envoi, et la donnee payee deux fois sur un
         * forfait mobile.
         */
        if (!mediaId && item.mediaBlob instanceof Blob) {
          const media = await uploadMedia(
            item.mediaBlob,
            typeof item.mediaNom === "string" ? item.mediaNom : "fichier",
            typeof item.mediaDureeMs === "number" ? item.mediaDureeMs : undefined
          )
          mediaId = media.id
          await patchOfflineQueueItem(tempId, { mediaId, mediaBlob: undefined })
        }

        const message = await deliverMessage(chatId, {
          content: typeof item.content === "string" ? item.content : undefined,
          msgType: typeof item.type === "string" ? item.type : "TEXT",
          tempId,
          mediaId,
          replyToId: typeof item.replyToId === "string" ? item.replyToId : undefined,
        })
        cacheDeliveredMessage(message)
      } catch (err) {
        /*
         * ⚠️ ON NE S'ARRETE QUE SUR UNE PANNE RESEAU.
         *
         * Une entree que le serveur REFUSE — fichier trop lourd, conversation
         * supprimee — bloquerait la file POUR TOUJOURS, et tout ce qui attend
         * derriere elle avec. On la retire et on continue : perdre l'envoi qui
         * ne pourra jamais passer vaut mieux que d'en perdre dix qui le
         * pouvaient.
         */
        if (estPanneReseau(err)) break
        await dequeueOffline(tempId)
        await removeMessageFromCache(tempId)
        continue
      }

      await dequeueOffline(tempId)
      // Retire le message optimiste : il est remplace par celui du backend.
      await removeMessageFromCache(tempId)
      sent += 1
    }
  } catch {
    // IndexedDB indisponible : rien a renvoyer.
  } finally {
    draining = false
  }

  return sent
}

/**
 * Supprime un message : "me" masque localement, "everyone" efface pour tous
 * (reserve a l'expediteur). La confirmation arrive via l'evenement message_deleted.
 * Supprime également du cache IndexedDB.
 */
export function deleteChatMessage(messageId: string, scope: "me" | "everyone") {
  sendDeleteMessage(messageId, scope)
  // Suppression du cache local
  void removeMessageFromCache(messageId)
}

/** Transfere un message vers d'autres conversations (contenu + medias copies). */
export async function forwardChatMessage(
  messageId: string,
  targetConvIds: string[]
): Promise<number> {
  const results = await forwardMessageOverSocket(messageId, targetConvIds)
  return results.length
}

/**
 * Persiste un message entrant (WebSocket) dans le cache IndexedDB.
 * Appelé par chat.tsx quand un nouveau message arrive via subscribeToConversation.
 */
export async function persistIncomingWsMessage(message: WsMessagePayload): Promise<void> {
  await cacheMessage({
    id: message.id,
    conversationId: message.convId,
    senderId: message.senderId,
    content: message.content,
    type: message.type,
    status: message.status,
    createdAt: message.createdAt ? new Date(message.createdAt).getTime() : Date.now(),
    replyToId: message.replyToId,
    replyTo: message.replyTo,
    // Une messagerie vocale arrivee en direct doit garder son appel, elle
    // aussi : c'est ce lien qui la distingue d'un fichier audio ordinaire.
    callId: message.callId ?? null,
    media: message.media,
  })
}

/**
 * Supprime un message du cache IndexedDB.
 * Appelé lors de la réception d'un événement message_deleted.
 */
export async function removeMessageFromDB(messageId: string): Promise<void> {
  await removeMessageFromCache(messageId)
}

/**
 * Reporte une edition dans le cache IndexedDB.
 *
 * Appelee a la reception d'un evenement `message_edited`. Sans elle, l'ecran
 * affichait bien le nouveau texte, mais le cache gardait l'ancien : au
 * rechargement suivant, le cache-first repeignait la version perimee avant que
 * le reseau ne la corrige — le bug reapparaissait le temps d'un clignotement.
 *
 * ⚠️ LECTURE PUIS ECRITURE, obligatoirement. Le depot ecrit par `db.put`, qui
 * REMPLACE l'enregistrement entier : ecrire seulement `{id, content}` effacerait
 * l'expediteur, les medias, la citation et l'horodatage. On repart donc de
 * l'enregistrement existant, dont on ne change que les deux champs concernes.
 *
 * Limite assumee : on ne fouille que la fenetre recente du cache. Un message
 * plus ancien que cette fenetre n'y est pas retrouve, et son cache reste perime
 * jusqu'au prochain passage du reseau — qui, lui, fait autorite. L'etat React
 * est juste dans tous les cas, c'est ce que voit l'utilisateur.
 */
export async function applyMessageEditToCache(
  convId: string,
  messageId: string,
  content: string,
  editedAt: Date
): Promise<void> {
  try {
    const caches = await loadCachedMessages(convId, 500)
    const existant = caches.find((m) => m.id === messageId)
    if (!existant) return
    await cacheMessage({ ...existant, content, editedAt: editedAt.toISOString() })
  } catch {
    // IndexedDB indisponible (navigation privee, quota) : l'etat React reste
    // juste, seul le cache est en retard. Rien a signaler a l'utilisateur.
  }
}

/* ----------------- Message epingle ----------------- */

/** Un message epingle, tel que le serveur le decrit. */
export interface MessageEpingle {
  id: string
  senderId: string
  content: string | null
  type: string
  pinnedBy?: string
  pinnedAt?: string
}

/**
 * LES messages epingles d'une conversation, du plus recent au plus ancien.
 *
 * Un serveur anterieur ne rend que `message`, au singulier : on retombe alors
 * sur une liste d'un element. Le web peut donc etre deploye avant le serveur
 * sans rien casser — il affichera simplement un seul epingle, comme avant.
 */
export async function fetchPinnedMessages(chatId: string): Promise<MessageEpingle[]> {
  const reponse = await apiRequest<{
    pinnedMessageId: string | null
    message: MessageEpingle | null
    messages?: MessageEpingle[]
  }>(`/api/conversations/${chatId}/pinned`)
  if (Array.isArray(reponse.messages)) return reponse.messages
  return reponse.message ? [reponse.message] : []
}

/**
 * Epingle un message, ou detache celui qui l'est (`null`).
 *
 * DEUX CHEMINS, comme le mobile : la socket d'abord — c'est elle qui previent
 * les autres — et le REST en repli. `handlePinMessage` ECHOUE EN SILENCE cote
 * serveur (il sort sans repondre quand le message est introuvable ou qu'on n'est
 * pas participant) : sans le repli, un epinglage rate ne laisserait aucune
 * trace, ni erreur ni changement.
 */
export async function definirMessageEpingle(
  chatId: string,
  messageId: string | null,
  epingle?: boolean
): Promise<void> {
  publishPinMessage(chatId, messageId, epingle)
  try {
    await apiRequest<void>(`/api/conversations/${chatId}/pin-message`, {
      method: "POST",
      body: JSON.stringify({ messageId, epingle }),
    })
  } catch {
    // La socket a peut-etre suffi ; l'echo du serveur fera foi.
  }
}
