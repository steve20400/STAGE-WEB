import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "./auth-provider"
import { confirmer } from "./confirmation"
import { useTranslation } from "../i18n"
import { aUneCleDeRecuperation, estOuverte } from "../services/e2ee-sauvegarde"
import { getCallState } from "../services/call-manager"

/**
 * INVITER À NOTER LA CLÉ DE RÉCUPÉRATION, UNE FOIS (27/11/2026).
 *
 * 🔴 JUMELLE DE `alanya/lib/features/parametres/invitation_cle_recuperation.dart`.
 *
 * La sauvegarde est activée en silence, sans clé de récupération : la plupart
 * des comptes n'ont que la serrure « mot de passe ». Un mot de passe oublié
 * leur faisait alors perdre tout l'historique sur un nouvel appareil — et il
 * est trop tard, à ce moment-là, pour créer la clé.
 *
 * On le propose donc UNE fois par compte et par navigateur, quand l'archive
 * est ouverte et n'a pas encore de clé. « Plus tard » ne revient pas : la clé
 * reste offerte dans Réglages › Sécurité.
 *
 * ⚠️ HORS DU PRÉFIXE `alanya.e2ee.` : celui-ci est vidé à la déconnexion, et
 * l'invitation reviendrait à chaque connexion.
 *
 * Ne dessine rien : la boîte se monte d'elle-même (`confirmer`).
 */
const ATTENTE_MS = 5_000
/** Un appel en cours : on repasse plus tard, sans jamais l'interrompre. */
const ATTENTE_APPEL_MS = 60_000

function appelEnCours(): boolean {
  const etat = getCallState()
  return Boolean(etat.activeCallId || etat.incoming)
}

export function InvitationCleRecuperation() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const moi = user?.id ?? null
  const horsPropos = pathname.startsWith("/restauration") || pathname.startsWith("/calls")

  useEffect(() => {
    if (!moi || horsPropos) return
    const cle = `alanya-invitation-cle-recuperation-vue-${moi}`
    try {
      if (localStorage.getItem(cle) === "1") return
    } catch {
      return
    }
    const marquer = () => {
      try {
        localStorage.setItem(cle, "1")
      } catch {
        // stockage indisponible : l'invitation pourra revenir, sans gravité.
      }
    }
    let annule = false
    let minuterie = 0
    const essayer = async () => {
      if (annule) return
      if (appelEnCours()) {
        minuterie = window.setTimeout(() => void essayer(), ATTENTE_APPEL_MS)
        return
      }
      // Une autre fenêtre est ouverte (nom de l'appareil…) : on ne s'empile pas.
      if (document.querySelector(".pseudo-gate-overlay, .confirmation-voile")) {
        minuterie = window.setTimeout(() => void essayer(), 10_000)
        return
      }
      if (!(await estOuverte())) return
      if (await aUneCleDeRecuperation()) {
        marquer()
        return
      }
      if (annule) return
      // Marquée AVANT d'afficher : une seule fois, même si la page se ferme.
      marquer()
      const creer = await confirmer({
        titre: t("arch_invitation_titre"),
        texte: t("arch_invitation_texte"),
        confirmer: t("arch_invitation_creer"),
        annuler: t("arch_plus_tard"),
        danger: false,
      })
      if (creer) navigate("/settings?section=security")
    }
    // Après l'arrivée : ne pas se superposer à la demande du pseudo d'appareil.
    minuterie = window.setTimeout(() => void essayer(), ATTENTE_MS)
    return () => {
      annule = true
      window.clearTimeout(minuterie)
    }
  }, [moi, horsPropos, navigate, t])

  return null
}
