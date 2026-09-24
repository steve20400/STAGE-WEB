import { useEffect, useState } from "react"
import QRCode from "qrcode"
import {
  empreintesPour,
  enGroupes,
  marquerVerifie,
  retirerVerification,
  type Empreinte,
} from "../../../../src/services/e2ee-empreinte"
import { oublierAvertissement } from "../../../../src/services/e2ee-store"
import { useTranslation } from "../../../../src/i18n"
import "./e2ee-verification.css"

/**
 * L'ÉCRAN DE COMPARAISON DES CODES DE SÉCURITÉ.
 *
 * 🔴 CET ÉCRAN NE VÉRIFIE RIEN PAR LUI-MÊME. C'est une aide à une vérification
 * que SEUL L'UTILISATEUR peut faire, et qui se fait AILLEURS : au téléphone, en
 * face à face, par un canal que le serveur ne contrôle pas.
 *
 * Tout ce qu'il fait, c'est afficher un nombre et demander « le voyez-vous tous
 * les deux ? ». Envoyer ce code DANS la conversation qu'il doit vérifier ne
 * prouverait rien — un serveur qui s'interpose réécrirait le message.
 *
 * ⚠️ LE QR EST ARRIVÉ AVEC LE CLIENT MOBILE, et pas avant : un QR affiché sans
 * lecteur en face est de la décoration, personne ne peut le comparer. Maintenant
 * qu'un téléphone a une caméra, il sert — on scanne l'écran de l'autre.
 *
 * 🔴 IL ENCODE LE CODE LUI-MÊME, RIEN D'AUTRE. Deux formats différents — l'un
 * pour l'œil, l'autre pour la caméra — peuvent DIVERGER, et le défaut ne se
 * verrait qu'au moment où quelqu'un essaie vraiment de vérifier, c'est-à-dire
 * quand il s'inquiète. En scannant exactement ce qui est écrit, la divergence
 * devient impossible par construction.
 *
 * ⚠️ LE QR N'AJOUTE AUCUNE SÉCURITÉ, seulement de la COMMODITÉ : comparer
 * soixante chiffres à l'œil est pénible et on se trompe. La garantie reste la
 * même — être EN FACE, hors du canal qu'on vérifie.
 */
export function E2eeVerification({
  peerUserId,
  peerName,
  onClose,
}: {
  peerUserId: string
  peerName: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [etat, setEtat] = useState<"calcul" | "pret">("calcul")
  const [empreintes, setEmpreintes] = useState<Empreinte[]>([])

  /**
   * Les QR, un par appareil, en images de données.
   *
   * ⚠️ FABRIQUÉS DANS UN EFFET, PAS AU RENDU : la génération est asynchrone, et
   * l'appeler pendant le rendu produirait un écran qui clignote à chaque
   * passage de React.
   */
  const [qr, setQr] = useState<Record<number, string>>({})

  useEffect(() => {
    let vivant = true
    void Promise.all(
      empreintes.map(async (e) => {
        /*
         * 🔴 LE MÊME PRÉFIXE QUE LE MOBILE — `alanya-e2ee:1:`. Il est écrit ici
         * et dans `alanya/lib/services/e2ee/e2ee_service.dart`. Les faire
         * diverger rendrait les QR illisibles d'un client à l'autre, et le
         * défaut ne se verrait qu'au moment d'une vraie vérification.
         */
        const image = await QRCode.toDataURL(`alanya-e2ee:1:${e.code}`, {
          margin: 1,
          width: 200,
          errorCorrectionLevel: "M",
        })
        return [e.deviceId, image] as const
      }),
    ).then((paires) => {
      if (vivant) setQr(Object.fromEntries(paires))
    })
    return () => {
      vivant = false
    }
  }, [empreintes])

  async function recharger() {
    const liste = await empreintesPour(peerUserId)
    setEmpreintes(liste)
    setEtat("pret")
  }

  useEffect(() => {
    let vivant = true
    /*
     * ⚠️ LE CALCUL PREND ~450 ms PAR APPAREIL, et c'est normal : 5 200
     * itérations de SHA-512 sont ce qui rend une collision hors de portée. On
     * annonce donc l'attente au lieu de laisser l'écran vide — un écran vide se
     * lit comme une panne.
     */
    void empreintesPour(peerUserId).then((liste) => {
      if (!vivant) return
      setEmpreintes(liste)
      setEtat("pret")
    })
    return () => {
      vivant = false
    }
  }, [peerUserId])

  async function basculer(e: Empreinte) {
    if (e.verifie) {
      await retirerVerification(peerUserId, e.deviceId)
    } else {
      await marquerVerifie(peerUserId, e.deviceId)
      /*
       * ⚠️ L'AVERTISSEMENT DE CHANGEMENT DE CLÉ S'EFFACE ICI, et seulement ici.
       * L'utilisateur vient de faire ce que l'alerte lui demandait : comparer.
       * Le laisser en place après coup apprendrait à l'ignorer.
       *
       * ⚠️ LA LISTE DES AVERTISSEMENTS RETIENT LE COMPTE, PAS L'APPAREIL —
       * `clesChangees.add(identifiant.split(".")[0])` dans `e2ee-store`. Lui
       * passer une adresse `compte.appareil` ne retirerait rien, en silence :
       * l'alerte serait restée affichée après une comparaison réussie.
       */
      oublierAvertissement(peerUserId)
    }
    await recharger()
  }

  return (
    <div className="e2ee-verif-fond" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="e2ee-verif" onClick={(ev) => ev.stopPropagation()}>
        <header>
          <h2>{t("e2ee_verif_titre")}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <p className="e2ee-verif-mode-emploi">
          {t("e2ee_verif_mode_emploi").replace("{nom}", peerName)}
        </p>

        {etat === "calcul" && <p className="e2ee-verif-calcul">{t("e2ee_verif_calcul")}</p>}

        {etat === "pret" && empreintes.length === 0 && (
          /*
           * ⚠️ AUCUN APPAREIL CONNU N'EST UN CAS NORMAL, pas une erreur : on n'a
           * encore échangé aucun message chiffré avec cette personne. Inventer
           * un code ici serait pire que de ne rien montrer.
           */
          <p className="e2ee-verif-vide">{t("e2ee_verif_aucun")}</p>
        )}

        {etat === "pret" &&
          empreintes.map((e) => (
            <section key={e.deviceId} className="e2ee-verif-appareil">
              {empreintes.length > 1 && (
                /*
                 * ⚠️ LE NUMÉRO D'APPAREIL N'APPARAÎT QUE S'IL Y EN A PLUSIEURS.
                 * Dans le cas courant — un appareil — il n'apporte rien et
                 * transforme un écran simple en écran technique.
                 */
                <div className="e2ee-verif-appareil-nom">
                  {t("e2ee_verif_appareil").replace("{n}", String(e.deviceId))}
                </div>
              )}

              <div className="e2ee-verif-code">
                {enGroupes(e.code).map((groupe, i) => (
                  <span key={i}>{groupe}</span>
                ))}
              </div>

              {/*
                ⚠️ LE QR VIENT APRÈS LE CODE, jamais à sa place. Sur deux
                ordinateurs il n'y a pas de caméra : les chiffres restent le
                seul moyen, et les cacher derrière une image les rendrait
                inaccessibles là où ils sont indispensables.
              */}
              {qr[e.deviceId] && (
                <img
                  className="e2ee-verif-qr"
                  src={qr[e.deviceId]}
                  alt={t("e2ee_verif_qr_alt")}
                />
              )}

              <button
                type="button"
                className={e.verifie ? "e2ee-verif-btn verifie" : "e2ee-verif-btn"}
                onClick={() => void basculer(e)}
              >
                {e.verifie ? (
                  <>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    {t("e2ee_verif_fait")}
                  </>
                ) : (
                  t("e2ee_verif_marquer")
                )}
              </button>
            </section>
          ))}

        {/*
          ⚠️ CE QUE LA VÉRIFICATION NE FAIT PAS, ÉCRIT SUR L'ÉCRAN.

          Décision du user (23/09/2026) : modèle WhatsApp — on avertit, on ne
          bloque jamais. Il faut donc le dire ici, sans quoi « vérifié » se
          lirait comme une garantie que les messages seront retenus si quelque
          chose change. Ils ne le seront pas.
        */}
        <p className="e2ee-verif-limite">{t("e2ee_verif_limite")}</p>
      </div>
    </div>
  )
}
