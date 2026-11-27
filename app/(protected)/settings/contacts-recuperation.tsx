import { useEffect, useState } from "react"
import { useTranslation } from "../../../src/i18n"
import { confirmer } from "../../../src/components/confirmation"
import { fetchContacts } from "../../../src/services/contacts-service"
import {
  clesDeCompte,
  confierAuxContacts,
  mesContactsRecuperation,
  retirerContactsRecuperation,
  type MonContact,
} from "../../../src/services/e2ee-contacts-recuperation"
import { subscribeToRecuperation } from "../../../src/services/websocket-service"

/**
 * LES CONTACTS DE RÉCUPÉRATION, DANS LES RÉGLAGES DE LA SAUVEGARDE (27/11/2026).
 *
 * 🔴 JUMEAU DE `alanya/lib/features/parametres/contacts_recuperation_section.dart`.
 *
 * Trois personnes de confiance ; deux suffisent à rendre l'accès aux anciens
 * messages. Seuls les contacts qui ont une clé de compte (leur sauvegarde est
 * active) peuvent être choisis : la part leur est scellée.
 */
export function ContactsRecuperation() {
  const { t } = useTranslation()
  const [etat, setEtat] = useState<{ actif: boolean; contacts: MonContact[] } | null>(null)
  const [choix, setChoix] = useState<
    { userId: string; nom: string; eligible: boolean }[] | null
  >(null)
  const [coches, setCoches] = useState<string[]>([])
  const [occupe, setOccupe] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const relire = async () => {
    try {
      const r = await mesContactsRecuperation()
      setEtat({ actif: r.actif, contacts: r.contacts })
    } catch {
      setEtat({ actif: false, contacts: [] })
    }
  }

  useEffect(() => {
    void relire()
    // Un contact vient d'accepter ou de refuser : l'état change sous nos yeux.
    return subscribeToRecuperation((quoi) => {
      if (quoi === "invitation_repondue") void relire()
    })
  }, [])

  const ouvrirChoix = async () => {
    setMessage(null)
    const contacts = (await fetchContacts()).filter((c) => c.userId)
    const cles = await clesDeCompte(contacts.map((c) => c.userId!)).catch(() => new Map())
    setChoix(contacts.map((c) => ({ userId: c.userId!, nom: c.name, eligible: cles.has(c.userId!) })))
    setCoches(etat?.contacts.map((c) => c.contactId) ?? [])
  }

  const valider = async () => {
    if (coches.length !== 3) return
    setOccupe(true)
    try {
      await confierAuxContacts(coches)
      setChoix(null)
      setMessage(t("recup_enregistre"))
      await relire()
    } catch {
      setMessage(t("recup_erreur"))
    } finally {
      setOccupe(false)
    }
  }

  const retirer = async () => {
    const oui = await confirmer({
      titre: t("recup_retirer"),
      confirmer: t("recup_retirer"),
      annuler: t("arch_plus_tard"),
    })
    if (!oui) return
    setOccupe(true)
    try {
      await retirerContactsRecuperation()
      await relire()
    } finally {
      setOccupe(false)
    }
  }

  const libelleEtat = (e: MonContact["etat"]) =>
    e === "accepte" ? t("recup_etat_accepte") : e === "refuse" ? t("recup_etat_refuse") : t("recup_etat_invite")

  return (
    <div className="sauv-cle" style={{ marginTop: 16 }}>
      <div className="sauv-cle-titre">{t("recup_titre")}</div>
      <p className="sauv-cle-avert">{t("recup_explication")}</p>

      {etat && etat.contacts.length > 0 && (
        <>
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
            {etat.contacts.map((c) => (
              <li
                key={c.contactId}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0" }}
              >
                <span>{c.nom ?? "—"}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>{libelleEtat(c.etat)}</span>
              </li>
            ))}
          </ul>
          <p className="sauv-resultat">{etat.actif ? t("recup_actif") : t("recup_inactif")}</p>
        </>
      )}

      {choix === null ? (
        <div className="sauv-actions">
          <button type="button" className="sauv-btn primaire" disabled={occupe} onClick={() => void ouvrirChoix()}>
            {etat && etat.contacts.length > 0 ? t("recup_changer") : t("recup_choisir")}
          </button>
          {etat && etat.contacts.length > 0 && (
            <button type="button" className="sauv-btn" disabled={occupe} onClick={() => void retirer()}>
              {t("recup_retirer")}
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="sauv-cle-avert" style={{ fontWeight: 600 }}>
            {t("recup_choisir_titre")} ({coches.length}/3)
          </p>
          <div style={{ maxHeight: 260, overflowY: "auto", margin: "4px 0 10px" }}>
            {choix.map((c) => {
              const coche = coches.includes(c.userId)
              return (
                <label
                  key={c.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 0",
                    opacity: c.eligible ? 1 : 0.5,
                    cursor: c.eligible ? "pointer" : "default",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={coche}
                    disabled={!c.eligible || (!coche && coches.length >= 3)}
                    onChange={(e) =>
                      setCoches((l) => (e.target.checked ? [...l, c.userId] : l.filter((x) => x !== c.userId)))
                    }
                    style={{ accentColor: "var(--accent)" }}
                  />
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span>{c.nom}</span>
                    {!c.eligible && (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{t("recup_sans_cle")}</span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
          <div className="sauv-actions">
            <button
              type="button"
              className="sauv-btn primaire"
              disabled={occupe || coches.length !== 3}
              onClick={() => void valider()}
            >
              {occupe ? "…" : t("recup_valider")}
            </button>
            <button type="button" className="sauv-btn" disabled={occupe} onClick={() => setChoix(null)}>
              {t("arch_plus_tard")}
            </button>
          </div>
        </>
      )}
      {message && <p className="sauv-resultat">{message}</p>}
    </div>
  )
}
