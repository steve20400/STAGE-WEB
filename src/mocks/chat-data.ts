export type MessageStatus = "sending" | "sent" | "delivered" | "read"
export type MessageType = "text" | "file" | "image" | "audio"

export interface ConversationMock {
  id: string
  name: string
  initials: string
  colorIdx: number
  lastMessage: string
  lastMessageType: MessageType
  time: string
  unread: number
  online: boolean
  isGroup: boolean
  members?: string[]
  isPinned?: boolean
}

export interface ChatInfoMock {
  id: string
  name: string
  initials: string
  colorIdx: number
  online: boolean
  isGroup: boolean
  members?: string[]
  typing?: boolean
}

export interface ChatMessageMock {
  id: string
  senderId: string
  content: string
  type: MessageType
  status: MessageStatus
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
  /** Message supprime "pour tous" : on affiche un placeholder. */
  isDeleted?: boolean
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
