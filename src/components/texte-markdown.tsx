import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import "./texte-markdown.css"

/**
 * LA REPONSE DE L'ASSISTANT, MISE EN FORME (01/11/2026) — jumeau web de
 * `gpt_markdown` sur le mobile : titres, listes, gras, code, tableaux, liens,
 * et formules (`$…$`, `$$…$$`).
 *
 * ⚠️ AUCUN HTML BRUT : `react-markdown` echappe le HTML present dans le texte
 * (pas de `rehype-raw`). Une reponse de modele n'est pas une source sure.
 *
 * Charge A LA DEMANDE par l'ecran de l'assistant (`lazy`) : KaTeX et ses
 * polices n'alourdissent pas le reste de l'application.
 */
export default function TexteMarkdown({ texte }: { texte: string }) {
  return (
    <div className="md-ia">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Un lien s'ouvre a cote, sans transmettre l'adresse de la page.
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {texte}
      </ReactMarkdown>
    </div>
  )
}
