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

  /** Filtre LOCAL dans le service ouvert — comme le mobile, au-delà de 5. */
  const [filtre, setFiltre] = useState("")
  /** Le collègue dont l'appel ou la conversation est en cours d'ouverture. */
  const [occupe, setOccupe] = useState<string | null>(null)

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
    setFiltre("")
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
  //
  // ⚠️ UN SEUL GESTE À LA FOIS : un double clic lançait deux appels vers la
  // même personne. Le mobile grise déjà ses boutons pendant l'ouverture.
  async function appeler(c: Collegue) {
    if (occupe) return
    setOccupe(c.id)
    try {
      const conversation = await createPrivateChat(c.publicNumber)
      const callId = await startOutgoingCall(conversation.id, "audio", c.nom)
      navigate(`/calls/${callId}?type=audio&returnTo=${encodeURIComponent("/collegues")}`)
    } catch (e) {
      error(t("call_failed"), e instanceof Error ? e.message : t("call_start_failed"))
    } finally {
      setOccupe(null)
    }
  }

  async function ecrire(c: Collegue) {
    if (occupe) return
    setOccupe(c.id)
    try {
      const conversation = await createPrivateChat(c.publicNumber)
      navigate(`/chats/${conversation.id}`)
    } catch (e) {
      error(t("error"), e instanceof Error ? e.message : t("server_unreachable"))
    } finally {
      setOccupe(null)
    }
  }

  /** Les membres retenus par le filtre local (nom ou Alanya ID). */
  const membresVisibles = useMemo(() => {
    if (membres === null) return null
    const q = filtre.trim().toLowerCase()
    if (q === "") return membres
    const chiffres = q.replace(/\D/g, "")
    return membres.filter(
      (c) =>
        c.nom.toLowerCase().includes(q) ||
        (chiffres !== "" && c.publicNumber.includes(chiffres))
    )
  }, [membres, filtre])

  const enRecherche = resultats !== null || cherche

  /**
   * Le titre du volet gauche : la page, ou la recherche en cours. Le service
   * ouvert est nomme par l'en-tete du volet droit, a toutes les largeurs.
   */
  const titre = enRecherche ? t("colleagues_search_hint") : t("colleagues")

  /*
   * 🐛 SUR TELEPHONE, TAPER UNE LETTRE FAISAIT DISPARAITRE LE CHAMP. La
   * recherche basculait la page en « detail », qui masque le volet gauche —
   * celui qui porte le champ. Empile, les resultats s'affichent donc SOUS le
   * champ, a la place des services ; seul un service ouvert passe a droite.
   */
  const resultatsAGauche = enRecherche && !deuxColonnes

  return (
    <div className={`cl-page${serviceOuvert && !enRecherche ? " detail-ouvert" : ""}`}>
      {/*
        LE VOLET GAUCHE PORTE SON EN-TETE ET SA RECHERCHE.
        Ils vivaient AU-DESSUS des deux colonnes, donc sur toute la largeur de
        l'ecran : la barre de recherche traversait la page pour filtrer une
        liste large de 300 px. Meme faute que si la recherche des discussions
        s'etendait par-dessus la conversation ouverte.
      */}
      <div className="cl-volet-gauche">
      <header className="cl-head">
        <h1>{titre}</h1>
      </header>

      <div className="cl-search">
        <ChampRecherche
          valeur={requete}
          onChange={setRequete}
          libelle={t("colleagues_search_hint")}
          effacer={t("search_clear")}
        />
      </div>

        <div className="cl-colonne cl-colonne-services">
          {resultatsAGauche
            ? rendreCollegues(cherche ? null : resultats, t("colleagues_no_match"))
            : rendreServices()}
        </div>
      </div>

      {/* LE VOLET DROIT. Les membres, les resultats de recherche, ou
          l'invitation a choisir — jamais vide sans le dire. */}
      <div className="cl-volet-droit">
          <div className="cl-colonne cl-colonne-membres">
            {enRecherche ? (
              rendreCollegues(cherche ? null : resultats, t("colleagues_no_match"))
            ) : serviceOuvert ? (
              <>
                {/* Le nom du service EN TETE de sa colonne : a deux colonnes, le
                    titre de page ne le porte plus, et une liste de visages sans
                    en-tete ne dit pas de qui elle parle. */}
                {/*
                  🐛 SUR TELEPHONE, CETTE VUE N'AVAIT NI TITRE NI RETOUR. Ils
                  vivaient dans l'en-tete du volet gauche — que l'empilement
                  masque des qu'un service est ouvert. On ne pouvait plus revenir
                  aux services qu'avec le bouton du navigateur.
                */}
                <div className="cl-head" style={{ paddingInline: 0 }}>
                  {!deuxColonnes && (
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
                  <h1>{serviceOuvert}</h1>
                </div>
                {/* Le filtre n'apparait qu'a partir d'une poignee de collegues,
                    comme sur le mobile : au-dessous, la liste se parcourt a
                    l'oeil et le champ prendrait une place pour rien. */}
                {membres !== null && membres.length > 5 && (
                  <div className="cl-filtre">
                    <ChampRecherche
                      valeur={filtre}
                      onChange={setFiltre}
                      libelle={t("colleagues_filter_hint")}
                      effacer={t("search_clear")}
                    />
                  </div>
                )}
                {/* Deux vides differents, deux messages : un service vide de
                    naissance n'est pas un filtre qui ne trouve rien. */}
                {rendreCollegues(
                  membresVisibles,
                  filtre.trim() === "" ? t("colleagues_service_empty") : t("colleagues_no_match")
                )}
              </>
            ) : (
              <div className="cl-vide-droite">
                <IconeAnnuaire />
                <p>{t("col_pick_service")}</p>
              </div>
            )}
          </div>
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
              {/* Meme carte que le mobile : pastille, nom, effectif, chevron. */}
              <span className="cl-pastille">
                <IconeBadge />
              </span>
              <span className="cl-service-texte">
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
              </span>
              <span className="cl-chevron">
                <Chevron />
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
            <div className="cl-membre-haut">
            <AvatarCircle avatar={c.avatarUrl} initials={initiales(c.nom)} className="cl-membre-avatar" />
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
              {c.agence ? (
                <div className="cl-membre-agence">
                  <IconeAgence />
                  <span>{c.agence}</span>
                </div>
              ) : null}
            </div>
            {/* La pastille verte du mobile : le collegue est connecte. */}
            {c.isOnline === 1 && (
              <span className="cl-en-ligne" title={t("online")} aria-label={t("online")} />
            )}
            </div>
            {/* Les deux gestes SOUS la fiche, sur toute sa largeur, comme le
                mobile : « Appeler » plein, « Message » au trait. Places a
                droite du nom, ils ecrasaient celui-ci sur un ecran etroit. */}
            <div className="cl-membre-actions">
              <button
                type="button"
                className="cl-action cl-action-pleine"
                disabled={occupe !== null}
                onClick={() => void appeler(c)}
              >
                <IconeAppel />
                <span>{t("call")}</span>
              </button>
              <button
                type="button"
                className="cl-action"
                disabled={occupe !== null}
                onClick={() => void ecrire(c)}
              >
                <IconeMessage />
                {/* « Message », le mot du mobile : « Envoyer un message » ne
                    tenait pas dans une demi-tuile et finissait en « Envoyer u… ». */}
                <span>{t("colleagues_message")}</span>
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

/** Le badge du mobile (`Icons.badge_outlined`), pastille des services. */
function IconeBadge() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" />
      <circle cx="9" cy="12" r="2" />
      <path d="M6 17c.5-1.5 1.6-2.2 3-2.2s2.5.7 3 2.2M15 11h3M15 14h3" />
    </svg>
  )
}

/** L'immeuble du mobile (`Icons.business_outlined`), devant l'agence. */
function IconeAgence() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4" />
    </svg>
  )
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

/**
 * Un champ de recherche avec sa loupe et sa croix, comme le mobile.
 *
 * ⚠️ `type="text"` et non `search` : la croix native de Chrome ne suit ni la
 * couleur ni le theme, et Firefox n'en dessine aucune — deux navigateurs, deux
 * ecrans differents.
 */
function ChampRecherche({
  valeur,
  onChange,
  libelle,
  effacer,
}: {
  valeur: string
  onChange: (v: string) => void
  libelle: string
  effacer: string
}) {
  return (
    <div className="cl-champ">
      <svg className="cl-champ-loupe" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        type="text"
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("")
        }}
        placeholder={libelle}
        aria-label={libelle}
      />
      {valeur !== "" && (
        <button type="button" className="cl-champ-effacer" onClick={() => onChange("")}
          title={effacer} aria-label={effacer}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** Les initiales, pour l'avatar de repli. */
function initiales(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean)
  if (mots.length === 0) return "?"
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}
