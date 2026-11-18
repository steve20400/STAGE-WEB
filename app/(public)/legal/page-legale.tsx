import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { apiRequest } from "../../../src/lib/api-client"
import { TexteLegal } from "./texte-legal"
import "./legal.css"

/**
 * LES PAGES LÉGALES PUBLIQUES (18/11/2026, exigence du Play Store) :
 * /confidentialite et /conditions, lisibles sans compte. Le texte vient du
 * serveur (`GET /api/legal/:slug`) et se modifie depuis la console de gestion.
 */
interface Page {
  titre: string
  contenu: string
  version: number
  majLe: string | null
}

export default function PageLegale({ slug }: { slug: "confidentialite" | "conditions" }) {
  const [page, setPage] = useState<Page | null>(null)
  const [erreur, setErreur] = useState(false)
  useEffect(() => {
    let annule = false
    setPage(null)
    setErreur(false)
    apiRequest<Page>(`/api/legal/${slug}`)
      .then((p) => {
        if (!annule) setPage(p)
      })
      .catch(() => {
        if (!annule) setErreur(true)
      })
    return () => {
      annule = true
    }
  }, [slug])
  useEffect(() => {
    if (page) document.title = `${page.titre} — Alanya Work`
  }, [page])

  return (
    <main className="legal-page">
      <nav className="legal-nav">
        <Link to="/">Alanya Work</Link>
        <span>
          <Link to="/confidentialite">Confidentialité</Link> · <Link to="/conditions">Conditions</Link> ·{" "}
          <Link to="/suppression-compte">Supprimer mon compte</Link>
        </span>
      </nav>
      {erreur && <p className="legal-erreur">Cette page n'a pas pu être chargée. Réessayez dans un instant.</p>}
      {!page && !erreur && <p className="legal-attente">Chargement…</p>}
      {page && (
        <article>
          <h1>{page.titre}</h1>
          <TexteLegal contenu={page.contenu} />
          <p className="legal-date">
            {page.majLe
              ? `Mise à jour le ${new Date(page.majLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} (version ${page.version}).`
              : "Version d'origine."}
          </p>
        </article>
      )}
    </main>
  )
}
