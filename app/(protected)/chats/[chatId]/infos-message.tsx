import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { useTranslation } from "../../../../src/i18n"
import { apiRequest } from "../../../../src/lib/api-client"
import { avatarDisplaySrc } from "../../../../src/lib/avatar"
import "./infos-message.css"

/**
 * « INFOS DU MESSAGE » d'un de MES messages de groupe (14/11/2026, jumeau du
 * mobile, comme l'application de reference) : une barre « n sur N ont lu »,
 * puis trois listes — lu, recu sans etre lu, pas encore recu.
 *
 * « Recu » vient du serveur (`received`) : le membre s'est connecte depuis
 * l'envoi. Un serveur plus ancien ne l'envoie pas ; on garde alors deux
 * listes, lu et en attente.
 */

interface MembreInfo {
  userId: string
  name: string
  avatarUrl?: string | null
  read: boolean
  readAt?: string | null
  received?: boolean
}

export function FenetreInfosMessage({
  convId,
  messageId,
  onFermer,
}: {
  convId: string
  messageId: string
  onFermer: () => void
}) {
  const { t } = useTranslation()
  const [membres, setMembres] = useState<MembreInfo[] | null>(null)
  const [echec, setEchec] = useState(false)

  useEffect(() => {
    let annule = false
    apiRequest<{ members?: MembreInfo[] }>(
      `/api/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(messageId)}/info`,
      { cache: "no-store" }
    )
      .then((r) => {
        if (!annule) setMembres(r.members ?? [])
      })
      .catch(() => {
        if (!annule) setEchec(true)
      })
    return () => {
      annule = true
    }
  }, [convId, messageId])

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer()
    }
    document.addEventListener("keydown", surTouche)
    return () => document.removeEventListener("keydown", surTouche)
  }, [onFermer])

  const lus = (membres ?? []).filter((m) => m.read)
  const nonLus = (membres ?? []).filter((m) => !m.read)
  const saitRecu = (membres ?? []).some((m) => typeof m.received === "boolean")
  const recus = saitRecu ? nonLus.filter((m) => m.received) : []
  const pasRecus = saitRecu ? nonLus.filter((m) => !m.received) : nonLus
  const total = membres?.length ?? 0

  const heure = (iso?: string | null) => {
    if (!iso) return ""
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  }

  const section = (titre: string, liste: MembreInfo[], classe: string, avecHeure: boolean) =>
    liste.length === 0 ? null : (
      <section className="infos-section">
        <h3 className={`infos-section-titre ${classe}`}>
          {titre} · {liste.length}
        </h3>
        <ul>
          {liste.map((m) => (
            <li key={m.userId} className="infos-membre">
              <span className="infos-photo" aria-hidden="true">
                {avatarDisplaySrc(m.avatarUrl) ? (
                  <img src={avatarDisplaySrc(m.avatarUrl)!} alt="" />
                ) : (
                  (m.name || "?").trim().slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="infos-nom">{m.name}</span>
              {avecHeure && <span className="infos-heure">{heure(m.readAt)}</span>}
            </li>
          ))}
        </ul>
      </section>
    )

  return createPortal(
    <div className="infos-voile" onClick={onFermer} role="presentation">
      <div
        className="infos-feuille"
        role="dialog"
        aria-modal="true"
        aria-label={t("info_titre")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="infos-tete">
          <h2>{t("info_titre")}</h2>
          <button type="button" className="infos-fermer" onClick={onFermer} aria-label={t("close")}>
            ×
          </button>
        </div>
        {echec ? (
          <p className="infos-vide">{t("info_indisponible")}</p>
        ) : membres === null ? (
          <p className="infos-vide">…</p>
        ) : total === 0 ? (
          <p className="infos-vide">{t("info_personne")}</p>
        ) : (
          <>
            <div className="infos-barre" aria-hidden="true">
              {lus.length > 0 && <span className="lu" style={{ flex: lus.length }} />}
              {recus.length > 0 && <span className="recu" style={{ flex: recus.length }} />}
              {pasRecus.length > 0 && <span className="attente" style={{ flex: pasRecus.length }} />}
            </div>
            <p className="infos-resume">{t("info_lus_sur", { n: lus.length, total })}</p>
            <div className="infos-listes">
              {section(t("info_lu"), lus, "lu", true)}
              {section(t("info_recu"), recus, "recu", false)}
              {section(saitRecu ? t("info_pas_recu") : t("info_en_attente"), pasRecus, "attente", false)}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
