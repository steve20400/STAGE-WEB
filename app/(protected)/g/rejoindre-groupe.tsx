import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { codeErreurApi } from "../../../src/lib/api-client"
import { useTranslation } from "../../../src/i18n"
import { AvatarCircle } from "../../../src/components/avatar-circle"
import { Icone } from "../../../src/components/icone"
import { useToast } from "../../../src/components/toast"
import {
  annulerDemandeGroupe,
  apercuLienGroupe,
  CODE_LIEN_GROUPE,
  rejoindreParLien,
  type ApercuGroupe,
} from "../../../src/services/groupe-service"
import "../../../src/components/groupe-lien.css"

/**
 * /webapp/g/<code> — LE LIEN D'UN GROUPE, OUVERT DANS LE NAVIGATEUR (18/11/2026).
 *
 * La page de secours du serveur (`/g/<code>`) envoie ici par « Continuer sur
 * le web ». Sans session, la garde passe par la connexion puis revient.
 *
 * Comme sur le mobile : on montre le groupe, et l'on confirme. Groupe public,
 * on entre et la discussion s'ouvre ; groupe privé, la demande part aux
 * admins. Jamais d'entrée sans confirmation : un lien caché derrière un texte
 * ne doit faire entrer personne à son insu.
 */
export function RejoindreGroupePage() {
  const { code = "" } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const toast = useToast()
  const [apercu, setApercu] = useState<ApercuGroupe | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    if (!CODE_LIEN_GROUPE.test(code)) {
      setErreur(t("grp_link_invalid"))
      return
    }
    let actif = true
    apercuLienGroupe(code)
      .then((a) => {
        if (!actif) return
        // Déjà membre : rien à confirmer.
        if (a.etat === "membre") navigate(`/chats/${a.convId}`, { replace: true })
        else setApercu(a)
      })
      .catch(() => {
        if (actif) setErreur(t("grp_link_invalid"))
      })
    return () => {
      actif = false
    }
  }, [code, navigate, t])

  const messageErreur = (e: unknown) => {
    const c = codeErreurApi(e)
    if (c === "HORS_PERIMETRE") return t("grp_join_out_of_scope")
    if (c === "CLES_MANQUANTES") return t("grp_join_no_keys")
    if (c === "LIEN_INVALIDE") return t("grp_link_invalid")
    return t("grp_join_failed")
  }

  const rejoindre = async () => {
    if (!apercu || enCours) return
    setEnCours(true)
    try {
      const r = await rejoindreParLien(code)
      if (r.etat === "membre") {
        navigate(`/chats/${r.convId}`, { replace: true })
        return
      }
      toast.success(t("grp_join_requested"))
      setApercu({ ...apercu, etat: "attente" })
    } catch (e) {
      toast.error(messageErreur(e))
    } finally {
      setEnCours(false)
    }
  }

  const retirer = async () => {
    if (!apercu || enCours) return
    setEnCours(true)
    try {
      await annulerDemandeGroupe(code)
      toast.success(t("grp_join_cancelled"))
      setApercu({ ...apercu, etat: "aucun" })
    } catch (e) {
      toast.error(messageErreur(e))
    } finally {
      setEnCours(false)
    }
  }

  const nom = apercu?.nom ?? t("grp_link_received")
  const enAttente = apercu?.etat === "attente"
  const estPublic = apercu?.acces === "public"

  return (
    <main className="gl-page">
      <div className="gl-fenetre">
        {!apercu ? (
          <>
            <p className={erreur ? "gl-erreur" : "gl-info"}>{erreur ?? "…"}</p>
            {erreur && (
              <div className="gl-actions">
                <button type="button" onClick={() => navigate("/chats", { replace: true })}>
                  {t("close")}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="gl-info" style={{ marginTop: 0 }}>
              {t("grp_link_received")}
            </p>
            <AvatarCircle
              avatar={apercu.avatarUrl}
              initials={(nom.trim()[0] ?? "?").toUpperCase()}
              className="gl-page-avatar"
            />
            <h1>{nom}</h1>
            <span className="gl-meta">
              <Icone nom={estPublic ? "globe" : "cadenas"} taille={14} />
              {t(estPublic ? "grp_type_public" : "grp_type_private")}
              <span aria-hidden="true">·</span>
              {t(apercu.membres > 1 ? "grp_members_count_many" : "grp_members_count_one", { n: apercu.membres })}
            </span>
            {apercu.chiffre && (
              <div className="gl-meta" style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
                <Icone nom="bouclier" taille={14} /> {t("grp_join_encrypted")}
              </div>
            )}
            {apercu.description && <p className="gl-description">{apercu.description}</p>}
            <p className="gl-info">
              {t(enAttente ? "grp_join_pending" : estPublic ? "grp_type_public_sub" : "grp_type_private_sub")}
            </p>
            <div className="gl-actions">
              {enAttente ? (
                <button type="button" onClick={retirer} disabled={enCours}>
                  {t("grp_join_cancel")}
                </button>
              ) : (
                <button type="button" className="gl-principal" onClick={rejoindre} disabled={enCours}>
                  {t(estPublic ? "grp_join" : "grp_join_request")}
                </button>
              )}
              <button type="button" onClick={() => navigate("/chats", { replace: true })}>
                {t(enAttente ? "close" : "cancel")}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
