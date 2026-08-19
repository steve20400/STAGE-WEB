import { useEffect, useId, useRef, useState } from "react"
import type { Contact } from "../../../src/data/contacts"
import { useToast } from "../../../src/components/toast"
import { useTranslation } from "../../../src/i18n"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"
import {
  listerListes,
  listesEnCache,
  supprimerListe,
  type ListeContacts,
  type ResultatEcriture,
} from "../../../src/services/contact-lists-service"
import {
  previewRingtone,
  rafraichirCatalogue,
  stopRingtonePreview,
} from "../../../src/services/ringtones"
import { ContactListModal } from "./contact-list-modal"
import { nomSonnerie, teinteCss } from "./contact-lists-affichage"
import "./contact-lists.css"

/**
 * Section des listes de contacts, posee dans la page du repertoire : les listes
 * existantes, leur creation, leur modification et leur suppression.
 *
 * Elle vit au-dessus du repertoire et non a cote : la page est une colonne
 * unique, et la couper en deux ne tiendrait pas sur un telephone.
 */

/* Icones : memes conventions que le reste de la page — 24 unites de cote, trait
   a la couleur du texte, taille imposee par la feuille de styles. */

function IconeCloche() {
  return (
    <svg
      className="clist-sonnerie-icone"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  )
}

export function ContactListsSection({ contacts }: { contacts: Contact[] }) {
  const { t } = useTranslation()
  const { success, error, warning } = useToast()

  /**
   * Le miroir du service donne les listes sans attendre le reseau : la section
   * s'affiche pleine des le premier rendu, et le GET ne fait que la corriger.
   */
  const [listes, setListes] = useState<ListeContacts[]>(() => listesEnCache())
  /** `null` : fenetre fermee. `{ liste: null }` : creation. Sinon modification. */
  const [fenetre, setFenetre] = useState<{ liste: ListeContacts | null } | null>(null)
  const [aSupprimer, setASupprimer] = useState<ListeContacts | null>(null)
  const [suppression, setSuppression] = useState(false)

  useEffect(() => {
    let annule = false
    void listerListes().then((rendues) => {
      if (!annule) setListes(rendues)
    })
    // Le catalogue des sonneries importees vit sur le compte, mais son miroir
    // local est vide sur un appareil qui n'a jamais ouvert les Parametres. Sans
    // cette relecture, la fenetre de modification n'offrirait que les cinq sons
    // fournis, et une liste sonnant deja avec un son importe afficherait le
    // libelle de repli au lieu de son nom — c'est-a-dire exactement le defaut
    // que le catalogue partage devait faire disparaitre.
    //
    // Rien n'est attendu de la reponse : elle met le miroir a jour, et
    // customRingtones() le relit au moment ou la fenetre s'ouvre.
    void rafraichirCatalogue().catch(() => undefined)
    return () => {
      annule = true
    }
  }, [])

  useEffect(() => () => stopRingtonePreview(), [])

  const ecouter = (sonnerie: string) => {
    // Echec possible tant que le navigateur n'a recu aucun geste, ou si le media
    // a disparu : rien de tout cela ne merite d'alerter dans une simple ecoute.
    void previewRingtone(sonnerie).catch(() => undefined)
  }

  const surEnregistrement = (resultat: ResultatEcriture, creation: boolean) => {
    setListes((precedentes) =>
      creation
        ? [...precedentes, resultat.liste]
        : precedentes.map((liste) => (liste.id === resultat.liste.id ? resultat.liste : liste))
    )
    setFenetre(null)
    success(creation ? t("clist_created") : t("clist_saved"), resultat.liste.nom)

    // Les numeros qu'aucun compte ne porte se disent en UN SEUL message.
    //
    // Un toast PAR numero ne tenait pas : le fournisseur n'en garde que cinq et
    // jette les plus anciens (`toast.tsx`, `prev.slice(-4)`). A six numeros
    // introuvables, le premier d'entre eux n'apparaissait NULLE PART, et
    // l'annonce du succes — emise juste avant, donc la plus ancienne — etait
    // evincee elle aussi : l'utilisateur ne voyait meme plus que sa liste avait
    // ete enregistree. Un recapitulatif unique tient quel qu'en soit le nombre.
    const inconnus = resultat.numerosInconnus
    if (inconnus.length > 0) {
      warning(t("clist_dial_unknown", { numero: inconnus.map(formatAlanyaNumber).join(", ") }))
    }
  }

  const confirmerSuppression = async (liste: ListeContacts) => {
    if (suppression) return
    setSuppression(true)
    try {
      await supprimerListe(liste.id)
      setListes((precedentes) => precedentes.filter((autre) => autre.id !== liste.id))
      success(t("clist_deleted"), liste.nom)
      setASupprimer(null)
    } catch (err) {
      error(t("clist_error"), err instanceof Error ? err.message : undefined)
    } finally {
      setSuppression(false)
    }
  }

  const boutonNouvelle = (
    <button type="button" className="clist-nouvelle" onClick={() => setFenetre({ liste: null })}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        aria-hidden
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      {t("clist_new")}
    </button>
  )

  return (
    <section className="clist-root">
      <div className="clist-tete">
        <div className="clist-titre-bloc">
          <h2 className="clist-titre">{t("clist_title")}</h2>
          {listes.length > 0 && <span className="clist-compteur">{listes.length}</span>}
        </div>
        {listes.length > 0 && boutonNouvelle}
      </div>

      {listes.length === 0 ? (
        <div className="clist-vide">
          <div className="clist-vide-icone">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
          </div>
          <div className="clist-vide-titre">{t("clist_empty")}</div>
          <p className="clist-vide-texte">{t("clist_empty_hint")}</p>
          {boutonNouvelle}
        </div>
      ) : (
        <ul className="clist-rangees">
          {listes.map((liste) => {
            const teinte = teinteCss(liste.couleur)
            // Retenue dans une constante : le controle de types ne garde pas le
            // resultat d'un test sur une propriete jusque dans un gestionnaire
            // de clic, la ou il le garde sur une variable.
            const sonnerie = liste.sonnerie
            return (
              <li key={liste.id} className="clist-rangee">
                <span
                  className={teinte ? "clist-pastille" : "clist-pastille clist-pastille-vide"}
                  style={teinte ? ({ "--clist-teinte": teinte } as React.CSSProperties) : undefined}
                  aria-hidden
                />

                {/* Pas d'`aria-label` ici : il remplacerait le contenu lu, donc
                    le nom de la liste et son nombre de membres. Le crayon, lui,
                    dit deja ce que fait ce corps de rangee. */}
                <button type="button" className="clist-corps" onClick={() => setFenetre({ liste })}>
                  <div className="clist-nom">{liste.nom}</div>
                  <div className="clist-meta">
                    <span className="clist-membres">
                      {t("clist_members_count", { count: liste.membres.length })}
                    </span>
                    {/* La sonnerie ne se montre que lorsqu'il y en a une : une
                        mention « aucune » n'apprendrait rien et alourdirait
                        chaque rangee. */}
                    {sonnerie && (
                      <span className="clist-sonnerie">
                        <IconeCloche />
                        <span className="clist-hors-ecran">{t("clist_ringtone")}</span>
                        <span className="clist-sonnerie-nom">
                          {nomSonnerie(sonnerie) ?? t("set_ringtone_imported")}
                        </span>
                      </span>
                    )}
                  </div>
                </button>

                <div className="clist-actions">
                  {sonnerie && (
                    <button
                      type="button"
                      className="clist-bouton-icone"
                      onClick={() => ecouter(sonnerie)}
                      aria-label={t("clist_preview")}
                      title={t("clist_preview")}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    className="clist-bouton-icone"
                    onClick={() => setFenetre({ liste })}
                    aria-label={t("clist_edit")}
                    title={t("clist_edit")}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="clist-bouton-icone clist-bouton-icone-danger"
                    onClick={() => setASupprimer(liste)}
                    aria-label={t("clist_delete")}
                    title={t("clist_delete")}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {fenetre && (
        <ContactListModal
          // Remonter la fenetre a chaque liste : les champs sont remplis a
          // l'ouverture, un simple changement de props les laisserait sur la
          // liste precedente.
          key={fenetre.liste?.id ?? "creation"}
          liste={fenetre.liste}
          contacts={contacts}
          onFermer={() => setFenetre(null)}
          onEnregistre={surEnregistrement}
        />
      )}

      {aSupprimer && (
        <ConfirmationSuppression
          liste={aSupprimer}
          enCours={suppression}
          onFermer={() => setASupprimer(null)}
          onConfirmer={() => void confirmerSuppression(aSupprimer)}
        />
      )}
    </section>
  )
}

/**
 * Confirmation de suppression. Composant a part pour une seule raison : elle
 * prend le focus a son ouverture, ce qu'un bloc rendu au milieu de la section ne
 * peut pas faire sans un effet declenche a chaque changement d'etat de celle-ci.
 */
function ConfirmationSuppression({
  liste,
  enCours,
  onFermer,
  onConfirmer,
}: {
  liste: ListeContacts
  enCours: boolean
  onFermer: () => void
  onConfirmer: () => void
}) {
  const { t } = useTranslation()
  const cadre = useRef<HTMLDivElement>(null)
  const idTitre = useId()

  useEffect(() => {
    cadre.current?.focus()
  }, [])

  return (
    <div className="clist-voile" onClick={() => !enCours && onFermer()}>
      <div
        ref={cadre}
        className="clist-modal clist-modal-confirme"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        tabIndex={-1}
        onClick={(evenement) => evenement.stopPropagation()}
        onKeyDown={(evenement) => {
          if (evenement.key === "Escape" && !enCours) onFermer()
        }}
      >
        <div className="clist-modal-tete">
          <div className="clist-modal-titre" id={idTitre}>
            {t("clist_delete")}
          </div>
        </div>
        <div className="clist-modal-corps">
          <p className="clist-confirme-texte">{t("clist_delete_q", { nom: liste.nom })}</p>
        </div>
        <div className="clist-modal-pied">
          <button type="button" className="clist-annuler" onClick={onFermer} disabled={enCours}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="clist-supprimer"
            onClick={onConfirmer}
            disabled={enCours}
          >
            {t("delete")}
          </button>
        </div>
      </div>
    </div>
  )
}
