import type { ReactNode } from "react"

import { analyseMiseEnForme, type NoeudTexte } from "../lib/mise-en-forme"

/**
 * Affiche un texte avec sa mise en forme (gras, italique, barré, souligné,
 * manuscrit) — pendant web de `spansWhatsApp` du mobile.
 *
 * `feuille` permet à l'appelant de transformer les morceaux de texte nu (liens
 * cliquables, par exemple) sans perdre le style qui les entoure.
 *
 * ⚠️ DES `<span>` ET NON `<strong>`/`<em>` : le gras d'un message n'est pas
 * une emphase au sens du document, et le lecteur d'écran n'a pas à changer de
 * voix pour un astérisque tapé par habitude.
 */
export function TexteForme({
  texte,
  feuille,
}: {
  texte: string
  feuille?: (morceau: string, cle: string) => ReactNode
}) {
  return <>{rendre(analyseMiseEnForme(texte), feuille, "f")}</>
}

function rendre(
  noeuds: NoeudTexte[],
  feuille: ((morceau: string, cle: string) => ReactNode) | undefined,
  prefixe: string,
): ReactNode[] {
  return noeuds.map((n, i) => {
    const cle = `${prefixe}${i}`
    if ("texte" in n) return feuille ? feuille(n.texte, cle) : n.texte
    return (
      <span key={cle} className={`mf-${n.style}`}>
        {rendre(n.enfants, feuille, `${cle}-`)}
      </span>
    )
  })
}
