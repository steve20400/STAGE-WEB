import { useCallback, useEffect, useState } from "react"

import { useToast } from "../../../src/components/toast"
import { useTranslation } from "../../../src/i18n"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"
import { startOutgoingCall } from "../../../src/services/call-manager"
import { createPrivateChat } from "../../../src/services/chats-service"
import {
  chercherEntreprises,
  entreprisesDuType,
  estVocal,
  ficheEntreprise,
  listerTypes,
  type CentreEntreprise,
  type Entreprise,
  type FicheEntreprise,
  type TypeEntreprise,
} from "../../../src/services/entreprises-service"

/**
 * ANNUAIRE DES ENTREPRISES — pendant web de l'onglet mobile.
 *
 * Quatre niveaux, plus un raccourci :
 *   1. les types d'entreprise, avec leur effectif dans mon pays ;
 *   2. les entreprises d'un type ;
 *   3. la fiche : sa description, puis deux entrées — centres d'appel, centres
 *      vocaux ;
 *   4. les centres d'un genre, avec le numéro à composer.
 *   +  une RECHERCHE qui traverse tout.
 *
 * 🔴 LA RECHERCHE IGNORE LE FILTRE PAR PAYS, et ce n'est pas une incohérence.
 * La navigation par type ne montre que les entreprises de mon pays ; celles dont
 * le pays n'est pas renseigné ne sont donc atteignables QUE par la recherche.
 * Lui ajouter le filtre « pour être cohérent » les rendrait introuvables.
 *
 * 🔴 LA DESCRIPTION D'ABORD, LES CENTRES ENSUITE (demande du user, 26/08/2026).
 * On ouvre une entreprise pour savoir ce qu'elle fait ; on choisit ensuite le
 * genre de standard. Les deux entrées s'affichent MÊME VIDES, avec leur
 * explication et un mot disant que ce n'est pas encore disponible : une entrée
 * absente laisserait croire que le genre n'existe pas.
 *
 * ⚠️ LES QUATRE NIVEAUX VIVENT DANS UNE SEULE PAGE, avec un état, plutôt que
 * dans quatre routes. Revenir en arrière retrouve la liste déjà chargée au lieu
 * de la relire au serveur pour afficher exactement la même chose. C'est le même
 * parti que la page Collègues.
 *
 * ⚠️ Aucun emoji ni sticker — règle du projet.
 */

/** Où l'on se trouve dans l'annuaire. */
type Vue =
  | { niveau: "types" }
  | { niveau: "entreprises"; type: TypeEntreprise }
  | { niveau: "recherche" }
  | { niveau: "fiche"; entreprise: Entreprise }
  | { niveau: "centres"; entreprise: Entreprise; vocal: boolean }

export default function EntreprisesPage() {
  const { t } = useTranslation()
  const { error } = useToast()

  const [vue, setVue] = useState<Vue>({ niveau: "types" })
  const [types, setTypes] = useState<TypeEntreprise[] | null>(null)
  const [liste, setListe] = useState<Entreprise[] | null>(null)
  const [fiche, setFiche] = useState<FicheEntreprise | null>(null)
  const [requete, setRequete] = useState("")
  const [echec, setEchec] = useState(false)
  const [occupe, setOccupe] = useState(false)

  const chargerTypes = useCallback(async () => {
    setEchec(false)
    try {
      setTypes(await listerTypes())
    } catch {
      setEchec(true)
    }
  }, [])

  useEffect(() => {
    void chargerTypes()
  }, [chargerTypes])

  const ouvrirType = useCallback(async (type: TypeEntreprise) => {
    setListe(null)
    setVue({ niveau: "entreprises", type })
    try {
      setListe(await entreprisesDuType(type.id))
    } catch {
      setListe([])
      setEchec(true)
    }
  }, [])

  const lancerRecherche = useCallback(async () => {
    const q = requete.trim()
    if (q === "") return
    setListe(null)
    setVue({ niveau: "recherche" })
    try {
      setListe(await chercherEntreprises(q))
    } catch {
      setListe([])
      setEchec(true)
    }
  }, [requete])

  const ouvrirFiche = useCallback(async (entreprise: Entreprise) => {
    setFiche(null)
    setVue({ niveau: "fiche", entreprise })
    try {
      setFiche(await ficheEntreprise(entreprise.id))
    } catch {
      setEchec(true)
    }
  }, [])

  /**
   * Appelle un standard par son ALANYA ID.
   *
   * ⚠️ La conversation est obtenue d'abord — c'est elle qui porte l'appel —
   * puis l'appel démarre. Même enchaînement que depuis la page Collègues : le
   * dupliquer autrement ferait diverger les deux.
   */
  const appeler = useCallback(
    async (centre: CentreEntreprise) => {
      if (occupe) return
      setOccupe(true)
      try {
        const conversation = await createPrivateChat(centre.alanyaId)
        await startOutgoingCall(conversation.id, "audio", centre.nom)
      } catch {
        error(t("core_server_unreachable"))
      } finally {
        setOccupe(false)
      }
    },
    [occupe, error, t],
  )

  // ── Rendus ─────────────────────────────────────────────────────────────
  const rendreTypes = () => {
    if (echec && types === null) {
      return (
        <p className="s-hint" style={{ padding: 16 }}>
          {t("core_server_unreachable")}
        </p>
      )
    }
    if (types === null) {
      return <p className="s-hint" style={{ padding: 16 }}>{t("loading")}</p>
    }
    if (types.length === 0) {
      return <p className="s-hint" style={{ padding: 16 }}>{t("company_no_type")}</p>
    }
    return (
      <ul style={{ listStyle: "none", margin: 0, padding: "0 16px 24px" }}>
        {types.map((ty) => (
          <li key={ty.id} style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => void ouvrirType(ty)}
              style={boutonLigne}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{ty.libelle}</span>
              <span className="s-hint" style={{ fontSize: 13 }}>
                {/* Le compte est celui de MON pays — le dire évite de croire à
                    un annuaire mondial tronqué. */}
                {ty.nbEntreprises === 0
                  ? t("company_count_none")
                  : ty.nbEntreprises === 1
                    ? t("company_count_one")
                    : t("company_count_many", { n: String(ty.nbEntreprises) })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  const rendreEntreprises = (vide: string) => {
    if (liste === null) {
      return <p className="s-hint" style={{ padding: 16 }}>{t("loading")}</p>
    }
    if (liste.length === 0) {
      return <p className="s-hint" style={{ padding: 16 }}>{vide}</p>
    }
    return (
      <ul style={{ listStyle: "none", margin: 0, padding: "0 16px 24px" }}>
        {liste.map((e) => (
          <li key={e.id} style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => void ouvrirFiche(e)}
              style={boutonLigne}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600 }}>{e.libelle}</span>
                {e.ville || e.pays ? (
                  <span className="s-hint" style={{ fontSize: 12 }}>
                    {[e.ville, e.pays].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  const rendreFiche = (entreprise: Entreprise) => {
    const centres = fiche?.centres ?? []
    const nbAppel = centres.filter((c) => !estVocal(c)).length
    const nbVocal = centres.filter((c) => estVocal(c)).length

    return (
      <div style={{ padding: "0 16px 24px" }}>
        {/* LA DESCRIPTION D'ABORD : on ouvre une entreprise pour savoir ce
            qu'elle fait, avant de choisir un standard. */}
        {entreprise.description ? (
          <p style={{ margin: "0 0 16px", lineHeight: 1.55 }}>
            {entreprise.description}
          </p>
        ) : null}
        {entreprise.adresse ? (
          <p className="s-hint" style={{ margin: "0 0 16px", fontSize: 13 }}>
            {entreprise.adresse}
          </p>
        ) : null}

        {fiche === null ? (
          <p className="s-hint">{t("loading")}</p>
        ) : (
          <>
            {/* LES DEUX ENTRÉES S'AFFICHENT MÊME VIDES : une entrée absente
                laisserait croire que le genre de standard n'existe pas. */}
            <button
              type="button"
              onClick={() =>
                setVue({ niveau: "centres", entreprise, vocal: false })
              }
              style={{ ...boutonLigne, marginBottom: 8 }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600 }}>
                  {t("company_call_centers")}
                </span>
                <span className="s-hint" style={{ fontSize: 12 }}>
                  {t("company_call_center_short")}
                </span>
              </span>
              <span className="s-hint" style={{ fontSize: 13 }}>{nbAppel}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setVue({ niveau: "centres", entreprise, vocal: true })
              }
              style={boutonLigne}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600 }}>
                  {t("company_vocal_centers")}
                </span>
                <span className="s-hint" style={{ fontSize: 12 }}>
                  {t("company_vocal_center_short")}
                </span>
              </span>
              <span className="s-hint" style={{ fontSize: 13 }}>{nbVocal}</span>
            </button>
          </>
        )}
      </div>
    )
  }

  const rendreCentres = (vocal: boolean) => {
    const centres = (fiche?.centres ?? []).filter((c) => estVocal(c) === vocal)
    return (
      <div style={{ padding: "0 16px 24px" }}>
        {/* L'EXPLICATION EN TÊTE, et elle reste même quand la liste est vide :
            c'est elle qui apprend ce qu'est un centre d'appel ou un serveur
            vocal, et cette leçon vaut aussi pour qui n'en trouve aucun. */}
        <p style={{ margin: "0 0 16px", lineHeight: 1.55 }}>
          {vocal ? t("company_vocal_center_desc") : t("company_call_center_desc")}
        </p>

        {centres.length === 0 ? (
          <p className="s-hint">{t("company_type_unavailable")}</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {centres.map((c) => (
              <li key={c.alanyaId} style={{ marginBottom: 12 }}>
                <div style={carteCentre}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{c.nom}</div>
                      {/* L'Alanya ID FORMATÉ : c'est le numéro qu'on compose,
                          et c'est sous cette forme qu'il se lit et se recopie. */}
                      <div className="s-hint" style={{ fontSize: 13 }}>
                        {formatAlanyaNumber(c.alanyaId)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void appeler(c)}
                      disabled={occupe}
                    >
                      {t("call")}
                    </button>
                  </div>

                  {c.services.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <div
                        className="s-hint"
                        style={{ fontSize: 12, marginBottom: 4 }}
                      >
                        {t("company_services")}
                      </div>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        {c.services.map((s) => (
                          <li
                            key={s.touche}
                            style={{ display: "flex", gap: 10, fontSize: 13 }}
                          >
                            <span style={touchePastille}>{s.touche}</span>
                            {/* « Sans nom » traduit, jamais un libellé
                                fabriqué : « Touche 2 » ressemblerait à un vrai
                                intitulé. */}
                            <span>{s.nom ?? t("company_service_unnamed")}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // ── L'en-tête : titre courant et retour ────────────────────────────────
  const titre =
    vue.niveau === "types"
      ? t("companies")
      : vue.niveau === "entreprises"
        ? vue.type.libelle
        : vue.niveau === "recherche"
          ? t("company_search_hint")
          : vue.niveau === "fiche"
            ? vue.entreprise.libelle
            : vue.vocal
              ? t("company_vocal_centers")
              : t("company_call_centers")

  const retour = () => {
    if (vue.niveau === "centres") setVue({ niveau: "fiche", entreprise: vue.entreprise })
    else setVue({ niveau: "types" })
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "16px 16px 10px",
        }}
      >
        {vue.niveau !== "types" ? (
          <button type="button" onClick={retour} aria-label={t("back")}>
            {t("back")}
          </button>
        ) : null}
        <h1 style={{ margin: 0, fontSize: 20, flex: 1, minWidth: 0 }}>{titre}</h1>
      </header>

      {/* La recherche n'est offerte qu'aux niveaux de liste : sur une fiche ou
          des centres, elle n'aurait rien à filtrer et brouillerait le retour. */}
      {vue.niveau === "types" || vue.niveau === "recherche" ? (
        <div style={{ padding: "0 16px 12px", display: "flex", gap: 8 }}>
          <input
            type="search"
            value={requete}
            placeholder={t("company_search_hint")}
            onChange={(e) => setRequete(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void lancerRecherche()
            }}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="button" onClick={() => void lancerRecherche()}>
            {t("search")}
          </button>
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {vue.niveau === "types" && rendreTypes()}
        {vue.niveau === "entreprises" && rendreEntreprises(t("company_none_here"))}
        {vue.niveau === "recherche" && rendreEntreprises(t("company_no_match"))}
        {vue.niveau === "fiche" && rendreFiche(vue.entreprise)}
        {vue.niveau === "centres" && rendreCentres(vue.vocal)}
      </div>
    </section>
  )
}

const boutonLigne: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 12,
  textAlign: "left",
  padding: "12px 14px",
}

const carteCentre: React.CSSProperties = {
  border: "1px solid var(--s-border, rgba(0,0,0,.12))",
  borderRadius: 12,
  padding: 14,
}

const touchePastille: React.CSSProperties = {
  minWidth: 22,
  textAlign: "center",
  fontWeight: 600,
}
