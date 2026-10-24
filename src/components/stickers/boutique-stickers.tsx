import { useEffect, useState } from "react"

import { useTranslation } from "../../i18n"
import {
  assurerStickers,
  installerPack,
  nomDans,
  ordonnerPacks,
  packsInstalles,
  retirerPack,
  useStickers,
  vignette,
  type PackStickers,
} from "../../services/stickers-service"
import { FenetreSticker } from "./fenetre-sticker"

/**
 * LA BOUTIQUE DE STICKERS, comme celle de WhatsApp — jumelle de
 * `boutique_stickers_screen.dart` : « Tous les stickers » (ajouter un pack)
 * et « Mes stickers » (réordonner, retirer). Un pack s'ouvre en aperçu.
 */
export function BoutiqueStickers({ onFermer }: { onFermer: () => void }) {
  const { t, language } = useTranslation()
  const etat = useStickers()
  const [onglet, setOnglet] = useState<"tous" | "mes">("tous")
  const [ouvert, setOuvert] = useState<PackStickers | null>(null)
  const [erreur, setErreur] = useState(false)

  useEffect(() => {
    void assurerStickers(true)
  }, [])

  const agir = (action: Promise<unknown>) => {
    setErreur(false)
    action.catch(() => setErreur(true))
  }
  const mes = packsInstalles(etat)

  const ligne = (p: PackStickers, fin: React.ReactNode, debut?: React.ReactNode) => (
    <li key={p.id} className="stk-ligne" data-pack={p.code}>
      {debut}
      <button type="button" className="stk-ligne-ouvrir" onClick={() => setOuvert(p)}>
        {vignette(p) ? <img src={vignette(p)!} alt="" loading="lazy" /> : null}
        <span className="stk-ligne-texte">
          <strong>{nomDans(p.nom, language, p.code)}</strong>
          <span>
            {[p.auteur, t("stickers_nombre", { n: p.stickers.length })].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      {fin}
    </li>
  )

  return (
    <>
      <FenetreSticker titre={t("stickers_titre")} onFermer={onFermer} libelleFermer={t("close")}>
        <div className="stk-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={onglet === "tous"} onClick={() => setOnglet("tous")}>
            {t("stickers_tous")}
          </button>
          <button type="button" role="tab" aria-selected={onglet === "mes"} onClick={() => setOnglet("mes")}>
            {t("stickers_mes")}
          </button>
        </div>
        {erreur && <p className="stk-description">{t("stickers_erreur")}</p>}
        <ul className="stk-liste">
          {onglet === "tous" &&
            (etat.catalogue.length === 0 ? (
              <li className="stk-vide">{t("stickers_catalogue_vide")}</li>
            ) : (
              etat.catalogue.map((p) =>
                ligne(
                  p,
                  etat.mesPacks.includes(p.id) ? (
                    <span className="stk-action" aria-label={t("stickers_deja_ajoute")} title={t("stickers_deja_ajoute")}>
                      ✓
                    </span>
                  ) : (
                    <button type="button" className="stk-action plein" onClick={() => agir(installerPack(p.id))}>
                      {t("stickers_ajouter")}
                    </button>
                  ),
                ),
              )
            ))}
          {onglet === "mes" &&
            (mes.length === 0 ? (
              <li className="stk-vide">{t("stickers_aucun_pack")}</li>
            ) : (
              mes.map((p, i) => {
                const deplacer = (vers: number) => {
                  const ids = mes.map((x) => x.id)
                  ids.splice(i, 1)
                  ids.splice(vers, 0, p.id)
                  agir(ordonnerPacks(ids))
                }
                return ligne(
                  p,
                  <button type="button" className="stk-action" onClick={() => agir(retirerPack(p.id))}>
                    {t("stickers_retirer")}
                  </button>,
                  <span className="stk-ordre">
                    <button type="button" disabled={i === 0} onClick={() => deplacer(i - 1)} aria-label="↑">
                      ▲
                    </button>
                    <button type="button" disabled={i === mes.length - 1} onClick={() => deplacer(i + 1)} aria-label="↓">
                      ▼
                    </button>
                  </span>,
                )
              })
            ))}
        </ul>
      </FenetreSticker>
      {ouvert && <ApercuPack pack={ouvert} onFermer={() => setOuvert(null)} />}
    </>
  )
}

/** L'APERÇU D'UN PACK : tous ses stickers, et « Ajouter » ou « Retirer ». */
export function ApercuPack({ pack, onFermer }: { pack: PackStickers; onFermer: () => void }) {
  const { t, language } = useTranslation()
  const etat = useStickers()
  const installe = etat.mesPacks.includes(pack.id)
  const [erreur, setErreur] = useState(false)
  const description = nomDans(pack.description, language)
  return (
    <FenetreSticker titre={nomDans(pack.nom, language, pack.code)} onFermer={onFermer} libelleFermer={t("close")}>
      <p className="stk-description">
        {description ? `${description} · ` : ""}
        {t("stickers_nombre", { n: pack.stickers.length })}
      </p>
      {erreur && <p className="stk-description">{t("stickers_erreur")}</p>}
      <div className="stk-grille">
        {pack.stickers.map((s) => (
          <span key={s.id} className="stk-case" style={{ cursor: "default" }}>
            <img src={s.url} alt={s.emoji} loading="lazy" />
          </span>
        ))}
      </div>
      <div className="stk-pied">
        <button
          type="button"
          className={`stk-action${installe ? "" : " plein"}`}
          onClick={() => {
            setErreur(false)
            ;(installe ? retirerPack(pack.id) : installerPack(pack.id)).catch(() => setErreur(true))
          }}
        >
          {t(installe ? "stickers_retirer" : "stickers_ajouter")}
        </button>
      </div>
    </FenetreSticker>
  )
}
