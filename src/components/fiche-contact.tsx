import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { ApiError } from "../lib/api-client"
import {
  formatAlanyaNumber,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../lib/alanya-number"
import { loadContacts, persistContacts, type Contact } from "../data/contacts"
import { startOutgoingCall } from "../services/call-manager"
import { createPrivateChat } from "../services/chats-service"
import { addContactByPhone } from "../services/contacts-service"
import {
  contactsDepuisContenu,
  nomAffichable,
  type SharedContact,
} from "../services/message-payload"
import { useTranslation } from "../i18n"
import { useAuth } from "./auth-provider"
import { useToast } from "./toast"
import "./fiche-contact.css"

/**
 * Fiche de contact recue ou envoyee (message de type `contact`).
 *
 * Sortie de `chats/[chatId]/chat.tsx` ou elle vivait : elle n'y etait plus une
 * simple vignette de rendu mais un objet qui AGIT — repertoire, appel,
 * conversation — et la laisser au milieu de l'ecran de discussion la rendait
 * impossible a modifier sans marcher sur le reste du fichier.
 *
 * La charge utile est du JSON dans `content` — format decide par le SERVEUR,
 * voir `services/message-payload.ts`. Elle n'est PAS reinventee ici : le mobile
 * envoie deja des fiches dans cette forme, et une forme differente les rendrait
 * illisibles d'une plateforme a l'autre.
 *
 * ⚠️ Une charge illisible n'affiche PAS une carte vide : on rend la mention
 * generique, et on ne pretend pas connaitre un contact qu'on ne sait pas lire.
 */
export function FicheContact({ content, isMe }: { content: string | null; isMe: boolean }) {
  const { t } = useTranslation()
  const contacts = useMemo(() => contactsDepuisContenu(content), [content])

  if (!contacts) {
    return <div className="fc-illisible">👤 {t("fc_contact")}</div>
  }

  return (
    <div className={`fc-liste${isMe ? " est-moi" : ""}`}>
      {contacts.map((c, i) => (
        <FicheUnique key={`${c.alanyaId ?? ""}-${c.phones[0] ?? ""}-${i}`} contact={c} />
      ))}
    </div>
  )
}

/** Ce que la fiche propose pour le premier bouton, selon ce qu'on sait deja. */
type EtatRepertoire = "absent" | "en-cours" | "present"

function FicheUnique({ contact }: { contact: SharedContact }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * Numero designant la cible. `alanyaId` d'abord : c'est ce que le mobile y
   * met (`contact_share_sheet.dart` -> `alanyaId: c.publicNumber`), et c'est le
   * seul champ dont on sait qu'il porte un compte Alanya. `phones[0]` ne sert
   * que de repli, pour une fiche ecrite par un autre client.
   */
  const numero = useMemo(
    () => normalizeAlanyaNumber(contact.alanyaId ?? contact.phones[0] ?? ""),
    [contact]
  )

  /**
   * Hors Alanya : un numero qui n'a pas la forme d'un Alanya ID ne designe
   * aucun compte. Les trois actions echoueraient toutes — le serveur repondrait
   * 404 sur l'ajout comme sur la conversation. On l'annonce plutot que d'offrir
   * des boutons qui ne mènent nulle part (le mobile fait pareil : « Contact
   * hors Alanya » dans `contact_bubble.dart`).
   */
  const surAlanya = isValidAlanyaNumber(numero)

  /**
   * La fiche designe le titulaire de la session.
   *
   * Regle reprise de `MenuContact` : s'ajouter soi-meme est refuse par le
   * serveur (`POST /api/contacts` -> 400 SELF) et s'appeler soi-meme
   * n'aboutirait nulle part. Seul « ecrire » garde un sens — c'est le « Moi »,
   * ou l'on se garde des notes.
   */
  const cestMoi =
    surAlanya && numero.length > 0 && normalizeAlanyaNumber(user?.phone ?? "") === numero

  const nom = nomAffichable(contact)
  /** Numero mis en forme comme partout ailleurs : « 6 91 23 45 67 », pas un bloc de chiffres. */
  const numeroLisible = surAlanya ? formatAlanyaNumber(numero) : (contact.phones[0] ?? "")

  const [etat, setEtat] = useState<EtatRepertoire>(() =>
    dejaDansLeRepertoire(numero) ? "present" : "absent"
  )
  const [occupe, setOccupe] = useState(false)
  /** L'ecran peut etre quitte pendant l'appel reseau (navigation, message efface). */
  const monte = useRef(true)

  useEffect(() => {
    monte.current = true
    return () => {
      monte.current = false
    }
  }, [])

  /**
   * Ajoute la personne au repertoire ALANYA — celui dont l'application se sert
   * pour retrouver quelqu'un — et non au carnet d'adresses du navigateur.
   *
   * Le doublon n'est pas un echec : le serveur repond 409 ALREADY_CONTACT quand
   * le cache local ne connaissait pas encore la personne (repertoire jamais
   * charge sur cet appareil, ou contact ajoute depuis le mobile). On corrige
   * alors l'affichage au lieu d'annoncer une panne.
   */
  const ajouter = useCallback(async () => {
    if (occupe || etat !== "absent") return
    setOccupe(true)
    setEtat("en-cours")
    try {
      const enregistre = await addContactByPhone(numero, contact.name ?? undefined)
      memoriserContact(enregistre)
      if (!monte.current) return
      setEtat("present")
      toast.success(t("contact_saved"), enregistre.name)
    } catch (err) {
      if (!monte.current) return
      const code = codeErreur(err)
      if (code === "ALREADY_CONTACT") {
        // Le repertoire local etait en retard : la fiche dit desormais vrai.
        setEtat("present")
        toast.info(t("contact_exists"), t("contact_exists_detail"))
        return
      }
      setEtat("absent")
      toast.error(t("add_failed"), err instanceof Error ? err.message : undefined)
    } finally {
      if (monte.current) setOccupe(false)
    }
  }, [occupe, etat, numero, contact.name, toast, t])

  /**
   * Appeler ou ecrire. Aucune logique neuve : la conversation se cree par
   * `createPrivateChat` et l'appel part par `startOutgoingCall`, exactement
   * comme le fait `MenuContact` — et le repertoire avant lui.
   */
  const lancer = useCallback(
    async (action: "ecrire" | "appeler") => {
      if (occupe) return
      setOccupe(true)
      try {
        const conversation = await createPrivateChat(numero)
        if (action === "ecrire") {
          navigate(`/chats/${conversation.id}`)
          return
        }
        const callId = await startOutgoingCall(conversation.id, "audio", nom)
        // On emporte l'endroit d'ou l'on part : a la fin de l'appel, l'ecran y
        // ramene au lieu de deposer tout le monde sur la liste des appels.
        const depart = `${location.pathname}${location.search}`
        navigate(`/calls/${callId}?type=audio&returnTo=${encodeURIComponent(depart)}`)
      } catch (err) {
        if (!monte.current) return
        const detail = err instanceof Error ? err.message : undefined
        if (action === "ecrire") {
          toast.error(t("error"), detail ?? t("conv_create_failed"))
        } else {
          toast.error(t("call_failed"), detail ?? t("call_failed_now"))
        }
      } finally {
        if (monte.current) setOccupe(false)
      }
    },
    [occupe, numero, nom, navigate, location, toast, t]
  )

  return (
    <div className="fc-carte">
      <div className="fc-entete">
        <div className="fc-avatar">
          {contact.avatarUrl ? <img src={contact.avatarUrl} alt="" /> : nom.charAt(0).toUpperCase()}
        </div>
        <div className="fc-identite">
          <div className="fc-nom">{nom}</div>
          {numeroLisible !== "" && nom !== numeroLisible && (
            <div className="fc-numero">{numeroLisible}</div>
          )}
          {cestMoi ? (
            <div className="fc-mention">{t("fc_its_you")}</div>
          ) : surAlanya ? (
            <div className="fc-mention sur-alanya">{t("fc_on_alanya")}</div>
          ) : (
            <div className="fc-mention">{t("fc_outside_alanya")}</div>
          )}
        </div>
      </div>

      {/* Hors Alanya : aucune des trois actions ne trouverait de compte. La
          fiche reste lisible — nom et numero — sans rangee de boutons morts. */}
      {surAlanya && (
        <div className="fc-actions">
          {/* « Ajouter » sait se taire : deja dans le repertoire, la place
              annonce le fait au lieu de proposer un geste sans effet ; et sur
              sa propre fiche, ni ajout ni appel n'ont de sens. */}
          {!cestMoi &&
            (etat === "present" ? (
              <span className="fc-action etat" aria-live="polite">
                <IconeCoche />
                <span className="fc-action-texte">{t("fc_in_contacts")}</span>
              </span>
            ) : (
              <BoutonAction
                libelle={t("fc_add")}
                icone={<IconeAjouter />}
                occupe={etat === "en-cours"}
                onClick={ajouter}
              />
            ))}

          {!cestMoi && (
            <BoutonAction
              libelle={t("fc_call")}
              icone={<IconeAppeler />}
              occupe={occupe}
              onClick={() => void lancer("appeler")}
            />
          )}

          {/* Sa propre fiche : ecrire garde un sens, c'est le « Moi » ou l'on se
              garde des notes. Libelle repris de `MenuContact`, pas redouble. */}
          <BoutonAction
            libelle={cestMoi ? t("mc_note_to_self") : t("fc_message")}
            icone={<IconeMessage />}
            occupe={occupe}
            onClick={() => void lancer("ecrire")}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Un bouton de la rangee.
 *
 * La bulle porte le glissement « repondre » et devoile son menu au clic : sans
 * arreter la propagation, presser un bouton ferait aussi glisser le message.
 */
function BoutonAction({
  libelle,
  icone,
  occupe,
  onClick,
}: {
  libelle: string
  icone: React.ReactNode
  occupe: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="fc-action"
      disabled={occupe}
      title={libelle}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {icone}
      <span className="fc-action-texte">{libelle}</span>
    </button>
  )
}

/**
 * Le numero est-il deja dans le repertoire connu de cet appareil ?
 *
 * Lecture du cache local, jamais du reseau : une discussion peut afficher dix
 * fiches, et dix `GET /api/contacts` au rendu d'un fil ne se justifient pas.
 * Le cache peut etre en retard — c'est la reponse 409 du serveur qui tranche
 * alors, et l'affichage se corrige.
 */
function dejaDansLeRepertoire(numero: string): boolean {
  if (numero === "") return false
  return loadContacts().some((c) => normalizeAlanyaNumber(c.phone) === numero)
}

/**
 * Range le contact fraichement ajoute dans le cache local, pour que les autres
 * ecrans le connaissent sans attendre un rechargement.
 */
function memoriserContact(contact: Contact) {
  const connus = loadContacts()
  if (connus.some((c) => c.id === contact.id)) return
  persistContacts([...connus, contact])
}

/** Code d'erreur du backend (`{ error: { code } }`), quand il en donne un. */
function codeErreur(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null
  const charge = err.payload
  if (charge === null || typeof charge !== "object") return null
  const erreur = (charge as { error?: { code?: unknown } }).error
  if (erreur && typeof erreur === "object" && typeof erreur.code === "string") return erreur.code
  return null
}

function IconeAjouter() {
  return (
    <svg
      className="fc-icone"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15.5 20.5v-1.8a3.7 3.7 0 0 0-3.7-3.7H6a3.7 3.7 0 0 0-3.7 3.7v1.8" />
      <circle cx="8.9" cy="7.4" r="3.7" />
      <path d="M19 7.5v6M22 10.5h-6" />
    </svg>
  )
}

function IconeAppeler() {
  return (
    <svg
      className="fc-icone"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.5 16.9v2.6a1.8 1.8 0 0 1-2 1.8 17.6 17.6 0 0 1-7.7-2.7 17.4 17.4 0 0 1-5.3-5.3A17.6 17.6 0 0 1 3.8 5.5a1.8 1.8 0 0 1 1.8-2h2.6a1.8 1.8 0 0 1 1.8 1.5c.1.9.3 1.7.6 2.5a1.8 1.8 0 0 1-.4 1.9l-1.1 1.1a14 14 0 0 0 5.3 5.3l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.6.5 2.5.6a1.8 1.8 0 0 1 1.6 1.9Z" />
    </svg>
  )
}

function IconeMessage() {
  return (
    <svg
      className="fc-icone"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.9L3 20.5l1.6-4.1A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
    </svg>
  )
}

function IconeCoche() {
  return (
    <svg
      className="fc-icone"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m20 6.5-11 11-5-5" />
    </svg>
  )
}
