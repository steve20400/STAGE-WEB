/**
 * LA PAGE ENTRE LA CONNEXION ET LA SESSION : l'historique chiffré revient.
 *
 * 🔴 JUMELLE DE `alanya/lib/features/auth/screens/restauration_screen.dart`.
 *
 * 🐛 « UN NOUVEAU NAVIGATEUR NE CHARGE PAS L'ARCHIVE » (user, 28/09/2026). La
 * restauration tournait en fond, invisible, et ses échecs finissaient dans la
 * console. Cette page récupère l'archive, la déchiffre, la range dans ce
 * navigateur, et montre où elle en est.
 *
 * ⚠️ « CONTINUER EN ARRIÈRE-PLAN » (choix du user) : la restauration continue
 * sans la page — elle vit dans ce module, pas dans le composant.
 *
 * ⚠️ MODE STRICT : React lance les effets deux fois en développement. La
 * restauration est donc tenue AU NIVEAU DU MODULE : un second effet reprend
 * celle qui tourne au lieu d'en lancer une autre — ou de consommer le mot de
 * passe à vide et de sortir.
 */
import { useEffect, useState } from "react"
import { Icone } from "../../../src/components/icone"
import { useLocation, useNavigate } from "react-router-dom"
import {
  aUneCleDeRecuperation,
  demanderCleAuxAppareils,
  ouvrir,
  relierAuMotDePasse,
  relireDemandeCle,
  restaurerALaConnexionSuivie,
  type IssueConnexion,
} from "../../../src/services/e2ee-sauvegarde"
import { subscribeToSignalSauvegarde } from "../../../src/services/websocket-service"
import { useTranslation } from "../../../src/i18n"
import { reprendreMotDePasse } from "../../../src/services/restauration-en-attente"
import { cacheMessage } from "../../../src/services/indexeddb-cache"
import { entreeCacheDechiffree } from "../../../src/services/e2ee-entree-cache"
import { restaurerTousLesTrousseaux } from "../../../src/services/e2ee-groupe-fil"
import type { MessageArchive } from "../../../src/services/e2ee-archive"
import {
  compteur,
  fractionGlobale,
  type ProgressionRestauration,
} from "../../../src/lib/restauration-progression"
import { useAuth } from "../../../src/components/auth-provider"

/*
 * « Plus tard » sur la proposition des 12 mots : on ne la refait pas avant
 * sept jours sur ce navigateur (27/11/2026). Hors du préfixe `alanya.e2ee.`,
 * vidé à la déconnexion.
 */
const REPORT_MS = 7 * 24 * 3600 * 1000
const cleReport = (moi: string) => `alanya-proposition-cle-reportee-${moi}`
function propositionReportee(moi: string | null): boolean {
  if (!moi) return false
  try {
    const quand = Number(localStorage.getItem(cleReport(moi)) ?? "")
    return Number.isFinite(quand) && quand > 0 && Date.now() - quand < REPORT_MS
  } catch {
    return false
  }
}
function reporterProposition(moi: string | null) {
  if (!moi) return
  try {
    localStorage.setItem(cleReport(moi), String(Date.now()))
  } catch {
    // stockage indisponible : la proposition reviendra, sans gravité.
  }
}

type Resultat = Awaited<ReturnType<typeof restaurerALaConnexionSuivie>>

/* ── L'état de la restauration, hors du composant ─────────────────────── */

let enCours: Promise<Resultat> | null = null
/** Gardé le temps de la page, pour « Réessayer ». Effacé en la quittant. */
let motDePasse: string | null = null
let derniere: ProgressionRestauration = { etape: "ouverture", fait: 0 }
const abonnes = new Set<(p: ProgressionRestauration) => void>()

// La même fabrique que la relève : un média restauré se range COMPLET, avec
// sa clé, et se rouvre donc sur ce nouvel appareil (chapitre 23).
const ranger = (m: MessageArchive) => cacheMessage(entreeCacheDechiffree(m))

function lancer(mdp: string): Promise<Resultat> {
  derniere = { etape: "ouverture", fait: 0 }
  const tour = restaurerALaConnexionSuivie(mdp, ranger, (p) => {
    derniere = p
    for (const f of abonnes) f(p)
  })
  enCours = tour
  void tour.finally(() => {
    if (enCours === tour) enCours = null
  })
  /*
   * 🔴 ET LES CLÉS DES GROUPES CHIFFRÉS (lot 6, chapitre 35) : l'archive est
   * ouverte, mes copies de trousseau s'ouvrent avec elle. Sans attendre — le
   * fil les reprendrait de toute façon à la demande (`trousseauAvecRepli`).
   */
  void tour.then((r) => {
    if (r.issue === "restauree" || r.issue === "rienARestaurer") {
      void restaurerTousLesTrousseaux().catch(() => undefined)
    }
  })
  return tour
}

function oublier() {
  motDePasse = null
}

/* ── La page ──────────────────────────────────────────────────────────── */

export default function RestaurationPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const suite = (location.state as { suite?: string } | null)?.suite ?? "/chats"

  const [progression, setProgression] = useState<ProgressionRestauration>(derniere)
  const [issue, setIssue] = useState<IssueConnexion | null>(null)
  const [essai, setEssai] = useState(0)
  const { t } = useTranslation()
  const moi = useAuth().user?.id ?? null

  /*
   * 🔴 L'ARCHIVE EST FERMÉE MAIS A UNE CLÉ DE RÉCUPÉRATION (27/11/2026) : on
   * la propose, sans bloquer — « Plus tard » entre aussitôt.
   */
  const [proposerCle, setProposerCle] = useState(false)
  const [mots, setMots] = useState("")
  const [ouverture, setOuverture] = useState(false)
  const [erreurCle, setErreurCle] = useState<string | null>(null)

  /*
   * 🔴 COUCHE C (27/11/2026) : la sauvegarde reste fermée ici, mais un autre
   * appareil du compte a la clé. On la lui demande dès l'arrivée ; elle arrive
   * toute seule s'il est ouvert, ou plus tard (la veille la reprendra).
   */
  const [attente, setAttente] = useState(false)
  const [refusParAppareil, setRefusParAppareil] = useState(false)
  const [motsVisibles, setMotsVisibles] = useState(false)

  /**
   * Les 12 mots : on ouvre, on RELIE l'archive au mot de passe qu'on vient de
   * taper (les appareils suivants s'ouvriront avec lui), puis la restauration
   * reprend — la clé est désormais dans ce navigateur.
   */
  const ouvrirParCle = async () => {
    const saisie = mots.trim()
    if (!saisie || ouverture) return
    setOuverture(true)
    setErreurCle(null)
    if (!(await ouvrir("recuperation", saisie))) {
      setOuverture(false)
      setErreurCle(t("arch_cle_refusee"))
      return
    }
    if (motDePasse) await relierAuMotDePasse(motDePasse)
    setMots("")
    setOuverture(false)
    setProposerCle(false)
    setIssue(null)
    setEssai((n) => n + 1)
  }

  const entrer = () => {
    oublier()
    navigate(suite, { replace: true })
  }

  useEffect(() => {
    let actif = true
    let tour = enCours
    if (!tour) {
      if (essai === 0) motDePasse = reprendreMotDePasse() ?? motDePasse
      if (!motDePasse) {
        // Rechargement, ou arrivée sans connexion : rien à restaurer ici.
        navigate(suite, { replace: true })
        return
      }
      tour = lancer(motDePasse)
    }
    abonnes.add(setProgression)
    setProgression(derniere)
    void tour.then((r) => {
      if (!actif) return
      if (r.issue === "restauree" || r.issue === "rienARestaurer") {
        oublier()
        navigate(suite, { replace: true })
      } else if (r.issue === "fermee") {
        void aUneCleDeRecuperation().then(async (avecCle) => {
          if (!actif) return
          if (avecCle && propositionReportee(moi)) {
            // Déjà proposée et remise à plus tard : on entre, sans rien dire —
            // la demande aux autres appareils part quand même, la veille la
            // reprendra.
            void demanderCleAuxAppareils(motDePasse ?? undefined)
            oublier()
            navigate(suite, { replace: true })
            return
          }
          setProposerCle(avecCle)
          setIssue("fermee")
          const id = await demanderCleAuxAppareils(motDePasse ?? undefined)
          if (actif) setAttente(id !== null)
        })
      } else {
        setIssue(r.issue)
      }
    })
    return () => {
      actif = false
      abonnes.delete(setProgression)
    }
    // `essai` relance : « Réessayer ».
  }, [essai, navigate, suite, moi])

  // La clé arrive : relue toutes les quatre secondes, et dès qu'un appareil
  // signale qu'il l'a traitée.
  useEffect(() => {
    if (issue !== "fermee" || !attente) return
    let actif = true
    let enLecture = false
    const relire = async () => {
      if (!actif || enLecture) return
      enLecture = true
      const r = await relireDemandeCle(motDePasse ?? undefined)
      enLecture = false
      if (!actif) return
      if (r === "recue") {
        setAttente(false)
        setIssue(null)
        setEssai((n) => n + 1)
      } else if (r === "refusee") {
        setAttente(false)
        setRefusParAppareil(true)
      } else if (r !== "attente") {
        setAttente(false)
      }
    }
    const minuterie = window.setInterval(() => void relire(), 4000)
    const desabonner = subscribeToSignalSauvegarde((quoi) => {
      if (quoi === "demande_cle_traitee") void relire()
    })
    return () => {
      actif = false
      window.clearInterval(minuterie)
      desabonner()
    }
  }, [issue, attente])

  const fraction = fractionGlobale(progression)
  const texteCompteur = compteur(progression, {
    blocs: t("rest_blocs"),
    messages: t("rest_messages"),
  })

  return (
    <div className="restauration">
      <style>{STYLE}</style>
      <div className="carte" role="status" aria-live="polite">
        <div className="icone" aria-hidden>
          <Icone nom="cadenas" taille={44} />
        </div>
        <h1>
          {issue === null
            ? t("rest_titre")
            : issue === "fermee" && attente
              ? t("arch_attente_titre")
              : issue === "fermee" && proposerCle
              ? t("arch_cle_proposee_titre")
              : issue === "fermee"
                ? t("rest_ferme_titre")
                : t("rest_echec_titre")}
        </h1>

        {issue === null && (
          <>
            <p className="sous">{t("rest_sous")}</p>
            <p className="etape">{t(`rest_etape_${progression.etape}` as const)}</p>
            <div
              className={`piste${fraction === null ? " animee" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
            >
              <div
                className="remplissage"
                style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
              />
            </div>
            <p className="compteur">{texteCompteur ?? " "}</p>
            <button type="button" className="secondaire" onClick={entrer}>
              {t("rest_arriere_plan")}
            </button>
            <p className="note">{t("rest_note")}</p>
          </>
        )}

        {issue === "fermee" && attente && (
          <>
            <p className="sous">{t("arch_attente_texte")}</p>
            <div className="piste animee" role="progressbar" aria-busy="true">
              <div className="remplissage" />
            </div>
          </>
        )}

        {issue === "fermee" && refusParAppareil && (
          <p className="erreur" role="alert">
            {t("arch_demande_refusee")}
          </p>
        )}

        {issue === "fermee" && proposerCle && attente && !motsVisibles && (
          <button type="button" className="secondaire" onClick={() => setMotsVisibles(true)}>
            {t("arch_jai_ma_cle")}
          </button>
        )}

        {issue === "fermee" && proposerCle && (!attente || motsVisibles) && (
          <>
            {!attente && <p className="sous">{t("arch_cle_proposee_texte")}</p>}
            <textarea
              className="mots"
              rows={3}
              value={mots}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t("arch_cle_saisie")}
              aria-label={t("arch_cle_saisie")}
              aria-invalid={erreurCle ? true : undefined}
              onChange={(e) => setMots(e.target.value)}
            />
            {erreurCle && (
              <p className="erreur" role="alert">
                {erreurCle}
              </p>
            )}
            <button
              type="button"
              className="principal"
              disabled={ouverture || !mots.trim()}
              onClick={() => void ouvrirParCle()}
            >
              {ouverture ? "…" : t("arch_cle_restaurer")}
            </button>
          </>
        )}

        {issue === "fermee" && proposerCle && (
          <button
            type="button"
            className="secondaire"
            disabled={ouverture}
            onClick={() => {
              reporterProposition(moi)
              entrer()
            }}
          >
            {attente ? t("arch_attente_continuer") : t("arch_plus_tard")}
          </button>
        )}

        {issue === "fermee" && !proposerCle && attente && (
          <button type="button" className="secondaire" onClick={entrer}>
            {t("arch_attente_continuer")}
          </button>
        )}

        {issue === "fermee" && !proposerCle && !attente && (
          <>
            <p className="sous">{t("rest_ferme_texte")}</p>
            <button
              type="button"
              className="principal"
              onClick={() => {
                oublier()
                navigate("/settings?section=security", { replace: true })
              }}
            >
              {t("rest_utiliser_cle")}
            </button>
            <button type="button" className="secondaire" onClick={entrer}>
              {t("rest_continuer_sans")}
            </button>
          </>
        )}

        {issue === "echec" && (
          <>
            <p className="sous">{t("rest_echec_texte")}</p>
            <button
              type="button"
              className="principal"
              onClick={() => {
                setIssue(null)
                setEssai((n) => n + 1)
              }}
            >
              {t("rest_reessayer")}
            </button>
            <button type="button" className="secondaire" onClick={entrer}>
              {t("rest_continuer_sans")}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const STYLE = `
  .restauration {
    min-height: 100vh; background: var(--bg-base); color: var(--text-primary);
    display: flex; align-items: center; justify-content: center; padding: 24px 16px;
  }
  .restauration .carte {
    width: 100%; max-width: 420px; display: flex; flex-direction: column;
    gap: 12px; text-align: center;
  }
  .restauration .icone { font-size: 2.75rem; line-height: 1; }
  .restauration h1 { font-size: 1.375rem; font-weight: 700; margin: 4px 0; }
  .restauration .sous { font-size: 0.875rem; line-height: 1.6; color: var(--text-muted); margin: 0 0 12px; }
  .restauration .etape { font-size: 0.9375rem; margin: 8px 0 0; text-align: left; }
  .restauration .piste {
    position: relative; height: 8px; border-radius: 6px; overflow: hidden;
    background: var(--accent-dim);
  }
  .restauration .remplissage {
    height: 100%; background: var(--accent); border-radius: 6px;
    transition: width .25s ease-out;
  }
  .restauration .piste.animee .remplissage {
    position: absolute; width: 35%; animation: restauration-va-vient 1.2s ease-in-out infinite;
  }
  @keyframes restauration-va-vient { 0% { left: -35%; } 100% { left: 100%; } }
  @media (prefers-reduced-motion: reduce) {
    .restauration .piste.animee .remplissage { animation: none; left: 0; width: 100%; opacity: .5; }
  }
  .restauration .compteur { font-size: 0.75rem; color: var(--text-muted); text-align: right; margin: 0 0 12px; }
  .restauration button {
    font: inherit; font-size: 0.9375rem; padding: 11px 16px; border-radius: 10px; cursor: pointer;
  }
  .restauration .principal { background: var(--accent); color: #fff; border: none; }
  .restauration .secondaire {
    background: transparent; color: var(--text-primary); border: 1px solid var(--accent);
  }
  .restauration .note { font-size: 0.75rem; color: var(--text-muted); margin: 0; }
  .restauration .mots {
    font: inherit; font-size: 0.9375rem; padding: 10px 12px; border-radius: 10px; resize: none;
    background: var(--bg-base); color: var(--text-primary); border: 1px solid var(--accent-dim);
  }
  .restauration .mots:focus { outline: none; border-color: var(--accent); }
  .restauration .erreur { font-size: 0.8125rem; color: #d64545; margin: 0; text-align: left; }
  .restauration button:disabled { opacity: .5; cursor: default; }
`
