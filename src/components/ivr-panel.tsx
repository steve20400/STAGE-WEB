import { sendIvrChoice, type IvrOption, type IvrSession } from "../services/call-manager"

/**
 * Menu d'un standard telephonique, affiche DANS l'ecran d'appel.
 *
 * ```
 * menu ──(appui)──► envoi ──(ivr_hold)──► attente ──(decrochage)──► appel
 *   ▲                 │
 *   └──(erreur avec retour possible)──┘
 * ```
 *
 * L'etat « appel » n'apparait pas ici : quand l'agent decroche, la session
 * disparait du gestionnaire d'appels et ce panneau avec elle. L'ecran qui le
 * portait etait deja affiche — il n'y a rien a ouvrir, rien a preparer.
 *
 * Styles en ligne, sur les variables de theme deja utilisees par l'ecran
 * d'appel : le panneau vit le temps d'un menu, il ne merite pas d'entree
 * permanente dans la feuille de styles.
 */
export function IvrPanel({ session }: { session: IvrSession }) {
  if (session.step === "attente") return <IvrAttente session={session} />

  return (
    <div style={{ width: "100%", maxWidth: 420, margin: "18px auto 0" }}>
      {session.message && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 14,
            borderRadius: 12,
            background: "color-mix(in srgb, var(--danger) 14%, transparent)",
            color: "var(--danger)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {session.message}
        </div>
      )}

      {session.options.length === 0 ? (
        <div style={{ opacity: 0.7, fontSize: 14, textAlign: "center" }}>
          Aucun service disponible.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {session.options.map((option) => (
            <IvrTouche key={option.digit} option={option} verrouille={session.envoiEnCours} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6, textAlign: "center" }}>
        {session.envoiEnCours ? "Envoi de votre choix…" : "Choisissez un service"}
      </div>
    </div>
  )
}

/**
 * Une touche du menu.
 *
 * Une option indisponible reste CLIQUABLE, et c'est delibere : l'invite vocale
 * vient de l'annoncer, la desactiver laisserait l'appelant sans explication. Le
 * serveur, lui, repond precisement pourquoi — et c'est lui qui fait autorite,
 * pas ce qu'on devinerait ici.
 */
function IvrTouche({ option, verrouille }: { option: IvrOption; verrouille: boolean }) {
  const grise = !option.disponible
  return (
    <button
      type="button"
      // Verrouille pendant l'envoi : sur un reseau lent l'utilisateur insiste, et
      // deux appuis feraient sonner deux agents pour une seule intention.
      disabled={verrouille}
      onClick={() => sendIvrChoice(option.digit)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        padding: "12px 14px",
        borderRadius: 14,
        border: "none",
        textAlign: "left",
        cursor: verrouille ? "default" : "pointer",
        background: "color-mix(in srgb, var(--text) 10%, transparent)",
        color: "inherit",
        opacity: grise ? 0.55 : 1,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          borderRadius: "50%",
          flex: "0 0 auto",
          fontSize: 18,
          fontWeight: 700,
          color: "#fff",
          background: grise ? "color-mix(in srgb, var(--text) 25%, transparent)" : "var(--accent)",
        }}
      >
        {option.digit}
      </span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span style={{ fontSize: 15 }}>{option.label}</span>
        {grise && <span style={{ fontSize: 11, opacity: 0.7 }}>Bientôt disponible</span>}
      </span>
    </button>
  )
}

function IvrAttente({ session }: { session: IvrSession }) {
  return (
    <div style={{ marginTop: 18, textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>
        {session.serviceChoisi ?? "Mise en relation"}
      </div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.65 }}>
        Nous vous mettons en relation. Merci de patienter.
      </div>
    </div>
  )
}
