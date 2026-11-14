import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

import { useTranslation } from "../../../../src/i18n"
import { apiRequest } from "../../../../src/lib/api-client"
import { avatarDisplaySrc } from "../../../../src/lib/avatar"
import "./groupes-communs.css"

/**
 * « GROUPES EN COMMUN » dans les infos d'une discussion a deux (14/11/2026,
 * demande du user, jumeau de `contact_info_screen.dart` sur le mobile, comme
 * l'application de reference).
 *
 * Le serveur ne rend que des groupes dont je suis membre
 * (`GET /api/users/:id/groupes-communs`) : rien n'est revele que je ne
 * connaisse deja. Aucun groupe, ou serveur plus ancien : la section n'existe pas.
 */

interface GroupeCommun {
  id: string
  nom: string
  avatarUrl?: string | null
  membres: number
}

export function GroupesCommuns({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [groupes, setGroupes] = useState<GroupeCommun[]>([])

  useEffect(() => {
    let annule = false
    apiRequest<{ groupes?: GroupeCommun[] }>(
      `/api/users/${encodeURIComponent(userId)}/groupes-communs`,
      { cache: "no-store" }
    )
      .then((r) => {
        if (!annule) setGroupes(r.groupes ?? [])
      })
      .catch(() => undefined)
    return () => {
      annule = true
    }
  }, [userId])

  if (groupes.length === 0) return null

  return (
    <div className="cip-section">
      <div className="cip-section-title">
        {t("cinfo_groupes_communs")} · {groupes.length}
      </div>
      <ul className="groupes-communs">
        {groupes.map((g) => (
          <li key={g.id}>
            <button type="button" onClick={() => navigate(`/chats/${g.id}`)}>
              <span className="gc-photo" aria-hidden="true">
                {avatarDisplaySrc(g.avatarUrl) ? (
                  <img src={avatarDisplaySrc(g.avatarUrl)!} alt="" />
                ) : (
                  (g.nom || "?").trim().slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="gc-texte">
                <span className="gc-nom">{g.nom}</span>
                <span className="gc-membres">{t("cinfo_members_count", { count: g.membres })}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
