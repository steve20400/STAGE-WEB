import { useLayoutEffect, useRef, useState } from "react"

import { useTranslation } from "../../../src/i18n"
import { ApiError, apiRequest } from "../../../src/lib/api-client"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"
import { empreinteEnBlocs, empreintePourServeur, saisirEmpreinte } from "../../../src/lib/empreinte"
import "./empreinte-panneau.css"

/**
 * VÉRIFIER UNE EMPREINTE NUMÉRIQUE, DANS LES RÉGLAGES (24/10/2026, demande du
 * user) — pendant web de `empreinte_screen.dart`.
 *
 * Toute copie d'un document sensible sortie d'Alanya porte une empreinte de
 * 32 caractères, aux bords du document et dans ses propriétés. Saisie ici,
 * elle dit qui a fait sortir la copie, quand, depuis quel appareil, et qui
 * avait envoyé le document. Tout compte peut chercher (décision du user) ; le
 * serveur ne renvoie jamais l'adresse IP.
 *
 * La saisie se fait en blocs de quatre, en chasse fixe, comme sur le document :
 * chaque frappe ou collage est remis en forme, et le curseur reste derrière le
 * même caractère.
 */

interface Personne {
  alanyaId: string
  nom: string | null
}

interface Resultat {
  empreinte: string
  geste: string
  date: string
  appareil: string | null
  utilisateur: Personne | null
  expediteur: Personne | null
}

export function EmpreintePanneau() {
  const { t } = useTranslation()
  const champ = useRef<HTMLInputElement>(null)
  const [valeur, setValeur] = useState("")
  const curseur = useRef<number | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [resultat, setResultat] = useState<Resultat | null>(null)

  // Le curseur, replacé après la remise en blocs.
  useLayoutEffect(() => {
    if (curseur.current !== null && champ.current) {
      champ.current.setSelectionRange(curseur.current, curseur.current)
      curseur.current = null
    }
  }, [valeur])

  const changer = (texte: string, position: number) => {
    const r = saisirEmpreinte(texte, position)
    curseur.current = r.curseur
    setValeur(r.texte)
    setErreur(null)
  }

  const rechercher = async () => {
    const code = empreintePourServeur(valeur)
    if (!code) {
      setErreur(t("emp_invalide"))
      setResultat(null)
      return
    }
    setEnCours(true)
    setErreur(null)
    setResultat(null)
    try {
      setResultat(await apiRequest<Resultat>(`/api/documents-sensibles/empreintes/${code}`))
    } catch (e) {
      const statut = e instanceof ApiError ? e.status : 0
      setErreur(t(statut === 404 ? "emp_inconnue" : statut === 422 ? "emp_invalide" : "emp_echec"))
    } finally {
      setEnCours(false)
    }
  }

  const geste = (g: string) =>
    g === "TELECHARGEMENT"
      ? t("emp_g_telechargement")
      : g === "PARTAGE"
        ? t("emp_g_partage")
        : g === "TRANSFERT"
          ? t("emp_g_transfert")
          : g

  const personne = (p: Personne | null) => {
    if (!p) return t("emp_inconnu")
    const id = `Alanya ${formatAlanyaNumber(p.alanyaId)}`
    return p.nom?.trim() ? `${id} · ${p.nom.trim()}` : id
  }

  const date = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return "—"
    const deux = (n: number) => String(n).padStart(2, "0")
    return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} ${deux(d.getHours())}:${deux(d.getMinutes())}`
  }

  return (
    <div className="s-card">
      <div className="s-card-title">{t("emp_titre")}</div>
      <p className="emp-aide">{t("emp_aide")}</p>
      <form
        className="emp-saisie"
        onSubmit={(e) => {
          e.preventDefault()
          void rechercher()
        }}
      >
        <label className="emp-libelle" htmlFor="emp-champ">
          {t("emp_champ")}
        </label>
        <input
          id="emp-champ"
          ref={champ}
          className={`emp-champ${erreur ? " erreur" : ""}`}
          value={valeur}
          onChange={(e) => changer(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          placeholder="XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          aria-invalid={Boolean(erreur)}
          aria-describedby={erreur ? "emp-erreur" : undefined}
        />
        {erreur && (
          <p id="emp-erreur" className="emp-erreur" role="alert">
            {erreur}
          </p>
        )}
        <button type="submit" className="btn-save emp-bouton" disabled={enCours}>
          {enCours ? "…" : t("emp_rechercher")}
        </button>
      </form>

      {resultat && (
        <dl className="emp-resultat" aria-live="polite">
          <div className="emp-resultat-titre">{t("emp_resultat")}</div>
          <dt>{t("emp_champ")}</dt>
          <dd className="emp-blocs">{empreinteEnBlocs(resultat.empreinte)}</dd>
          <dt>{t("emp_par")}</dt>
          <dd>{personne(resultat.utilisateur)}</dd>
          <dt>{t("emp_geste")}</dt>
          <dd>{geste(resultat.geste)}</dd>
          <dt>{t("emp_date")}</dt>
          <dd>{date(resultat.date)}</dd>
          <dt>{t("emp_appareil")}</dt>
          <dd>{resultat.appareil ?? t("emp_inconnu")}</dd>
          <dt>{t("emp_expediteur")}</dt>
          <dd>{personne(resultat.expediteur)}</dd>
        </dl>
      )}
    </div>
  )
}
