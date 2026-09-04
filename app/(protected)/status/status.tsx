import { langueInitiale, traduire, useTranslation } from "../../../src/i18n"
import { useCallback, useEffect, useRef, useState } from "react"
import { compresserImage } from "../../../src/lib/image-compression"
import { createPrivateChat } from "../../../src/services/chats-service"
import { sendChatMessage } from "../../../src/services/messages-service"
import { useToast } from "../../../src/components/toast"
import { toInitials } from "../../../src/data/session-user"
import { resolveMediaUrl,
  TAILLE_MEDIA_MAX_OCTETS,
} from "../../../src/services/media-service"
import {
  deleteStatus,
  fetchStatusFeed,
  postMediaStatus,
  postTextStatus,
  viewStatus,
  type StatusFeed,
  type StatusGroup,
} from "../../../src/services/status-service"
import "../calls/calls-page.css"

const TEXT_BG_COLORS = ["#8A4B2B", "#2E7D32", "#C04D29", "#1D4ED8", "#6D28D9", "#2B1B12"]
const STATUS_DURATION_MS = 5000

function groupLabel(group: StatusGroup): string {
  return group.pseudo?.trim() || group.publicNumber
}

// Helper hors composant : la langue est relue a chaque appel, donc a chaque
// rendu. Un changement de langue se propage sans recharger la page.
function timeAgo(iso: string): string {
  const langue = langueInitiale()
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (diffMin < 1) return traduire(langue, "l2_just_now")
  if (diffMin < 60) return traduire(langue, "set_ago_minutes", { n: diffMin })
  const h = Math.floor(diffMin / 60)
  return traduire(langue, "set_ago_hours", { n: h })
}

/** Anneau d'avatar : accent si statuts non vus, discret sinon. */
function StatusAvatar({
  group,
  isMine,
  onClick,
}: {
  group: StatusGroup
  isMine?: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const label = isMine ? t("l2_my_status") : groupLabel(group)
  const ringColor = group.hasUnviewed && !isMine ? "var(--accent)" : "var(--border-strong)"
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        width: 86,
      }}
    >
      <div
        style={{
          width: 62,
          height: 62,
          borderRadius: "50%",
          border: `2.5px solid ${ringColor}`,
          padding: 3,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: "var(--accent-dim)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 16,
            fontFamily: "'Bricolage Grotesque', sans-serif",
          }}
        >
          {toInitials(label)}
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          color: "var(--text-secondary)",
          maxWidth: 84,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </button>
  )
}

export default function StatusPage() {
  const { t } = useTranslation()
  const { success, error } = useToast()
  const [feed, setFeed] = useState<StatusFeed>({ me: null, others: [] })
  const [loading, setLoading] = useState(true)

  // Visionneuse : groupe ouvert + index du statut affiche
  const [viewer, setViewer] = useState<{
    group: StatusGroup
    index: number
    isMine: boolean
  } | null>(null)
  const [progress, setProgress] = useState(0)
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Composeur
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerText, setComposerText] = useState("")
  const [composerBg, setComposerBg] = useState(TEXT_BG_COLORS[0])
  const [posting, setPosting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    try {
      const data = await fetchStatusFeed()
      setFeed(data)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[status] chargement echoue", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /* ----------------- Visionneuse ----------------- */

  const closeViewer = useCallback(() => {
    setViewer(null)
    if (progressTimer.current) {
      clearInterval(progressTimer.current)
      progressTimer.current = null
    }
    void reload() // rafraichit les anneaux vus/non-vus
  }, [reload])

  const goTo = useCallback((delta: number) => {
    setViewer((current) => {
      if (!current) return null
      const nextIndex = current.index + delta
      if (nextIndex < 0) return { ...current, index: 0 }
      if (nextIndex >= current.group.statuses.length) return null // fin du groupe
      return { ...current, index: nextIndex }
    })
    avancement.current = 0
    setProgress(0)
    setMediaPret(false)
  }, [])

  /**
   * LECTURE EN PAUSE — appui maintenu.
   *
   * On lit un statut en quelques secondes ; il suffit d'un nom a dechiffrer ou
   * d'un texte un peu long pour que la barre passe avant qu'on ait fini. Toutes
   * les messageries laissent retenir la lecture au doigt.
   */
  const [enPause, setEnPause] = useState(false)

  /**
   * LE MEDIA EST-IL PRET ? Tant qu'il ne l'est pas, le compte a rebours ne
   * demarre PAS et le cercle tourne.
   *
   * Sans cela, la barre de progression courait sur un ecran noir : sur une
   * connexion lente, un statut de cinq secondes pouvait passer AVANT que
   * l'image apparaisse. On regardait le vide, puis le suivant.
   *
   * Le cercle revient si le telechargement s'interrompt en cours de lecture —
   * une video qui bufferise n'avance plus, la barre ne doit pas avancer non plus.
   */
  const [mediaPret, setMediaPret] = useState(false)

  /** Texte en cours de saisie dans la barre de reponse. */
  const [reponse, setReponse] = useState("")
  const [envoiReponse, setEnvoiReponse] = useState(false)

  // La progression s'ACCUMULE au lieu de repartir de l'heure de depart : sans
  // cela, reprendre apres une pause relancerait le compte a zero.
  const avancement = useRef(0)

  // Progression + auto-avance (les videos avancent a la fin via onEnded).
  useEffect(() => {
    if (!viewer) return
    const status = viewer.group.statuses[viewer.index]
    if (!status) return

    if (!viewer.isMine) void viewStatus(status.id)

    if (progressTimer.current) clearInterval(progressTimer.current)
    if (status.type === "VIDEO") return // gere par onEnded
    if (enPause) return // l'appui est maintenu : la barre ne bouge pas
    // ⚠️ LE COMPTE A REBOURS SUIT LE TELECHARGEMENT. Un statut de cinq secondes
    // sur une connexion lente passait avant que l'image arrive.
    if (status.type === "IMAGE" && !mediaPret) return

    let dernier = Date.now()
    progressTimer.current = setInterval(() => {
      const maintenant = Date.now()
      // On ajoute le TEMPS ECOULE plutot que de comparer a l'heure de depart :
      // c'est ce qui permet de reprendre une pause la ou on l'avait laissee.
      avancement.current += maintenant - dernier
      dernier = maintenant
      const ratio = avancement.current / STATUS_DURATION_MS
      if (ratio >= 1) {
        goTo(1)
      } else {
        setProgress(ratio)
      }
    }, 50)

    return () => {
      if (progressTimer.current) {
        clearInterval(progressTimer.current)
        progressTimer.current = null
      }
    }
  }, [viewer, goTo, enPause, mediaPret])

  // Le viewer devient null quand on depasse le dernier statut -> fermeture propre.
  useEffect(() => {
    if (viewer === null && progressTimer.current) {
      clearInterval(progressTimer.current)
      progressTimer.current = null
      void reload()
    }
  }, [viewer, reload])

  /**
   * REPONDRE A UN STATUT — par un emoji ou par un texte.
   *
   * Le message part dans le TETE-A-TETE avec l'auteur, jamais dans un fil
   * dedie : repondre a un statut, c'est engager une conversation, et
   * l'utilisateur s'attend a la retrouver la ou vivent toutes les autres.
   *
   * ⚠️ LA CITATION ACCOMPAGNE LE MESSAGE. Sans elle, l'auteur recevrait
   * « joli ! » sans savoir de quoi on parle — il a pu publier cinq statuts dans
   * la journee. Le serveur RECOPIE le statut cite plutot que d'y pointer : un
   * statut est purge au bout de 24 h, et une citation qui le referencerait
   * disparaitrait avec.
   */
  const repondreAuStatut = async (texte: string) => {
    const contenu = texte.trim()
    if (!contenu || envoiReponse || !viewer) return
    const statut = viewer.group.statuses[viewer.index]
    if (!statut) return

    setEnvoiReponse(true)
    // La lecture se met en pause le temps de l'envoi : voir le statut defiler
    // pendant qu'on lui repond est desagreable, et le suivant volerait la
    // reponse en cours.
    setEnPause(true)
    try {
      const { id } = await createPrivateChat(viewer.group.publicNumber)
      await sendChatMessage(id, contenu, "text", { statutCite: statut.id })
      setReponse("")
      success(t("statut_reponse_envoyee"))
    } catch {
      error(t("server_unreachable"))
    } finally {
      setEnvoiReponse(false)
      setEnPause(false)
    }
  }

  /* ----------------- Composeur ----------------- */

  const submitTextStatus = async () => {
    const text = composerText.trim()
    if (!text || posting) return
    setPosting(true)
    try {
      await postTextStatus(text, composerBg)
      success(t("l2_status_published"), t("status_visible_24h"))
      setComposerText("")
      setComposerOpen(false)
      await reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : t("l2_publish_failed_detail")
      error(t("l2_status_not_published"), message)
    } finally {
      setPosting(false)
    }
  }

  /**
   * Publie PLUSIEURS medias, dans l'ordre choisi.
   *
   * ⚠️ SEQUENTIEL, jamais en parallele. Trois raisons, dans l'ordre
   * d'importance :
   *
   *  - l'ORDRE. Les statuts se lisent dans l'ordre de publication ; lancer
   *    trois televersements de front les ferait arriver dans l'ordre du reseau,
   *    et une serie de photos se retrouverait melangee ;
   *  - la MEMOIRE. Chaque image est compressee avant d'etre envoyee, et trois
   *    bitmaps de 12 megapixels decodes ensemble retiennent pres de 150 Mo ;
   *  - le RESEAU. Sur une connexion mobile, trois envois simultanes se
   *    partagent la bande passante et finissent tous les trois en retard.
   *
   * Un echec n'arrete pas la serie : les autres partent, et le decompte final
   * dit ce qui a reellement ete publie. Perdre trois photos parce que la
   * deuxieme etait trop lourde serait le pire des comportements.
   */
  const publierPlusieurs = async (fichiers: File[]) => {
    if (posting) return
    setPosting(true)
    let publies = 0
    let echecs = 0
    try {
      for (const fichier of fichiers) {
        try {
          await envoyerUnMedia(fichier)
          publies += 1
        } catch {
          echecs += 1
        }
      }
    } finally {
      setPosting(false)
    }
    if (publies > 0) {
      success(t("l2_status_published"), t("status_visible_24h"))
      await reload()
    }
    if (echecs > 0) {
      error(t("l2_status_not_published"), t("l2_publish_failed_detail"))
    }
  }

  /**
   * Publie UN media. Ne gere ni l'etat « en cours » ni les avis : c'est
   * `publierPlusieurs` qui les tient, une fois pour toute la serie — sinon
   * publier cinq photos afficherait cinq confirmations.
   *
   * LEVE en cas d'echec, pour que la serie sache compter ce qui n'est pas passe.
   */
  const envoyerUnMedia = async (file: File) => {
    // La MEME borne que la messagerie et que le serveur. Elle etait ecrite en
    // dur ici : le jour ou l'une des trois change, les deux autres mentent.
    if (file.size > TAILLE_MEDIA_MAX_OCTETS) {
      throw new Error(t("l2_max_50_mb"))
    }
    /*
     * COMPRESSEE COMME DANS UNE DISCUSSION. Un statut est vu par tout le
     * repertoire : c'est le media le plus telecharge de l'application, et le
     * seul qui l'etait encore en pleine resolution.
     *
     * `compresserImage` rend l'original a la moindre incertitude — format
     * inconnu, decodage rate, gain absent.
     */
    const pret =
      file.type.startsWith("image/") ? await compresserImage(file) : null
    await postMediaStatus(pret?.fichier ?? file)
    setComposerOpen(false)
  }

  const handleDeleteCurrent = async () => {
    if (!viewer || !viewer.isMine) return
    const status = viewer.group.statuses[viewer.index]
    try {
      await deleteStatus(status.id)
      success(t("l2_status_deleted"), "")
      closeViewer()
    } catch (err) {
      const message = err instanceof Error ? err.message : t("cinfo_delete_failed")
      error(t("error"), message)
    }
  }

  const currentStatus = viewer?.group.statuses[viewer.index]

  return (
    <div className="calls-root" style={{ padding: "20px 0" }}>
      <div className="calls-head" style={{ marginBottom: 18 }}>
        <div className="calls-title-row page-title-row">
          <h1 className="calls-title">{t("status")}</h1>
          <button className="new-call-btn" onClick={() => setComposerOpen((v) => !v)}>
            {composerOpen ? t("close") : t("publish_status")}
          </button>
        </div>
      </div>

      {composerOpen && (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 14,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            {t("status_help")}
          </div>
          <textarea
            className="input-base"
            placeholder={t("express_yourself")}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            maxLength={700}
            rows={3}
            style={{ width: "100%", padding: 12, fontSize: 13, resize: "vertical" }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            {TEXT_BG_COLORS.map((colorHex) => (
              <button
                key={colorHex}
                onClick={() => setComposerBg(colorHex)}
                aria-label={t("l2_background_color", { couleur: colorHex })}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: colorHex,
                  border:
                    composerBg === colorHex
                      ? "3px solid var(--text-primary)"
                      : "2px solid var(--border-default)",
                  cursor: "pointer",
                }}
              />
            ))}
            <div style={{ flex: 1 }} />
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              // PLUSIEURS A LA FOIS, photos et videos melangees. On n'en
              // prenait qu'un : publier trois cliches d'un evenement demandait
              // de rouvrir le selecteur trois fois.
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const fichiers = Array.from(e.target.files ?? [])
                if (fichiers.length > 0) void publierPlusieurs(fichiers)
                e.target.value = ""
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={posting}
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: "8px 14px",
                color: "var(--text-secondary)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t("l2_photo_video")}
            </button>
            <button
              className="new-call-btn"
              onClick={() => void submitTextStatus()}
              disabled={!composerText.trim() || posting}
            >
              {posting ? t("l2_publishing") : t("l2_publish")}
            </button>
          </div>
        </div>
      )}

      {/* Rangee "Mon statut" + contacts */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {feed.me && feed.me.statuses.length > 0 && (
          <StatusAvatar
            group={feed.me}
            isMine
            onClick={() => setViewer({ group: feed.me!, index: 0, isMine: true })}
          />
        )}
        {feed.others.map((group) => (
          <StatusAvatar
            key={group.userId}
            group={group}
            onClick={() => setViewer({ group, index: 0, isMine: false })}
          />
        ))}
      </div>

      {loading && (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: 12 }}>{t("loading")}</div>
      )}
      {!loading && !feed.me?.statuses.length && feed.others.length === 0 && (
        <div className="empty-state">
          <div className="empty-txt">{t("no_status_yet")}</div>
        </div>
      )}

      {/* Visionneuse plein ecran */}
      {viewer && currentStatus && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9000,
            background: "#000000f0",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Barres de progression */}
          <div style={{ display: "flex", gap: 4, padding: "12px 14px 8px" }}>
            {viewer.group.statuses.map((s, i) => (
              <div
                key={s.id}
                style={{ flex: 1, height: 3, borderRadius: 2, background: "#ffffff35" }}
              >
                <div
                  style={{
                    height: "100%",
                    borderRadius: 2,
                    background: "#fff",
                    width:
                      i < viewer.index ? "100%" : i === viewer.index ? `${progress * 100}%` : "0%",
                  }}
                />
              </div>
            ))}
          </div>

          {/* En-tete */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 16px 10px" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "var(--accent)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {toInitials(viewer.isMine ? t("l2_me") : groupLabel(viewer.group))}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>
                {viewer.isMine ? t("l2_my_status") : groupLabel(viewer.group)}
              </div>
              <div style={{ color: "#ffffff90", fontSize: 11 }}>
                {timeAgo(currentStatus.createdAt)}
                {viewer.isMine
                  ? ` — ${t("l2_views_count", { count: currentStatus.viewsCount })}`
                  : ""}
              </div>
            </div>
            {viewer.isMine && (
              <button
                onClick={() => void handleDeleteCurrent()}
                aria-label={t("delete_status")}
                style={{
                  background: "#ffffff20",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 10px",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            )}
            <button
              onClick={closeViewer}
              aria-label={t("close")}
              style={{
                background: "#ffffff20",
                border: "none",
                borderRadius: 8,
                padding: "8px 10px",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Contenu + zones de navigation (gauche = precedent, droite = suivant) */}
          <div
            style={{
              flex: 1,
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
            /*
             * L'APPUI MAINTENU MET EN PAUSE, et le relachement reprend.
             *
             * `onPointerDown` / `onPointerUp` couvrent le doigt ET la souris —
             * les evenements de pointeur unifient les deux, la ou `mousedown`
             * aurait ignore le tactile.
             *
             * `onPointerLeave` et `onPointerCancel` sont indispensables : un
             * doigt qui glisse hors du cadre, ou un appel entrant qui vole le
             * pointeur, ne declenchent PAS `pointerup`. Sans eux, le statut
             * resterait fige indefiniment.
             */
            onPointerDown={() => setEnPause(true)}
            onPointerUp={() => setEnPause(false)}
            onPointerLeave={() => setEnPause(false)}
            onPointerCancel={() => setEnPause(false)}
          >
            {/*
              LES ZONES INVISIBLES restent : sur telephone, on tape a gauche ou
              a droite de l'image, c'est le geste appris de toutes les
              messageries. Elles ne portent AUCUN visuel — un bouton sous le
              pouce cacherait le statut.
            */}
            <div
              onClick={() => goTo(-1)}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "32%",
                zIndex: 5,
                cursor: "w-resize",
              }}
            />
            <div
              onClick={() => goTo(1)}
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: "32%",
                zIndex: 5,
                cursor: "e-resize",
              }}
            />

            {/*
              LES FLECHES, GRAND ECRAN SEULEMENT.

              A la souris, rien n'indique qu'on peut cliquer sur les cotes :
              l'utilisateur attend la fin, ou ferme. La classe porte la bascule
              — masquees sous 901 px, ou le doigt fait deja le travail et ou
              elles mangeraient l'image.

              Elles sont DESACTIVEES aux extremites plutot que masquees : un
              bouton qui disparait deplace celui d'a cote, et l'on clique a cote.
            */}
            <button
              type="button"
              className="statut-fleche gauche"
              onClick={() => goTo(-1)}
              disabled={viewer.index === 0}
              aria-label={t("statut_precedent")}
            >
              ‹
            </button>
            <button
              type="button"
              className="statut-fleche droite"
              onClick={() => goTo(1)}
              disabled={viewer.index >= viewer.group.statuses.length - 1}
              aria-label={t("statut_suivant")}
            >
              ›
            </button>

            {currentStatus.type === "TEXT" && (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background: currentStatus.bgColor ?? "var(--accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 40,
                }}
              >
                <div
                  style={{
                    color: "#fff",
                    fontSize: 26,
                    fontWeight: 700,
                    textAlign: "center",
                    fontFamily: "'Bricolage Grotesque', sans-serif",
                    maxWidth: 640,
                    lineHeight: 1.4,
                    wordBreak: "break-word",
                  }}
                >
                  {currentStatus.text}
                </div>
              </div>
            )}

            {currentStatus.type === "IMAGE" && currentStatus.mediaUrl && (
              <img
                key={currentStatus.id}
                src={resolveMediaUrl(currentStatus.mediaUrl)}
                alt={t("l2_status_alt")}
                // Le compte a rebours ne part qu'ICI : tant que l'image n'est
                // pas arrivee, la barre reste immobile et le cercle tourne.
                onLoad={() => setMediaPret(true)}
                // Media introuvable ou casse : on debloque quand meme, sinon le
                // lecteur resterait fige sur un cercle eternel. Cinq secondes
                // d'ecran vide valent mieux qu'un blocage.
                onError={() => setMediaPret(true)}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            )}

            {currentStatus.type === "VIDEO" && currentStatus.mediaUrl && (
              <video
                key={currentStatus.id}
                src={resolveMediaUrl(currentStatus.mediaUrl)}
                autoPlay
                playsInline
                controls={false}
                /*
                 * UNE VIDEO SE LIT AU FUR ET A MESURE — le navigateur le fait
                 * deja. Ce qu'il ne fait pas, c'est le DIRE : `waiting` marque
                 * l'interruption du telechargement, `playing` sa reprise.
                 *
                 * Sans ces deux-la, une video qui bufferise laissait un ecran
                 * fige sans explication, et l'utilisateur croyait a une panne.
                 */
                onCanPlay={() => setMediaPret(true)}
                onPlaying={() => setMediaPret(true)}
                onWaiting={() => setMediaPret(false)}
                onError={() => setMediaPret(true)}
                onTimeUpdate={(e) => {
                  const video = e.currentTarget
                  if (Number.isFinite(video.duration) && video.duration > 0) {
                    setProgress(video.currentTime / video.duration)
                  }
                }}
                onEnded={() => goTo(1)}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            )}

            {/*
              LE CERCLE, AU-DESSUS DU MEDIA et non a sa place : l'image deja
              recue reste visible pendant qu'on attend la suite d'une video.
              Il ne parait que pour les medias — un statut de TEXTE n'a rien a
              telecharger.
            */}
            {currentStatus.type !== "TEXT" && !mediaPret && (
              <div className="statut-chargement" role="status" aria-live="polite">
                <span className="statut-cercle" aria-hidden="true" />
              </div>
            )}
          </div>

          {/*
            REPONDRE — jamais sur son propre statut : on ne s'ecrit pas a
            soi-meme depuis un ecran de lecture, et le tete-a-tete avec soi
            existe deja ailleurs.

            Les emojis d'abord : c'est la reponse la plus frequente, et elle
            doit tenir en UN geste. La saisie libre reste dessous pour le reste.
          */}
          {!viewer.isMine && (
            <div
              className="statut-reponse"
              // Le clic ne doit pas atteindre les zones de navigation posees
              // dessous : ecrire ne fait pas passer au statut suivant.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="statut-emojis">
                {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    disabled={envoiReponse}
                    onClick={() => void repondreAuStatut(emoji)}
                    aria-label={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <form
                className="statut-saisie"
                onSubmit={(e) => {
                  e.preventDefault()
                  void repondreAuStatut(reponse)
                }}
              >
                <input
                  value={reponse}
                  onChange={(e) => setReponse(e.target.value)}
                  placeholder={t("statut_repondre")}
                  aria-label={t("statut_repondre")}
                  // La lecture s'arrete pendant qu'on ecrit : le statut ne doit
                  // pas defiler sous la reponse en cours.
                  onFocus={() => setEnPause(true)}
                  onBlur={() => setEnPause(false)}
                  disabled={envoiReponse}
                />
                <button type="submit" disabled={envoiReponse || reponse.trim() === ""}>
                  {t("send")}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
