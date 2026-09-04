import { useEffect, useRef } from "react"
import { useTranslation } from "../i18n"
import { AvatarCircle } from "./avatar-circle"
import { MenuContact } from "./menu-contact"
import { toInitials } from "../data/session-user"
import "./panneau-membre.css"

/**
 * LA FICHE D'UN MEMBRE, OUVERTE DEPUIS UNE MENTION.
 *
 * Une mention désigne quelqu'un : y toucher doit montrer QUI, et proposer
 * d'agir. Sans cela l'utilisateur lit un nom, veut appeler la personne, et doit
 * ressortir la chercher dans l'annuaire.
 *
 * ⚠️ UN SEUL COMPOSANT POUR DEUX MISES EN PAGE, et c'est délibéré :
 *
 *  - sur PETIT écran, une feuille qui monte du bas jusqu'à mi-hauteur. C'est le
 *    geste attendu sur un téléphone, et cela laisse voir la conversation
 *    derrière — on n'a pas quitté sa place ;
 *  - sur GRAND écran, un panneau à droite, à l'emplacement des informations de
 *    discussion. Le cadre est le même, seul le contenu change.
 *
 * Deux composants distincts auraient dérivé l'un de l'autre : le jour où l'on
 * ajoute une action, on l'oublie dans l'un des deux. Ici la bascule est en CSS.
 */

export interface MembreDuGroupe {
  id: string
  nom: string
  numero?: string
  avatar?: string | null
  estAdmin?: boolean
}

interface PanneauMembreProps {
  /** UNE personne — clic sur sa mention. */
  membre?: MembreDuGroupe
  /** TOUS les membres — clic sur une mention collective. */
  membres?: MembreDuGroupe[]
  /** Titre du panneau quand il liste les membres. */
  titreListe?: string
  /** Celui qui regarde : on ne s'appelle pas soi-même. */
  monId: string | null
  /** Le lecteur est-il administrateur du groupe ? Décide des actions offertes. */
  jeSuisAdmin: boolean
  onFermer: () => void
  /** Retirer du groupe. Absent = l'action n'est pas proposée. */
  onRetirer?: (membre: MembreDuGroupe) => void
  /** Nommer administrateur. Absent = l'action n'est pas proposée. */
  onNommerAdmin?: (membre: MembreDuGroupe) => void
}

export function PanneauMembre({
  membre,
  membres,
  titreListe,
  monId,
  jeSuisAdmin,
  onFermer,
  onRetirer,
  onNommerAdmin,
}: PanneauMembreProps) {
  const { t } = useTranslation()
  const cadre = useRef<HTMLDivElement>(null)

  /*
   * ÉCHAP FERME, et le focus entre dans le panneau à l'ouverture.
   *
   * Un panneau qu'on ne peut fermer qu'à la souris exclut qui navigue au
   * clavier — et sur un téléphone, le geste de défilement vers le bas fait le
   * même travail (voir la feuille en CSS).
   */
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer()
    }
    document.addEventListener("keydown", surTouche)
    cadre.current?.focus()
    return () => document.removeEventListener("keydown", surTouche)
  }, [onFermer])

  const liste = membres ?? (membre ? [membre] : [])
  const modeListe = membres !== undefined

  return (
    <>
      {/*
        LE VOILE ne sert QUE sur petit écran — sur grand écran le panneau vit à
        côté de la conversation, qui reste utilisable. Le masquer là-bas est une
        décision de mise en page, pas de style : un voile sur un panneau latéral
        bloquerait la conversation sans raison.
      */}
      <div className="pm-voile" onClick={onFermer} aria-hidden="true" />

      <div
        ref={cadre}
        className="pm-panneau"
        role="dialog"
        aria-modal="true"
        aria-label={modeListe ? (titreListe ?? t("cinfo_members")) : (membre?.nom ?? "")}
        tabIndex={-1}
      >
        {/* La poignée : sur téléphone elle dit « ceci se tire vers le bas ».
            Purement visuelle — le voile et Échap ferment déjà. */}
        <div className="pm-poignee" aria-hidden="true" />

        <header className="pm-tete">
          <h2>{modeListe ? (titreListe ?? t("cinfo_members")) : t("cinfo_members")}</h2>
          <button type="button" className="pm-fermer" onClick={onFermer} aria-label={t("close")}>
            ×
          </button>
        </header>

        <div className="pm-corps">
          {/* UNE SEULE PERSONNE : sa fiche en grand, puis les actions. */}
          {!modeListe && membre && (
            <div className="pm-fiche">
              <AvatarCircle
                avatar={membre.avatar}
                initials={toInitials(membre.nom)}
                style={{ width: 72, height: 72, fontSize: 24 }}
              />
              <div className="pm-fiche-nom">{membre.nom}</div>
              {membre.numero && <div className="pm-fiche-numero">{membre.numero}</div>}
              {membre.estAdmin && <div className="pm-fiche-role">{t("cinfo_admin")}</div>}
            </div>
          )}

          <ul className="pm-liste">
            {liste.map((m) => {
              const cestMoi = m.id === monId
              return (
                <li key={m.id} className={modeListe ? "" : "pm-liste-actions"}>
                  {modeListe && (
                    <>
                      <AvatarCircle
                        avatar={m.avatar}
                        initials={toInitials(m.nom)}
                        style={{ width: 36, height: 36, fontSize: 12 }}
                      />
                      <div className="pm-liste-textes">
                        <span className="pm-liste-nom">
                          {m.nom}
                          {m.estAdmin && <span className="pm-badge">{t("cinfo_admin")}</span>}
                        </span>
                        {m.numero && <span className="pm-liste-num">{m.numero}</span>}
                      </div>
                    </>
                  )}

                  <div className="pm-actions">
                    {/* Écrire, appeler en audio, appeler en vidéo : le menu que
                        toute l'application utilise déjà. On ne le réécrit pas —
                        une seconde version dériverait de la première. */}
                    {m.numero && (
                      <MenuContact
                        userId={m.id}
                        numero={m.numero}
                        nom={m.nom}
                        estMoi={cestMoi}
                        compact
                        flottant
                      />
                    )}

                    {/*
                      LES ACTIONS D'ADMINISTRATION, réservées à l'administrateur
                      et jamais sur soi-même : se retirer de son propre groupe
                      passe par « Quitter », qui prévient et confirme.
                    */}
                    {jeSuisAdmin && !cestMoi && !m.estAdmin && onNommerAdmin && (
                      <button
                        type="button"
                        className="pm-action"
                        onClick={() => onNommerAdmin(m)}
                        title={t("cinfo_make_admin")}
                      >
                        {t("cinfo_make_admin")}
                      </button>
                    )}
                    {jeSuisAdmin && !cestMoi && onRetirer && (
                      <button
                        type="button"
                        className="pm-action danger"
                        onClick={() => onRetirer(m)}
                        title={t("cinfo_remove_from_group")}
                      >
                        {t("cinfo_remove_from_group")}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </>
  )
}
