import { useEffect, useState } from "react"
import { langueInitiale, traduire, useTranslation } from "../i18n"
import { avatarDisplaySrc } from "../lib/avatar"
import { toInitials } from "../data/session-user"
import { fetchStatusViews, type StatusItem, type VueStatut } from "../services/status-service"
import { aimesDe, useStatutsEnDirect, vuesDe } from "../services/statuts-en-direct"

function ilYa(iso: string): string {
  const langue = langueInitiale()
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 1) return traduire(langue, "l2_just_now")
  if (min < 60) return traduire(langue, "set_ago_minutes", { n: min })
  return traduire(langue, "set_ago_hours", { n: Math.floor(min / 60) })
}

/**
 * QUI A VU, QUI A AIME — sous MON statut (01/11/2026), comme le mobile.
 *
 * Le web n'affichait qu'un compte dans l'en-tete, et jamais les noms. Le pied
 * montre les vues et les « J'aime » en direct ; un clic deplie la liste :
 * chaque personne, quand elle a vu, et un coeur si elle a aime.
 *
 * [onOuvert] : la lecture se met en pause pendant qu'on lit la liste.
 */
export function VuesStatut({
  statut,
  onOuvert,
}: {
  statut: StatusItem
  onOuvert: (ouvert: boolean) => void
}) {
  const { t } = useTranslation()
  useStatutsEnDirect()
  const vues = vuesDe(statut)
  const aimes = aimesDe(statut)
  const [ouvert, setOuvert] = useState(false)
  const [liste, setListe] = useState<VueStatut[] | null>(null)
  const [echec, setEchec] = useState(false)

  // Relue a l'ouverture, et a chaque vue ou « J'aime » arrive en direct.
  useEffect(() => {
    if (!ouvert) return
    let actif = true
    setEchec(false)
    fetchStatusViews(statut.id)
      .then((l) => {
        if (actif) setListe(l)
      })
      .catch(() => {
        if (actif) setEchec(true)
      })
    return () => {
      actif = false
    }
  }, [ouvert, statut.id, vues, aimes])

  // Un autre statut : la liste repart fermee.
  useEffect(() => {
    setOuvert(false)
    setListe(null)
  }, [statut.id])

  const basculer = () => {
    const suivant = !ouvert
    setOuvert(suivant)
    onOuvert(suivant)
  }

  return (
    <div
      className="statut-vues"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {ouvert && (
        <div className="statut-vues-liste" role="list">
          <div className="statut-vues-titre">
            {t("l2_views_count", { count: vues })}
            {aimes > 0 && <span className="statut-vues-coeur"> · ♥ {aimes}</span>}
          </div>
          {echec && <div className="statut-vues-vide">{t("server_unreachable")}</div>}
          {!echec && liste === null && <div className="statut-vues-vide">{t("loading")}</div>}
          {!echec && liste !== null && liste.length === 0 && (
            <div className="statut-vues-vide">{t("statut_aucune_vue")}</div>
          )}
          {liste?.map((v) => (
            <div key={v.userId} className="statut-vues-ligne" role="listitem">
              <span className="statut-vues-avatar">
                {avatarDisplaySrc(v.avatarUrl) ? (
                  <img src={avatarDisplaySrc(v.avatarUrl)!} alt="" />
                ) : (
                  toInitials(v.name)
                )}
              </span>
              <span className="statut-vues-nom">{v.name}</span>
              {v.liked && (
                <span className="statut-vues-coeur" aria-label={t("status_like")}>
                  ♥
                </span>
              )}
              <span className="statut-vues-quand">{ilYa(v.viewedAt)}</span>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="statut-vues-pied" onClick={basculer} aria-expanded={ouvert}>
        <span aria-hidden="true">👁</span> {t("l2_views_count", { count: vues })}
        {aimes > 0 && <span className="statut-vues-coeur"> ♥ {aimes}</span>}
        <span aria-hidden="true">{ouvert ? "⌄" : "⌃"}</span>
      </button>
    </div>
  )
}
