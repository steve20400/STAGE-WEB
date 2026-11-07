import React, { useCallback, useEffect, useState } from "react"
import { useDeveloperTab } from "./developer-layout"
import CreationEnseigne from "./creation-enseigne"
import Documentation from "./documentation"
import {
  api,
  messageErreur,
  type Cle,
  type Enseigne,
  type EtatEnseignes,
  type Journal,
  type Webhook,
} from "./enseignes-api"
import "./developer.css"

/*
 * LA CONSOLE DÉVELOPPEUR (refaite le 07/11/2026, décisions du user).
 *
 * On entre avec son compte Alanya. Pour utiliser l'API, on crée une ENSEIGNE :
 * un nom et un numéro Alanya propres. Clés, journal et webhook appartiennent à
 * l'enseigne choisie en haut de page, et c'est elle qui envoie les messages.
 *
 * Ce qui a disparu, et pourquoi :
 *  - la création automatique d'un compte développeur à l'ouverture de la page ;
 *  - le choix Sandbox / Production : les deux clés produisaient des effets
 *    réels, le choix ne servait qu'à tromper ;
 *  - les « espaces de travail », qui n'avaient aucun effet : l'enseigne les
 *    remplace ;
 *  - le champ « Verify Token », que le serveur n'utilisait jamais ;
 *  - la courbe de latence inventée quand il y avait trop peu d'appels.
 */

/** L'enseigne choisie, retenue pour la prochaine visite (confort seulement). */
const CLE_ENSEIGNE_CHOISIE = "alanya-dev-enseigne"

function lireEnseigneChoisie(): string | null {
  try {
    return localStorage.getItem(CLE_ENSEIGNE_CHOISIE)
  } catch {
    return null
  }
}

function retenirEnseigneChoisie(id: string) {
  try {
    localStorage.setItem(CLE_ENSEIGNE_CHOISIE, id)
  } catch {
    // Stockage refusé : on choisira la première enseigne la prochaine fois.
  }
}

const dateCourte = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—")
const dateHeure = (iso: string | null) =>
  iso ? `${new Date(iso).toLocaleDateString()} ${new Date(iso).toLocaleTimeString()}` : "jamais"

const champ: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "8px",
  border: "1px solid var(--dev-border)",
  background: "var(--dev-bg-page)",
  color: "var(--dev-text-primary)",
  fontSize: "14px",
  boxSizing: "border-box",
}

function CourbeLatence({ journal }: { journal: Journal | null }) {
  const lignes = journal?.logs ?? []
  if (lignes.length < 2) {
    return (
      <div className="dev-panel-box" style={{ marginTop: "24px" }}>
        <h4 style={{ margin: "0 0 6px 0", fontSize: "15px", fontWeight: 700 }}>Temps de réponse</h4>
        <p style={{ margin: 0, color: "var(--dev-text-secondary)", fontSize: "14px" }}>
          La courbe apparaîtra après vos premiers appels à l'API.
        </p>
      </div>
    )
  }

  const points = lignes.slice(0, 12).reverse().map((l, i) => ({ x: i, y: l.latencyMs }))
  const largeur = 640
  const hauteur = 180
  const marge = 32
  const maxY = Math.max(...points.map((p) => p.y), 10)
  const minY = Math.min(...points.map((p) => p.y), 0)
  const x = (i: number) => marge + (i / (points.length - 1 || 1)) * (largeur - 2 * marge)
  const y = (v: number) => hauteur - marge - ((v - minY) / (maxY - minY || 1)) * (hauteur - 2 * marge)
  const trace = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.y)}`).join(" ")

  return (
    <div className="dev-panel-box" style={{ marginTop: "24px" }}>
      <h4 style={{ margin: "0 0 12px 0", fontSize: "15px", fontWeight: 700 }}>
        Temps de réponse des derniers appels (ms)
      </h4>
      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg width="100%" height={hauteur} viewBox={`0 0 ${largeur} ${hauteur}`} style={{ overflow: "visible" }}>
          <path d={trace} fill="none" stroke="var(--dev-accent)" strokeWidth="3" strokeLinecap="round" />
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(p.y)} r="4.5" fill="var(--dev-bg-panel)" stroke="var(--dev-accent)" strokeWidth="2.5" />
              <text x={x(i)} y={y(p.y) - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--dev-text-primary)">
                {p.y}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

export default function DeveloperPage() {
  const { activeTab, setActiveTab } = useDeveloperTab()

  const [etat, setEtat] = useState<EtatEnseignes | null>(null)
  const [erreurChargement, setErreurChargement] = useState<string | null>(null)
  const [enseigneId, setEnseigneId] = useState<string | null>(null)
  const [enseigneCreee, setEnseigneCreee] = useState<Enseigne | null>(null)

  const [cles, setCles] = useState<Cle[]>([])
  const [webhook, setWebhook] = useState<Webhook | null>(null)
  const [journal, setJournal] = useState<Journal | null>(null)

  const [nomCle, setNomCle] = useState("")
  const [cleComplete, setCleComplete] = useState<string | null>(null)
  const [urlWebhook, setUrlWebhook] = useState("")
  const [secretVisible, setSecretVisible] = useState(false)
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null)
  const [enCours, setEnCours] = useState(false)

  const enseigne = etat?.enseignes.find((e) => e.id === enseigneId) ?? null

  const chargerEtat = useCallback(async () => {
    try {
      setErreurChargement(null)
      const e = await api.etat()
      setEtat(e)
      setEnseigneId((actuelle) => {
        const retenue = actuelle ?? lireEnseigneChoisie()
        if (retenue && e.enseignes.some((x) => x.id === retenue)) return retenue
        return e.enseignes[0]?.id ?? null
      })
    } catch (err) {
      setErreurChargement(messageErreur(err, "La console n'a pas pu se charger."))
    }
  }, [])

  const chargerEnseigne = useCallback(async (id: string) => {
    const [c, w, j] = await Promise.all([
      api.cles(id).catch(() => [] as Cle[]),
      api.webhook(id).catch(() => null),
      api.journal(id).catch(() => null),
    ])
    setCles(c)
    setWebhook(w)
    setUrlWebhook(w?.url ?? "")
    setJournal(j)
  }, [])

  useEffect(() => {
    void chargerEtat()
  }, [chargerEtat])

  useEffect(() => {
    if (!enseigneId) return
    retenirEnseigneChoisie(enseigneId)
    setCleComplete(null)
    setSecretVisible(false)
    setMessage(null)
    void chargerEnseigne(enseigneId)
  }, [enseigneId, chargerEnseigne])

  const action = async (travail: () => Promise<void>, repli: string) => {
    setEnCours(true)
    setMessage(null)
    try {
      await travail()
    } catch (err) {
      setMessage({ texte: messageErreur(err, repli), erreur: true })
    } finally {
      setEnCours(false)
    }
  }

  const apresCreation = async (nouvelle: Enseigne) => {
    setEnseigneCreee(nouvelle)
    setEnseigneId(nouvelle.id)
    await chargerEtat()
  }

  const supprimerEnseigne = (e: Enseigne) => {
    const ok = window.confirm(
      `Supprimer l'enseigne « ${e.nom} » ?\n\n` +
        `• ses clés cessent de marcher immédiatement ;\n` +
        `• son webhook et son journal sont effacés ;\n` +
        `• son numéro ${e.numero} est fermé.\n\n` +
        `Votre compte Alanya n'est pas touché. Cette action est définitive.`,
    )
    if (!ok) return
    void action(async () => {
      await api.supprimerEnseigne(e.id)
      if (enseigneId === e.id) setEnseigneId(null)
      if (enseigneCreee?.id === e.id) setEnseigneCreee(null)
      await chargerEtat()
      setMessage({ texte: `L'enseigne « ${e.nom} » a été supprimée.`, erreur: false })
    }, "La suppression a échoué.")
  }

  const creerCle = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!enseigneId) return
    void action(async () => {
      const r = await api.creerCle(enseigneId, nomCle.trim())
      setCleComplete(r.cleComplete)
      setNomCle("")
      setCles(await api.cles(enseigneId))
    }, "La clé n'a pas pu être créée.")
  }

  const revoquerCle = (c: Cle) => {
    if (!enseigneId) return
    if (!window.confirm(`Révoquer la clé « ${c.name} » ? Elle cessera de marcher immédiatement.`)) return
    void action(async () => {
      await api.revoquerCle(enseigneId, c.id)
      setCles(await api.cles(enseigneId))
    }, "La révocation a échoué.")
  }

  const enregistrerWebhook = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!enseigneId) return
    void action(async () => {
      const w = await api.enregistrerWebhook(enseigneId, urlWebhook.trim())
      setWebhook(w)
      setMessage({ texte: "Webhook enregistré.", erreur: false })
    }, "Le webhook n'a pas pu être enregistré.")
  }

  const changerSecret = () => {
    if (!enseigneId || !webhook) return
    if (!window.confirm("Changer le secret ? L'ancien cessera aussitôt de valoir : pensez à mettre à jour votre serveur."))
      return
    void action(async () => {
      setWebhook(await api.enregistrerWebhook(enseigneId, webhook.url, true))
      setSecretVisible(true)
      setMessage({ texte: "Nouveau secret créé.", erreur: false })
    }, "Le secret n'a pas pu être changé.")
  }

  const supprimerWebhook = () => {
    if (!enseigneId) return
    if (!window.confirm("Supprimer le webhook ? Plus aucun envoi ne partira vers votre serveur.")) return
    void action(async () => {
      await api.supprimerWebhook(enseigneId)
      setWebhook(null)
      setUrlWebhook("")
    }, "La suppression a échoué.")
  }

  const copier = (texte: string) => {
    void navigator.clipboard?.writeText(texte)
    setMessage({ texte: "Copié.", erreur: false })
  }

  /* ─── États d'attente et d'accès ─────────────────────────────────────── */

  if (erreurChargement) {
    return (
      <div className="dev-dashboard-main">
        <div className="dev-panel-box">
          <p style={{ color: "#ef4444", fontWeight: 600, margin: "0 0 12px 0" }}>{erreurChargement}</p>
          <button className="dev-refresh-btn" onClick={() => void chargerEtat()}>
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  if (!etat) {
    return (
      <div className="dev-dashboard-main">
        <p style={{ color: "var(--dev-text-secondary)" }}>Chargement…</p>
      </div>
    )
  }

  if (!etat.autorise) {
    return (
      <div className="dev-dashboard-main">
        <div className="dev-panel-box">
          <h3 className="dev-panel-title">Espace développeur indisponible pour ce compte</h3>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6 }}>
            Les comptes agent, centre d'appels et centre vocal ne peuvent pas créer d'enseigne. Connectez-vous avec un
            compte Alanya personnel, ou créez un compte développeur.
          </p>
        </div>
      </div>
    )
  }

  // Aucune enseigne encore : c'est la seule chose à faire, on ne montre qu'elle.
  if (etat.enseignes.length === 0) {
    return (
      <div className="dev-dashboard-main">
        <div className="dev-panel-box">
          <h3 className="dev-panel-title">Créez votre enseigne</h3>
          <p style={{ margin: "0 0 20px 0", fontSize: "14px", lineHeight: 1.6, color: "var(--dev-text-secondary)" }}>
            L'enseigne est l'expéditeur de vos messages : elle a son nom et son propre numéro Alanya. Vos clés d'API lui
            sont rattachées. Votre compte personnel, lui, ne change pas.
          </p>
          {etat.limite === 0 ? (
            <p style={{ margin: 0, fontWeight: 600 }}>
              La création d'enseignes est fermée pour le moment. Contactez l'équipe Alanya.
            </p>
          ) : (
            <CreationEnseigne confirmationRequise={etat.confirmationRequise} onCree={(e) => void apresCreation(e)} />
          )}
        </div>
      </div>
    )
  }

  /* ─── La console d'une enseigne ──────────────────────────────────────── */

  const clesActives = cles.filter((c) => c.isActive)
  const peutEnCreer = etat.enseignes.length < etat.limite

  return (
    <div className="dev-dashboard-main">
      <div className="dev-main-header">
        <div className="dev-main-header-text">
          <h1 className="dev-main-title">
            {activeTab === "dashboard" && "Tableau de bord"}
            {activeTab === "enseignes" && "Mes enseignes"}
            {activeTab === "keys" && "Clés d'API"}
            {activeTab === "logs" && "Journal des appels"}
            {activeTab === "webhooks" && "Webhook"}
            {activeTab === "docs" && "Documentation"}
          </h1>
          {enseigne && (
            <p className="dev-main-subtitle">
              Enseigne <strong>{enseigne.nom}</strong> · numéro {enseigne.numero}
            </p>
          )}
        </div>

        <div className="dev-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          {etat.enseignes.length > 1 && (
            <select
              aria-label="Enseigne"
              value={enseigneId ?? ""}
              onChange={(e) => setEnseigneId(e.target.value)}
              style={{ ...champ, padding: "8px 12px", fontWeight: 600 }}
            >
              {etat.enseignes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nom}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => enseigneId && void chargerEnseigne(enseigneId)}
            className="dev-refresh-btn"
          >
            Actualiser
          </button>
        </div>
      </div>

      {message && (
        <div
          role="status"
          style={{ color: message.erreur ? "#ef4444" : "#10b981", fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}
        >
          {message.texte}
        </div>
      )}

      {enseigneCreee && (
        <div className="dev-panel-box" style={{ borderColor: "#10b981", borderWidth: "2px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>Enseigne « {enseigneCreee.nom} » créée</h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "14px", lineHeight: 1.6 }}>
            Son numéro Alanya : <strong style={{ fontFamily: "monospace", fontSize: "16px" }}>{enseigneCreee.numero}</strong>.
            C'est l'expéditeur de vos messages API.
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              className="dev-metric-btn"
              style={{ background: "#10b981", color: "#ffffff", padding: "8px 16px" }}
              onClick={() => {
                setEnseigneCreee(null)
                setActiveTab("keys")
              }}
            >
              Créer ma première clé
            </button>
            <button className="dev-refresh-btn" onClick={() => setEnseigneCreee(null)}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {cleComplete && (
        <div className="dev-panel-box" style={{ borderColor: "#6366f1", borderWidth: "2px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 8px 0", color: "#6366f1", fontSize: "16px" }}>Votre nouvelle clé</h3>
          <p style={{ fontSize: "14px", margin: "4px 0" }}>
            Copiez-la maintenant et gardez-la sur votre serveur : elle ne sera plus jamais affichée.
          </p>
          <div className="dev-code-block" style={{ color: "#10b981", fontSize: "15px", margin: "12px 0", wordBreak: "break-all" }}>
            {cleComplete}
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              className="dev-metric-btn"
              style={{ background: "var(--dev-accent)", color: "#ffffff", padding: "8px 16px" }}
              onClick={() => copier(cleComplete)}
            >
              Copier la clé
            </button>
            <button className="dev-refresh-btn" onClick={() => setCleComplete(null)}>
              J'ai copié ma clé
            </button>
          </div>
        </div>
      )}

      {/* 1. TABLEAU DE BORD */}
      {activeTab === "dashboard" && (
        <>
          <div className="dev-metrics-grid">
            <div className="dev-metric-card">
              <div className="dev-metric-info">
                <span className="dev-metric-label">CLÉS ACTIVES</span>
                <span className="dev-metric-value">{clesActives.length}</span>
              </div>
              <button className="dev-metric-btn" onClick={() => setActiveTab("keys")}>
                Gérer les clés →
              </button>
            </div>
            <div className="dev-metric-card">
              <div className="dev-metric-info">
                <span className="dev-metric-label">APPELS RÉUSSIS</span>
                <span className="dev-metric-value">{journal && journal.total > 0 ? `${journal.successRatePercent} %` : "—"}</span>
              </div>
              <button className="dev-metric-btn" onClick={() => setActiveTab("logs")}>
                Voir le journal →
              </button>
            </div>
            <div className="dev-metric-card">
              <div className="dev-metric-info">
                <span className="dev-metric-label">TEMPS DE RÉPONSE MOYEN</span>
                <span className="dev-metric-value">{journal && journal.total > 0 ? `${journal.avgLatencyMs} ms` : "—"}</span>
              </div>
              <button className="dev-metric-btn" onClick={() => setActiveTab("logs")}>
                Voir le journal →
              </button>
            </div>
            <div className="dev-metric-card">
              <div className="dev-metric-info">
                <span className="dev-metric-label">WEBHOOK</span>
                <span className="dev-metric-value">{webhook?.isActive ? "Actif" : "Aucun"}</span>
              </div>
              <button className="dev-metric-btn" onClick={() => setActiveTab("webhooks")}>
                Configurer →
              </button>
            </div>
          </div>

          {clesActives.length === 0 && (
            <div className="dev-panel-box" style={{ marginTop: "24px" }}>
              <h3 className="dev-panel-title">Prochaine étape : une clé d'API</h3>
              <p style={{ margin: "0 0 12px 0", fontSize: "14px", lineHeight: 1.6 }}>
                Votre serveur s'identifie auprès d'Alanya avec une clé. Créez-en une, puis suivez la documentation pour
                envoyer votre premier message.
              </p>
              <button
                className="dev-metric-btn"
                style={{ background: "#10b981", color: "#ffffff", padding: "8px 16px" }}
                onClick={() => setActiveTab("keys")}
              >
                Créer une clé
              </button>
            </div>
          )}

          <CourbeLatence journal={journal} />
        </>
      )}

      {/* 2. MES ENSEIGNES */}
      {activeTab === "enseignes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div className="dev-panel-box">
            <h3 className="dev-panel-title">
              Mes enseignes ({etat.enseignes.length} sur {etat.limite})
            </h3>
            <div className="dev-table-container">
              <table className="dev-table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Numéro Alanya</th>
                    <th>Clés actives</th>
                    <th>Création</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {etat.enseignes.map((e) => (
                    <tr key={e.id}>
                      <td style={{ fontWeight: 600 }}>{e.nom}</td>
                      <td style={{ fontFamily: "monospace" }}>{e.numero}</td>
                      <td>{e.clesActives}</td>
                      <td style={{ color: "var(--dev-text-secondary)", fontSize: "13px" }}>{dateCourte(e.creeLe)}</td>
                      <td>
                        <button
                          className="dev-metric-btn"
                          style={{ background: "#dc2626", color: "#ffffff" }}
                          disabled={enCours}
                          onClick={() => supprimerEnseigne(e)}
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="dev-panel-box">
            <h3 className="dev-panel-title">Créer une autre enseigne</h3>
            {peutEnCreer ? (
              <CreationEnseigne confirmationRequise={etat.confirmationRequise} onCree={(e) => void apresCreation(e)} />
            ) : (
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6 }}>
                Vous avez atteint le nombre maximal d'enseignes ({etat.limite}). Contactez l'équipe Alanya pour en
                ouvrir davantage.
              </p>
            )}
          </div>
        </div>
      )}

      {/* 3. CLÉS D'API */}
      {activeTab === "keys" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div className="dev-panel-box">
            <h3 className="dev-panel-title">Créer une clé</h3>
            <form onSubmit={creerCle} style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Nom de la clé (ex. : serveur principal)"
                value={nomCle}
                maxLength={50}
                onChange={(e) => setNomCle(e.target.value)}
                style={{ ...champ, flex: "1", minWidth: "200px" }}
              />
              <button
                type="submit"
                disabled={enCours}
                className="dev-metric-btn"
                style={{ background: "#10b981", color: "#ffffff", padding: "10px 20px" }}
              >
                {enCours ? "Création…" : "Créer la clé"}
              </button>
            </form>
          </div>

          <div className="dev-panel-box">
            <h3 className="dev-panel-title">Clés de l'enseigne</h3>
            {cles.length === 0 ? (
              <p style={{ color: "var(--dev-text-secondary)", margin: 0 }}>Aucune clé pour le moment.</p>
            ) : (
              <div className="dev-table-container">
                <table className="dev-table">
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th>Début de la clé</th>
                      <th>Création</th>
                      <th>Dernière utilisation</th>
                      <th>Statut</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cles.map((c) => (
                      <tr key={c.id} style={{ opacity: c.isActive ? 1 : 0.5 }}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td style={{ fontFamily: "monospace", color: "var(--dev-accent)" }}>{c.prefix}…</td>
                        <td style={{ color: "var(--dev-text-secondary)", fontSize: "13px" }}>{dateCourte(c.createdAt)}</td>
                        <td style={{ color: "var(--dev-text-secondary)", fontSize: "13px" }}>{dateHeure(c.lastUsedAt)}</td>
                        <td>
                          <span style={{ color: c.isActive ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                            {c.isActive ? "Active" : "Révoquée"}
                          </span>
                        </td>
                        <td>
                          {c.isActive && (
                            <button
                              className="dev-metric-btn"
                              style={{ background: "#dc2626", color: "#ffffff" }}
                              disabled={enCours}
                              onClick={() => revoquerCle(c)}
                            >
                              Révoquer
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. JOURNAL */}
      {activeTab === "logs" && (
        <>
          <div className="dev-panel-box">
            <h3 className="dev-panel-title">Derniers appels</h3>
            {!journal || journal.logs.length === 0 ? (
              <p style={{ color: "var(--dev-text-secondary)", margin: 0 }}>
                Aucun appel pour le moment. Ils s'afficheront ici dès votre premier appel à l'API.
              </p>
            ) : (
              <>
                <p style={{ color: "var(--dev-text-secondary)", fontSize: "13px", margin: "0 0 12px 0" }}>
                  {journal.total} appel{journal.total > 1 ? "s" : ""} au total · {journal.successRatePercent} % réussis ·{" "}
                  {journal.avgLatencyMs} ms en moyenne
                </p>
                <div className="dev-table-container">
                  <table className="dev-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Route</th>
                        <th>Statut</th>
                        <th>Durée</th>
                        <th>Clé</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journal.logs.map((l) => (
                        <tr key={l.id}>
                          <td style={{ color: "var(--dev-text-secondary)", fontSize: "13px" }}>{dateHeure(l.createdAt)}</td>
                          <td style={{ fontFamily: "monospace", fontSize: "13px" }}>
                            {l.method} {l.endpoint}
                          </td>
                          <td>
                            <span
                              style={{
                                padding: "2px 8px",
                                borderRadius: "4px",
                                fontSize: "12px",
                                fontWeight: 700,
                                background: l.statusCode < 300 ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                                color: l.statusCode < 300 ? "#10b981" : "#ef4444",
                              }}
                            >
                              {l.statusCode}
                            </span>
                          </td>
                          <td style={{ fontSize: "13px" }}>{l.latencyMs} ms</td>
                          <td style={{ fontFamily: "monospace", color: "var(--dev-text-secondary)", fontSize: "12px" }}>
                            {l.keyPrefix ? `${l.keyPrefix}…` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          <CourbeLatence journal={journal} />
        </>
      )}

      {/* 5. WEBHOOK */}
      {activeTab === "webhooks" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div className="dev-panel-box">
            <h3 className="dev-panel-title">Adresse de votre serveur</h3>
            <p style={{ color: "var(--dev-text-secondary)", fontSize: "14px", margin: "0 0 16px 0", lineHeight: 1.6 }}>
              Alanya prévient votre serveur quand un message de l'enseigne part. L'adresse doit commencer par{" "}
              <code>https://</code> et être joignable sur Internet.
            </p>
            <form onSubmit={enregistrerWebhook} style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <input
                type="url"
                placeholder="https://mon-serveur.com/alanya/webhook"
                value={urlWebhook}
                onChange={(e) => setUrlWebhook(e.target.value)}
                style={{ ...champ, flex: "1", minWidth: "240px" }}
                required
              />
              <button
                type="submit"
                disabled={enCours}
                className="dev-metric-btn"
                style={{ background: "#10b981", color: "#ffffff", padding: "10px 20px" }}
              >
                {enCours ? "Enregistrement…" : "Enregistrer"}
              </button>
            </form>
          </div>

          {webhook && (
            <div className="dev-panel-box">
              <h3 className="dev-panel-title">Secret de signature</h3>
              <p style={{ color: "var(--dev-text-secondary)", fontSize: "14px", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                Chaque envoi porte l'en-tête <code>X-Alanya-Signature</code>, calculé avec ce secret. Votre serveur s'en
                sert pour vérifier que l'envoi vient bien d'Alanya (voir la documentation).
              </p>
              <div className="dev-code-block" style={{ wordBreak: "break-all", margin: "0 0 12px 0" }}>
                {secretVisible ? webhook.secretKey : "••••••••••••••••••••••••••••••••"}
              </div>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button className="dev-refresh-btn" onClick={() => setSecretVisible((v) => !v)}>
                  {secretVisible ? "Masquer" : "Afficher"}
                </button>
                {webhook.secretKey && (
                  <button className="dev-refresh-btn" onClick={() => copier(webhook.secretKey!)}>
                    Copier
                  </button>
                )}
                <button className="dev-refresh-btn" disabled={enCours} onClick={changerSecret}>
                  Changer le secret
                </button>
                <button
                  className="dev-metric-btn"
                  style={{ background: "#dc2626", color: "#ffffff" }}
                  disabled={enCours}
                  onClick={supprimerWebhook}
                >
                  Supprimer le webhook
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. DOCUMENTATION */}
      {activeTab === "docs" && (
        <div className="dev-panel-box">
          <Documentation numeroEnseigne={enseigne?.numero} />
        </div>
      )}
    </div>
  )
}
