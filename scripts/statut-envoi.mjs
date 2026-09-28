/**
 * L'ÉTAT D'UN MESSAGE ENVOYÉ NE REDESCEND JAMAIS — `src/lib/statut-envoi.ts`.
 *
 * Usage : node scripts/statut-envoi.mjs   (Node 24 lit le TypeScript)
 */
import { statutFusionne } from "../src/lib/statut-envoi.ts"

let echecs = 0
const cas = [
  ["« lu » pendant l'envoi, puis « envoyé » : reste lu", "read", "sent", "read"],
  ["« distribué » n'est pas effacé par « envoyé »", "delivered", "sent", "delivered"],
  ["en cours → envoyé", "sending", "sent", "sent"],
  ["le serveur sait plus : il gagne", "sending", "delivered", "delivered"],
  ["distribué → lu", "delivered", "read", "read"],
]
for (const [libelle, affiche, recu, attendu] of cas) {
  const obtenu = statutFusionne(affiche, recu)
  const ok = obtenu === attendu
  if (!ok) echecs++
  console.log(`  ${ok ? "✓" : "✗"} ${libelle}${ok ? "" : ` (obtenu ${obtenu})`}`)
}
console.log(echecs === 0 ? "Tout passe." : `${echecs} échec(s).`)
process.exit(echecs === 0 ? 0 : 1)
