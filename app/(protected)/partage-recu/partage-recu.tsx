import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { useTranslation } from "../../../src/i18n"
import { fetchChatConversations } from "../../../src/services/chats-service"
import { lirePartageRecu, oublierPartageRecu, type PartageRecu } from "../../../src/services/partage-recu"
import "./partage-recu.css"

/**
 * « ENVOYER DANS ALANYA WORK » — la page qu'ouvre un partage reçu d'une autre
 * application (07/10/2026).
 *
 * L'utilisateur a choisi Alanya Work dans la feuille de partage de son
 * téléphone ; le service worker a rangé ce qu'on lui confiait. Ici, on demande
 * DANS QUELLE DISCUSSION — puis on l'y conduit : l'écran d'envoi habituel
 * s'ouvre avec les fichiers (aperçu, légende, compression), ou le texte est
 * posé dans le champ de saisie. Rien ne part sans un dernier geste.
 */
export default function PartageRecuPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get("id") ?? ""
  const [partage, setPartage] = useState<PartageRecu | null | undefined>(undefined)
  const [conversations, setConversations] = useState<Array<{ id: string; name: string; initials: string }>>([])

  useEffect(() => {
    let vivant = true
    void lirePartageRecu(id).then((p) => {
      if (vivant) setPartage(p)
    })
    void fetchChatConversations().then((liste) => {
      if (vivant) setConversations(liste.map((c) => ({ id: c.id, name: c.name, initials: c.initials })))
    })
    return () => {
      vivant = false
    }
  }, [id])

  if (partage === undefined) {
    return <div className="partage-recu">{t("loading")}</div>
  }

  if (partage === null || (partage.fichiers.length === 0 && !partage.texte)) {
    return (
      <div className="partage-recu">
        <h1>{t("partage_recu_titre")}</h1>
        <p className="partage-recu-vide">{t("partage_recu_vide")}</p>
        <button type="button" className="partage-recu-retour" onClick={() => navigate("/chats")}>
          {t("cancel")}
        </button>
      </div>
    )
  }

  return (
    <div className="partage-recu">
      <h1>{t("partage_recu_titre")}</h1>
      <div className="partage-recu-resume">
        {partage.fichiers.length > 0 && (
          <div className="partage-recu-fichiers">
            <strong>{t("partage_recu_n_fichiers", { n: partage.fichiers.length })}</strong>
            {partage.fichiers.slice(0, 4).map((f, i) => (
              <span key={i} className="partage-recu-nom">
                {f.name}
              </span>
            ))}
          </div>
        )}
        {partage.texte && <p className="partage-recu-texte">{partage.texte}</p>}
      </div>
      <h2>{t("partage_recu_choisir")}</h2>
      <div className="partage-recu-liste">
        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            className="partage-recu-conv"
            onClick={() => navigate(`/chats/${c.id}?partage=${encodeURIComponent(partage.id)}`)}
          >
            <span className="partage-recu-initiales" aria-hidden="true">
              {c.initials}
            </span>
            <span className="partage-recu-nomconv">{c.name}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="partage-recu-retour"
        onClick={() => {
          void oublierPartageRecu(partage.id)
          navigate("/chats")
        }}
      >
        {t("cancel")}
      </button>
    </div>
  )
}
