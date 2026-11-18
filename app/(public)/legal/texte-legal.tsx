import { Fragment, type ReactNode } from "react"

/**
 * Le Markdown SIMPLE des pages légales (18/11/2026) : `## titre`, `- liste`,
 * `**gras**`, paragraphes séparés par une ligne vide, adresses web cliquables.
 *
 * ⚠️ AUCUN HTML N'EST INTERPRÉTÉ : le texte vient de la console, il est rendu
 * comme du texte. Un `<script>` collé par erreur s'affiche, il ne s'exécute pas.
 */
function enLigne(texte: string): ReactNode[] {
  const morceaux: ReactNode[] = []
  const motif = /(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g
  let dernier = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = motif.exec(texte))) {
    if (m.index > dernier) morceaux.push(texte.slice(dernier, m.index))
    const t = m[0]
    if (t.startsWith("**")) {
      morceaux.push(<strong key={i++}>{t.slice(2, -2)}</strong>)
    } else {
      morceaux.push(
        <a key={i++} href={t} rel="noreferrer">
          {t}
        </a>,
      )
    }
    dernier = m.index + t.length
  }
  if (dernier < texte.length) morceaux.push(texte.slice(dernier))
  return morceaux
}

export function TexteLegal({ contenu }: { contenu: string }) {
  const blocs = contenu.replace(/\r\n/g, "\n").split(/\n\s*\n/)
  return (
    <>
      {blocs.map((bloc, b) => {
        const lignes = bloc.split("\n").filter((l) => l.trim() !== "")
        if (lignes.length === 0) return null
        if (lignes.length === 1 && lignes[0].startsWith("## ")) {
          return <h2 key={b}>{enLigne(lignes[0].slice(3))}</h2>
        }
        if (lignes.every((l) => /^\s*-\s+/.test(l))) {
          return (
            <ul key={b}>
              {lignes.map((l, j) => (
                <li key={j}>{enLigne(l.replace(/^\s*-\s+/, ""))}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={b}>
            {lignes.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {enLigne(l)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}
