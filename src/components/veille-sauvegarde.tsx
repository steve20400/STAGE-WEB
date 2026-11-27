import { useCallback, useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { useAuth } from "./auth-provider"
import { useToast } from "./toast"
import { useTranslation } from "../i18n"
import { cacheMessage } from "../services/indexeddb-cache"
import { entreeCacheDechiffree } from "../services/e2ee-entree-cache"
import { restaurerTousLesTrousseaux } from "../services/e2ee-groupe-fil"
import { verifierMotDePasseApi } from "../services/auth-api"
import {
  sendSessionRevoked,
  subscribeToRecuperation,
  subscribeToSignalSauvegarde,
} from "../services/websocket-service"
import {
  aTraiterRecuperation,
  aideEnAttente,
  aider,
  refuserAide,
  relireAideContacts,
  repondreInvitation,
  type DemandeAide,
  type InvitationRecuperation,
} from "../services/e2ee-contacts-recuperation"
import {
  demandeCleEnAttente,
  demandesCleOuvertes,
  refuserDemandeCle,
  relierAuMotDePasse,
  relireDemandeCle,
  restaurerTout,
  serrureMotDePassePerimee,
  servirDemandeCle,
  type DemandeCle,
} from "../services/e2ee-sauvegarde"
import "./confirmation.css"

/**
 * LA VEILLE DE LA SAUVEGARDE, SUR CHAQUE APPAREIL CONNECTÉ (27/11/2026).
 *
 * 🔴 JUMELLE DE `alanya/lib/features/parametres/veille_sauvegarde.dart`.
 *
 * Trois choses, au démarrage, au retour sur l'onglet et à chaque signal d'un
 * autre appareil du compte :
 *
 *  1. CET appareil attendait la clé (demande ouverte depuis la page de
 *     restauration) : si elle est arrivée, on la range et l'on restaure ;
 *  2. un AUTRE appareil attend la clé : si elle est ici, on la lui transmet —
 *     d'elle-même quand le serveur le permet, sinon après « Autoriser » ;
 *  3. la serrure « mot de passe » ne suit plus le mot de passe (couche B) :
 *     un bandeau propose de la refaire, en confirmant le mot de passe.
 *
 * ⚠️ RIEN NE BLOQUE : « Plus tard » ferme tout jusqu'au prochain démarrage.
 */
const PAUSE_MS = 60_000

/**
 * Une AUTRE fenêtre est-elle ouverte (nom de l'appareil, invitation à noter sa
 * clé, une confirmation) ? Alors la nôtre attend le tour suivant : trois
 * fenêtres empilées au premier écran, la dernière ne se cliquait plus.
 */
function autreFenetreOuverte(): boolean {
  if (typeof document === "undefined") return false
  return document.querySelector(".pseudo-gate-overlay, .confirmation-voile:not([data-veille])") !== null
}
/**
 * Les demandes des autres appareils se relisent aussi d'elles-mêmes, page
 * visible : le signal temps réel peut se perdre (socket qui se rouvre au même
 * instant). Une seule requête légère.
 */
const RELECTURE_DEMANDES_MS = 30_000

export function VeilleSauvegarde() {
  const { user } = useAuth()
  const moi = user?.id ?? null
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const { success, warning, error } = useToast()

  const [demande, setDemande] = useState<DemandeCle | null>(null)
  // Contacts de récupération (chantier 2) : ce que J'AI à traiter pour d'autres.
  const [invitation, setInvitation] = useState<InvitationRecuperation | null>(null)
  const [aide, setAide] = useState<DemandeAide | null>(null)
  const [bandeau, setBandeau] = useState(false)
  const [saisie, setSaisie] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const ecartees = useRef(new Set<string>())
  const bandeauEcarte = useRef(false)
  const enCours = useRef(false)
  // Un signal arrivé pendant une vérification n'est pas perdu : on refait un tour.
  const relancer = useRef(false)
  const dernier = useRef(0)
  // La page de restauration fait elle-même ce travail : on ne s'y croise pas.
  const surRestauration = pathname.startsWith("/restauration")

  /** Invitations et demandes d'aide qui m'attendent, en tant que contact. */
  const relireRecuperation = useCallback(async () => {
    if (autreFenetreOuverte()) return
    const { invitations, demandes } = await aTraiterRecuperation()
    const inv = invitations.find((i) => !ecartees.current.has(i.id))
    setInvitation(inv ?? null)
    const dem = demandes.find((d) => !ecartees.current.has(d.id))
    // Une demande close ailleurs (deux accords, un refus) disparaît d'ici :
    // la carte se « grise » d'elle-même.
    setAide(inv ? null : (dem ?? null))
  }, [])

  const verifier = useCallback(
    async (force = false) => {
      if (!moi) return
      if (enCours.current) {
        if (force) relancer.current = true
        return
      }
      if (!force && Date.now() - dernier.current < PAUSE_MS) return
      enCours.current = true
      dernier.current = Date.now()
      try {
        // ① Ma demande : la clé est-elle arrivée ?
        if (await demandeCleEnAttente()) {
          if ((await relireDemandeCle()) === "recue") {
            success(t("arch_cle_recue"))
            try {
              const { messages } = await restaurerTout()
              for (const m of messages) await cacheMessage(entreeCacheDechiffree(m))
            } catch {
              // Le rattrapage des fils reprendra ce qui manque.
            }
            void restaurerTousLesTrousseaux().catch(() => undefined)
          }
        }
        // ② Les demandes des autres appareils.
        for (const d of await demandesCleOuvertes()) {
          if (d.auto) {
            await servirDemandeCle(d)
            continue
          }
          if (!ecartees.current.has(d.id) && !autreFenetreOuverte()) {
            setDemande((deja) => deja ?? d)
            break
          }
        }
        // ①bis Mon aide demandée à mes contacts : arrivée ?
        if ((await aideEnAttente()) && (await relireAideContacts()).etat === "recue") {
          success(t("arch_cle_recue"))
          try {
            const { messages } = await restaurerTout()
            for (const m of messages) await cacheMessage(entreeCacheDechiffree(m))
          } catch {
            // Le rattrapage des fils reprendra ce qui manque.
          }
          void restaurerTousLesTrousseaux().catch(() => undefined)
        }
        // ②bis Ce que d'autres me demandent, en tant que contact de récupération.
        await relireRecuperation()
        // ③ La serrure périmée.
        if (!bandeauEcarte.current) setBandeau(await serrureMotDePassePerimee())
      } finally {
        enCours.current = false
        if (relancer.current) {
          relancer.current = false
          void verifier(true)
        }
      }
    },
    [moi, success, t, relireRecuperation],
  )

  /** Seulement les demandes des autres appareils : le tour léger. */
  const relireDemandes = useCallback(async () => {
    if (!moi || enCours.current || document.visibilityState !== "visible") return
    enCours.current = true
    try {
      // Les invitations et demandes d'aide en attente reviennent aussi ici.
      await relireRecuperation()
      for (const d of await demandesCleOuvertes()) {
        if (d.auto) {
          await servirDemandeCle(d)
          continue
        }
        if (!ecartees.current.has(d.id) && !autreFenetreOuverte()) {
          setDemande((deja) => deja ?? d)
          break
        }
      }
    } finally {
      enCours.current = false
    }
  }, [moi, relireRecuperation])

  useEffect(() => {
    if (!moi || surRestauration) return
    const premier = window.setTimeout(() => void verifier(true), 3000)
    const auRetour = () => {
      if (document.visibilityState === "visible") void verifier()
    }
    document.addEventListener("visibilitychange", auRetour)
    const desabonner = subscribeToSignalSauvegarde(() => void verifier(true))
    const desabonnerRecuperation = subscribeToRecuperation(() => void verifier(true))
    const releve = window.setInterval(() => void relireDemandes(), RELECTURE_DEMANDES_MS)
    return () => {
      window.clearInterval(releve)
      desabonnerRecuperation()
      window.clearTimeout(premier)
      document.removeEventListener("visibilitychange", auRetour)
      desabonner()
    }
  }, [moi, surRestauration, verifier, relireDemandes])

  const autoriser = async () => {
    if (!demande) return
    setOccupe(true)
    const ok = await servirDemandeCle(demande)
    setOccupe(false)
    if (!ok) error(t("error"))
    setDemande(null)
  }

  const refuser = async () => {
    if (!demande) return
    setOccupe(true)
    const appareil = await refuserDemandeCle(demande)
    setOccupe(false)
    if (appareil) sendSessionRevoked(appareil)
    warning(t("arch_demande_refusee_ok"))
    setDemande(null)
  }

  const repondre = async (accepte: boolean) => {
    if (!invitation) return
    setOccupe(true)
    await repondreInvitation(invitation.id, accepte)
    setOccupe(false)
    setInvitation(null)
    void relireRecuperation()
  }

  const aiderOuRefuser = async (oui: boolean) => {
    if (!aide) return
    setOccupe(true)
    const ok = oui ? await aider(aide) : await refuserAide(aide)
    setOccupe(false)
    if (oui) {
      if (ok) success(t("recup_aide_envoyee"))
      else error(t("error"))
    }
    setAide(null)
    void relireRecuperation()
  }

  const ecarter = (id: string) => {
    ecartees.current.add(id)
    setInvitation(null)
    setAide(null)
  }

  const plusTard = () => {
    if (demande) ecartees.current.add(demande.id)
    setDemande(null)
  }

  const confirmerMotDePasse = async () => {
    const mdp = saisie ?? ""
    if (!mdp || occupe) return
    setOccupe(true)
    setErreur(null)
    try {
      await verifierMotDePasseApi(mdp)
    } catch {
      setOccupe(false)
      setErreur(t("arch_mdp_incorrect"))
      return
    }
    const ok = await relierAuMotDePasse(mdp)
    setOccupe(false)
    if (ok) {
      success(t("arch_relier_ok"))
      setSaisie(null)
      setBandeau(false)
    } else {
      setErreur(t("error"))
    }
  }

  return (
    <>
      {bandeau && saisie === null && !demande && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9000,
            width: "min(560px, calc(100vw - 32px))",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 12,
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "0 8px 24px rgba(0,0,0,.18)",
            fontSize: "0.875rem",
          }}
        >
          <span style={{ flex: "1 1 220px", lineHeight: 1.45 }}>{t("arch_bandeau_perimee")}</span>
          <div className="confirmation-actions">
            <button
              type="button"
              onClick={() => {
                bandeauEcarte.current = true
                setBandeau(false)
              }}
            >
              {t("arch_plus_tard")}
            </button>
            <button type="button" className="principal" onClick={() => setSaisie("")}>
              {t("arch_bandeau_confirmer")}
            </button>
          </div>
        </div>
      )}

      {saisie !== null && (
        <div className="confirmation-voile" data-veille onClick={() => !occupe && setSaisie(null)}>
          <div
            className="confirmation-boite"
            role="dialog"
            aria-modal="true"
            aria-labelledby="veille-relier-titre"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="veille-relier-titre">{t("arch_relier_titre")}</h2>
            <p>{t("arch_relier_texte")}</p>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              aria-label={t("current_password")}
              placeholder={t("current_password")}
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmerMotDePasse()
                if (e.key === "Escape" && !occupe) setSaisie(null)
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                font: "inherit",
                fontSize: "0.9375rem",
                padding: "10px 12px",
                margin: "0 0 8px",
                borderRadius: 10,
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-base)",
                color: "var(--text-primary)",
              }}
            />
            {erreur && (
              <p role="alert" style={{ color: "var(--danger)", margin: "0 0 10px" }}>
                {erreur}
              </p>
            )}
            <div className="confirmation-actions">
              <button type="button" disabled={occupe} onClick={() => setSaisie(null)}>
                {t("arch_plus_tard")}
              </button>
              <button
                type="button"
                className="principal"
                disabled={occupe || !saisie}
                onClick={() => void confirmerMotDePasse()}
              >
                {occupe ? "…" : t("arch_bandeau_confirmer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!demande && invitation && (
        <div className="confirmation-voile" data-veille>
          <div className="confirmation-boite" role="alertdialog" aria-modal="true" aria-labelledby="recup-inv-titre">
            <h2 id="recup-inv-titre">{t("recup_titre")}</h2>
            <p>{t("recup_invitation_texte").split("{nom}").join(invitation.nom ?? "—")}</p>
            <div className="confirmation-actions" style={{ flexWrap: "wrap" }}>
              <button type="button" disabled={occupe} onClick={() => ecarter(invitation.id)}>
                {t("arch_plus_tard")}
              </button>
              <button type="button" disabled={occupe} onClick={() => void repondre(false)}>
                {t("recup_refuser")}
              </button>
              <button type="button" className="principal" disabled={occupe} onClick={() => void repondre(true)}>
                {t("recup_accepter")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!demande && !invitation && aide && (
        <div className="confirmation-voile" data-veille>
          <div className="confirmation-boite" role="alertdialog" aria-modal="true" aria-labelledby="recup-aide-titre">
            <h2 id="recup-aide-titre">{t("recup_demande_titre").split("{nom}").join(aide.nom ?? "—")}</h2>
            <p>{t("recup_demande_texte").split("{nom}").join(aide.nom ?? "—")}</p>
            <div className="confirmation-actions" style={{ flexWrap: "wrap" }}>
              <button type="button" disabled={occupe} onClick={() => ecarter(aide.id)}>
                {t("arch_plus_tard")}
              </button>
              <button type="button" className="danger" disabled={occupe} onClick={() => void aiderOuRefuser(false)}>
                {t("recup_je_refuse")}
              </button>
              <button type="button" className="principal" disabled={occupe} onClick={() => void aiderOuRefuser(true)}>
                {t("recup_aider")}
              </button>
            </div>
          </div>
        </div>
      )}

      {demande && (
        <div className="confirmation-voile" data-veille>
          <div
            className="confirmation-boite"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="veille-demande-titre"
          >
            <h2 id="veille-demande-titre">{t("arch_demande_titre")}</h2>
            <p>
              {t("arch_demande_texte").replace(
                "{appareil}",
                demande.libelle || t("arch_demande_inconnu"),
              )}
            </p>
            <div className="confirmation-actions" style={{ flexWrap: "wrap" }}>
              <button type="button" disabled={occupe} onClick={plusTard}>
                {t("arch_plus_tard")}
              </button>
              <button type="button" className="danger" disabled={occupe} onClick={() => void refuser()}>
                {t("arch_demande_refuser")}
              </button>
              <button
                type="button"
                className="principal"
                disabled={occupe}
                onClick={() => void autoriser()}
              >
                {t("arch_demande_autoriser")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
