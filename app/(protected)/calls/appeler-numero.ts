import { useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useToast } from "../../../src/components/toast"
import { useTranslation } from "../../../src/i18n"
import { ApiError } from "../../../src/lib/api-client"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"
import { createPrivateChat } from "../../../src/services/chats-service"
import { lancerAppel } from "../../../src/services/lancer-appel"

/**
 * Les appels sortants de l'écran Appels (20/11/2026), partagés par la liste et
 * par le pavé posé dans le grand panneau : les deux composent un Alanya ID et
 * doivent appeler, et annoncer un échec, exactement de la même façon.
 */
export function useAppelsSortants() {
  const navigate = useNavigate()
  const { error } = useToast()
  const { t } = useTranslation()

  /** Un échec dit ce qui s'est passé : numéro inconnu, réseau, ou autre. */
  const signalerEchecAppel = useCallback(
    (err: unknown, cible: string) => {
      const inconnu = err instanceof ApiError && [400, 404, 422].includes(err.status)
      const reseau = err instanceof ApiError && err.status === 0
      error(
        t("call_failed"),
        inconnu
          ? t("no_account_matches").replace("{cible}", cible)
          : reseau
            ? t("server_unreachable")
            : err instanceof Error
              ? err.message
              : t("call_failed_now")
      )
    },
    [error, t]
  )

  /**
   * Appel direct d'un Alanya ID composé au clavier : le même chemin que depuis
   * la fiche d'un contact — conversation privée, puis appel sortant. S'il
   * n'existe pas, le serveur refuse la conversation et l'échec est annoncé.
   */
  const appelerNumero = useCallback(
    async (publicNumber: string, type: "audio" | "video") => {
      try {
        await lancerAppel(navigate, {
          conversation: async () => (await createPrivateChat(publicNumber)).id,
          type,
          titre: formatAlanyaNumber(publicNumber),
          returnTo: "/calls",
        })
      } catch (err) {
        signalerEchecAppel(err, formatAlanyaNumber(publicNumber))
      }
    },
    [navigate, signalerEchecAppel]
  )

  return { appelerNumero, signalerEchecAppel }
}
