import { useState } from "react"

import { useTranslation } from "../../i18n"
import {
  basculerFavori,
  nomDans,
  packParCode,
  stickerParId,
  useStickers,
  type ChargeSticker,
} from "../../services/stickers-service"
import { ApercuPack } from "./boutique-stickers"
import { FenetreSticker } from "./fenetre-sticker"
import "./stickers.css"

/**
 * UN STICKER DANS LE FIL — jumeau de `bulle_sticker.dart` : l'image seule,
 * grande, sans bulle autour. Un clic ouvre sa fenêtre : favori, et « Voir le
 * pack » pour l'ajouter. L'heure est posée par la bulle (`.stk-heure`).
 */
export function BulleSticker({ charge }: { charge: ChargeSticker }) {
  const { t } = useTranslation()
  const [ouvert, setOuvert] = useState(false)
  return (
    <>
      <button
        type="button"
        className="stk-bulle"
        data-sticker-recu={charge.sid}
        aria-label={`${charge.emoji} ${t("sticker")}`.trim()}
        onClick={(e) => {
          e.stopPropagation()
          setOuvert(true)
        }}
      >
        <img className="stk-image" src={charge.url} alt={charge.emoji} loading="lazy" />
      </button>
      {ouvert && <StickerRecu charge={charge} onFermer={() => setOuvert(false)} />}
    </>
  )
}

function StickerRecu({ charge, onFermer }: { charge: ChargeSticker; onFermer: () => void }) {
  const { t, language } = useTranslation()
  const etat = useStickers()
  const [pack, setPack] = useState(false)
  const [erreur, setErreur] = useState(false)
  const sticker = etat.ouverts ? stickerParId(etat, charge.sid) : null
  const lePack = etat.ouverts ? packParCode(etat, charge.pack) : null
  const favori = sticker !== null && etat.favoris.includes(sticker.id)

  if (pack && lePack) return <ApercuPack pack={lePack} onFermer={onFermer} />
  return (
    <FenetreSticker
      titre={lePack ? nomDans(lePack.nom, language, lePack.code) : t("sticker")}
      onFermer={onFermer}
      libelleFermer={t("close")}
    >
      <div className="stk-recu">
        <img src={charge.url} alt={charge.emoji} />
        {!lePack && <p className="stk-description">{t("stickers_indisponible")}</p>}
        {erreur && <p className="stk-description">{t("stickers_erreur")}</p>}
        <div className="stk-recu-actions">
          {sticker && (
            <button
              type="button"
              className="stk-action"
              data-action="favori"
              onClick={() => {
                setErreur(false)
                basculerFavori(sticker.id).catch(() => setErreur(true))
              }}
            >
              {favori ? "★ " : "☆ "}
              {t(favori ? "stickers_retirer_favori" : "stickers_ajouter_favori")}
            </button>
          )}
          {lePack && (
            <button type="button" className="stk-action plein" data-action="voir-pack" onClick={() => setPack(true)}>
              {t("stickers_voir_pack")}
            </button>
          )}
        </div>
      </div>
    </FenetreSticker>
  )
}
