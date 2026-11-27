import { useEffect, useState } from "react"
import { apiRequest, codeErreurApi } from "../../../../src/lib/api-client"
import { formatAlanyaNumber } from "../../../../src/lib/alanya-number"
import { useTranslation } from "../../../../src/i18n"
import { useToast } from "../../../../src/components/toast"
import { addContactByPhone } from "../../../../src/services/contacts-service"
import { poser } from "../../../../src/services/noms-donnes"
import "./cartes-contact.css"

/**
 * LES CARTES DE LA FICHE D'UN CONTACT, comme sur le mobile (27/11/2026,
 * demande du user : « la fiche de contact du web doit ressembler exactement a
 * celle du mobile »).
 *
 *   · « Votre nom pour ce contact » — modifiable, visible par soi seul — et
 *     « Nom du profil », le nom que la personne s'est donne ;
 *   · le numero (Alanya ID), a copier, et « A propos ».
 *
 * 🐛 « ON NE PEUT PAS MODIFIER UN NOM APRES L'AVOIR ENREGISTRE SUR LE WEB »
 * (user) : le nom donne a un contact ne se posait qu'a l'enregistrement, et
 * plus rien ne permettait de le changer ensuite. Le mobile le permettait.
 */

interface FicheNom {
  /** L'identifiant de la ligne de MON repertoire. */
  contactId: string
  alias: string | null
  nomVerrouille: boolean
}

interface ContactServeur {
  id: string
  alias: string | null
  nomVerrouille?: boolean
  user: { id: string }
}

/** Ma fiche de ce correspondant, s'il est dans mon repertoire. */
async function ficheNomPour(userId: string): Promise<FicheNom | null> {
  const r = await apiRequest<{ contacts: ContactServeur[] }>("/api/contacts")
  const c = r.contacts.find((x) => x.user.id === userId)
  if (!c) return null
  return { contactId: c.id, alias: c.alias, nomVerrouille: c.nomVerrouille === true }
}

function IconeCrayon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function IconePersonne() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  )
}

function IconeTelephone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

function IconeInfo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  )
}

function IconeCopier() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function CartesContact({
  pairUserId,
  alanyaId,
  nomProfil,
  aPropos,
  estContact,
}: {
  pairUserId: string
  alanyaId: string | null
  /** Le nom que la personne s'est donne. */
  nomProfil: string
  aPropos: string | null
  /** Dans mon repertoire ? `null` tant qu'on ne sait pas. */
  estContact: boolean | null
}) {
  const { t } = useTranslation()
  const { success, error } = useToast()
  const [fiche, setFiche] = useState<FicheNom | null>(null)
  const [edition, setEdition] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  useEffect(() => {
    let vivant = true
    ficheNomPour(pairUserId)
      .then((f) => {
        if (vivant) setFiche(f)
      })
      .catch(() => undefined)
    return () => {
      vivant = false
    }
  }, [pairUserId, estContact])

  const ouvrir = () => {
    if (fiche?.nomVerrouille) {
      error(t("ci_name_locked", { nom: nomProfil }))
      return
    }
    setEdition(fiche?.alias ?? "")
  }

  const enregistrer = async (valeur: string) => {
    const nom = valeur.trim()
    setEnCours(true)
    try {
      if (fiche) {
        await apiRequest(`/api/contacts/${fiche.contactId}`, {
          method: "PATCH",
          body: { alias: nom || null },
        })
        setFiche({ ...fiche, alias: nom || null })
      } else {
        // Pas encore dans mon repertoire : le nommer l'y ajoute (comme le mobile).
        if (!nom) {
          setEdition(null)
          return
        }
        if (!alanyaId) return
        await addContactByPhone(alanyaId, nom)
        setFiche(await ficheNomPour(pairUserId))
      }
      // Le nom donne remplace celui du profil partout chez moi, tout de suite.
      poser(pairUserId, nom || null)
      setEdition(null)
      success(t("ci_rename_saved"))
    } catch (err) {
      if (codeErreurApi(err) === "NOM_VERROUILLE") {
        error(t("ci_name_locked", { nom: nomProfil }))
      } else {
        error(t("error"), err instanceof Error ? err.message : undefined)
      }
    } finally {
      setEnCours(false)
    }
  }

  const copier = async () => {
    if (!alanyaId) return
    try {
      await navigator.clipboard.writeText(alanyaId)
      success(t("number_copied"))
    } catch {
      /* presse-papiers refuse : rien a signaler */
    }
  }

  const donne = fiche?.alias?.trim() || null

  return (
    <>
      <div className="cic-carte">
        <div className="cic-ligne">
          <span className="cic-icone">
            <IconeCrayon />
          </span>
          <div className="cic-texte">
            <span className="cic-label">{t("ci_given_name")}</span>
            {edition === null ? (
              <span className={`cic-valeur${donne ? "" : " cic-vide"}`}>
                {donne ?? t("ci_given_name_empty")}
              </span>
            ) : (
              <form
                className="cic-edition"
                onSubmit={(e) => {
                  e.preventDefault()
                  void enregistrer(edition)
                }}
              >
                <p className="cic-aide">{t("ci_rename_hint", { profil: nomProfil })}</p>
                <input
                  autoFocus
                  value={edition}
                  maxLength={100}
                  placeholder={nomProfil}
                  onChange={(e) => setEdition(e.target.value)}
                  aria-label={t("ci_given_name")}
                />
                <div className="cic-boutons">
                  {donne && (
                    <button type="button" disabled={enCours} onClick={() => void enregistrer("")}>
                      {t("ci_rename_clear")}
                    </button>
                  )}
                  <button type="button" disabled={enCours} onClick={() => setEdition(null)}>
                    {t("cancel")}
                  </button>
                  <button type="submit" className="cic-principal" disabled={enCours}>
                    {t("save")}
                  </button>
                </div>
              </form>
            )}
          </div>
          {edition === null && (
            <button type="button" className="cic-action" onClick={ouvrir} aria-label={t("ci_rename_title")} title={t("ci_rename_title")}>
              <IconeCrayon />
            </button>
          )}
        </div>
        <div className="cic-separateur" />
        <div className="cic-ligne">
          <span className="cic-icone">
            <IconePersonne />
          </span>
          <div className="cic-texte">
            <span className="cic-label">{t("ci_profile_name")}</span>
            <span className="cic-valeur">{nomProfil}</span>
          </div>
        </div>
      </div>

      <div className="cic-carte">
        {alanyaId && (
          <div className="cic-ligne">
            <span className="cic-icone">
              <IconeTelephone />
            </span>
            <div className="cic-texte">
              <span className="cic-label">{t("phone")}</span>
              <span className="cic-valeur cic-numero">{formatAlanyaNumber(alanyaId)}</span>
            </div>
            <button type="button" className="cic-action" onClick={() => void copier()} aria-label={t("number_copied")}>
              <IconeCopier />
            </button>
          </div>
        )}
        {alanyaId && aPropos && <div className="cic-separateur" />}
        {aPropos && (
          <div className="cic-ligne">
            <span className="cic-icone">
              <IconeInfo />
            </span>
            <div className="cic-texte">
              <span className="cic-label">{t("about")}</span>
              <span className="cic-valeur">{aPropos}</span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
