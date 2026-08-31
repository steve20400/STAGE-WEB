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
import "./entreprises-page.css"

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
/**
 * CE QUE MONTRE LE VOLET GAUCHE — une liste, toujours.
 *
 * Separe du detail, et c'est tout le decoupage : un seul etat forcait la liste
 * a DISPARAITRE des qu'on ouvrait une fiche, puisque le meme champ portait les
 * deux. La page ne pouvait donc pas etre a deux volets.
 */
type Liste =
  | { niveau: "types" }
  | { niveau: "entreprises"; type: TypeEntreprise }
  | { niveau: "recherche" }

/** CE QUE MONTRE LE VOLET DROIT, ou `null` quand rien n'est choisi. */
type Detail =
  | { niveau: "fiche"; entreprise: Entreprise }
  | { niveau: "centres"; entreprise: Entreprise; vocal: boolean }
  | null

export default function EntreprisesPage() {
  const { t } = useTranslation()
  const { error } = useToast()

  const [voletGauche, setVoletGauche] = useState<Liste>({ niveau: "types" })
  const [detail, setDetail] = useState<Detail>(null)
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
    setVoletGauche({ niveau: "entreprises", type })
    setDetail(null)
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
    setVoletGauche({ niveau: "recherche" })
    setDetail(null)
    try {
      setListe(await chercherEntreprises(q))
    } catch {
      setListe([])
      setEchec(true)
    }
  }, [requete])

  const ouvrirFiche = useCallback(async (entreprise: Entreprise) => {
    setFiche(null)
    setDetail({ niveau: "fiche", entreprise })
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
      // Pas de gouttiere ici : `.ent-detail` la porte deja, et les additionner
      // rentrait le contenu de 34 px au lieu de 18.
      <div>
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
                setDetail({ niveau: "centres", entreprise, vocal: false })
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
                setDetail({ niveau: "centres", entreprise, vocal: true })
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

  // ── Les deux en-tetes : chaque volet nomme ce qu'il montre ─────────────
  const titreGauche =
    voletGauche.niveau === "types"
      ? t("companies")
      : voletGauche.niveau === "entreprises"
        ? voletGauche.type.libelle
        : t("company_search_hint")

  const titreDroite =
    detail === null
      ? ""
      : detail.niveau === "fiche"
        ? detail.entreprise.libelle
        : detail.vocal
          ? t("company_vocal_centers")
          : t("company_call_centers")

  /** Retour DANS LE VOLET GAUCHE : d'une liste d'entreprises vers les types. */
  const retourListe = () => {
    setVoletGauche({ niveau: "types" })
    setDetail(null)
  }

  /**
   * Retour DANS LE VOLET DROIT. Les centres reviennent a leur fiche ; une fiche
   * se referme et rend la main a la liste — sur telephone, c'est ce geste qui
   * ramene au volet gauche.
   */
  const retourDetail = () => {
    if (detail?.niveau === "centres") setDetail({ niveau: "fiche", entreprise: detail.entreprise })
    else setDetail(null)
  }

  return (
    <div className={`ent-page${detail ? " detail-ouvert" : ""}`}>
      {/*
        LE VOLET GAUCHE. Il porte SON en-tete et SA recherche : elles vivaient
        au-dessus de toute la page et s'etendaient sur la largeur de l'ecran
        pour commander une liste large de 360 px.
      */}
      <div className="ent-volet-gauche">
        <header className="ent-head">
          {voletGauche.niveau !== "types" ? (
            <button
              type="button"
              className="ent-back"
              onClick={retourListe}
              aria-label={t("back")}
            >
              {/* Une fleche, pas le mot traduit : le libelle changeait la largeur
                  du bouton d'une langue a l'autre et poussait le titre. */}
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M15 18l-6-6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
          <h1>{titreGauche}</h1>
        </header>

        {/* La recherche ne vaut que pour les listes d'ou l'on peut chercher. */}
        {voletGauche.niveau === "types" || voletGauche.niveau === "recherche" ? (
          <div className="ent-search">
            <input
              type="search"
              value={requete}
              placeholder={t("company_search_hint")}
              onChange={(e) => setRequete(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void lancerRecherche()
              }}
            />
            <button type="button" onClick={() => void lancerRecherche()}>
              {t("search")}
            </button>
          </div>
        ) : null}

        <div className="ent-liste">
          {voletGauche.niveau === "types" && rendreTypes()}
          {voletGauche.niveau === "entreprises" && rendreEntreprises(t("company_none_here"))}
          {voletGauche.niveau === "recherche" && rendreEntreprises(t("company_no_match"))}
        </div>
      </div>

      {/* LE VOLET DROIT. Vide tant que rien n'est choisi — et il le DIT, au lieu
          de laisser une moitie d'ecran blanche. */}
      <div className="ent-volet-droit">
        {detail === null ? (
          <div className="ent-vide">
            <div className="ent-vide-badge" aria-hidden="true">
              <svg
                width="34"
                height="34"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <path d="M9 21v-6h6v6" />
                <path d="M9 9h.01M15 9h.01M9 12h.01M15 12h.01" />
              </svg>
            </div>
            <div className="ent-vide-titre">{t("companies")}</div>
            <div className="ent-vide-sous">{t("ent_pick_company")}</div>
          </div>
        ) : (
          <>
            <header className="ent-head">
              <button
                type="button"
                className="ent-back"
                onClick={retourDetail}
                aria-label={t("back")}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M15 18l-6-6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <h1>{titreDroite}</h1>
            </header>
            <div className="ent-detail">
              {detail.niveau === "fiche" && rendreFiche(detail.entreprise)}
              {detail.niveau === "centres" && rendreCentres(detail.vocal)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/*
 * LA LIGNE DE LISTE, calquee sur `.conv-item` des discussions : meme gouttiere
 * de 12 px, meme espacement, meme rayon. Les deux ecrans doivent se superposer.
 */
const boutonLigne: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 12,
  textAlign: "left",
  padding: 12,
  borderRadius: 11,
  border: "1px solid transparent",
  background: "none",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: 14,
  cursor: "pointer",
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
