import { useNavigate } from "react-router-dom"
import type { BoutonMessage } from "../../../../src/mocks/chat-data"

/**
 * LES BOUTONS D'UN MESSAGE OFFICIEL (24/10/2026) — jumeau de `bulle_boutons.dart`.
 *
 * Le bloc « Boutons » de la bienvenue de la console : un lien, ou un écran
 * (`profile`, `statuses`, `help`, ceux de la console d'Alanya2026). Ils
 * REMPLACENT le texte du message, qui ne dit la même chose en clair (« Libellé :
 * lien ») que pour les clients qui ignorent les boutons.
 *
 * L'aide n'ayant pas d'écran chez nous, elle ouvre les Paramètres.
 */
const ECRANS: Record<string, string> = {
  profile: "/settings?section=profile",
  statuses: "/status",
  help: "/settings",
}

/** Un lien ne s'ouvre qu'en http(s) : un autre schéma n'a rien à faire ici. */
function lienSur(cible: string): string | null {
  try {
    const u = new URL(cible)
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null
  } catch {
    return null
  }
}

const styleBouton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #B85C38",
  background: "transparent",
  color: "#B85C38",
  fontWeight: 600,
  fontSize: "0.92em",
  cursor: "pointer",
  textDecoration: "none",
}

export function BoutonsMessage({ boutons }: { boutons: BoutonMessage[] }) {
  const navigate = useNavigate()
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 200, marginBottom: 2 }}>
      {boutons.map((b, i) => {
        if (b.action === "url") {
          const lien = lienSur(b.target)
          if (!lien) return null
          return (
            <a key={i} href={lien} target="_blank" rel="noopener noreferrer" style={styleBouton}>
              {b.label} <span aria-hidden="true">↗</span>
            </a>
          )
        }
        const chemin = ECRANS[b.target]
        if (!chemin) return null
        return (
          <button key={i} type="button" style={styleBouton} onClick={() => navigate(chemin)}>
            {b.label} <span aria-hidden="true">→</span>
          </button>
        )
      })}
    </div>
  )
}
