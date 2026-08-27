import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"

import { AvatarCircle } from "../../../src/components/avatar-circle"
import { useToast } from "../../../src/components/toast"
import { useTranslation } from "../../../src/i18n"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"
import { startOutgoingCall } from "../../../src/services/call-manager"
import { createPrivateChat } from "../../../src/services/chats-service"
import {
  chercherCollegues,
  listerServices,
  membresDuService,
  type Collegue,
  type ServiceCollegues,
} from "../../../src/services/collegues-service"

/**
 * ANNUAIRE DES COLLÈGUES — pendant web de l'onglet mobile.
 *
 * Deux niveaux, plus un raccourci :
 *   1. les services de mon entreprise, avec leur effectif ;
 *   2. les collègues d'un service ;
 *   +  une RECHERCHE qui traverse les deux.
 *
 * 🔴 LA RECHERCHE N'EST PAS UN FILTRE DE LA LISTE AFFICHÉE. Elle interroge le
 * serveur sur TOUS les agents de l'entreprise, services confondus — et c'est
 * indispensable : un agent peut n'être rattaché à AUCUN service (cas réel en
 * production), et la navigation par service ne peut alors pas l'atteindre.
 * Sans elle, un collègue existant serait introuvable dans son propre annuaire.
 *
 * ⚠️ LES DEUX NIVEAUX VIVENT DANS UNE SEULE PAGE, avec un état, plutôt que dans
 * deux routes. La liste des services est déjà chargée quand on revient d'un
 * service : une seconde route la rechargerait à chaque retour, pour afficher
 * exactement la même chose.
 *
 * ⚠️ Aucun emoji ni sticker — règle du projet.
 */
export default function ColleguesPage() {
  const { t } = useTranslation()
  const { error } = useToast()
  const navigate = useNavigate()

  const [services, setServices] = useState<ServiceCollegues[] | null>(null)
  /**
   * L'entreprise limite-t-elle le répertoire au service de chacun ?
   * Sert UNIQUEMENT à dire vrai quand la liste revient vide.
   */
  const [porteeRestreinte, setPorteeRestreinte] = useState(false)
  const [echec, setEchec] = useState(false)

  /** Le service ouvert, ou `null` quand on est sur la liste des services. */
  const [serviceOuvert, setServiceOuvert] = useState<string | null>(null)
  const [membres, setMembres] = useState<Collegue[] | null>(null)

  const [requete, setRequete] = useState("")
  const [resultats, setResultats] = useState<Collegue[] | null>(null)
  const [cherche, setCherche] = useState(false)

  const chargerServices = useCallback(async () => {
    setEchec(false)
    try {
      const liste = await listerServices()
      setServices(liste.services)
      setPorteeRestreinte(liste.porteeRestreinte)
    } catch {
      setEchec(true)
    }
  }, [])

  useEffect(() => {
    void chargerServices()
  }, [chargerServices])

  // ── Recherche, après une pause de frappe ────────────────────────────────
  //
  // ⚠️ Sans ce délai, chaque caractère déclenche une requête : huit lettres
  // tapées normalement lancent huit appels dont sept sont périmés à leur
  // arrivée — et rien ne garantit qu'ils reviennent dans l'ordre, si bien que
  // l'écran peut finir sur le résultat d'une saisie intermédiaire.
  const dernierQ = useRef("")
  useEffect(() => {
    const q = requete.trim()
    dernierQ.current = q
    if (q === "") {
      setResultats(null)
      setCherche(false)
      return
    }
    setCherche(true)
    const id = window.setTimeout(() => {
      void chercherCollegues(q)
        .then((trouves) => {
          // La saisie a pu changer pendant l'aller-retour : on ne pose le
          // résultat que s'il correspond ENCORE à ce qui est écrit.
          if (dernierQ.current !== q) return
          setResultats(trouves)
          setCherche(false)
        })
        .catch(() => setCherche(false))
    }, 350)
    return () => window.clearTimeout(id)
  }, [requete])

  async function ouvrirService(nom: string) {
    setServiceOuvert(nom)
    setMembres(null)
    try {
      setMembres(await membresDuService(nom))
    } catch {
      setMembres([])
    }
  }

  // ── Les deux gestes ─────────────────────────────────────────────────────
  //
  // Même enchaînement que depuis « Nouvel appel » : la conversation directe est
  // obtenue d'abord — c'est elle qui porte l'appel — puis on ouvre l'écran.
  // `createPrivateChat` est IDEMPOTENT côté serveur : il retrouve la
  // conversation existante ou la crée, on n'a donc pas à savoir laquelle des
  // deux situations on est.
  async function appeler(c: Collegue) {
    try {
      const conversation = await createPrivateChat(c.publicNumber)
      const callId = await startOutgoingCall(conversation.id, "audio", c.nom)
      navigate(`/calls/${callId}?type=audio&returnTo=${encodeURIComponent("/collegues")}`)
    } catch (e) {
      error(t("call_failed"), e instanceof Error ? e.message : t("call_start_failed"))
    }
  }

  async function ecrire(c: Collegue) {
    try {
      const conversation = await createPrivateChat(c.publicNumber)
      navigate(`/chats/${conversation.id}`)
    } catch (e) {
      error(t("error"), e instanceof Error ? e.message : t("server_unreachable"))
    }
  }

  const enRecherche = resultats !== null || cherche

  const titre = useMemo(() => {
    if (enRecherche) return t("colleagues_search_hint")
    return serviceOuvert ?? t("colleagues")
  }, [enRecherche, serviceOuvert, t])

  return (
    <div className="s-page">
      <header className="s-head">
        {serviceOuvert && !enRecherche && (
          <button
            type="button"
            className="s-back"
            onClick={() => {
              setServiceOuvert(null)
              setMembres(null)
            }}
            aria-label={t("back")}
          >
            &larr;
          </button>
        )}
        <h1>{titre}</h1>
      </header>

      <div style={{ padding: "0 16px 12px" }}>
        <input
          type="search"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder={t("colleagues_search_hint")}
          aria-label={t("colleagues_search_hint")}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 9 }}
        />
      </div>

      {enRecherche
        ? rendreCollegues(cherche ? null : resultats, t("colleagues_no_match"))
        : serviceOuvert
          ? rendreCollegues(membres, t("colleagues_service_empty"))
          : rendreServices()}
    </div>
  )

  // ── Rendus ──────────────────────────────────────────────────────────────

  function rendreServices() {
    if (echec) {
      return (
        <p className="s-hint" style={{ padding: 16 }}>
          {t("server_unreachable")}{" "}
          <button type="button" onClick={() => void chargerServices()}>
            {t("retry")}
          </button>
        </p>
      )
    }
    if (services === null) return <p className="s-hint" style={{ padding: 16 }}>{t("loading")}</p>
    if (services.length === 0) {
      // Le message dit POURQUOI la liste est vide. « Aucun service n est
      // configure » serait faux quand c est l entreprise qui restreint : des
      // services existent, on n a pas le droit de les voir.
      return (
        <p className="s-hint" style={{ padding: 16 }}>
          {t(porteeRestreinte ? "colleagues_own_service_only" : "colleagues_no_service")}
        </p>
      )
    }

    return (
      <ul style={{ listStyle: "none", margin: 0, padding: "0 16px 24px" }}>
        {services.map((s) => (
          <li key={s.nom} style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => void ouvrirService(s.nom)}
              style={{
                width: "100%", textAlign: "left", padding: "14px 16px",
                borderRadius: 10, cursor: "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              <span style={{ fontWeight: 600 }}>{s.nom}</span>
              {/*
                L'effectif est ANNONCÉ, y compris à zéro : un service configuré
                mais sans personne est une information, pas une ligne à cacher.
              */}
              <span className="s-hint" style={{ fontSize: 13 }}>
                {s.effectif === 0
                  ? t("colleagues_count_none")
                  : s.effectif === 1
                    ? t("colleagues_count_one")
                    : t("colleagues_count_many", { n: s.effectif })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  function rendreCollegues(liste: Collegue[] | null, messageVide: string) {
    if (liste === null) return <p className="s-hint" style={{ padding: 16 }}>{t("loading")}</p>
    if (liste.length === 0) return <p className="s-hint" style={{ padding: 16 }}>{messageVide}</p>

    return (
      <ul style={{ listStyle: "none", margin: 0, padding: "0 16px 24px" }}>
        {liste.map((c) => (
          <li
            key={c.id}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 14px", borderRadius: 10, marginBottom: 8,
              border: "1px solid var(--border)",
            }}
          >
            <AvatarCircle avatar={c.avatarUrl} initials={initiales(c.nom)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.nom}
              </div>
              {/* L'Alanya ID FORMATÉ, comme partout ailleurs : c'est sous cette
                  forme que les gens le lisent et le recopient. */}
              <div className="s-hint" style={{ fontSize: 13 }}>
                {formatAlanyaNumber(c.publicNumber)}
              </div>
              {/* L'AGENCE, juste sous le numéro (demande du user, 26/08/2026).

                  ⚠️ RIEN DU TOUT quand elle manque, et pas un tiret : un agent
                  sans fonction rattachée n'a pas d'agence, et le cas est réel
                  en production. Une ligne creuse sous le numéro se lirait comme
                  une donnée perdue, alors qu'il n'y a rien à dire.

                  Le mobile affiche exactement la même chose au même endroit :
                  les deux clients lisent le même champ du même serveur. */}
              {c.agence ? (
                <div
                  className="s-hint"
                  style={{
                    fontSize: 12,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.agence}
                </div>
              ) : null}
            </div>
            <button type="button" onClick={() => void appeler(c)}>
              {t("call")}
            </button>
            <button type="button" onClick={() => void ecrire(c)}>
              {t("send_message")}
            </button>
          </li>
        ))}
      </ul>
    )
  }
}

/** Les initiales, pour l'avatar de repli. */
function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean)
  if (mots.length === 0) return "?"
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}
