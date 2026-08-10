import { type Contact } from "./contacts"
import { type ChatMessageMock, type ConversationMock, type MessageType } from "../mocks/chat-data"
import { langueInitiale, traduire } from "../i18n"

interface StoredMessage extends Omit<ChatMessageMock, "timestamp"> {
  timestamp: string
}

const CONVERSATIONS_KEY = "alanya-local-conversations-v1"
const MESSAGES_KEY = "alanya-local-messages-v1"

function hasStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function readJson<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  if (!hasStorage()) return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function serializeMessage(message: ChatMessageMock): StoredMessage {
  return {
    ...message,
    timestamp: message.timestamp.toISOString(),
  }
}

function deserializeMessage(message: StoredMessage): ChatMessageMock {
  return {
    ...message,
    timestamp: new Date(message.timestamp),
  }
}

function formatConversationTime(date: Date) {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
}

function toPreviewContent(message: ChatMessageMock) {
  if (message.type === "file" || message.type === "image" || message.type === "audio") {
    return message.fileName ?? message.content
  }

  return message.content
}

type StoredMessagesByChat = Record<string, StoredMessage[]>

export function loadLocalConversations() {
  return readJson<ConversationMock[]>(CONVERSATIONS_KEY, [])
}

export function saveLocalConversation(conversation: ConversationMock) {
  const current = loadLocalConversations()
  const next = current.filter((entry) => entry.id !== conversation.id)
  writeJson(CONVERSATIONS_KEY, [conversation, ...next])
}

export function ensureDirectConversation(contact: Contact) {
  const existing = loadLocalConversations().find((conversation) => conversation.id === contact.id)
  if (existing) return existing

  const colorOrder = ["amber", "blue", "violet", "teal", "rose"]
  const colorIdx = Math.max(0, colorOrder.indexOf(contact.color))
  const conversation: ConversationMock = {
    id: contact.id,
    name: contact.name,
    initials: contact.initials,
    colorIdx,
    lastMessage: traduire(langueInitiale(), "core_new_conversation"),
    lastMessageType: "text",
    time: "Maintenant",
    unread: 0,
    online: contact.online,
    isGroup: false,
  }

  saveLocalConversation(conversation)
  return conversation
}

export function ensureGroupConversation(group: {
  id: string
  name: string
  initials: string
  memberIds: string[]
}) {
  const existing = loadLocalConversations().find((conversation) => conversation.id === group.id)
  if (existing) return existing

  const conversation: ConversationMock = {
    id: group.id,
    name: group.name,
    initials: group.initials,
    colorIdx: group.name.length % 5,
    lastMessage: "Groupe cree",
    lastMessageType: "text",
    time: "Maintenant",
    unread: 0,
    online: false,
    isGroup: true,
    members: group.memberIds,
  }

  saveLocalConversation(conversation)
  return conversation
}

export function loadLocalMessages(chatId: string) {
  const messagesByChat = readJson<StoredMessagesByChat>(MESSAGES_KEY, {})
  return (messagesByChat[chatId] ?? []).map(deserializeMessage)
}

export function saveLocalMessages(chatId: string, messages: ChatMessageMock[]) {
  const current = readJson<StoredMessagesByChat>(MESSAGES_KEY, {})
  writeJson(MESSAGES_KEY, {
    ...current,
    [chatId]: messages.map(serializeMessage),
  })
}

export function seedLocalMessages(chatId: string, messages: ChatMessageMock[]) {
  const current = readJson<StoredMessagesByChat>(MESSAGES_KEY, {})
  if (current[chatId]?.length) return

  writeJson(MESSAGES_KEY, {
    ...current,
    [chatId]: messages.map(serializeMessage),
  })
}

export function syncConversationFromMessages(
  conversation: Omit<ConversationMock, "lastMessage" | "lastMessageType" | "time" | "unread">,
  messages: ChatMessageMock[]
) {
  const latest = messages[messages.length - 1]

  saveLocalConversation({
    ...conversation,
    lastMessage: latest
      ? toPreviewContent(latest)
      : traduire(langueInitiale(), "core_new_conversation"),
    lastMessageType: (latest?.type ?? "text") as MessageType,
    time: latest ? formatConversationTime(latest.timestamp) : "Maintenant",
    unread: 0,
  })

  saveLocalMessages(conversation.id, messages)
}
