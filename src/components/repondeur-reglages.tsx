import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "../i18n"
import { useToast } from "./toast"
import {
  ACCUEIL_MAX_MS,
  ACCUEIL_MAX_OCTETS,
  activerRepondeur,
  lireMonRepondeur,
  poserAccueil,
  refusAccueil,
  retirerAccueil,
  type AccueilRepondeur,
} from "../services/repondeur-service"
import { resolveMediaUrl } from "../services/media-service"

/**
 * LA SECTION « RÉPONDEUR » DES RÉGLAGES.
 *
 * Un composant à part, et non quelques lignes de plus dans `settings.tsx` : ce
 * fichier frôle déjà les quatre mille lignes, et cette section porte un
 * enregistreur complet — micro, minuteur, niveau sonore, réécoute, reprise.
 *
 * ⚠️ TROIS CHEMINS MÈNENT AU MÊME ACCUEIL : l'enregistrer, l'importer, ou n'en
 * avoir aucun. L'écran doit dire lequel est en cours sans qu'on ait à cliquer
 * pour le découvrir.
 */

type Phase =
  | { nom: "repos" }
  | { nom: "enregistre"; depuis: number }
  | { nom: "relit"; blob: Blob; dureeMs: number }

export function RepondeurReglages() {
  const { t } = useTranslation()
  const { success, error } = useToast()

  const [actif, setActif] = useState(false)
  const [accueil, setAccueil] = useState<AccueilRepondeur | null>(null)
  const [phase, setPhase] = useState<Phase>({ nom: "repos" })
  const [secondes, setSecondes] = useState(0)
  const [occupe, setOccupe] = useState(false)

  const enregistreur = useRef<MediaRecorder | null>(null)
  const morceaux = useRef<Blob[]>([])
  const flux = useRef<MediaStream | null>(null)
  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null)
  const champFichier = useRef<HTMLInputElement>(null)
  const apercuUrl = useRef<string | null>(null)

  useEffect(() => {
    void lireMonRepondeur()
      .then((etat) => {
        setActif(etat.actif)
        setAccueil(etat.accueil)
      })
      .catch(() => undefined)
  }, [])

  /**
   * Coupe tout : minuteur, enregistreur, et SURTOUT le micro.
   *
   * 🔴 SANS `stop()` SUR CHAQUE PISTE, LE VOYANT DU MICRO RESTE ALLUMÉ. Le
   * navigateur garde l'accès ouvert tant qu'une piste vit, même l'enregistreur
   * arrêté : l'utilisateur voit son micro actif sur une page de réglages, ce qui
   * est au mieux inquiétant.
   */
  const toutArreter = useCallback(() => {
    if (minuteur.current) {
      clearInterval(minuteur.current)
      minuteur.current = null
    }
    try {
      enregistreur.current?.stop()
    } catch {
      /* déjà arrêté */
    }
    enregistreur.current = null
    flux.current?.getTracks().forEach((piste) => piste.stop())
    flux.current = null
  }, [])

  // Quitter la page pendant un enregistrement ne doit pas laisser le micro
  // ouvert derrière soi.
  useEffect(() => toutArreter, [toutArreter])

  useEffect(() => {
    return () => {
      if (apercuUrl.current) URL.revokeObjectURL(apercuUrl.current)
    }
  }, [])

  const demarrer = async () => {
    if (occupe) return
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      flux.current = media
      morceaux.current = []
      const rec = new MediaRecorder(media)
      rec.ondataavailable = (evenement) => {
        if (evenement.data.size > 0) morceaux.current.push(evenement.data)
      }
      rec.onstop = () => {
        const blob = new Blob(morceaux.current, { type: rec.mimeType || "audio/webm" })
        const duree = Math.min(secondes * 1000, ACCUEIL_MAX_MS)
        if (apercuUrl.current) URL.revokeObjectURL(apercuUrl.current)
        apercuUrl.current = URL.createObjectURL(blob)
        setPhase({ nom: "relit", blob, dureeMs: duree })
      }
      rec.start()
      enregistreur.current = rec
      setSecondes(0)
      setPhase({ nom: "enregistre", depuis: Date.now() })

      minuteur.current = setInterval(() => {
        setSecondes((valeur) => {
          const suivant = valeur + 1
          /*
           * ⚠️ LA COUPE AUTOMATIQUE EST DANS LE MINUTEUR, pas dans un contrôle à
           * l'envoi. Laisser enregistrer dix minutes pour refuser ensuite ferait
           * perdre dix minutes de parole — et le refus arriverait au pire
           * moment, quand on croit avoir fini.
           */
          if (suivant * 1000 >= ACCUEIL_MAX_MS) {
            arreter()
            return Math.floor(ACCUEIL_MAX_MS / 1000)
          }
          return suivant
        })
      }, 1000)
    } catch {
      error(t("rep_micro_refuse"))
    }
  }

  const arreter = () => {
    if (minuteur.current) {
      clearInterval(minuteur.current)
      minuteur.current = null
    }
    try {
      enregistreur.current?.stop()
    } catch {
      /* déjà arrêté */
    }
    flux.current?.getTracks().forEach((piste) => piste.stop())
    flux.current = null
  }

  const valider = async () => {
    if (phase.nom !== "relit" || occupe) return
    setOccupe(true)
    try {
      const etat = await poserAccueil(phase.blob, `accueil-${Date.now()}.webm`, phase.dureeMs)
      setActif(etat.actif)
      setAccueil(etat.accueil)
      setPhase({ nom: "repos" })
      setSecondes(0)
      success(t("rep_enregistre"))
    } catch {
      error(t("rep_echec"))
    } finally {
      setOccupe(false)
    }
  }

  const importer = async (fichier: File | undefined) => {
    if (!fichier || occupe) return
    const refus = refusAccueil(fichier)
    if (refus === "format") {
      error(t("rep_mauvais_format"))
    } else if (refus === "taille") {
      error(t("rep_trop_lourd", { n: String(ACCUEIL_MAX_OCTETS / 1024 / 1024) }))
    }
    if (refus) {
      if (champFichier.current) champFichier.current.value = ""
      return
    }
    setOccupe(true)
    try {
      const etat = await poserAccueil(fichier, fichier.name)
      setActif(etat.actif)
      setAccueil(etat.accueil)
      success(t("rep_enregistre"))
    } catch {
      error(t("rep_echec"))
    } finally {
      setOccupe(false)
      // Sans remise à zéro, réimporter le MÊME fichier n'émet aucun événement.
      if (champFichier.current) champFichier.current.value = ""
    }
  }

  const supprimer = async () => {
    if (occupe) return
    setOccupe(true)
    try {
      await retirerAccueil()
      setAccueil(null)
      setActif(false)
    } catch {
      error(t("rep_echec"))
    } finally {
      setOccupe(false)
    }
  }

  const basculer = async (valeur: boolean) => {
    // L'interrupteur bascule sous le doigt ; le serveur corrige s'il refuse.
    setActif(valeur)
    try {
      const etat = await activerRepondeur(valeur)
      setActif(etat.actif)
    } catch {
      setActif(!valeur)
      error(t("rep_echec"))
    }
  }

  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

  return (
    <div className="s-card">
      {/* Les styles vivent ici plutot que dans une feuille globale : cette
          section est la seule a s'en servir, et `settings.tsx` porte deja les
          siens de la meme facon. Calques sur `ringtone-import-btn`, pour que les
          deux cartes voisines ne paraissent pas venir de deux applications. */}
      <style>{`
        .rep-btn {
          padding: 10px 16px; border-radius: 9px; cursor: pointer;
          border: 1px solid var(--accent); background: var(--accent);
          color: var(--accent-text); font-family: 'DM Sans', sans-serif;
          font-size: 12.5px; font-weight: 600;
        }
        .rep-btn:disabled { cursor: progress; opacity: 0.6; }
        .rep-btn-ghost {
          border: 1px dashed var(--border-default); background: var(--bg-elevated);
          color: var(--text-secondary);
        }
        .rep-btn-ghost:hover:not(:disabled) {
          color: var(--accent); border-color: var(--accent-border);
        }
        /* Sur un telephone, les boutons prennent la ligne entiere plutot que de
           se serrer a deux ou trois par rangee, ou aucun n'est atteignable au
           pouce. */
        @media (max-width: 520px) {
          .rep-btn { flex: 1 1 100%; }
        }
      `}</style>
      <div className="s-card-title">{t("rep_titre")}</div>
      <div className="s-hint" style={{ marginTop: 0, marginBottom: 14 }}>
        {t("rep_sub")}
      </div>

      <div className="notif-row" style={{ marginBottom: 14 }}>
        <span className="notif-label">{t("rep_activer")}</span>
        <button
          className="tgl"
          role="switch"
          aria-checked={actif}
          // ⚠️ INACTIVABLE SANS ACCUEIL : allumer un répondeur muet promettrait
          // à ses correspondants un message qu'ils n'entendraient jamais.
          disabled={!accueil}
          style={{
            background: actif ? "var(--accent)" : "var(--border-default)",
            opacity: accueil ? 1 : 0.5,
            cursor: accueil ? "pointer" : "not-allowed",
          }}
          onClick={() => void basculer(!actif)}
        >
          <div
            className="tgl-knob"
            style={{
              left: actif ? "20px" : "2.5px",
              background: actif ? "var(--accent-text)" : "var(--text-muted)",
            }}
          />
        </button>
      </div>

      {/* ── L'accueil en place ───────────────────────────────────────────── */}
      {phase.nom === "repos" && (
        <div style={{ display: "grid", gap: 10 }}>
          {accueil ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <audio
                controls
                preload="none"
                src={resolveMediaUrl(accueil.url)}
                style={{ flex: "1 1 220px", minWidth: 0, height: 36 }}
              />
              <button className="rep-btn rep-btn-ghost" onClick={() => void supprimer()} disabled={occupe}>
                {t("rep_supprimer")}
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("rep_aucun")}</div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="rep-btn" onClick={() => void demarrer()} disabled={occupe}>
              ● {t("rep_enregistrer")}
            </button>
            <input
              ref={champFichier}
              type="file"
              accept="audio/*"
              hidden
              onChange={(evenement) => void importer(evenement.target.files?.[0])}
            />
            <button
              className="rep-btn rep-btn-ghost"
              onClick={() => champFichier.current?.click()}
              disabled={occupe}
            >
              {t("rep_importer")}
            </button>
          </div>
        </div>
      )}

      {/* ── En cours d'enregistrement ────────────────────────────────────── */}
      {phase.nom === "enregistre" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "var(--danger)",
              flexShrink: 0,
            }}
          />
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 15 }}>
            {mmss(secondes)}
          </span>
          {/* Le reste du temps disponible, pour qu'on sache où l'on va plutôt
              que d'être coupé sans prévenir. */}
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            / {mmss(Math.floor(ACCUEIL_MAX_MS / 1000))}
          </span>
          <button className="rep-btn" onClick={arreter}>
            ■ {t("rep_arreter")}
          </button>
        </div>
      )}

      {/* ── Réécoute avant de valider ────────────────────────────────────── */}
      {phase.nom === "relit" && (
        <div style={{ display: "grid", gap: 10 }}>
          <audio
            controls
            src={apercuUrl.current ?? undefined}
            style={{ width: "100%", height: 36 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="rep-btn" onClick={() => void valider()} disabled={occupe}>
              {t("rep_valider")}
            </button>
            <button
              className="rep-btn rep-btn-ghost"
              onClick={() => {
                setPhase({ nom: "repos" })
                setSecondes(0)
              }}
              disabled={occupe}
            >
              {t("rep_refaire")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
