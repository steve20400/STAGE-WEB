import { useState, useMemo, useEffect, useRef, useCallback, type CSSProperties } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import { CHAT_COLORS, type ConversationMock } from "../../../src/mocks/chat-data"
import {
  fetchChatConversations,
  fetchChatConversationsCacheFirst,
  type ConversationListItem,
} from "../../../src/services/chats-service"
import {
  subscribeToAllMessages,
  subscribeToPresence,
  subscribeToWsConnected,
} from "../../../src/services/websocket-service"
import { useAuth } from "../../../src/components/auth-provider"
import { getMyUserId, toInitials } from "../../../src/data/session-user"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"
import { avatarDisplaySrc } from "../../../src/lib/avatar"
import { listerBlocages } from "../../../src/services/blocked-service"
import {
  listerListes,
  listesEnCache,
  type ListeContacts,
} from "../../../src/services/contact-lists-service"
import { teinteCss } from "../contacts/contact-lists-affichage"
import {
} from "../../../src/services/message-payload"
import { langueInitiale, traduire, useTranslation } from "../../../src/i18n"
import "./chats-page.css"

// Helper hors composant : la langue est relue a chaque appel, donc a chaque
// rendu. Un changement de langue se propage sans recharger la page.
function lastMsgIcon(type: ConversationMock["lastMessageType"]) {
  const langue = langueInitiale()
  if (type === "file") return `[${traduire(langue, "file")}] `
  if (type === "audio") return `[${traduire(langue, "cinfo_audio")}] `
  if (type === "image") return `[${traduire(langue, "l2_image")}] `
  return ""
}

/**
 * LA LIGNE SOUS LE NOM DE LA CONVERSATION — l'apercu du dernier message.
 *
 * 🔴 UN MESSAGE STRUCTURE NE PORTE PAS DE TEXTE. Le `content` d'une fiche de
 * contact ou d'une position est du JSON (`services/message-payload`, miroir du
 * format que le serveur impose aux trois clients). La liste l'affichait tel
 * quel : on lisait `{"v":1,"contacts":[{"name":"Jean Dupont",…` sous le nom de
 * la conversation, et l'expediteur voyait exactement la meme chose apres avoir
 * envoye une fiche.
 *
 * Le resume se lit AVEC les lecteurs partages — jamais avec un `JSON.parse`
 * ecrit ici : ils ecartent deja une charge mal formee, une fiche sans nom ni
 * numero, une latitude hors bornes. Une seconde lecture locale finirait par
 * diverger de la leur, et la liste annoncerait une fiche que la discussion
 * refuserait d'afficher.
 *
 * Traduit au RENDU comme `lastMsgIcon` juste au-dessus, et pour la meme raison :
 * un libelle calcule au chargement garderait la langue de ce moment-la.
 *
 * Les media gardent leur forme d'origine — `[Image] legende` : leur contenu EST
 * la legende, il n'y a rien a decoder.
 */
function apercuDernierMessage(conv: ConversationMock): string {
  const langue = langueInitiale()

  if (conv.lastMessageType === "contact" || conv.lastMessageType === "location") {
    /*
     * LE SERVEUR A DEJA FAIT CE TRAVAIL, ET MIEUX QUE NOUS.
     *
     * `lastMessage` ne contient PAS le JSON de la fiche : le serveur y ecrit
     * deja un libelle — « 👤 Jean Dupont », « 📍 Douala ». Tenter de le decoder
     * ici partait donc d'une premisse fausse, et le nom se perdait en route :
     * la liste affichait « Contact » la ou elle affichait le nom de la personne
     * auparavant. Une correction qui retire de l'information.
     *
     * On rend donc le libelle tel quel, SANS le prefixe de type : ces deux
     * formes portent deja leur propre pictogramme, et y ajouter le trombone des
     * fichiers donnait « [Fichier] 👤 Jean Dupont » — un contact annonce comme
     * une piece jointe.
     *
     * Le repli ne sert qu'au cache local, seul chemin ou `lastMessage` peut
     * etre vide : une ligne vide se lirait comme une conversation sans dernier
     * message.
     */
    if (conv.lastMessage) return conv.lastMessage
    return traduire(
      langue,
      conv.lastMessageType === "contact" ? "f2_contact" : "thr_gps_position"
    )
  }

  return `${lastMsgIcon(conv.lastMessageType)}${conv.lastMessage}`
}

/**
 * Le nom sous lequel s'affiche une conversation.
 *
 * MES NOTES NE SONT PAS UN CORRESPONDANT. Une conversation avec soi-meme n'a
 * qu'un participant — moi — et le nom d'un tete-a-tete se lit d'ordinaire chez
 * l'AUTRE. Faute d'autre, elle s'annoncerait sous mon propre nom, ou sous mon
 * numero, comme si quelqu'un d'autre m'ecrivait. Le serveur le sait deja et
 * envoie `isSelf` : on s'en sert plutot que de deviner a la forme des membres.
 *
 * Le libelle se relit ici, a chaque rendu (meme raison que `lastMsgIcon`), et
 * non au chargement : un changement de langue se voit donc aussitot, sans
 * attendre le prochain passage sur le reseau.
 */
function nomConversation(conv: ConversationListItem): string {
  return conv.isSelf ? traduire(langueInitiale(), "l2_me") : conv.name
}

/**
 * Les filtres du systeme, dans l'ordre de la rangee. Les listes de contacts
 * viennent APRES eux et ne s'y melangent jamais : un filtre du systeme decrit
 * un etat de la conversation (non lue, reservee), une liste designe un cercle
 * de personnes que l'utilisateur a lui-meme constitue. Les confondre ferait
 * croire que « Famille » est une notion de l'application.
 */
const FILTRES_SYSTEME = ["all", "unread", "groups", "locked", "blocked"] as const

type FiltreSysteme = (typeof FILTRES_SYSTEME)[number]

/**
 * Un seul filtre est actif a la fois : un etat unique, plutot que deux qu'il
 * faudrait tenir accordes a chaque clic. Le prefixe empeche l'identifiant d'une
 * liste — une chaine libre venue du serveur — de se faire passer pour un filtre
 * du systeme.
 */
type Filtre = FiltreSysteme | `liste:${string}`

const PREFIXE_LISTE = "liste:"

function idListeDuFiltre(filtre: Filtre): string | null {
  return filtre.startsWith(PREFIXE_LISTE) ? filtre.slice(PREFIXE_LISTE.length) : null
}

/**
 * Pastille de couleur d'une liste, la MEME que dans la page des contacts :
 * c'est elle qui relie les deux ecrans, et elle est posee en style inline pour
 * la meme raison que `--clist-teinte` la-bas — la teinte appartient au modele,
 * aucune feuille de styles ne peut la connaitre a l'avance.
 */
function stylePastille(teinte: string | null): CSSProperties {
  return {
    flexShrink: 0,
    boxSizing: "border-box",
    width: 8,
    height: 8,
    borderRadius: "50%",
    // Sans couleur choisie, un contour vide plutot qu'un point couleur d'accent,
    // qui ferait croire a un choix : c'est le dessin de `.clist-pastille-vide`.
    background: teinte ?? "transparent",
    border: teinte ? undefined : "1.5px solid var(--border-default)",
  }
}

export default function ChatsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user: sessionUser } = useAuth()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filtre>("all")
  const idListeActive = idListeDuFiltre(filter)

  /**
   * Numeros concernes par un blocage, DANS LES DEUX SENS : ceux que j'ai
   * bloques, et ceux qui m'ont bloque. L'echange est rompu dans les deux cas,
   * c'est ce que le filtre rassemble.
   *
   * A ne pas confondre avec le futur filtre des conversations verrouillees, qui
   * portera sur les reservations posees par les appareils de VOTRE compte.
   */
  const [numerosBloques, setNumerosBloques] = useState<Set<string>>(new Set())
  useEffect(() => {
    let annule = false
    void listerBlocages().then(({ bloques, quiMOntBloque }) => {
      if (annule) return
      // Les DEUX sens : ceux que j'ai bloques, et ceux qui m'ont bloque. Dans
      // les deux cas l'echange est rompu, c'est ce que le filtre doit montrer.
      setNumerosBloques(
        new Set(
          [...bloques, ...quiMOntBloque]
            .map((b) => (b.publicNumber ?? "").replace(/\D/g, ""))
            .filter(Boolean)
        )
      )
    })
    return () => {
      annule = true
    }
  }, [])

  /** Vrai si le correspondant d'un tete-a-tete figure parmi les bloques. */
  const estConversationBloquee = useCallback(
    (c: ConversationMock) => {
      if (c.isGroup || numerosBloques.size === 0) return false
      const moi = getMyUserId()
      const pair = c.membersInfo?.find((m) => m.id !== moi)
      const numero = (pair?.publicNumber ?? "").replace(/\D/g, "")
      return numero !== "" && numerosBloques.has(numero)
    },
    [numerosBloques]
  )

  /**
   * Listes de contacts, proposees en filtres a la suite de ceux du systeme. Le
   * miroir du service les rend sans attendre le reseau : la rangee est complete
   * des le premier rendu, et le GET ne fait que la corriger.
   */
  const [listes, setListes] = useState<ListeContacts[]>(() => listesEnCache())
  useEffect(() => {
    let annule = false
    void listerListes().then((rendues) => {
      if (!annule) setListes(rendues)
    })
    return () => {
      annule = true
    }
  }, [])

  /**
   * Une liste supprimee ailleurs — l'ecran des contacts, un autre appareil du
   * compte — disparait de la rangee au rafraichissement. Si c'est elle qui
   * filtrait, on revient a « Tous » : sinon la liste des discussions resterait
   * vide, sans plus aucun bouton allume pour dire pourquoi.
   */
  /**
   * Membres de la liste qui filtre, prets a comparer. Deux ensembles construits
   * une fois plutot qu'un parcours du tableau par conversation : la liste des
   * discussions se refiltre a chaque message recu.
   *
   * Les identifiants sont mis en minuscules comme le fait le service, dont la
   * comparaison suit celle du serveur. Les numeros ne sont qu'un second essai,
   * pour une conversation venue d'un cache ancien dont le membre n'aurait pas
   * d'identifiant exploitable ; les deux facons d'alimenter une liste (contact
   * choisi, numero compose) aboutissent au meme compte, donc au meme resultat.
   */
  const membresDuFiltre = useMemo(() => {
    const liste = idListeActive ? listes.find((autre) => autre.id === idListeActive) : undefined
    if (!liste) return null
    return {
      identifiants: new Set(liste.membres.map((membre) => membre.id.toLowerCase())),
      numeros: new Set(
        liste.membres.map((membre) => membre.numero.replace(/\D/g, "")).filter(Boolean)
      ),
    }
  }, [listes, idListeActive])

  /**
   * Vrai si le correspondant d'un tete-a-tete est membre de la liste active.
   *
   * Un groupe n'a pas de correspondant : une liste rassemble des personnes, pas
   * des salons, et un groupe qui compterait un membre de la liste n'est pas
   * pour autant une conversation avec ce cercle. Le correspondant se lit comme
   * pour les blocages juste au-dessus — le membre qui n'est pas soi.
   */
  const estDansListeActive = useCallback(
    (c: ConversationMock) => {
      if (!membresDuFiltre || c.isGroup) return false
      const moi = getMyUserId()
      const pair = c.membersInfo?.find((m) => m.id !== moi)
      if (!pair) return false
      if (membresDuFiltre.identifiants.has(pair.id.toLowerCase())) return true
      const numero = (pair.publicNumber ?? "").replace(/\D/g, "")
      return numero !== "" && membresDuFiltre.numeros.has(numero)
    },
    [membresDuFiltre]
  )

  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * LES LISTES QUI MERITENT UN FILTRE — celles avec qui l'on parle vraiment.
   *
   * Toutes les listes s'affichaient, y compris vides. Depuis que quatre listes
   * existent des le depart, la rangee de filtres s'ouvrait sur quatre boutons
   * qui ne filtraient RIEN : les presser rendait une liste vide, et ils
   * poussaient hors de vue les filtres du systeme, qui eux servent.
   *
   * Un filtre n'a de sens que s'il a quelque chose a montrer. Une liste
   * apparait donc quand au moins un de ses membres a une conversation — et
   * disparait si cette conversation s'en va.
   *
   * ⚠️ CALCULE SUR LES CORRESPONDANTS, une seule fois, et non liste par liste :
   * la rangee se recalcule a chaque message recu, et croiser quatre listes avec
   * deux cents conversations a chaque fois se paierait a l'affichage.
   */
  const listesAvecDiscussion = useMemo(() => {
    const moi = getMyUserId()
    const identifiants = new Set<string>()
    const numeros = new Set<string>()
    for (const c of conversations) {
      // Un groupe n'a pas de correspondant : une liste rassemble des personnes,
      // pas des salons. Meme regle que le filtrage lui-meme.
      if (c.isGroup) continue
      const pair = c.membersInfo?.find((m) => m.id !== moi)
      if (!pair) continue
      identifiants.add(pair.id.toLowerCase())
      const numero = (pair.publicNumber ?? "").replace(/\D/g, "")
      if (numero) numeros.add(numero)
    }
    return listes.filter((liste) =>
      liste.membres.some(
        (membre) =>
          identifiants.has(membre.id.toLowerCase()) ||
          numeros.has(membre.numero.replace(/\D/g, ""))
      )
    )
  }, [listes, conversations])

  /*
   * Le filtre actif suit ce que la rangee AFFICHE.
   *
   * Une liste dont la derniere conversation vient de disparaitre quitte la
   * rangee. Si c'est elle qui filtrait, on revient a « Tous » : sinon l'ecran
   * resterait vide, sans plus aucun bouton allume pour dire pourquoi.
   */
  useEffect(() => {
    if (!idListeActive) return
    if (listesAvecDiscussion.some((liste) => liste.id === idListeActive)) return
    setFilter("all")
  }, [listesAvecDiscussion, idListeActive])

  useEffect(() => {
    let cancelled = false

    // Chargement initial : cache-first (IndexedDB → affichage instantané, puis réseau)
    void fetchChatConversationsCacheFirst(
      (cached) => {
        if (!cancelled) setConversations(cached)
      },
      (fresh) => {
        if (!cancelled) setConversations(fresh)
      }
    )

    // Refresh réseau pur pour les mises à jour temps réel
    // (le cache est déjà alimenté par le service sous-jacent)
    const refresh = () => {
      void fetchChatConversations().then((list) => {
        if (!cancelled) setConversations(list)
      })
    }

    // Temps reel : un nouveau message (n'importe quelle conversation) rafraichit
    // la liste (dernier message, tri, compteur non-lus). Debounce leger pour
    // eviter une rafale de requetes si plusieurs messages arrivent d'un coup.
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(refresh, 400)
    }
    const unsubscribeMessages = subscribeToAllMessages(scheduleRefresh)
    // Et on se resynchronise apres chaque (re)connexion du WebSocket.
    const unsubscribeConnected = subscribeToWsConnected(scheduleRefresh)

    // Presence : le pastille verte suit les connexions/deconnexions sans
    // recharger toute la liste.
    const unsubscribePresence = subscribeToPresence((event) => {
      if (cancelled) return
      setConversations((prev) =>
        prev.map((conversation) =>
          !conversation.isGroup &&
          conversation.membersInfo?.some((member) => member.id === event.userId)
            ? { ...conversation, online: event.isOnline }
            : conversation
        )
      )
    })

    // Filet de securite : un expediteur au WebSocket degrade (4G) envoie en
    // REST sans diffusion -> on resynchronise la liste toutes les 20 s.
    const pollId = setInterval(() => {
      if (!cancelled && !document.hidden) scheduleRefresh()
    }, 20_000)

    return () => {
      cancelled = true
      unsubscribeMessages()
      unsubscribeConnected()
      unsubscribePresence()
      clearInterval(pollId)
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [])

  const filtered = useMemo(() => {
    return conversations
      .filter((c) => {
        // Une liste choisie tient lieu de filtre a elle seule : l'etat n'en
        // porte qu'un a la fois, et aucun filtre du systeme n'est actif alors.
        if (idListeActive) return estDansListeActive(c)
        if (filter === "unread") return c.unread > 0
        if (filter === "groups") return c.isGroup
        if (filter === "blocked") return estConversationBloquee(c)
        // Toutes les conversations reservees du compte, sans distinguer quel
        // appareil a pose le verrou : c'est la vue « ce qui est en cours de
        // traitement chez nous », l'interet d'un numero partage.
        if (filter === "locked") return c.lock != null
        return true
      })
      // Sur le nom AFFICHE, pas sur celui du serveur : sinon chercher « Moi »
      // ne trouverait pas mes notes dans une langue autre que le francais.
      .filter((c) => nomConversation(c).toLowerCase().includes(query.toLowerCase()))
  }, [conversations, query, filter, idListeActive, estDansListeActive, estConversationBloquee])

  const pinned = filtered.filter((c) => c.isPinned)
  const regular = filtered.filter((c) => !c.isPinned)

  return (
    <div className="chats-root">
      <div className="ch-header">
        {/* Carte profil : nom + Alanya ID, comme en tete de liste sur mobile */}
        <div
          onClick={() => navigate("/settings")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 14,
            padding: "12px 14px",
            marginBottom: 14,
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              background: "var(--brand)",
              color: "var(--brand-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Bricolage Grotesque', sans-serif",
              fontWeight: 800,
              fontSize: 15,
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            {avatarDisplaySrc(sessionUser?.avatar) ? (
              <img
                src={avatarDisplaySrc(sessionUser?.avatar)!}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              toInitials(sessionUser?.name ?? t("l2_me"))
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {sessionUser?.name ?? t("my_profile")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Alanya ID :{" "}
              <strong style={{ color: "var(--accent)" }}>
                {sessionUser?.phone ? formatAlanyaNumber(sessionUser.phone) : "—"}
              </strong>
            </div>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-faint)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>

        <div className="ch-title-row page-title-row">
          <h1 className="ch-title">{t("chats")}</h1>
          <button className="new-chat-btn" onClick={() => navigate("/chats/new")}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("new_chat")}
          </button>
        </div>

        {/* Recherche */}
        <div className="search-wrap">
          <svg
            className="search-icon"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="search-input"
            type="search"
            placeholder={t("search_conversation")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Filtres : ceux du systeme, puis les listes de contacts. La rangee
            defile lateralement (voir .filter-row), elle encaisse donc autant de
            listes que le compte en porte sans changer de hauteur. */}
        <div className="filter-row">
          {FILTRES_SYSTEME.map((f) => (
            <button
              key={f}
              className={`filter-btn ${filter === f ? "active" : ""}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? t("filter_all")
                : f === "unread"
                  ? `${t("filter_unread")} (${conversations.reduce((a, c) => a + (c.unread > 0 ? 1 : 0), 0)})`
                  : f === "groups"
                    ? t("filter_groups")
                    : f === "blocked"
                      ? `${t("filter_blocked")} (${conversations.filter(estConversationBloquee).length})`
                      : `${t("filter_locked")} (${conversations.filter((c) => c.lock != null).length})`}
            </button>
          ))}

          {/* Trait de separation : les listes commencent ici. Sans lui, une
              liste nommee « Non lues » se lirait comme un filtre du systeme. */}
          {listesAvecDiscussion.length > 0 && (
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                alignSelf: "center",
                width: 1,
                height: 16,
                margin: "0 5px",
                background: "var(--border-subtle)",
              }}
            />
          )}

          {listesAvecDiscussion.map((liste) => {
            const cible: Filtre = `${PREFIXE_LISTE}${liste.id}`
            return (
              <button
                key={liste.id}
                type="button"
                className={`filter-btn ${filter === cible ? "active" : ""}`}
                aria-pressed={filter === cible}
                onClick={() => setFilter(cible)}
                title={liste.nom}
                style={{ gap: 7 }}
              >
                <span aria-hidden style={stylePastille(teinteCss(liste.couleur))} />
                {/* Un nom va jusqu'a 60 caracteres : borne ici, sinon une seule
                    liste occuperait toute la rangee et cacherait les autres. */}
                <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {liste.nom}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Liste */}
      <div className="ch-list">
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">...</div>
            <div className="empty-txt">
              {t("no_conversation_found")}
              {/* Le terme cherche seulement s'il y en a un : un filtre qui ne
                  ramene rien affichait jusqu'ici une paire de guillemets vides,
                  qui se lisait comme un defaut d'affichage. */}
              {query !== "" && (
                <>
                  <br />
                  {`"${query}"`}
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <div className="section-label">{t("section_pinned")}</div>
                {pinned.map((conv) => (
                  <ConvItem key={conv.id} conv={conv} />
                ))}
              </>
            )}
            {regular.length > 0 && (
              <>
                {pinned.length > 0 && <div className="section-label">{t("section_recent")}</div>}
                {regular.map((conv) => (
                  <ConvItem key={conv.id} conv={conv} />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Bouton flottant orange -> repertoire des contacts (comme sur mobile).
          position en CSS (chats-split.css) pour rester dans la colonne de gauche. */}
      <button
        className="chats-fab"
        onClick={() => navigate("/contacts")}
        aria-label={t("open_contacts")}
        title={t("contacts")}
        style={{
          position: "absolute",
          right: 20,
          bottom: 20,
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "none",
          background: "#c04d29",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 10px 28px #c04d2960",
          zIndex: 100,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </button>
    </div>
  )
}

function ConvItem({ conv }: { conv: ConversationListItem }) {
  const { t } = useTranslation()
  const color = CHAT_COLORS[conv.colorIdx % CHAT_COLORS.length]
  const nom = nomConversation(conv)
  return (
    <NavLink
      to={`/chats/${conv.id}`}
      className={({ isActive }) => `conv-item ${isActive ? "active" : ""}`}
    >
      <div className="av" style={{ background: color.bg, color: color.text, overflow: "hidden" }}>
        {avatarDisplaySrc(conv.avatar) ? (
          <img
            src={avatarDisplaySrc(conv.avatar)!}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
          />
        ) : (
          // Les initiales suivent le nom affiche : sinon le « M » de « Moi »
          // resterait apres un passage au chinois, ou l'inverse.
          conv.isSelf ? toInitials(nom) : conv.initials
        )}
        {/* Pas de pastille de presence sur mes propres notes : je suis
            forcement la, l'annoncer n'apprendrait rien. Le service met deja
            `online` a faux pour cette conversation ; la condition ici garde
            l'affichage juste meme si une donnee de cache ancienne dit autrement. */}
        {conv.online && !conv.isGroup && !conv.isSelf && <div className="av-dot" />}
        {conv.isGroup && <div className="group-stack">{conv.members?.length ?? "+"}</div>}
      </div>
      <div className="conv-meta">
        <div className="conv-name">
          {nom}
          {conv.isPinned && <span className="pin-icon">{t("l2_pinned_badge")}</span>}
          {conv.isGroup && (
            <span
              style={{
                fontSize: 9,
                background: "var(--border-subtle)",
                color: "var(--text-muted)",
                padding: "1px 5px",
                borderRadius: 3,
                fontWeight: 500,
              }}
            >
              {t("set_about_group")}
            </span>
          )}
          {/* Reservee par un appareil du compte. Visible AVANT d'ouvrir : c'est
              tout l'interet, savoir qu'un collegue s'en occupe deja plutot que
              de le decouvrir devant une zone de saisie absente. */}
          {conv.lock != null && (
            <span
              className="conv-lock"
              title={
                conv.lock.detenteur
                  ? t("has_the_hand", { name: conv.lock.detenteur })
                  : t("locked_by_device")
              }
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 018 0v4" />
              </svg>
              {conv.lock.detenteur ?? t("l2_reserved_badge")}
            </span>
          )}
        </div>
        <div className={`conv-preview ${conv.unread > 0 ? "unread" : ""}`}>
          {apercuDernierMessage(conv)}
        </div>
      </div>
      <div className="conv-right">
        <div className={`conv-time ${conv.unread > 0 ? "unread" : ""}`}>{conv.time}</div>
        {conv.unread > 0 && <div className="unread-badge">{conv.unread}</div>}
      </div>
    </NavLink>
  )
}
