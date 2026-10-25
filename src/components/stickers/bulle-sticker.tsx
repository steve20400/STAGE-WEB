import { useState } from "react"

import { useTranslation } from "../../i18n"
import {
  basculerFavori,
  copierSticker,
  estMaCreation,
  nomDans,
  packParCode,
  signalerSticker,
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
  const [avis, setAvis] = useState<string | null>(null)
  const sticker = etat.ouverts ? stickerParId(etat, charge.sid) : null
  const lePack = etat.ouverts ? packParCode(etat, charge.pack) : null
  const favori = sticker !== null && etat.favoris.includes(sticker.id)
  // La création de quelqu'un d'autre (25/10/2026) : on peut en garder une
  // copie, comme sur WhatsApp, ou la signaler.
  const creationAutrui = etat.ouverts && sticker === null && charge.pack.startsWith("perso-")
  const mienne = estMaCreation(etat, charge.sid)
  const agir = (action: Promise<unknown>, reussite: Parameters<typeof t>[0]) => {
    setErreur(false)
    action.then(() => setAvis(t(reussite))).catch(() => setErreur(true))
  }

  if (pack && lePack) return <ApercuPack pack={lePack} onFermer={onFermer} />
  return (
    <FenetreSticker
      titre={lePack ? nomDans(lePack.nom, language, lePack.code) : mienne ? t("stickers_creations") : t("sticker")}
      onFermer={onFermer}
      libelleFermer={t("close")}
    >
      <div className="stk-recu">
        <img src={charge.url} alt={charge.emoji} />
        {!lePack && !mienne && !creationAutrui && <p className="stk-description">{t("stickers_indisponible")}</p>}
        {erreur && <p className="stk-description">{t("stickers_erreur")}</p>}
        {avis && <p className="stk-description" role="status">{avis}</p>}
        <div className="stk-recu-actions">
          {creationAutrui && etat.creation && (
            <button type="button" className="stk-action plein" data-action="enregistrer" onClick={() => agir(copierSticker(charge.sid), "stickers_enregistre")}>
              {t("stickers_enregistrer")}
            </button>
          )}
          {creationAutrui && (
            <button type="button" className="stk-action" data-action="signaler" onClick={() => agir(signalerSticker(charge.assetId), "stickers_signale")}>
              {t("stickers_signaler")}
            </button>
          )}
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
