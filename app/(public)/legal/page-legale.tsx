import { useEffect, useState } from "react"
import { EnTetePublic, PiedPublic } from "../../../src/components/cadre-public"
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
    <div className="alanya-root">
      {/*
        🔴 LES PAGES LÉGALES PORTENT LE MÊME CADRE QUE L'ACCUEIL (demande du
        user, 25/11/2026) : « quand on clique sur ces boutons, ça devait
        respecter le design de notre application ; il n'y a pas de header ni de
        logo ». Elles avaient leur propre barre de liens, sans logo, sans
        traduction et sans rapport avec le reste.

        ⚠️ ON RÉUTILISE `EnTetePublic` ET `PiedPublic` plutôt que de recopier
        leur allure : c'est la barre commune des pages publiques depuis le
        20/11, et les liens légaux du pied y sont déjà traduits dans les neuf
        langues — ceux d'ici étaient écrits en français dans le code.
      */}
      <EnTetePublic action="connexion" />
      <main className="legal-page">
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
      <PiedPublic />
    </div>
  )
}
