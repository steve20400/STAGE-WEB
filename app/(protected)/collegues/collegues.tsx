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
import "./collegues-page.css"

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

  /**
   * Deux colonnes ou une seule ?
   *
   * La MEME borne que la media query de la feuille. Le CSS suffirait a placer
   * les colonnes, mais pas a decider du BOUTON DE RETOUR ni de ce que la droite
   * affiche : cote a cote, il n'y a nulle part ou revenir. On ecoute donc la
   * meme condition ici, plutot que de la deviner.
   */
  const [deuxColonnes, setDeuxColonnes] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 901px)").matches
  )
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 901px)")
    const suivre = (e: MediaQueryListEvent) => setDeuxColonnes(e.matches)
    mq.addEventListener("change", suivre)
    return () => mq.removeEventListener("change", suivre)
  }, [])

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

  /**
   * Le titre suit ce que la page MONTRE.
   *
   * A deux colonnes, les services et les membres sont visibles ENSEMBLE : le
   * titre redevient celui de la page, et c'est la colonne de droite qui nomme le
   * service ouvert. Empile, il n'y a qu'une liste a l'ecran, et le titre est le
   * seul endroit qui puisse dire laquelle.
   */
  const titre = useMemo(() => {
    if (enRecherche) return t("colleagues_search_hint")
    if (deuxColonnes) return t("colleagues")
    return serviceOuvert ?? t("colleagues")
  }, [enRecherche, deuxColonnes, serviceOuvert, t])

  /** Empile seulement : cote a cote, il n'y a nulle part ou revenir. */
  const montrerRetour = !deuxColonnes && serviceOuvert !== null && !enRecherche

  return (
    <div className="cl-page">
      <header className="cl-head">
        {montrerRetour && (
          <button
            type="button"
            className="cl-back"
            onClick={() => {
              setServiceOuvert(null)
              setMembres(null)
            }}
            title={t("back")}
            aria-label={t("back")}
          >
            <FlecheRetour />
          </button>
        )}
        <h1>{titre}</h1>
      </header>

      <div className="cl-search">
        <input
          type="search"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder={t("colleagues_search_hint")}
          aria-label={t("colleagues_search_hint")}
        />
      </div>

      <div className="cl-corps">
        {/* LA GAUCHE. Empile, elle disparait des qu'un service est ouvert ou
            qu'on cherche — c'est l'ecran d'origine. */}
        {(deuxColonnes || (!serviceOuvert && !enRecherche)) && (
          <div className="cl-colonne cl-colonne-services">{rendreServices()}</div>
        )}

        {/* LA DROITE. Elle porte les membres, les resultats de recherche, ou
            l'invitation a choisir. Empilee, elle ne parait que lorsqu'elle a
            quelque chose a dire. */}
        {(deuxColonnes || serviceOuvert || enRecherche) && (
          <div className="cl-colonne cl-colonne-membres">
            {enRecherche ? (
              rendreCollegues(cherche ? null : resultats, t("colleagues_no_match"))
            ) : serviceOuvert ? (
              <>
                {/* Le nom du service EN TETE de sa colonne : a deux colonnes, le
                    titre de page ne le porte plus, et une liste de visages sans
                    en-tete ne dit pas de qui elle parle. */}
                {deuxColonnes && (
                  <div className="cl-head" style={{ paddingInline: 0 }}>
                    <h1>{serviceOuvert}</h1>
                  </div>
                )}
                {rendreCollegues(membres, t("colleagues_service_empty"))}
              </>
            ) : (
              <div className="cl-vide-droite">
                <IconeAnnuaire />
                <p>{t("col_pick_service")}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  // ── Rendus ──────────────────────────────────────────────────────────────

  function rendreServices() {
    if (echec) {
      return (
        <p className="cl-hint">
          {t("server_unreachable")}{" "}
          <button type="button" onClick={() => void chargerServices()}>
            {t("retry")}
          </button>
        </p>
      )
    }
    if (services === null) return <p className="cl-hint">{t("loading")}</p>
    if (services.length === 0) {
      // Le message dit POURQUOI la liste est vide. « Aucun service n est
      // configure » serait faux quand c est l entreprise qui restreint : des
      // services existent, on n a pas le droit de les voir.
      return (
        <p className="cl-hint">
          {t(porteeRestreinte ? "colleagues_own_service_only" : "colleagues_no_service")}
        </p>
      )
    }

    return (
      <ul className="cl-liste">
        {services.map((s) => (
          <li key={s.nom}>
            <button
              type="button"
              className={`cl-service${serviceOuvert === s.nom ? " ouvert" : ""}`}
              // A deux colonnes, la ligne reste designee pendant qu'on lit ses
              // membres a droite : sans cela, rien ne dit laquelle a produit
              // l'autre.
              aria-current={serviceOuvert === s.nom ? "true" : undefined}
              onClick={() => void ouvrirService(s.nom)}
            >
              <span className="cl-service-nom">{s.nom}</span>
              {/*
                L'effectif est ANNONCÉ, y compris à zéro : un service configuré
                mais sans personne est une information, pas une ligne à cacher.
              */}
              <span className="cl-service-effectif">
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
    if (liste === null) return <p className="cl-hint">{t("loading")}</p>
    if (liste.length === 0) return <p className="cl-hint">{messageVide}</p>

    return (
      <ul className="cl-liste">
        {liste.map((c) => (
          <li key={c.id} className="cl-membre">
            <AvatarCircle avatar={c.avatarUrl} initials={initiales(c.nom)} />
            <div className="cl-membre-texte">
              <div className="cl-membre-nom">{c.nom}</div>
              {/* L'Alanya ID FORMATÉ, comme partout ailleurs : c'est sous cette
                  forme que les gens le lisent et le recopient. */}
              <div className="cl-membre-num">{formatAlanyaNumber(c.publicNumber)}</div>
              {/* L'AGENCE, juste sous le numéro (demande du user, 26/08/2026).

                  ⚠️ RIEN DU TOUT quand elle manque, et pas un tiret : un agent
                  sans fonction rattachée n'a pas d'agence, et le cas est réel
                  en production. Une ligne creuse sous le numéro se lirait comme
                  une donnée perdue, alors qu'il n'y a rien à dire.

                  Le mobile affiche exactement la même chose au même endroit :
                  les deux clients lisent le même champ du même serveur. */}
              {c.agence ? <div className="cl-membre-agence">{c.agence}</div> : null}
            </div>
            {/* Le LIBELLE disparait sur telephone, l'icone reste : deux boutons
                de texte plus un nom plus un avatar ne tiennent pas sur 360 px.
                `aria-label` porte le mot dans les deux cas — ce que le lecteur
                d'ecran annonce ne doit pas dependre de la largeur. */}
            <div className="cl-membre-actions">
              <button
                type="button"
                className="cl-action"
                onClick={() => void appeler(c)}
                title={t("call")}
                aria-label={t("call")}
              >
                <IconeAppel />
                <span>{t("call")}</span>
              </button>
              <button
                type="button"
                className="cl-action"
                onClick={() => void ecrire(c)}
                title={t("send_message")}
                aria-label={t("send_message")}
              >
                <IconeMessage />
                <span>{t("send_message")}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    )
  }
}

/*
 * Icones DESSINEES et non caracteres.
 *
 * « ← » et « ☎ » se rendent dans la police du texte : leur trait est plus fin
 * que tout ce qui les entoure, et leur taille varie d'une plateforme a l'autre.
 * Un trace suit la couleur et l'epaisseur qu'on lui donne.
 */
function FlecheRetour() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function IconeAnnuaire() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconeAppel() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
    </svg>
  )
}

function IconeMessage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.4 8.4 0 0 1 8.4-9 8.4 8.4 0 0 1 8.6 8.6Z" />
    </svg>
  )
}

/** Les initiales, pour l'avatar de repli. */
function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean)
  if (mots.length === 0) return "?"
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}
