import { useCallback, useEffect, useRef, useState } from "react"
import { sendIvrChoice, type IvrSession } from "../services/call-manager"
import { useTranslation } from "../i18n"

/** Delai au-dela duquel un appui devient un appui MAINTENU (revelation). */
const DELAI_APPUI_LONG_MS = 450

/**
 * Pave numerique d'un standard telephonique, affiche DANS l'ecran d'appel.
 *
 * ```
 * menu ──(appui)──► envoi ──(ivr_hold)──► attente ──(decrochage)──► appel
 *   ▲                 │
 *   └──(erreur avec retour possible)──┘
 * ```
 *
 * ⚠️ POURQUOI UN PAVE ET NON LA LISTE DES SERVICES.
 *
 * La premiere version affichait les options en liste. C'etait plus lisible,
 * mais cela liait la FORME de l'ecran au CONTENU du menu : un standard a
 * sous-menus, une invite demandant un numero de dossier, ou simplement un menu
 * plus long auraient demande de retoucher le client a chaque evolution d'un
 * vocal. Un pave numerique ne depend de rien : dix touches, quel que soit le
 * standard appele.
 *
 * Le libelle n'est pas perdu : **maintenir une touche l'affiche**, juste
 * au-dessus du pave. Miroir exact du client mobile.
 */
export function IvrPanel({ session }: { session: IvrSession }) {
  const { t } = useTranslation()
  const [maintenue, setMaintenue] = useState<number | null>(null)
  const minuteur = useRef<number | null>(null)
  /** L'appui a-t-il DEJA revele ? Si oui, le relachement n'envoie pas. */
  const aRevele = useRef(false)

  // Un composant demonte pendant un appui laisserait son minuteur courir et
  // appellerait `setMaintenue` sur un composant disparu.
  useEffect(() => {
    return () => {
      if (minuteur.current !== null) window.clearTimeout(minuteur.current)
    }
  }, [])

  const optionPour = useCallback(
    (digit: number) => session.options.find((o) => o.digit === digit) ?? null,
    [session.options]
  )

  const arreteMinuteur = () => {
    if (minuteur.current !== null) {
      window.clearTimeout(minuteur.current)
      minuteur.current = null
    }
  }

  const debutAppui = (digit: number) => {
    aRevele.current = false
    arreteMinuteur()
    minuteur.current = window.setTimeout(() => {
      aRevele.current = true
      setMaintenue(digit)
    }, DELAI_APPUI_LONG_MS)
  }

  /** Relachement SUR la touche : c'est le seul cas qui envoie. */
  const finAppui = (digit: number) => {
    arreteMinuteur()
    setMaintenue(null)
    // L'appui long REVELE, il n'envoie pas — sinon consulter un libelle
    // declencherait l'appel d'un agent.
    if (!aRevele.current && !session.envoiEnCours) sendIvrChoice(digit)
    aRevele.current = false
  }

  /** Doigt ou souris parti ailleurs : on annule, sans rien envoyer. */
  const annuleAppui = () => {
    arreteMinuteur()
    setMaintenue(null)
    aRevele.current = false
  }

  if (session.step === "attente") return <IvrAttente session={session} />

  const optionRevelee = maintenue === null ? null : optionPour(maintenue)
  let titre: string | null = null
  let sous: string | null = null
  if (maintenue !== null) {
    if (!optionRevelee) titre = t("ivr_no_service")
    else {
      // `nom_service` d'abord, `libelle` en repli — meme regle que le mobile,
      // posee par le user le 12/08/2026. Deux clients qui n'afficheraient pas le
      // meme nom pour la meme touche, c'est le genre de divergence qui ne se
      // signale jamais toute seule.
      titre = optionRevelee.nomService ?? optionRevelee.label
      if (!optionRevelee.disponible) sous = t("ivr_soon")
    }
  }

  return (
    <div style={{ width: "100%", maxWidth: 320, margin: "16px auto 0" }}>
      {session.message && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            borderRadius: 12,
            background: "color-mix(in srgb, var(--danger) 14%, transparent)",
            // ⚠️ Texte en BLANC (15/08/2026) : `var(--danger)` sur son propre
            // fond teinté à 14% était illisible (rouge sur rouge). Le fond
            // reste inchangé — seul le texte change.
            color: "#fff",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {session.message}
        </div>
      )}

      {/* Hauteur FIXE : sans elle, le pave sauterait a chaque appui maintenu et
          la touche glisserait sous le doigt. */}
      <div
        style={{
          height: 46,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: titre ? 1 : 0,
          transition: "opacity 120ms",
        }}
      >
        {titre && (
          <div
            style={{
              padding: "6px 16px",
              borderRadius: 20,
              textAlign: "center",
              background: "color-mix(in srgb, var(--text) 14%, transparent)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{titre}</div>
            {sous && <div style={{ fontSize: 11, opacity: 0.65 }}>{sous}</div>}
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
          marginTop: 8,
        }}
      >
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <IvrTouche
            key={d}
            digit={d}
            option={optionPour(d)}
            maintenue={maintenue === d}
            verrouille={session.envoiEnCours}
            onDebut={debutAppui}
            onFin={finAppui}
            onAnnule={annuleAppui}
          />
        ))}
        <span />
        <IvrTouche
          digit={0}
          option={optionPour(0)}
          maintenue={maintenue === 0}
          verrouille={session.envoiEnCours}
          onDebut={debutAppui}
          onFin={finAppui}
          onAnnule={annuleAppui}
        />
        <span />
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6, textAlign: "center" }}>
        {session.envoiEnCours ? t("ivr_sending") : t("ivr_hold_hint")}
      </div>
    </div>
  )
}

function IvrTouche({
  digit,
  option,
  maintenue,
  verrouille,
  onDebut,
  onFin,
  onAnnule,
}: {
  digit: number
  option: { disponible: boolean } | null
  maintenue: boolean
  verrouille: boolean
  onDebut: (digit: number) => void
  onFin: (digit: number) => void
  onAnnule: () => void
}) {
  return (
    <button
      type="button"
      onPointerDown={() => onDebut(digit)}
      onPointerUp={() => onFin(digit)}
      onPointerLeave={onAnnule}
      onPointerCancel={onAnnule}
      // Sur mobile, un appui maintenu ouvre le menu contextuel du navigateur et
      // selectionne le texte : les deux passeraient par-dessus la revelation.
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "relative",
        aspectRatio: "1.7",
        // Repère des touches qui menent quelque part (15/08/2026) : un anneau
        // AUTOUR du bouton plutôt qu'un point en bas — remplace l'ancien
        // indicateur, demandé plus visible. Toujours discret : il ne dit pas
        // QUOI, l'appui maintenu le dit toujours.
        border: option
          ? `2px solid ${
              option.disponible ? "var(--accent)" : "color-mix(in srgb, var(--text) 35%, transparent)"
            }`
          : "none",
        borderRadius: 16,
        cursor: verrouille ? "default" : "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "manipulation",
        fontSize: 24,
        fontWeight: 600,
        color: verrouille ? "color-mix(in srgb, var(--text) 40%, transparent)" : "inherit",
        background: `color-mix(in srgb, var(--text) ${maintenue ? 26 : 12}%, transparent)`,
        transition: "background 120ms",
      }}
    >
      {digit}
    </button>
  )
}

function IvrAttente({ session }: { session: IvrSession }) {
  const { t } = useTranslation()
  return (
    <div style={{ marginTop: 18, textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>
        {session.serviceChoisi ?? t("ivr_connecting")}
      </div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.65 }}>{t("ivr_connecting_you")}</div>
    </div>
  )
}
