import { useEffect, useRef, useState, type FormEvent } from "react"
import { codeErreurApi } from "../lib/api-client"
import { bloquer } from "../services/blocked-service"
import { addContactByPhone, memoriserContact } from "../services/contacts-service"
import { signalerAjout, useEstContact } from "../hooks/use-est-contact"
import { useTranslation } from "../i18n"
import { useToast } from "./toast"
import "./enregistrer-inconnu.css"

/**
 * ENREGISTRER QUELQU'UN QUI NOUS A ÉCRIT, SANS RECOPIER SON ID.
 *
 * 🐛 Retour des testeurs du 14/11/2026 : « Lorsque quelqu'un nous a écrit en
 * premier, on ne peut pas l'enregistrer directement : il faut copier son ID,
 * cliquer sur "nouveau contact" et entrer l'ID. » Le numéro était pourtant
 * sous nos yeux — c'est celui du correspondant de la discussion.
 *
 * Deux portes, une seule logique :
 *   - le BANDEAU en tête de la discussion, comme WhatsApp ;
 *   - le bouton du PANNEAU D'INFOS, pour qui y cherche le geste, ou a masqué
 *     le bandeau.
 *
 * ⚠️ ON N'AFFIRME RIEN SUR UN DOUTE. « Ne fait pas partie de vos contacts » ne
 * paraît qu'après lecture du répertoire SUR LE SERVEUR. Le cache local peut
 * être vide (premier passage sur cet appareil) ou en retard (contact ajouté
 * depuis le téléphone) ; serveur injoignable, le bandeau se tait.
 */

/** Conversations où le bandeau a été masqué — préférence de cet appareil. */
const CLE_ECARTES = "alanya-inconnus-ecartes-v1"

function lireEcartes(): string[] {
  try {
    const brut = localStorage.getItem(CLE_ECARTES)
    const liste: unknown = brut ? JSON.parse(brut) : []
    return Array.isArray(liste) ? liste.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

function ecarter(convId: string) {
  try {
    const liste = lireEcartes().filter((id) => id !== convId)
    // Borné : une liste qui grossirait sans fin pour un simple confort.
    localStorage.setItem(CLE_ECARTES, JSON.stringify([...liste, convId].slice(-200)))
  } catch {
    /* le bandeau reste masqué pour cette visite, c'est l'essentiel */
  }
}

/**
 * Le bandeau en tête d'une discussion à deux avec quelqu'un qui n'est pas dans
 * mes contacts : Bloquer, Enregistrer, ou le masquer.
 */
export function BandeauInconnu({
  convId,
  numero,
  nomProfil,
}: {
  convId: string
  /** Alanya ID du correspondant. */
  numero: string
  /** Le nom qu'il s'est donné, proposé comme nom du contact. */
  nomProfil: string
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const estContact = useEstContact(numero)
  const [masque, setMasque] = useState(() => lireEcartes().includes(convId))
  const [vue, setVue] = useState<"bandeau" | "enregistrer" | "bloquer">("bandeau")
  const [occupe, setOccupe] = useState(false)

  // L'écran de discussion ne se démonte pas d'un fil à l'autre.
  useEffect(() => {
    setMasque(lireEcartes().includes(convId))
    setVue("bandeau")
  }, [convId])

  if (estContact !== false || masque) return null

  const nom = nomProfil.trim() || numero

  /*
   * BLOQUER DEMANDE CONFIRMATION, sur place. Un clic malheureux couperait la
   * personne sans qu'on l'ait voulu ; une fenêtre du navigateur casserait le
   * ton de l'écran. Le bandeau se change donc en question.
   */
  const confirmerBlocage = async () => {
    if (occupe) return
    setOccupe(true)
    try {
      await bloquer(numero)
      toast.info(t("blocked_toast"), t("cinfo_blocked_detail", { name: nom }))
      setMasque(true)
    } catch (err) {
      toast.error(t("cinfo_block_failed"), err instanceof Error ? err.message : undefined)
      setVue("bandeau")
    } finally {
      setOccupe(false)
    }
  }

  if (vue === "enregistrer") {
    return (
      <div className="bandeau-inconnu">
        <FormulaireEnregistrerContact
          numero={numero}
          nomProfil={nomProfil}
          onTermine={() => setVue("bandeau")}
        />
      </div>
    )
  }

  if (vue === "bloquer") {
    return (
      <div className="bandeau-inconnu" role="alertdialog" aria-label={t("block")}>
        <span className="bi-texte">{t("inc_block_confirm", { name: nom })}</span>
        <div className="bi-boutons">
          <button type="button" className="bi-secondaire" onClick={() => setVue("bandeau")}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="bi-danger"
            disabled={occupe}
            onClick={() => void confirmerBlocage()}
          >
            {t("block")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bandeau-inconnu">
      <span className="bi-icone" aria-hidden="true">
        <IconeAjouterPersonne />
      </span>
      <span className="bi-texte">{t("inc_banner")}</span>
      <div className="bi-boutons">
        <button type="button" className="bi-danger" onClick={() => setVue("bloquer")}>
          {t("block")}
        </button>
        <button type="button" className="bi-principal" onClick={() => setVue("enregistrer")}>
          {t("inc_save")}
        </button>
        <button
          type="button"
          className="bi-fermer"
          aria-label={t("inc_hide")}
          title={t("inc_hide")}
          onClick={() => {
            ecarter(convId)
            setMasque(true)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/**
 * Nommer et enregistrer le correspondant.
 *
 * Le champ arrive REMPLI du nom de son profil : Entrée suffit. Le changer
 * donne un nom personnel ; le laisser tel quel n'en donne pas, et le contact
 * suivra alors les changements de nom de son profil.
 */
export function FormulaireEnregistrerContact({
  numero,
  nomProfil,
  onTermine,
}: {
  numero: string
  nomProfil: string
  /** Enregistré ou abandonné : le parent referme le formulaire. */
  onTermine: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [nom, setNom] = useState(nomProfil)
  const [occupe, setOccupe] = useState(false)
  const monte = useRef(true)
  useEffect(() => {
    monte.current = true
    return () => {
      monte.current = false
    }
  }, [])

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault()
    if (occupe) return
    setOccupe(true)
    const choisi = nom.trim()
    const alias = choisi && choisi !== nomProfil.trim() ? choisi : undefined
    try {
      const contact = await addContactByPhone(numero, alias)
      memoriserContact(contact)
      signalerAjout(numero)
      toast.success(t("contact_saved"), contact.name)
      if (monte.current) onTermine()
    } catch (err) {
      // Déjà enregistré ailleurs (téléphone, autre onglet) : ce n'est pas un
      // échec, l'affichage était simplement en retard.
      if (codeErreurApi(err) === "ALREADY_CONTACT") {
        signalerAjout(numero)
        toast.info(t("contact_exists"), t("contact_exists_detail"))
        if (monte.current) onTermine()
        return
      }
      toast.error(t("add_failed"), err instanceof Error ? err.message : undefined)
    } finally {
      if (monte.current) setOccupe(false)
    }
  }

  return (
    <form className="bi-formulaire" onSubmit={(e) => void enregistrer(e)}>
      <input
        className="input-base bi-champ"
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        placeholder={t("inc_name_placeholder")}
        aria-label={t("inc_name_placeholder")}
        maxLength={100}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="bi-boutons">
        <button type="button" className="bi-secondaire" onClick={onTermine}>
          {t("cancel")}
        </button>
        <button type="submit" className="bi-principal" disabled={occupe}>
          {occupe ? t("device_name_saving") : t("save")}
        </button>
      </div>
    </form>
  )
}

export function IconeAjouterPersonne({ taille = 16 }: { taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  )
}
