export type ContactColor = "amber" | "blue" | "violet" | "teal" | "rose"

export interface Contact {
  id: string
  name: string
  initials: string
  color: ContactColor
  online: boolean
  email: string
  phone: string
  /** Photo de profil (data-URL miniature ou URL). */
  avatar?: string | null
}

export const CONTACT_COLORS: Record<ContactColor, { bg: string; fg: string }> = {
  amber: { bg: "var(--av-0-bg)", fg: "var(--av-0-fg)" },
  blue: { bg: "var(--av-1-bg)", fg: "var(--av-1-fg)" },
  violet: { bg: "var(--av-2-bg)", fg: "var(--av-2-fg)" },
  teal: { bg: "var(--av-3-bg)", fg: "var(--av-3-fg)" },
  rose: { bg: "var(--av-4-bg)", fg: "var(--av-4-fg)" },
}

export const DEFAULT_CONTACTS: Contact[] = [
  {
    id: "1",
    name: "Kevin Manga",
    initials: "KM",
    color: "amber",
    online: true,
    email: "k.manga@enspy.cm",
    phone: "+237690000001",
  },
  {
    id: "2",
    name: "Groupe Alanya II",
    initials: "GA",
    color: "blue",
    online: false,
    email: "group.alanya@enspy.cm",
    phone: "+237690000002",
  },
  {
    id: "3",
    name: "Dr. NANA BINKEU",
    initials: "NB",
    color: "violet",
    online: false,
    email: "nana.binkeu@enspy.cm",
    phone: "+237690000003",
  },
  {
    id: "4",
    name: "Laure Ateba",
    initials: "LA",
    color: "teal",
    online: true,
    email: "l.ateba@enspy.cm",
    phone: "+237690000004",
  },
  {
    id: "5",
    name: "Paul Essomba",
    initials: "PE",
    color: "rose",
    online: false,
    email: "p.essomba@enspy.cm",
    phone: "+237690000005",
  },
  {
    id: "6",
    name: "Nina Fouda",
    initials: "NF",
    color: "amber",
    online: false,
    email: "n.fouda@enspy.cm",
    phone: "+237690000006",
  },
]

export interface DirectoryAccount {
  name: string
  phone: string
  email: string
  online: boolean
  color: ContactColor
}

export const ACCOUNT_DIRECTORY: DirectoryAccount[] = [
  {
    name: "Kevin Manga",
    phone: "+237690000001",
    email: "k.manga@enspy.cm",
    online: true,
    color: "amber",
  },
  {
    name: "Groupe Alanya II",
    phone: "+237690000002",
    email: "group.alanya@enspy.cm",
    online: false,
    color: "blue",
  },
  {
    name: "Dr. NANA BINKEU",
    phone: "+237690000003",
    email: "nana.binkeu@enspy.cm",
    online: false,
    color: "violet",
  },
  {
    name: "Laure Ateba",
    phone: "+237690000004",
    email: "l.ateba@enspy.cm",
    online: true,
    color: "teal",
  },
  {
    name: "Paul Essomba",
    phone: "+237690000005",
    email: "p.essomba@enspy.cm",
    online: false,
    color: "rose",
  },
  {
    name: "Nina Fouda",
    phone: "+237690000006",
    email: "n.fouda@enspy.cm",
    online: false,
    color: "amber",
  },
  {
    name: "Serge Mvondo",
    phone: "+237690000007",
    email: "s.mvondo@enspy.cm",
    online: true,
    color: "blue",
  },
  {
    name: "Anita Mekongo",
    phone: "+237690000008",
    email: "a.mekongo@enspy.cm",
    online: false,
    color: "teal",
  },
]

const STORAGE_KEY = "alanya-contacts-v1"

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

export function loadContacts(): Contact[] {
  if (!canUseStorage()) return []

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Contact[]
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

export function persistContacts(contacts: Contact[]) {
  if (!canUseStorage()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts))
}

export function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, "").replace(/[()-]/g, "")
}

export function findDirectoryAccountByPhone(phone: string): DirectoryAccount | null {
  const normalized = normalizePhone(phone)
  const found = ACCOUNT_DIRECTORY.find((account) => normalizePhone(account.phone) === normalized)
  return found ?? null
}

export function toInitials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "NC"
  )
}
