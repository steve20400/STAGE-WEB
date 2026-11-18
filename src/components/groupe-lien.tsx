import { useCallback, useEffect, useState } from "react"
import QRCode from "qrcode"
import { codeErreurApi } from "../lib/api-client"
import { useTranslation } from "../i18n"
import {
  deciderDemandeGroupe,
  demandesDuGroupe,
  lienDuGroupe,
  renouvelerLienDuGroupe,
  type DemandeAdhesion,
  type LienGroupe,
} from "../services/groupe-service"
import { AvatarCircle } from "./avatar-circle"
import { Icone } from "./icone"
import { useToast } from "./toast"
import "./groupe-lien.css"

/**
 * LE LIEN ET LE QR CODE D'UN GROUPE, ET SA LISTE D'ATTENTE (18/11/2026).
 *
 * Jumeaux de `lien_groupe_screen.dart` et `demandes_groupe_screen.dart` sur
 * le mobile. Demande du user : chaque groupe a un lien et un QR code ; un
 * groupe public fait entrer aussitôt, un groupe privé met la personne en
 * attente jusqu'à ce qu'un admin l'accepte ou la refuse.
 */

function initiales(nom: string): string {
  return (
    nom
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((m) => m[0]?.toUpperCase() ?? "")
      .join("") || "?"
  )
}

/** Le lien, son QR code, partager, copier, réinitialiser (admins). */
export function FenetreLienGroupe({
  convId,
  nom,
  estAdmin,
  onFermer,
}: {
  convId: string
  nom: string
  estAdmin: boolean
  onFermer: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [lien, setLien] = useState<LienGroupe | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    let actif = true
    lienDuGroupe(convId)
      .then((l) => {
        if (actif) setLien(l)
      })
      .catch((e) => {
        if (!actif) return
        setErreur(codeErreurApi(e) === "NOT_ADMIN" ? t("grp_link_admins_only") : t("grp_link_load_failed"))
      })
    return () => {
      actif = false
    }
  }, [convId, t])

  // Niveau H : le code reste lisible même abîmé ou recadré par une messagerie.
  useEffect(() => {
    if (!lien) return
    let actif = true
    QRCode.toDataURL(lien.lien, { errorCorrectionLevel: "H", margin: 1, width: 440 })
      .then((url) => {
        if (actif) setQr(url)
      })
      .catch(() => {})
    return () => {
      actif = false
    }
  }, [lien])

  const texte = lien ? t("grp_link_share_text", { name: nom, link: lien.lien }) : ""

  const copier = async () => {
    if (!lien) return
    try {
      await navigator.clipboard.writeText(lien.lien)
      toast.success(t("grp_link_copied"))
    } catch {
      toast.error(t("grp_link_load_failed"))
    }
  }

  const partager = async () => {
    if (!lien) return
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: nom, text: texte })
        return
      } catch {
        // Partage annulé : rien à dire.
        return
      }
    }
    await copier()
  }

  const reinitialiser = async () => {
    if (enCours || !window.confirm(`${t("grp_link_reset_confirm_title")}\n\n${t("grp_link_reset_confirm_text")}`)) return
    setEnCours(true)
    try {
      setLien(await renouvelerLienDuGroupe(convId))
      setQr(null)
      toast.success(t("grp_link_reset_done"))
    } catch {
      toast.error(t("grp_link_load_failed"))
    } finally {
      setEnCours(false)
    }
  }

  const publicOuPrive = lien?.acces === "public"

  return (
    <div className="gl-voile" role="presentation" onClick={onFermer}>
      <div
        className="gl-fenetre"
        role="dialog"
        aria-modal="true"
        aria-label={t("grp_link_title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gl-entete">
          <h2>{t("grp_link_title")}</h2>
          <button type="button" className="gl-fermer" onClick={onFermer} aria-label={t("close")}>
            <Icone nom="fermer" taille={18} />
          </button>
        </div>
        {!lien ? (
          <p className={erreur ? "gl-erreur" : "gl-info"}>{erreur ?? "…"}</p>
        ) : (
          <>
            <div className="gl-carte">
              <strong className="gl-nom">{nom}</strong>
              <span className="gl-type">
                <Icone nom={publicOuPrive ? "globe" : "cadenas"} taille={13} />{" "}
                {t(publicOuPrive ? "grp_type_public" : "grp_type_private")}
              </span>
              {qr ? <img className="gl-qr" src={qr} alt="" width={220} height={220} /> : <div className="gl-qr" />}
              <span className="gl-astuce">{t("grp_link_qr_hint")}</span>
            </div>
            <p className="gl-info">{t(publicOuPrive ? "grp_type_public_sub" : "grp_type_private_sub")}</p>
            <div className="gl-lien" title={lien.lien}>
              {lien.lien}
            </div>
            <div className="gl-actions">
              <button type="button" className="gl-principal" onClick={partager}>
                <Icone nom="lien" /> {t("grp_link_share")}
              </button>
              <button type="button" onClick={copier}>
                {t("grp_link_copy")}
              </button>
              {qr && (
                <a className="gl-bouton" href={qr} download="alanya-groupe.png">
                  <Icone nom="qr" /> {t("grp_link_share_qr")}
                </a>
              )}
            </div>
            {estAdmin && (
              <button type="button" className="gl-danger" onClick={reinitialiser} disabled={enCours}>
                {t("grp_link_reset")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** La liste d'attente d'un groupe, pour ses admins. */
export function FenetreDemandesGroupe({
  convId,
  onFermer,
  onChange,
}: {
  convId: string
  onFermer: () => void
  /** Après une décision : le nombre de demandes et les membres ont changé. */
  onChange?: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [demandes, setDemandes] = useState<DemandeAdhesion[] | null>(null)
  const [erreur, setErreur] = useState(false)
  const [enCours, setEnCours] = useState<string | null>(null)

  const charger = useCallback(async () => {
    try {
      setDemandes(await demandesDuGroupe(convId))
      setErreur(false)
    } catch {
      setErreur(true)
    }
  }, [convId])

  useEffect(() => {
    void charger()
  }, [charger])

  const decider = async (d: DemandeAdhesion, accepter: boolean) => {
    if (enCours) return
    setEnCours(d.id)
    const nom = d.pseudo || d.publicNumber
    try {
      await deciderDemandeGroupe(convId, d.id, accepter)
      toast.success(accepter ? t("grp_requests_accepted", { name: nom }) : t("grp_requests_refused"))
      onChange?.()
    } catch (e) {
      const code = codeErreurApi(e)
      toast.error(
        code === "DEJA_TRAITEE"
          ? t("grp_requests_already")
          : code === "HORS_PERIMETRE"
            ? t("grp_requests_out_of_scope")
            : code === "CLES_MANQUANTES"
              ? t("grp_requests_no_keys")
              : t("grp_requests_failed"),
      )
    } finally {
      setEnCours(null)
      await charger()
    }
  }

  return (
    <div className="gl-voile" role="presentation" onClick={onFermer}>
      <div
        className="gl-fenetre"
        role="dialog"
        aria-modal="true"
        aria-label={t("grp_requests_title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gl-entete">
          <h2>{t("grp_requests_title")}</h2>
          <button type="button" className="gl-fermer" onClick={onFermer} aria-label={t("close")}>
            <Icone nom="fermer" taille={18} />
          </button>
        </div>
        {demandes === null ? (
          <p className={erreur ? "gl-erreur" : "gl-info"}>{erreur ? t("grp_requests_load_failed") : "…"}</p>
        ) : demandes.length === 0 ? (
          <p className="gl-info">{t("grp_requests_none")}</p>
        ) : (
          <ul className="gl-demandes">
            {demandes.map((d) => {
              const nom = d.pseudo || d.publicNumber
              return (
                <li key={d.id}>
                  <AvatarCircle avatar={d.avatarUrl} initials={initiales(nom)} className="gl-avatar" />
                  <span className="gl-demandeur">
                    <strong>{nom}</strong>
                    <small>{d.publicNumber}</small>
                  </span>
                  <button
                    type="button"
                    className="gl-refuser"
                    disabled={enCours !== null}
                    onClick={() => decider(d, false)}
                    aria-label={t("grp_requests_refuse")}
                    title={t("grp_requests_refuse")}
                  >
                    <Icone nom="fermer" />
                  </button>
                  <button
                    type="button"
                    className="gl-accepter"
                    disabled={enCours !== null}
                    onClick={() => decider(d, true)}
                    aria-label={t("grp_requests_accept")}
                    title={t("grp_requests_accept")}
                  >
                    <Icone nom="valider" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
