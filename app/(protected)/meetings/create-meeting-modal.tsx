import { useEffect, useMemo, useState } from "react"
import { useToast } from "../../../src/components/toast"
import { NomDuTitulaire } from "../../../src/components/nom-du-titulaire"
import { loadContacts } from "../../../src/data/contacts"
import { fetchContacts } from "../../../src/services/contacts-service"
import {
  isValidAlanyaNumber,
  formatAlanyaNumber,
  normalizeAlanyaNumber,
} from "../../../src/lib/alanya-number"
import { normalizePhoneNumber } from "../../../src/data/session-user"
import {
  chargerPlafondsReunion,
  createMeeting,
  lireRefusPlafond,
  placesRestantes,
  refusPlafondEnMots,
  type PlafondsReunion,
} from "../../../src/services/meetings-service"
import { useTranslation } from "../../../src/i18n"

interface CreateMeetingModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

/**
 * Duree en secondes, deduite des deux horaires.
 *
 * Le formulaire demandait une duree en secondes — une question a laquelle
 * personne ne repond en pensant « 3600 ». On saisit un debut et une fin ; la
 * duree s'en deduit. Sans les deux, on laisse le serveur poser sa valeur par
 * defaut plutot que d'en inventer une.
 *
 * Bornee comme le serveur la borne : une fin anterieure au debut, ou au-dela
 * de vingt-quatre heures, ferait rejeter la creation entiere.
 */
function dureeDeduite(debut: string, fin: string): number | undefined {
  if (!debut || !fin) return undefined
  const secondes = Math.round((new Date(fin).getTime() - new Date(debut).getTime()) / 1000)
  if (!Number.isFinite(secondes) || secondes < 1) return undefined
  return Math.min(secondes, 86400)
}

export function CreateMeetingModal({ isOpen, onClose, onSuccess }: CreateMeetingModalProps) {
  const { t } = useTranslation()
  const { success, error: showError } = useToast()

  const [step, setStep] = useState<"details" | "participants">("details")
  const [objet, setObjet] = useState("")
  const [typeMedia, setTypeMedia] = useState(1)
  const [duree, setDuree] = useState("3600")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")
  const [manualNumber, setManualNumber] = useState("")
  const [contacts, setContacts] = useState(() => loadContacts())
  const [loading, setLoading] = useState(false)
  /**
   * Les plafonds tels que LE SERVEUR les applique a mes reunions. Nuls tant
   * qu'ils n'ont pas ete obtenus — et durablement nuls si la route n'existe pas
   * encore. Aucun repli en dur : voir `chargerPlafondsReunion`.
   */
  const [plafonds, setPlafonds] = useState<PlafondsReunion | null>(null)

  useEffect(() => {
    void fetchContacts()
      .then(setContacts)
      .catch(() => undefined)
  }, [])

  /**
   * Relus a CHAQUE ouverture, et non une fois pour la vie de l'onglet : un
   * exploitant peut avoir change le plafond depuis, et une session de web reste
   * ouverte des journees entieres.
   */
  useEffect(() => {
    if (!isOpen) return
    let vivant = true
    void chargerPlafondsReunion().then((p) => {
      if (vivant) setPlafonds(p)
    })
    return () => {
      vivant = false
    }
  }, [isOpen])

  /**
   * LE COMPTE DES PLACES, tel que le serveur le tient.
   *
   * `occupants` compte l'organisateur — c'est-a-dire MOI, qui cree la reunion —
   * en plus des invites choisis. C'est la convention du serveur, et ne pas la
   * suivre rendrait le compteur faux d'une unite : il annoncerait une derniere
   * place que la creation refuserait.
   *
   * Tout est nul quand les plafonds sont inconnus : pas de compteur invente.
   */
  const capacite = useMemo(() => {
    if (!plafonds) return null
    const plafond = typeMedia === 2 ? plafonds.video : plafonds.audio
    const occupants = selectedParticipants.size + 1
    return {
      plafond,
      occupants,
      restantes: placesRestantes(plafond, occupants),
      depasse: occupants > plafond,
    }
  }, [plafonds, typeMedia, selectedParticipants])

  /**
   * LE CHANGEMENT DE TYPE, DIT AU MOMENT OU IL SE FAIT.
   *
   * Une reunion video plafonne plus bas qu'une audio. Quelqu'un qui a choisi
   * huit personnes en audio, puis bascule en video, doit l'apprendre sur-le-champ
   * — pas apres avoir clique sur « Creer ». L'avis est donc un ETAT DERIVE et non
   * un message lance par le clic : il apparait a l'instant ou la case change, et
   * s'efface de lui-meme des qu'on retire assez de monde ou qu'on revient a
   * l'audio.
   */
  const avisBasculeVideo =
    plafonds && typeMedia === 2 && capacite?.depasse
      ? t("meet_cap_switch_video", {
          choisis: selectedParticipants.size,
          video: plafonds.video,
          audio: plafonds.audio,
        })
      : null

  /**
   * Le compteur, ecrit une fois et pose aux deux etapes : sous le choix du type,
   * et en tete de la liste des contacts. Deux copies du meme JSX auraient fini
   * par diverger.
   *
   * `aria-live` : le nombre change a chaque case cochee sans qu'aucun focus ne
   * bouge. Sans annonce, un lecteur d'ecran ne dirait jamais qu'il ne reste
   * qu'une place.
   */
  const compteurPlaces = capacite ? (
    <p
      className={`meeting-capacite${capacite.restantes === 0 ? " pleine" : ""}`}
      aria-live="polite"
    >
      {capacite.restantes > 0
        ? t("meet_cap_seats", { restantes: capacite.restantes, plafond: capacite.plafond })
        : t("meet_cap_seats_none", { plafond: capacite.plafond })}
    </p>
  ) : null

  /**
   * Plus une place : on cesse d'accepter de NOUVEAUX choix.
   *
   * On ne verrouille que l'ajout, jamais le retrait — une case deja cochee reste
   * decochable, sans quoi une liste trop grande deviendrait un cul-de-sac. Et
   * rien n'est verrouille tant que les plafonds sont inconnus : un ecran qui
   * refuse sans savoir pourquoi serait pire que pas de garde-fou du tout.
   */
  const plusDePlace = capacite !== null && capacite.restantes === 0
  const filteredContacts = searchQuery.trim()
    ? contacts.filter((c) => {
        const query = searchQuery.toLowerCase()
        return (
          c.name.toLowerCase().includes(query) ||
          normalizePhoneNumber(c.phone).includes(normalizePhoneNumber(searchQuery))
        )
      })
    : contacts

  const handleCreate = async () => {
    if (!objet.trim()) {
      showError(t("meet_subject_required"), t("meet_subject_required_detail"))
      return
    }

    setLoading(true)
    try {
      const numeros = Array.from(selectedParticipants)
      await createMeeting({
        objet: objet.trim(),
        type: typeMedia === 2 ? "video" : "audio",
        // Le champ datetime-local rend « 2026-08-10T14:30 » : ni secondes, ni
        // fuseau. Le serveur exige un ISO complet et refusait la creation avec
        // un laconique « donnees invalides ». La conversion regle aussi le
        // fuseau : on saisit une heure locale, le serveur stocke de l'UTC.
        debut: startTime ? new Date(startTime).toISOString() : undefined,
        dureeSecondes: dureeDeduite(startTime, endTime),
        numerosInvites: numeros.length > 0 ? numeros : undefined,
      })
      success(t("meet_created"))
      setObjet("")
      setTypeMedia(1)
      setDuree("3600")
      setStartTime("")
      setEndTime("")
      setSelectedParticipants(new Set())
      setStep("details")
      onClose()
      onSuccess()
    } catch (err) {
      /*
       * LE REFUS DE PLAFOND N'EST PAS UNE ERREUR COMME LES AUTRES.
       *
       * Le serveur en donne les nombres exacts ; sa phrase, elle, est en
       * francais et ne sortirait pas d'ici dans une autre langue. On la refait
       * donc, et surtout on ajoute CE QU'IL FAUT FAIRE — l'audio accueille plus
       * de monde. Un refus qui n'ouvre aucune porte ne fait que bloquer.
       */
      const refus = lireRefusPlafond(err)
      if (refus) {
        const { titre, texte } = refusPlafondEnMots({ refus, plafonds, creation: true, t })
        showError(titre, texte)
      } else {
        showError(err instanceof Error ? err.message : t("meet_create_failed"))
      }
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("meet_create")}</h2>
          <button className="modal-close" onClick={onClose} aria-label={t("close")}>
            ✕
          </button>
        </div>

        {step === "details" ? (
          <div className="modal-body">
            <div className="form-group">
              <label>{t("meet_subject")} *</label>
              <input
                type="text"
                placeholder={t("meet_subject_placeholder")}
                value={objet}
                onChange={(e) => setObjet(e.target.value)}
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label>{t("meet_type")}</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    value="1"
                    checked={typeMedia === 1}
                    onChange={() => setTypeMedia(1)}
                  />
                  {t("cinfo_audio")}
                </label>
                <label>
                  <input
                    type="radio"
                    value="2"
                    checked={typeMedia === 2}
                    onChange={() => setTypeMedia(2)}
                  />
                  {t("video_label")}
                </label>
              </div>
              {/* COMBIEN DE MONDE TIENT DANS CHAQUE TYPE, avant meme d'ouvrir la
                  liste des contacts. C'est la seule information qui rende le
                  choix audio/video eclaire — et la seule qui evite de composer
                  une liste de douze personnes pour se la faire refuser. Absent
                  si le serveur n'a pas donne ses chiffres : on n'en invente
                  aucun. */}
              {plafonds && (
                <p className="meeting-capacite-note">
                  {t("meet_cap_hint", { video: plafonds.video, audio: plafonds.audio })}
                </p>
              )}
              {avisBasculeVideo && (
                <p className="meeting-capacite-avis" role="status">
                  {avisBasculeVideo}
                </p>
              )}
            </div>

            <div className="form-group">
              <label>{t("meet_start_time")}</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>{t("meet_end_time")}</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>{t("meet_participants", { count: selectedParticipants.size })}</label>
              {compteurPlaces}
              <button className="btn-secondary" onClick={() => setStep("participants")}>
                {t("meet_add_participants")}
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            {/* LE COMPTEUR EST EN TETE DE LA LISTE, pas au pied : il doit se lire
                PENDANT qu'on coche, pas apres. C'est tout l'ecart entre prevenir
                et punir. */}
            {compteurPlaces}
            {avisBasculeVideo && (
              <p className="meeting-capacite-avis" role="status">
                {avisBasculeVideo}
              </p>
            )}
            <input
              type="text"
              placeholder={t("meet_search_placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
              autoFocus
            />

            {/* La marge passe du bloc de saisie a cette colonne : le nom du
                titulaire doit rester COLLE aux chiffres, et la rangee, elle,
                garde son ecart avec ce qui l'entoure. */}
            <div style={{ margin: "10px 0" }}>
              <div className="meeting-direct-id" style={{ margin: 0 }}>
                <input
                  value={formatAlanyaNumber(manualNumber)}
                  onChange={(e) => setManualNumber(normalizeAlanyaNumber(e.target.value))}
                  placeholder={t("alanya_id_placeholder")}
                  inputMode="numeric"
                />
                {/* Le libelle etait en francais dans le code : les onze autres
                    langues lisaient « Ajouter » sur ce bouton. */}
                <button
                  type="button"
                  disabled={!isValidAlanyaNumber(manualNumber) || plusDePlace}
                  onClick={() => {
                    setSelectedParticipants((prev) =>
                      new Set(prev).add(normalizeAlanyaNumber(manualNumber))
                    )
                    setManualNumber("")
                  }}
                >
                  {t("l2_add")}
                </button>
              </div>
              {/* Un participant ajoute par son numero n'apparait ensuite que
                  sous forme de compte : c'est ICI, avant l'ajout, que l'on peut
                  encore verifier qui l'on invite. */}
              <NomDuTitulaire numero={manualNumber} style={{ marginTop: 4 }} />
            </div>

            <div className="participants-list">
              {filteredContacts.map((contact) => (
                <label
                  key={contact.id}
                  className={`participant-item${
                    plusDePlace && !selectedParticipants.has(contact.phone) ? " hors-plafond" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedParticipants.has(contact.phone)}
                    disabled={plusDePlace && !selectedParticipants.has(contact.phone)}
                    onChange={(e) => {
                      const next = new Set(selectedParticipants)
                      if (e.target.checked) {
                        next.add(contact.phone)
                      } else {
                        next.delete(contact.phone)
                      }
                      setSelectedParticipants(next)
                    }}
                  />
                  <div className="participant-info">
                    <div>{contact.name}</div>
                    <small>{normalizePhoneNumber(contact.phone)}</small>
                  </div>
                </label>
              ))}
              {filteredContacts.length === 0 && (
                <div className="empty-search">
                  {searchQuery ? t("meet_no_contact_found") : t("meet_no_contact")}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="modal-footer">
          {step === "participants" && (
            <button className="btn-secondary" onClick={() => setStep("details")}>
              {t("back")}
            </button>
          )}
          <button
            className="btn-primary"
            onClick={step === "details" ? () => setStep("participants") : handleCreate}
            disabled={loading || (step === "details" && !objet.trim())}
          >
            {loading
              ? t("meet_creating")
              : step === "details"
                ? t("meet_next")
                : t("meet_create_btn")}
          </button>
        </div>
      </div>
    </div>
  )
}
