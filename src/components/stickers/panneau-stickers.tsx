import { useState, type ReactNode } from "react"

import { useTranslation } from "../../i18n"
import {
  basculerFavori,
  chercherStickers,
  estMaCreation,
  nomDans,
  packsInstalles,
  stickersDe,
  supprimerCreation,
  useStickers,
  vignette,
  type Sticker,
} from "../../services/stickers-service"
import { BoutiqueStickers } from "./boutique-stickers"
import { CreateurSticker } from "./createur-sticker"
import { FenetreSticker } from "./fenetre-sticker"
import "./stickers.css"

/**
 * L'ONGLET STICKERS du sélecteur — jumeau de `panneau_stickers.dart`, comme
 * celui de WhatsApp : en haut, rechercher, récents, favoris, un onglet par
 * pack de MON panneau, et « + » (la boutique) au bout. Un clic ENVOIE ; un
 * clic droit ajoute aux favoris (ou en retire), l'appui long du mobile.
 */
const RECHERCHE = -1
const RECENTS = -2
const FAVORIS = -3
/** « Mes créations » (25/10/2026) : une case « Créer » en tête de la grille. */
const CREATIONS = -4

export function PanneauStickers({ onEnvoyer }: { onEnvoyer: (s: Sticker) => void }) {
  const { t, language } = useTranslation()
  const etat = useStickers()
  const [actifChoisi, setActif] = useState<number | null>(null)
  const [requete, setRequete] = useState("")
  const [boutique, setBoutique] = useState(false)
  const [avis, setAvis] = useState<string | null>(null)
  const [createur, setCreateur] = useState(false)
  const [options, setOptions] = useState<Sticker | null>(null)

  const packs = packsInstalles(etat)
  const recents = stickersDe(etat, etat.recents)
  const ouverture = recents.length > 0 ? RECENTS : (packs[0]?.id ?? FAVORIS)
  const actif =
    actifChoisi === null || (actifChoisi > 0 && !packs.some((p) => p.id === actifChoisi)) ? ouverture : actifChoisi

  let grille: Sticker[]
  let vide: string
  if (actif === RECHERCHE) {
    grille = chercherStickers(etat, requete)
    vide = requete.trim() ? t("stickers_aucun_resultat") : t("stickers_chercher_aide")
  } else if (actif === RECENTS) {
    grille = recents
    vide = t("stickers_vide_recents")
  } else if (actif === FAVORIS) {
    grille = stickersDe(etat, etat.favoris)
    vide = t("stickers_vide_favoris")
  } else if (actif === CREATIONS) {
    grille = etat.creations?.stickers ?? []
    vide = ""
  } else {
    grille = packs.find((p) => p.id === actif)?.stickers ?? []
    vide = t("stickers_aucun_pack")
  }

  const onglet = (id: number, icone: ReactNode, libelle: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      className="stk-onglet"
      aria-selected={actif === id}
      title={libelle}
      aria-label={libelle}
      onClick={() => setActif(id)}
    >
      {icone}
    </button>
  )

  async function favori(s: Sticker) {
    const ajout = !etat.favoris.includes(s.id)
    try {
      await basculerFavori(s.id)
      setAvis(t(ajout ? "stickers_favori_ajoute" : "stickers_favori_retire"))
    } catch {
      setAvis(t("stickers_erreur"))
    }
    window.setTimeout(() => setAvis(null), 2000)
  }

  return (
    <div className="stk-panneau">
      <div className="stk-onglets" role="tablist">
        {onglet(RECHERCHE, ICONE_LOUPE, t("stickers_chercher"))}
        {onglet(RECENTS, ICONE_HORLOGE, t("stickers_recents"))}
        {onglet(FAVORIS, ICONE_ETOILE, t("stickers_favoris"))}
        {etat.creation && onglet(CREATIONS, ICONE_PINCEAU, t("stickers_creations"))}
        {packs.map((p) => onglet(p.id, vignette(p) ? <img src={vignette(p)!} alt="" /> : ICONE_PACK, nomDans(p.nom, language, p.code)))}
        <button
          type="button"
          className="stk-onglet stk-plus"
          title={t("stickers_boutique")}
          aria-label={t("stickers_boutique")}
          onClick={() => setBoutique(true)}
        >
          {ICONE_PLUS}
        </button>
      </div>
      {actif === RECHERCHE && (
        <div className="stk-recherche">
          <input
            type="text"
            value={requete}
            autoFocus
            onChange={(e) => setRequete(e.target.value)}
            placeholder={t("stickers_chercher_aide")}
            aria-label={t("stickers_chercher_aide")}
          />
        </div>
      )}
      {avis && <p className="stk-description" role="status">{avis}</p>}
      <div className="stk-grille">
        {actif === CREATIONS && (
          <button type="button" className="stk-creer" data-action="creer" onClick={() => setCreateur(true)}>
            {ICONE_PHOTO}
            {t("stickers_creer")}
          </button>
        )}
        {grille.length === 0 && actif !== CREATIONS ? (
          <p className="stk-vide">{vide}</p>
        ) : (
          grille.map((s) => (
            <button
              key={s.id}
              type="button"
              className="stk-case"
              data-sticker={s.id}
              title={s.emoji}
              onClick={() => onEnvoyer(s)}
              onContextMenu={(e) => {
                e.preventDefault()
                // Une de MES créations : favori ou suppression ; sinon, favori.
                if (estMaCreation(etat, s.id)) setOptions(s)
                else void favori(s)
              }}
            >
              <img src={s.url} alt={s.emoji} loading="lazy" />
            </button>
          ))
        )}
      </div>
      {boutique && <BoutiqueStickers onFermer={() => setBoutique(false)} />}
      {createur && (
        <CreateurSticker
          onFermer={() => setCreateur(false)}
          onCree={(s) => {
            // Comme WhatsApp : le sticker créé part aussitôt.
            setCreateur(false)
            setActif(CREATIONS)
            onEnvoyer(s)
          }}
        />
      )}
      {options && (
        <FenetreSticker titre={t("stickers_creations")} onFermer={() => setOptions(null)} libelleFermer={t("close")}>
          <div className="stk-recu">
            <img src={options.url} alt={options.emoji} />
            <div className="stk-recu-actions">
              <button
                type="button"
                className="stk-action"
                onClick={() => {
                  void favori(options)
                  setOptions(null)
                }}
              >
                {t(etat.favoris.includes(options.id) ? "stickers_retirer_favori" : "stickers_ajouter_favori")}
              </button>
              <button
                type="button"
                className="stk-action plein"
                data-action="supprimer"
                onClick={() => {
                  const id = options.id
                  setOptions(null)
                  supprimerCreation(id).catch(() => setAvis(t("stickers_erreur")))
                }}
              >
                {t("stickers_supprimer")}
              </button>
            </div>
          </div>
        </FenetreSticker>
      )}
    </div>
  )
}

function Trace({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const ICONE_LOUPE = (
  <Trace>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Trace>
)
const ICONE_HORLOGE = (
  <Trace>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Trace>
)
const ICONE_ETOILE = (
  <Trace>
    <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z" />
  </Trace>
)
const ICONE_PACK = (
  <Trace>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M14 20v-4a2 2 0 0 1 2-2h4" />
  </Trace>
)
const ICONE_PINCEAU = (
  <Trace>
    <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8 8.2 13Z" />
    <path d="M7 14.5c-2 0-3.5 1.6-3.5 3.5 0 1.2-.7 2-1.5 2.5 3 1 7 .5 7.8-3.2" />
  </Trace>
)
const ICONE_PHOTO = (
  <Trace>
    <rect x="3" y="5" width="18" height="15" rx="3" />
    <circle cx="9" cy="11" r="2" />
    <path d="M21 16l-5-5-8 9" />
  </Trace>
)
const ICONE_PLUS = (
  <Trace>
    <path d="M12 5v14M5 12h14" />
  </Trace>
)

/** L'icône de l'onglet « Stickers » de la barre du bas. */
export const ICONE_STICKERS = (
  <Trace>
    <path d="M20 13V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h6" />
    <path d="M20 13l-7 7v-4a3 3 0 0 1 3-3h4Z" />
  </Trace>
)
