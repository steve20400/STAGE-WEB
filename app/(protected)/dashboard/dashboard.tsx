import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  fetchDashboardData,
  type DashboardCall,
  type DashboardData,
} from "../../../src/services/dashboard-service"
import { subscribeToAllMessages } from "../../../src/services/websocket-service"
import "./dashboard-page.css"
import { useTranslation, type Cle, type LanguageCode } from "../../../src/i18n"

// TYPES

// CONSTANTES

// Palette de couleurs cyclique pour les avatars (un par contact)
const AVATAR_COLORS = ["var(--accent)", "var(--info)", "#a78bfa", "var(--success)", "var(--danger)"]

// HELPERS

/** Retourne la couleur d'avatar correspondant a la position dans la liste. */
function avatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]
}

/**
 * Salutation selon l'heure de la journee, rendue sous forme de CLE : le libelle
 * est resolu au rendu, il suit donc la langue choisie sans rechargement.
 */
function greetingKey(): Cle {
  const hour = new Date().getHours()
  if (hour < 12) return "s2_greeting_morning"
  if (hour < 18) return "s2_greeting_afternoon"
  return "s2_greeting_evening"
}

/**
 * Etiquette regionale de chaque langue, pour les noms de jour et de mois.
 * Le code court suffirait au navigateur, mais il choisirait « pt-BR » pour le
 * portugais et « nn » pour le norvegien : on fixe la variante attendue.
 */
const LOCALES: Record<LanguageCode, string> = {
  fr: "fr-FR",
  en: "en-GB",
  es: "es-ES",
  de: "de-DE",
  pt: "pt-PT",
  ru: "ru-RU",
  zh: "zh-CN",
  sv: "sv-SE",
  no: "nb-NO",
}

/** Date du jour dans la langue courante (ex : « jeudi 10 avril »). */
function getTodayLabel(langue: LanguageCode): string {
  return new Date().toLocaleDateString(LOCALES[langue], {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
}

// SOUS-COMPOSANTS

/**
 * Carte de statistique rapide.
 * La variante `accent` (messages non lus) s'affiche en dore.
 */
function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string
  value: string
  sub: string
  accent?: boolean
}) {
  return (
    <div className={`stat-card ${accent ? "stat-card--accent" : ""}`}>
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__sub">{sub}</div>
    </div>
  )
}

/**
 * Icone de direction d'appel (entrant / sortant / manque).
 * La couleur et la rotation sont gerees par des classes CSS (.call-icon--*).
 */
function CallDirectionIcon({ direction }: { direction: DashboardCall["direction"] }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      className={`call-icon--${direction}`}
      style={{ flexShrink: 0 }}
    >
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" />
    </svg>
  )
}

// PAGE PRINCIPALE

export default function DashboardPage() {
  const { t, language } = useTranslation()
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    let cancelled = false
    let refreshTimer: ReturnType<typeof setTimeout> | null = null

    const refresh = () => {
      void fetchDashboardData().then((result) => {
        if (!cancelled) setData(result)
      })
    }

    refresh()

    // Rafraichit les "messages recents" quand un nouveau message arrive en direct.
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(refresh, 500)
    }
    const unsubscribeMessages = subscribeToAllMessages(scheduleRefresh)

    return () => {
      cancelled = true
      unsubscribeMessages()
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [])

  if (!data) {
    return (
      <main className="dash">
        <div className="dash-header">
          <h1 className="dash-title">{t("loading")}</h1>
        </div>
      </main>
    )
  }

  const { currentUser, recentChats, recentCalls, contacts } = data
  const totalUnread = recentChats.reduce((acc, chat) => acc + chat.unread, 0)
  const onlineCount = contacts.filter((contact) => contact.online).length
  const firstName = currentUser.name.split(" ")[0]

  return (
    <main className="dash">
      <div className="dash-header">
        <div className="greeting">{getTodayLabel(language)}</div>
        <h1 className="dash-title">
          {t(greetingKey())}, <span>{firstName}.</span>
        </h1>
      </div>

      <div className="stats-grid">
        <StatCard
          label={t("dash_unread")}
          value={String(totalUnread)}
          sub={t("dash_in_conversations", { n: recentChats.length })}
          accent
        />
        <StatCard
          label={t("dash_conversations")}
          value={String(recentChats.length)}
          sub={t("dash_active_this_month")}
        />
        <StatCard
          label={t("dash_recent_calls")}
          value={String(recentCalls.length)}
          sub={t("dash_last_7_days")}
        />
        <StatCard
          label={t("contacts")}
          value={String(contacts.length)}
          sub={t("dash_in_your_network")}
        />
      </div>

      <div className="dash-grid">
        {/* Conversations */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">{t("s2_recent_conversations")}</span>
            <Link to="/chats" className="card-link">
              {t("s2_see_all")}
            </Link>
          </div>

          {recentChats.map((chat, i) => {
            const color = avatarColor(i)
            return (
              <Link to={`/chats/${chat.id}`} className="chat-item" key={chat.id}>
                <div
                  className="avatar"
                  // background et color restent inline : calcules dynamiquement
                  style={{ background: color + "30", color }}
                >
                  {chat.initials}
                  {chat.online && <div className="av-dot" />}
                </div>

                <div className="chat-meta">
                  <div className="chat-name">
                    {chat.name}
                    {chat.isGroup && <span className="group-pill">{t("set_about_group")}</span>}
                  </div>
                  <div className="chat-preview">{chat.lastMessage}</div>
                </div>

                <div className="chat-right">
                  <div className="chat-time">{chat.time}</div>
                  {chat.unread > 0 && <div className="unread-badge">{chat.unread}</div>}
                </div>
              </Link>
            )
          })}
        </div>

        {/* Profil utilisateur */}
        <div className="profile-card">
          <div className="profile-top">
            <div className="profile-avatar">
              {currentUser.initials}
              <div className="profile-avatar-dot" />
            </div>
            <div>
              <div className="profile-name">{currentUser.name}</div>
              {currentUser.email ? <div className="profile-email">{currentUser.email}</div> : null}
            </div>
          </div>

          <div className="profile-divider" />

          <div className="profile-row">
            <span className="profile-row-label">{t("s2_profile_status")}</span>
            <span className="profile-row-val profile-row-val--online">{t("online")}</span>
          </div>
          <div className="profile-row">
            <span className="profile-row-label">{t("cinfo_message")}</span>
            <span className="profile-row-val">{currentUser.statusMsg}</span>
          </div>
          <div className="profile-row">
            <span className="profile-row-label">{t("s2_member_since")}</span>
            <span className="profile-row-val">{currentUser.memberSince}</span>
          </div>
          <div className="profile-row">
            <span className="profile-row-label">{t("contacts")}</span>
            <span className="profile-row-val">
              {t("dash_contacts_count", { n: contacts.length })}
            </span>
          </div>

          <button className="profile-edit" onClick={() => navigate("/settings")}>
            {t("dash_edit_profile")}
          </button>
        </div>
      </div>

      <div className="dash-grid-3">
        {/* Appels recents */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">{t("dash_recent_calls")}</span>
            <Link to="/calls" className="card-link">
              {t("s2_see_all")}
            </Link>
          </div>

          {recentCalls.map((call, i) => {
            const color = avatarColor(i)
            return (
              <div className="call-item" key={call.id}>
                <div className="avatar avatar--sm" style={{ background: color + "20", color }}>
                  {call.initials}
                </div>

                <div className="call-info">
                  <div className="call-name">{call.name}</div>
                  <div className="call-meta">
                    <CallDirectionIcon direction={call.direction} />
                    <span className="type-badge">
                      {call.type === "video" ? t("filter_video") : t("filter_audio")}
                    </span>
                    {call.duration !== "-" && <span>{call.duration}</span>}
                    {call.direction === "missed" && (
                      <span className="call-missed-label">{t("s2_missed")}</span>
                    )}
                  </div>
                </div>

                <div className="call-right">
                  <div className="call-time">{call.time}</div>
                  <button
                    className="call-btn"
                    title={t("s2_call_back")}
                    aria-label={t("s2_call_back")}
                    onClick={() =>
                      navigate(
                        `/calls/new?contact=${call.contactId}&type=${call.type}&returnTo=${encodeURIComponent("/dashboard")}`
                      )
                    }
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Contacts */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">{t("contacts")}</span>
            <span className="contacts-online">{t("s2_n_online", { n: onlineCount })}</span>
          </div>

          {contacts.map((contact, i) => {
            const color = avatarColor(i)
            return (
              <div className="contact-item" key={contact.id}>
                <div className="avatar avatar--sm" style={{ background: color + "20", color }}>
                  {contact.initials}
                  {contact.online && <div className="av-dot av-dot--sm" />}
                </div>

                <div className="contact-info">
                  <div className="contact-name">{contact.name}</div>
                  <div className="contact-status">{contact.status}</div>
                </div>

                <Link to={`/chats?contact=${contact.id}`} className="contact-write">
                  {t("s2_write")}
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
