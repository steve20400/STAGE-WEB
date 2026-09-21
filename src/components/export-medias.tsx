import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "../i18n"
import { useToast } from "./toast"
import { fetchChatConversations, type ConversationListItem } from "../services/chats-service"
import {
  chiffrerExport,
  FAMILLES,
  lancerTelechargement,
  tailleLisible,
  type Famille,
} from "../services/export-medias"

/**
 * L'ÉCRAN D'EXPORTATION DES MÉDIAS.
 *
 * Trois questions, dans l'ordre où on se les pose : QUELLES discussions, QUELS
 * médias, QUELLE période. Puis un décompte — combien de fichiers, quel poids —
 * avant de s'engager.
 *
 * 🔴 LE DÉCOMPTE N'EST PAS UN ORNEMENT. Sans lui, on lance un export sans savoir
 * si l'on demande quarante mégaoctets ou six gigaoctets, et l'on s'en aperçoit
 * quand le téléphone est plein. Il est recalculé à chaque changement de critère,
 * et c'est lui qui décide si le bouton est actionnable.
 */

/** Le décompte suit la frappe : on attend une pause avant d'interroger. */
const REPOS_AVANT_CALCUL_MS = 350

/** Les raccourcis de période, en jours. `null` = depuis toujours. */
const RACCOURCIS: Array<{ cle: "exp_raccourci_7j" | "exp_raccourci_30j" | "exp_raccourci_an" | "exp_raccourci_tout"; jours: number | null }> = [
  { cle: "exp_raccourci_7j", jours: 7 },
  { cle: "exp_raccourci_30j", jours: 30 },
  { cle: "exp_raccourci_an", jours: 365 },
  { cle: "exp_raccourci_tout", jours: null },
]

/** « 2026-09-21T10:00 », le format qu'attend un champ `datetime-local`. */
function pourChamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`
}

export function ExportMedias() {
  const { t, language } = useTranslation()
  const { success, error } = useToast()

  const [discussions, setDiscussions] = useState<ConversationListItem[]>([])
  const [toutesDiscussions, setToutesDiscussions] = useState(true)
  const [choisies, setChoisies] = useState<string[]>([])
  const [recherche, setRecherche] = useState("")

  const [familles, setFamilles] = useState<Famille[]>([...FAMILLES])
  const [du, setDu] = useState("")
  const [au, setAu] = useState("")

  const [chiffrage, setChiffrage] = useState<{
    fichiers: number
    octets: number
    plafondOctets: number
  } | null>(null)
  const [calcule, setCalcule] = useState(false)
  const [lance, setLance] = useState(false)
  const [prepare, setPrepare] = useState(false)

  useEffect(() => {
    void fetchChatConversations()
      .then(setDiscussions)
      .catch(() => setDiscussions([]))
  }, [])

  /*
   * ⚠️ LES CRITÈRES SONT MÉMORISÉS, et il le faut : ils servent de dépendance à
   * l'effet de calcul. Recréés à chaque rendu, ils relanceraient une requête à
   * chaque frappe dans le champ de recherche — qui ne les concerne même pas.
   */
  const criteres = useMemo(
    () => ({
      conversations: toutesDiscussions ? [] : choisies,
      familles,
      du,
      au,
    }),
    [toutesDiscussions, choisies, familles, du, au],
  )

  const invalide =
    familles.length === 0 ||
    (!toutesDiscussions && choisies.length === 0) ||
    Boolean(du && au && new Date(du).getTime() > new Date(au).getTime())

  const demande = useRef(0)
  useEffect(() => {
    if (invalide) {
      setChiffrage(null)
      setCalcule(false)
      return
    }
    setCalcule(true)
    const mien = ++demande.current
    // Une pause avant d'interroger : sans elle, cocher quatre types de médias
    // déclencherait quatre requêtes dont seule la dernière compte.
    const minuteur = window.setTimeout(() => {
      void chiffrerExport(criteres)
        .then((r) => {
          // ⚠️ SEULE LA DERNIÈRE DEMANDE ÉCRIT : une réponse en retard
          // afficherait le décompte de critères qu'on vient de changer.
          if (demande.current !== mien) return
          setChiffrage({
            fichiers: r.fichiers,
            octets: r.octets,
            plafondOctets: r.plafondOctets,
          })
          setCalcule(false)
        })
        .catch(() => {
          if (demande.current !== mien) return
          setChiffrage(null)
          setCalcule(false)
        })
    }, REPOS_AVANT_CALCUL_MS)
    return () => window.clearTimeout(minuteur)
  }, [criteres, invalide])

  /*
   * ⚠️ LE PLAFOND SE DIT AVANT, PAS APRÈS. Le serveur refuse au-delà d'une
   * certaine taille — c'est ce qui protège la machine — mais découvrir ce refus
   * après avoir attendu serait une perte de temps sèche. Le décompte le connaît
   * déjà : on le dit ici, et le bouton reste inerte.
   */
  const tropGros = Boolean(chiffrage && chiffrage.octets > chiffrage.plafondOctets)

  const basculerFamille = (f: Famille) =>
    setFamilles((liste) => (liste.includes(f) ? liste.filter((x) => x !== f) : [...liste, f]))

  const basculerDiscussion = (id: string) =>
    setChoisies((liste) => (liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id]))

  const poserRaccourci = useCallback((jours: number | null) => {
    if (jours === null) {
      setDu("")
      setAu("")
      return
    }
    const fin = new Date()
    const debut = new Date(fin.getTime() - jours * 24 * 60 * 60 * 1000)
    setDu(pourChamp(debut))
    setAu(pourChamp(fin))
  }, [])

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (!q) return discussions
    /*
     * LE NOM OU LE NUMÉRO : on cherche « Marie » comme « 10000001 ».
     *
     * ⚠️ LE NUMÉRO VIT DANS LES MEMBRES, pas sur la conversation. Une
     * conversation à deux n'a pas de numéro à elle — elle en a un par
     * participant — et ne chercher que dans les noms priverait de la seule
     * façon fiable de retrouver quelqu'un qu'on n'a pas enregistré.
     */
    return discussions.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.membersInfo ?? []).some((m) =>
          (m.publicNumber ?? "").toLowerCase().includes(q),
        ),
    )
  }, [discussions, recherche])

  const exporter = () => {
    if (invalide || tropGros || !chiffrage || chiffrage.fichiers === 0) return
    try {
      setPrepare(true)
      lancerTelechargement(criteres)
      /*
       * ⚠️ UN INSTANT DE « PRÉPARATION » AVANT L'AVIS DE DÉPART. Le serveur
       * compte et ouvre son flux avant que le navigateur n'affiche quoi que ce
       * soit : sans ce mot, on clique et il ne se passe visiblement RIEN
       * pendant une seconde ou deux — le temps qu'il faut pour recliquer, et
       * lancer deux exports.
       */
      window.setTimeout(() => setPrepare(false), 1400)
      setLance(true)
      success(t("exp_lance"))
      // L'avis s'efface : il annonce un DÉPART, pas un état durable.
      window.setTimeout(() => setLance(false), 6000)
    } catch {
      error(t("exp_echec"))
    }
  }

  const libelleFamille: Record<Famille, string> = {
    photo: t("exp_photo"),
    video: t("exp_video"),
    audio: t("exp_audio"),
    document: t("exp_document"),
  }

  return (
    <div className="s-card exp-carte">
      <div className="s-card-title">{t("settings_export")}</div>
      <div className="s-hint exp-intro">{t("exp_sub")}</div>

      {/* ⚠️ DIT D'EMBLÉE, ET NON EN NOTE DE BAS DE PAGE : « seuls les médias
          reçus » change entièrement ce qu'on attend de l'archive. Le découvrir
          après avoir attendu un téléchargement de deux gigaoctets serait une
          perte de temps qu'une phrase évite. */}
      <div className="exp-avis">{t("exp_avert_recus")}</div>

      {/* ── 1. Les discussions ──────────────────────────────────────────── */}
      <section className="exp-bloc">
        <div className="exp-titre">
          <span className="exp-num">1</span>
          {t("exp_etape_disc")}
        </div>
        <div className="exp-choix2">
          <button
            type="button"
            className={`exp-opt ${toutesDiscussions ? "actif" : ""}`}
            onClick={() => setToutesDiscussions(true)}
          >
            {t("exp_toutes_disc")}
          </button>
          <button
            type="button"
            className={`exp-opt ${toutesDiscussions ? "" : "actif"}`}
            onClick={() => setToutesDiscussions(false)}
          >
            {t("exp_choisir_disc")}
            {!toutesDiscussions && choisies.length > 0 && (
              <span className="exp-compteur" title={t("exp_selection", { n: String(choisies.length) })}>
                {choisies.length}
              </span>
            )}
          </button>
        </div>

        {!toutesDiscussions && (
          <div className="exp-liste-zone">
            <input
              id="exp-recherche"
              className="exp-recherche"
              type="search"
              value={recherche}
              placeholder={t("exp_rechercher")}
              onChange={(e) => setRecherche(e.target.value)}
            />
            {choisies.length > 0 && (
              <div className="exp-barre-sel">
                <span>{t("exp_selection", { n: String(choisies.length) })}</span>
                <button type="button" className="exp-effacer" onClick={() => setChoisies([])}>
                  {t("exp_tout_effacer")}
                </button>
              </div>
            )}
            {visibles.length === 0 ? (
              <div className="exp-vide">{t("exp_aucune_disc")}</div>
            ) : (
              /* Une hauteur bornée avec défilement : trois cents discussions
                 pousseraient sinon tout le reste de l'écran hors de vue. */
              <ul className="exp-liste">
                {visibles.map((d) => {
                  const coche = choisies.includes(d.id)
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        className={`exp-ligne ${coche ? "coche" : ""}`}
                        aria-pressed={coche}
                        onClick={() => basculerDiscussion(d.id)}
                      >
                        <span className="exp-case" aria-hidden>
                          {coche ? "✓" : ""}
                        </span>
                        <span className="exp-nom">{d.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ── 2. Les types de médias ──────────────────────────────────────── */}
      <section className="exp-bloc">
        <div className="exp-titre">
          <span className="exp-num">2</span>
          {t("exp_etape_types")}
        </div>
        {/* ⚠️ « TOUS » EST UN BOUTON, PAS UNE CONSIGNE. Tout cocher demandait
            quatre clics, et tout décocher quatre autres — pour l'usage le plus
            courant de cet écran. */}
        <button
          type="button"
          className={`exp-raccourci exp-tous ${familles.length === FAMILLES.length ? "coche" : ""}`}
          onClick={() =>
            setFamilles(familles.length === FAMILLES.length ? [] : [...FAMILLES])
          }
        >
          {t("exp_tous_types")}
        </button>
        <div className="exp-familles">
          {FAMILLES.map((f) => {
            const coche = familles.includes(f)
            return (
              <button
                key={f}
                type="button"
                className={`exp-famille ${coche ? "coche" : ""}`}
                aria-pressed={coche}
                onClick={() => basculerFamille(f)}
              >
                {libelleFamille[f]}
              </button>
            )
          })}
        </div>
        {familles.length === 0 && <div className="exp-erreur">{t("exp_type_requis")}</div>}
      </section>

      {/* ── 3. La période ───────────────────────────────────────────────── */}
      <section className="exp-bloc">
        <div className="exp-titre">
          <span className="exp-num">3</span>
          {t("exp_etape_periode")}
        </div>
        {/* Les raccourcis d'abord : « les 30 derniers jours » est la demande la
            plus fréquente, et la composer à la main quatre fois par mois est une
            corvée que deux mots évitent. */}
        <div className="exp-raccourcis">
          {RACCOURCIS.map((r) => (
            <button
              key={r.cle}
              type="button"
              className="exp-raccourci"
              onClick={() => poserRaccourci(r.jours)}
            >
              {t(r.cle)}
            </button>
          ))}
        </div>
        <div className="exp-dates">
          <label className="exp-date">
            <span>{t("exp_du")}</span>
            <input
              id="exp-du"
              type="datetime-local"
              value={du}
              onChange={(e) => setDu(e.target.value)}
            />
          </label>
          <label className="exp-date">
            <span>{t("exp_au")}</span>
            <input
              id="exp-au"
              type="datetime-local"
              value={au}
              onChange={(e) => setAu(e.target.value)}
            />
          </label>
        </div>
        {du && au && new Date(du).getTime() > new Date(au).getTime() ? (
          <div className="exp-erreur">{t("exp_periode_inverse")}</div>
        ) : (
          <div className="exp-note">{t("exp_periode_libre")}</div>
        )}
      </section>

      {/* ── Le résumé, puis le départ ───────────────────────────────────── */}
      <div className="exp-resume">
        {calcule ? (
          <span className="exp-resume-txt">{t("exp_calcul")}</span>
        ) : tropGros ? (
          <span className="exp-resume-txt alerte">{t("exp_trop_gros")}</span>
        ) : chiffrage && chiffrage.fichiers > 0 ? (
          <span className="exp-resume-txt fort">
            {t("exp_resume", {
              n: chiffrage.fichiers.toLocaleString(language),
              t: tailleLisible(chiffrage.octets, language),
            })}
          </span>
        ) : (
          <span className="exp-resume-txt">{t("exp_rien")}</span>
        )}
        <button
          type="button"
          className="exp-lancer"
          disabled={invalide || calcule || tropGros || !chiffrage || chiffrage.fichiers === 0}
          onClick={exporter}
        >
          {prepare ? t("exp_encours") : t("exp_lancer")}
        </button>
      </div>

      {lance && <div className="exp-lance">{t("exp_lance")}</div>}
      <div className="exp-note exp-note-bas">{t("exp_avert_quitter")}</div>

      <style>{`
        /* Les marges suivent celles des autres cartes de reglages : une section
           qui respire differemment de ses voisines se lit comme un morceau
           rapporte. */
        .exp-carte { display: grid; gap: 0; }
        .exp-intro { margin-top: 0; margin-bottom: 12px; }
        .exp-avis {
          padding: 10px 12px; border-radius: 10px; margin-bottom: 18px;
          background: var(--accent-dim); color: var(--text-primary);
          border-left: 3px solid var(--accent);
          font-size: 12.5px; line-height: 1.45;
        }

        .exp-bloc { margin-bottom: 20px; }
        .exp-titre {
          display: flex; align-items: center; gap: 9px; margin-bottom: 10px;
          font-size: 13.5px; font-weight: 700; color: var(--text-primary);
        }
        /* Le numero encode une SEQUENCE reelle — on choisit les discussions,
           puis les types, puis la periode — et non une decoration. */
        .exp-num {
          width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: var(--accent); color: var(--accent-text);
          font-size: 11.5px; font-weight: 700;
        }

        .exp-choix2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .exp-opt {
          display: flex; align-items: center; justify-content: center; gap: 7px;
          padding: 11px 14px; border-radius: 11px; cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600;
          border: 1.5px solid var(--border-subtle);
          background: var(--bg-surface); color: var(--text-secondary);
        }
        .exp-opt.actif {
          border-color: var(--accent); background: var(--accent); color: var(--accent-text);
        }
        .exp-compteur {
          padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 700;
          background: rgba(255,255,255,.28);
        }

        .exp-liste-zone { margin-top: 10px; display: grid; gap: 8px; }
        .exp-recherche {
          width: 100%; padding: 10px 12px; border-radius: 10px;
          border: 1px solid var(--border-subtle); background: var(--bg-surface);
          color: var(--text-primary); font-family: 'DM Sans', sans-serif;
          font-size: 13px; outline: none;
        }
        .exp-recherche:focus { border-color: var(--accent); }
        .exp-effacer {
          padding: 5px 10px; border-radius: 8px; cursor: pointer;
          border: none; background: transparent; color: var(--accent);
          font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600;
        }
        /* Hauteur bornee : trois cents discussions pousseraient tout le reste
           de l'ecran hors de vue, y compris le bouton d'export. */
        .exp-liste {
          list-style: none; margin: 0; padding: 0;
          max-height: 260px; overflow-y: auto;
          border: 1px solid var(--border-subtle); border-radius: 11px;
          background: var(--bg-surface);
        }
        .exp-ligne {
          display: flex; align-items: center; gap: 10px; width: 100%;
          padding: 10px 12px; cursor: pointer; text-align: left;
          border: none; background: transparent; color: var(--text-primary);
          font-family: 'DM Sans', sans-serif; font-size: 13px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .exp-liste li:last-child .exp-ligne { border-bottom: none; }
        .exp-ligne.coche { background: var(--accent-dim); }
        .exp-case {
          width: 19px; height: 19px; border-radius: 5px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          border: 1.5px solid var(--border-default);
          font-size: 12px; font-weight: 700; color: var(--accent-text);
        }
        .exp-ligne.coche .exp-case { background: var(--accent); border-color: var(--accent); }
        .exp-nom { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .exp-vide { padding: 14px; font-size: 12.5px; color: var(--text-muted); text-align: center; }

        .exp-tous { margin-bottom: 8px; }
        .exp-tous.coche { border-color: var(--accent); color: var(--accent); }
        .exp-barre-sel {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          font-size: 12px; color: var(--text-muted);
        }
        .exp-resume-txt.alerte { color: var(--danger); font-weight: 600; }
        .exp-familles { display: flex; gap: 8px; flex-wrap: wrap; }
        .exp-famille {
          flex: 1 1 120px; padding: 10px 12px; border-radius: 10px; cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600;
          border: 1.5px solid var(--border-subtle);
          background: var(--bg-surface); color: var(--text-secondary);
        }
        .exp-famille.coche {
          border-color: var(--accent); background: var(--accent); color: var(--accent-text);
        }

        .exp-raccourcis { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 10px; }
        .exp-raccourci {
          padding: 7px 13px; border-radius: 999px; cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 500;
          border: 1px solid var(--border-subtle);
          background: transparent; color: var(--text-secondary);
        }
        .exp-raccourci:hover { border-color: var(--accent); color: var(--accent); }

        .exp-dates { display: flex; gap: 8px; flex-wrap: wrap; }
        .exp-date {
          flex: 1 1 190px; display: flex; align-items: center; gap: 8px;
          padding: 7px 12px; border-radius: 10px;
          border: 1px solid var(--border-subtle); background: var(--bg-surface);
        }
        .exp-date > span { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
        .exp-date input {
          flex: 1; min-width: 0; border: none; background: transparent; outline: none;
          color: var(--text-primary); font-family: 'DM Sans', sans-serif; font-size: 13px;
        }

        .exp-note { font-size: 11.5px; color: var(--text-muted); margin-top: 8px; }
        .exp-note-bas { text-align: center; margin-top: 10px; }
        .exp-erreur { font-size: 12px; color: var(--danger); margin-top: 8px; }

        .exp-resume {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          padding: 14px; border-radius: 12px; margin-top: 4px;
          border: 1px solid var(--border-subtle); background: var(--bg-elevated);
        }
        .exp-resume-txt { flex: 1; min-width: 150px; font-size: 13px; color: var(--text-muted); }
        .exp-resume-txt.fort {
          color: var(--text-primary); font-weight: 700; font-size: 14.5px;
          font-variant-numeric: tabular-nums;
        }
        .exp-lancer {
          padding: 12px 24px; border-radius: 10px; cursor: pointer; border: none;
          background: var(--accent); color: var(--accent-text);
          font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 700;
        }
        .exp-lancer:disabled { opacity: .45; cursor: not-allowed; }
        .exp-lancer:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        .exp-lance {
          margin-top: 10px; padding: 11px 13px; border-radius: 10px;
          background: var(--accent-dim); color: var(--text-primary);
          font-size: 12.5px; text-align: center;
        }

        /* Au pouce : les paires de colonnes passent l'une sous l'autre plutot
           que de se serrer a un endroit ou plus rien n'est atteignable. */
        @media (max-width: 520px) {
          .exp-choix2 { grid-template-columns: 1fr; }
          .exp-famille { flex-basis: calc(50% - 4px); }
          .exp-lancer { width: 100%; }
        }
      `}</style>
    </div>
  )
}
