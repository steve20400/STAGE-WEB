/** Un fichier attache a un message, tel que le backend le decrit. */
export interface MediaJointe {
  id: string
  url: string
  filename: string
  mimeType: string
  sizeBytes: number
  durationMs: number | null
}

export type MessageStatus = "sending" | "sent" | "delivered" | "read"
// `contact` et `location` : fiches de contact et positions partagées. Leur
// charge utile est du JSON dans `content` — voir `services/message-payload.ts`,
// miroir du format que le serveur impose aux trois clients.
export type MessageType =
  | "text"
  | "file"
  | "image"
  | "audio"
  | "video"
  | "system"
  | "contact"
  | "location"

export interface ConversationMock {
  id: string
  name: string
  initials: string
  colorIdx: number
  lastMessage: string
  lastMessageType: MessageType
  time: string
  unread: number
  /**
   * Notifications coupees pour MOI dans cette conversation.
   *
   * Facultatif : absent d'un backend anterieur et des conversations de
   * demonstration. L'interrupteur part alors de « non ».
   */
  sourdine?: boolean
  online: boolean
  isGroup: boolean
  /**
   * Conversation avec SOI-MEME — le « Moi » ou l'on se garde des notes. Vient du
   * serveur, qui seul sait qu'une conversation non-groupe a UN participant est
   * la sienne ; le client ne le recalcule pas.
   */
  isSelf?: boolean
  members?: string[]
  membersInfo?: Array<{
    id: string
    pseudo?: string | null
    publicNumber?: string
    role?: string
    /** Photo de profil. Absente = on retombe sur les initiales. */
    avatarUrl?: string | null
  }>
  isPinned?: boolean
  /**
   * Verrou pose par un appareil de MON compte, s'il y en a un.
   *
   * Present dans la liste pour que l'indice s'affiche sans ouvrir la
   * conversation : savoir qu'elle est deja prise en charge par un collegue est
   * precisement ce qu'on veut voir avant de cliquer.
   */
  lock?: { appareilId: number; detenteur: string | null; expiresAt: string } | null
  /** Photo de profil de l'interlocuteur (data-URL miniature ou URL). */
  avatar?: string | null
}

export interface ChatInfoMock {
  id: string
  name: string
  initials: string
  colorIdx: number
  online: boolean
  isGroup: boolean
  members?: string[]
  membersInfo?: Array<{
    id: string
    pseudo?: string | null
    publicNumber?: string
    role?: string
    /** Photo de profil. Absente = on retombe sur les initiales. */
    avatarUrl?: string | null
  }>
  typing?: boolean
  /** Verrou pose par un appareil de mon compte, ou null. Voir ConversationMock. */
  lock?: { appareilId: number; detenteur: string | null; expiresAt: string } | null
}

/**
 * Une mention `@` : le compte vise, et le texte ecrit dans le message.
 *
 * ⚠️ `libelle` N'EST PAS LE PSEUDO COURANT, c'est ce qui a ete insere a
 * l'envoi, fige par le serveur. C'est ce texte qu'il faut retrouver dans le
 * message pour le mettre en evidence — un pseudo change depuis ne s'y
 * trouverait plus — et il garde lisible la mention de quelqu'un qui a quitte le
 * groupe.
 */
export interface MentionMessage {
  userId: string
  libelle: string
}

export interface ChatMessageMock {
  id: string
  senderId: string
  content: string
  type: MessageType
  status: MessageStatus
  /**
   * Les mentions `@` du message — groupes seulement.
   *
   * 🔴 LE TEXTE PORTE « @Dominique » EN CLAIR ; cette liste dit QUEL compte est
   * vise. Sans elle, mettre en evidence reviendrait a chercher un pseudo dans
   * une phrase, et notifier reviendrait a le deviner — ce qui echoue des que
   * deux membres portent le meme nom.
   */
  mentions?: MentionMessage[]
  /**
   * Le texte tape apres le « @ » quand le message mentionne TOUT le groupe.
   *
   * Un libelle et non un booleen : c'est lui qui permet de retrouver la mention
   * dans le texte pour la surligner, et il depend de la langue de l'AUTEUR —
   * « all », « tous », « alle ». Absent = pas de mention collective.
   */
  mentionTousLibelle?: string | null
  /**
   * Le statut auquel ce message repond.
   *
   * RECOPIE par le serveur, jamais reference : un statut est purge au bout de
   * 24 h, et une citation qui pointerait vers lui disparaitrait avec. Ce qui est
   * ici reste donc lisible meme apres l'expiration du statut d'origine.
   */
  statutCite?: {
    statusId: string
    authorId: string
    type: string
    text: string | null
    mediaUrl: string | null
    bgColor: string | null
  } | null
  /**
   * Pseudo de l'appareil qui a envoye le message.
   *
   * Present UNIQUEMENT si le lecteur appartient au meme compte que
   * l'expediteur : le serveur ne met pas ce champ dans la charge des autres
   * comptes. Le client n'a donc rien a filtrer, il affiche ce qu'il recoit.
   */
  nomAgent?: string | null
  /**
   * Appareil qui a envoye le message. Present seulement avec `nomAgent`, donc
   * uniquement pour les appareils du compte emetteur. Sert a se reconnaitre :
   * un poste n'affiche pas son propre nom au-dessus de ses propres messages.
   */
  appareilId?: number | null
  timestamp: Date
  fileName?: string
  fileSize?: string
  /** Id du message cite (reponse). */
  replyTo?: string
  /** Apercu du message cite, fourni par le backend meme si le message n'est pas charge. */
  replySnapshot?: {
    senderId: string
    content: string | null
    type: MessageType
    isDeleted: boolean
  }
  /** URL relative backend du media attache (/api/media/{id}). */
  mediaUrl?: string
  mediaMime?: string
  durationMs?: number
  /**
   * TOUS les medias du message, quand il en porte plusieurs.
   *
   * Le mobile envoie un lot de fichiers comme UN SEUL message portant N medias,
   * la ou le web en envoie N messages d'un media chacun. Les champs `mediaUrl` /
   * `mediaMime` ci-dessus ne decrivent que le PREMIER : tant qu'on s'en tenait a
   * eux, un envoi de trois videos depuis un telephone s'affichait ici comme une
   * seule video, et les deux autres etaient perdues sans le moindre signe.
   *
   * Absent ou de longueur 1 quand le message ne porte qu'un media : les champs
   * simples suffisent alors, et tout le rendu existant continue de les lire.
   */
  medias?: MediaJointe[]
  /** Message supprime "pour tous" : on affiche un placeholder. */
  isDeleted?: boolean
  /**
   * Renseigne = le message a ete modifie apres coup ; on affiche « modifie »
   * a cote de l'heure, comme le mobile. Absent = jamais modifie.
   *
   * La DATE elle-meme n'est pas affichee aujourd'hui — seule sa presence
   * compte. Elle est conservee plutot qu'un simple booleen parce que le
   * serveur la fournit deja (REST et WebSocket) et qu'un « modifie a 14h03 »
   * ne demanderait alors aucun aller-retour supplementaire.
   */
  editedAt?: Date
}

export const CHAT_COLORS = [
  { bg: "#E8B84B30", text: "#E8B84B" },
  { bg: "#60a5fa30", text: "#60a5fa" },
  { bg: "#a78bfa30", text: "#a78bfa" },
  { bg: "#34d39930", text: "#34d399" },
  { bg: "#f8717130", text: "#f87171" },
]

export const MOCK_CONVERSATIONS: ConversationMock[] = [
  {
    id: "1",
    name: "Kevin Manga",
    initials: "KM",
    colorIdx: 0,
    lastMessage: "T'as envoyé le TP de BD ?",
    lastMessageType: "text",
    time: "10:43",
    unread: 2,
    online: true,
    isGroup: false,
    isPinned: true,
  },
  {
    id: "2",
    name: "Groupe Alanya II",
    initials: "GA",
    colorIdx: 1,
    lastMessage: "Réunion demain à 14h sur Teams",
    lastMessageType: "text",
    time: "09:12",
    unread: 5,
    online: false,
    isGroup: true,
    isPinned: true,
    members: ["KM", "LA", "PE", "NF"],
  },
  {
    id: "3",
    name: "Dr. NANA BINKEU",
    initials: "NB",
    colorIdx: 2,
    lastMessage: "Votre cahier des charges est reçu",
    lastMessageType: "text",
    time: "Hier",
    unread: 0,
    online: false,
    isGroup: false,
  },
  {
    id: "4",
    name: "Laure Ateba",
    initials: "LA",
    colorIdx: 3,
    lastMessage: "📎 rapport_final_v2.pdf",
    lastMessageType: "file",
    time: "Hier",
    unread: 0,
    online: true,
    isGroup: false,
  },
  {
    id: "5",
    name: "Paul Essomba",
    initials: "PE",
    colorIdx: 4,
    lastMessage: "La démo est prête pour vendredi",
    lastMessageType: "text",
    time: "Lun.",
    unread: 0,
    online: false,
    isGroup: false,
  },
  {
    id: "6",
    name: "Nina Fouda",
    initials: "NF",
    colorIdx: 0,
    lastMessage: "🎵 voice_message.mp3",
    lastMessageType: "audio",
    time: "Dim.",
    unread: 0,
    online: false,
    isGroup: false,
  },
  {
    id: "7",
    name: "Projet Réseau",
    initials: "PR",
    colorIdx: 1,
    lastMessage: "📷 photo_circuit.jpg",
    lastMessageType: "image",
    time: "Sam.",
    unread: 0,
    online: false,
    isGroup: true,
    members: ["KM", "PE", "NF"],
  },
]

export const MOCK_CHAT_INFOS: Record<string, ChatInfoMock> = {
  "1": { id: "1", name: "Kevin Manga", initials: "KM", colorIdx: 0, online: true, isGroup: false },
  "2": {
    id: "2",
    name: "Groupe Alanya II",
    initials: "GA",
    colorIdx: 1,
    online: false,
    isGroup: true,
    members: ["KM", "LA", "PE", "NF"],
  },
  "3": {
    id: "3",
    name: "Dr. NANA BINKEU",
    initials: "NB",
    colorIdx: 2,
    online: false,
    isGroup: false,
  },
  "4": { id: "4", name: "Laure Ateba", initials: "LA", colorIdx: 3, online: true, isGroup: false },
  "5": {
    id: "5",
    name: "Paul Essomba",
    initials: "PE",
    colorIdx: 4,
    online: false,
    isGroup: false,
  },
}

export const MOCK_CHAT_MESSAGES: ChatMessageMock[] = [
  {
    id: "m1",
    senderId: "km",
    content: "Salut ! T'as avancé sur la partie base de données ?",
    type: "text",
    status: "read",
    timestamp: new Date(Date.now() - 3600000 * 2),
  },
  {
    id: "m2",
    senderId: "me",
    content: "Oui ! J'ai fini les tables users et messages. Le schéma est propre.",
    type: "text",
    status: "read",
    timestamp: new Date(Date.now() - 3600000 * 2 + 60000),
  },
  {
    id: "m3",
    senderId: "km",
    content: "Respect. T'as pensé aux index sur sender_id et conv_id ?",
    type: "text",
    status: "read",
    timestamp: new Date(Date.now() - 3600000),
  },
  {
    id: "m4",
    senderId: "me",
    content: "Oui, et aussi sur email et sent_at pour les performances.",
    type: "text",
    status: "read",
    timestamp: new Date(Date.now() - 3600000 + 30000),
    replyTo: "m3",
  },
  {
    id: "m5",
    senderId: "km",
    content: "rapport_architecture.pdf",
    type: "file",
    status: "read",
    timestamp: new Date(Date.now() - 1800000),
    fileName: "rapport_architecture.pdf",
    fileSize: "1.2 Mo",
  },
  {
    id: "m6",
    senderId: "me",
    content: "Je regarde ça maintenant, merci !",
    type: "text",
    status: "delivered",
    timestamp: new Date(Date.now() - 900000),
  },
  {
    id: "m7",
    senderId: "km",
    content: "T'as envoyé le TP de BD ?",
    type: "text",
    status: "read",
    timestamp: new Date(Date.now() - 300000),
  },
]
