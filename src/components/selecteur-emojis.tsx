import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import type { CategorieEmoji, EntreeEmoji } from "../data/emojis-catalogue"
import { useTranslation } from "../i18n"
import "./selecteur-emojis.css"

/**
 * SÉLECTEUR D'EMOJIS — le même catalogue que le mobile (1 812 emojis, 8
 * catégories, plus les récents et une recherche).
 *
 * Le web n'en avait AUCUN : on ne pouvait insérer un emoji qu'avec le clavier
 * du système (signalé le 02/10/2026).
 *
 * ⚠️ LE CATALOGUE EST CHARGÉ À LA PREMIÈRE OUVERTURE, pas avec l'application :
 * 175 Ko de données pour un panneau que beaucoup n'ouvriront jamais.
 *
 * ⚠️ LES RÉCENTS VIVENT DANS CE NAVIGATEUR (localStorage), comme ceux du
 * mobile vivent dans le téléphone. Une préférence de confort : perdue, elle ne
 * coûte rien — on l'enveloppe donc de try/catch et on n'en dépend jamais.
 */

type Catalogue = ReadonlyArray<{ id: CategorieEmoji; emojis: ReadonlyArray<EntreeEmoji> }>

const CLE_RECENTS = "alanya.emojis.recents"
const MAX_RECENTS = 32

function lireRecents(): string[] {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_RECENTS) ?? "[]")
    return Array.isArray(brut) ? brut.filter((e): e is string => typeof e === "string") : []
  } catch {
    return []
  }
}

function noterRecent(emoji: string): void {
  try {
    const liste = [emoji, ...lireRecents().filter((e) => e !== emoji)].slice(0, MAX_RECENTS)
    localStorage.setItem(CLE_RECENTS, JSON.stringify(liste))
  } catch {
    /* navigation privée ou stockage refusé : les récents ne seront pas retenus */
  }
}

/** Même normalisation que les mots-clés générés : sans accents, minuscules. */
function nu(texte: string): string {
  return texte
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

let catalogueCharge: Promise<Catalogue> | null = null
function chargerCatalogue(): Promise<Catalogue> {
  catalogueCharge ??= import("../data/emojis-catalogue").then((m) => m.CATALOGUE_EMOJIS)
  return catalogueCharge
}

export function SelecteurEmojis({
  onChoisir,
  onFermer,
}: {
  onChoisir: (emoji: string) => void
  onFermer: () => void
}) {
  const { t } = useTranslation()
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [requete, setRequete] = useState("")
  const [recents, setRecents] = useState<string[]>(lireRecents)
  const [actif, setActif] = useState<string>(() => (lireRecents().length > 0 ? "recents" : "smileys"))
  const grille = useRef<HTMLDivElement>(null)
  const racine = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivant = true
    void chargerCatalogue().then((c) => {
      if (vivant) setCatalogue(c)
    })
    return () => {
      vivant = false
    }
  }, [])

  // Échap ferme ; un clic hors du panneau aussi — le même geste que les
  // autres menus de l'application.
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer()
    }
    const clic = (e: PointerEvent) => {
      const cible = e.target as Node
      if (racine.current && !racine.current.contains(cible) && !(cible as Element).closest?.(".emoji-declencheur")) {
        onFermer()
      }
    }
    window.addEventListener("keydown", touche)
    window.addEventListener("pointerdown", clic)
    return () => {
      window.removeEventListener("keydown", touche)
      window.removeEventListener("pointerdown", clic)
    }
  }, [onFermer])

  const trouves = useMemo(() => {
    const q = nu(requete)
    if (q === "" || !catalogue) return null
    const mots = q.split(/\s+/)
    const sortie: string[] = []
    for (const c of catalogue) {
      for (const [emoji, cles] of c.emojis) {
        if (mots.every((m) => cles.includes(m))) sortie.push(emoji)
      }
    }
    return sortie
  }, [requete, catalogue])

  function choisir(emoji: string) {
    noterRecent(emoji)
    setRecents(lireRecents())
    onChoisir(emoji)
  }

  function allerA(id: string) {
    setRequete("")
    setActif(id)
    // Après le rendu : la recherche vidée vient de remettre les sections.
    window.requestAnimationFrame(() => {
      const section = grille.current?.querySelector<HTMLElement>(`[data-section="${id}"]`)
      if (section && grille.current) grille.current.scrollTop = section.offsetTop - grille.current.offsetTop
    })
  }

  /** L'onglet suit la section qu'on lit en faisant défiler. */
  function suivreDefilement() {
    const g = grille.current
    if (!g || trouves) return
    const sections = g.querySelectorAll<HTMLElement>("[data-section]")
    let courant = actif
    for (const s of sections) {
      if (s.offsetTop - g.offsetTop <= g.scrollTop + 8) courant = s.dataset.section ?? courant
    }
    if (courant !== actif) setActif(courant)
  }

  const onglets: Array<{ id: string; icone: ReactNode; libelle: string }> = [
    ...(recents.length > 0 ? [{ id: "recents", icone: ICONES.recents, libelle: t("emoji_recent") }] : []),
    ...(catalogue ?? []).map((c) => ({
      id: c.id,
      icone: ICONES[c.id],
      libelle: t(`emoji_cat_${c.id}` as "emoji_cat_smileys"),
    })),
  ]

  const bouton = (emoji: string, cle: string) => (
    <button key={cle} type="button" className="emoji-case" onClick={() => choisir(emoji)} title={emoji}>
      {emoji}
    </button>
  )

  return (
    <div className="emoji-panneau" ref={racine} role="dialog" aria-label={t("emojis")}>
      <div className="emoji-recherche">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="text"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder={t("emoji_search_hint")}
          aria-label={t("emoji_search_hint")}
          autoFocus
        />
      </div>

      <div className="emoji-onglets" role="tablist">
        {onglets.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={!trouves && actif === o.id}
            className={`emoji-onglet${!trouves && actif === o.id ? " actif" : ""}`}
            onClick={() => allerA(o.id)}
            title={o.libelle}
            aria-label={o.libelle}
          >
            {o.icone}
          </button>
        ))}
      </div>

      <div className="emoji-grille" ref={grille} onScroll={suivreDefilement}>
        {catalogue === null ? (
          <p className="emoji-vide">{t("loading")}</p>
        ) : trouves ? (
          trouves.length === 0 ? (
            <p className="emoji-vide">{t("emoji_none")}</p>
          ) : (
            <div className="emoji-cases">{trouves.map((e, i) => bouton(e, `r${i}`))}</div>
          )
        ) : (
          <>
            {recents.length > 0 && (
              <section data-section="recents">
                <h3>{t("emoji_recent")}</h3>
                <div className="emoji-cases">{recents.map((e, i) => bouton(e, `rec${i}`))}</div>
              </section>
            )}
            {catalogue.map((c) => (
              <section key={c.id} data-section={c.id}>
                <h3>{t(`emoji_cat_${c.id}` as "emoji_cat_smileys")}</h3>
                <div className="emoji-cases">{c.emojis.map(([e], i) => bouton(e, `${c.id}${i}`))}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/*
 * ONGLETS DESSINÉS ET NON EMOJIS : un emoji dans la barre d'onglets se rend à
 * la taille et dans les couleurs de la police du système, sans suivre le
 * thème ; un tracé prend la couleur qu'on lui donne, actif ou non.
 */
function Trace({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const ICONES: Record<string, ReactNode> = {
  recents: (
    <Trace>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Trace>
  ),
  smileys: (
    <Trace>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2M9 9.5h.01M15 9.5h.01" />
    </Trace>
  ),
  nature: (
    <Trace>
      <path d="M5 21c0-9 5-15 15-16-1 10-7 15-15 16Z" />
      <path d="M5 21 13 13" />
    </Trace>
  ),
  nourriture: (
    <Trace>
      <path d="M4 11h16a8 8 0 0 1-16 0Z" />
      <path d="M8 7c0-1 1-1 1-2M12 7c0-1 1-1 1-2M16 7c0-1 1-1 1-2" />
    </Trace>
  ),
  activites: (
    <Trace>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8" />
    </Trace>
  ),
  voyages: (
    <Trace>
      <path d="M3 13h18l-2 5H5l-2-5ZM6 13l1.5-5h9L18 13M8 18v2M16 18v2" />
    </Trace>
  ),
  objets: (
    <Trace>
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3Z" />
    </Trace>
  ),
  symboles: (
    <Trace>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
    </Trace>
  ),
  drapeaux: (
    <Trace>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </Trace>
  ),
}
