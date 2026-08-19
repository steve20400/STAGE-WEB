import { useCallback, useEffect, useRef, useState } from "react"
import {
  ALANYA_NUMBER_MAX_LENGTH,
  isValidAlanyaNumber,
  normalizeAlanyaNumber,
} from "../../../src/lib/alanya-number"
import { PaveNumerique } from "../../../src/components/pave-numerique"
import { useTranslation } from "../../../src/i18n"
import "./dialer.css"

/**
 * Composeur plein ecran : le numero en cours de composition, un clavier, et le
 * choix entre appel audio et appel video. Rien d'autre, comme sur un telephone.
 *
 * Le numero saisi est un Alanya ID, pas un numero de telephone, et sa longueur
 * n'est pas imposee : le front verifie seulement que la saisie peut etre un
 * identifiant, le serveur tranche sur l'existence du compte.
 *
 * CE QUI VIENT DU PAVE PARTAGE, et pourquoi. L'ecran du numero, les douze
 * touches et l'effacement sont ceux de `PaveNumerique` : ils etaient ecrits ici
 * une premiere fois, et une seconde dans la fenetre des listes de contacts, ou
 * ils ont depuis appris a montrer le NOM DU TITULAIRE sous les chiffres. Deux
 * claviers qui divergent, c'est un utilisateur qui apprend deux fois la meme
 * chose ; c'est aussi une amelioration livree a un seul des deux endroits. Ce
 * qui reste ici, c'est ce qui fait de ce composeur un ECRAN et non un bloc :
 * la fermeture, la ligne d'etat de la saisie et les deux boutons d'appel.
 */
export function Dialer({
  onClose,
  onCall,
}: {
  onClose: () => void
  /** Recoit les chiffres seuls, sans les espaces d'affichage, et le type d'appel. */
  onCall: (number: string, type: "audio" | "video") => void
}) {
  const { t } = useTranslation()
  const [digits, setDigits] = useState("")
  const valide = isValidAlanyaNumber(digits)

  /**
   * Enveloppe du pave, tenue pour une seule raison : savoir si une frappe a
   * DEJA ete traitee par lui (voir l'ecoute du clavier physique plus bas).
   */
  const zonePave = useRef<HTMLDivElement>(null)

  const taper = useCallback((touche: string) => {
    setDigits((courant) =>
      normalizeAlanyaNumber(courant + touche).slice(0, ALANYA_NUMBER_MAX_LENGTH)
    )
  }, [])

  const effacer = useCallback(() => setDigits((courant) => courant.slice(0, -1)), [])

  const appeler = useCallback(
    (type: "audio" | "video") => {
      if (isValidAlanyaNumber(digits)) onCall(normalizeAlanyaNumber(digits), type)
    },
    [digits, onCall]
  )

  /**
   * Le clavier physique doit marcher aussi : on est sur un navigateur, pas
   * seulement sur un telephone. Deux ecoutes se partagent desormais le travail,
   * et le partage est la seule subtilite de ce fichier.
   *
   * Le pave, lui, ecoute sur SA racine — il est fait pour vivre dans une fenetre
   * qui contient d'autres champs de saisie, et un ecouteur global y volerait les
   * chiffres tapes ailleurs. Il prend le focus a l'affichage (`autoFocus`), donc
   * chiffres, retour arriere et Entree lui arrivent tant que le focus y reste.
   *
   * Cette ecoute-ci reste sur `document` parce que ce composeur occupe l'ecran
   * entier : le focus peut le quitter — un clic sur le fond, sur la croix de
   * fermeture, sur un bouton d'appel — et le clavier physique doit continuer de
   * composer, comme avant la migration. D'ou la GARDE : une frappe partie de
   * l'interieur du pave a deja ete traitee par lui, et la retraiter ici
   * doublerait chaque chiffre.
   */
  useEffect(() => {
    const surFrappe = (evenement: KeyboardEvent) => {
      // Echap ferme, d'ou que vienne la frappe : le pave laisse expressement
      // passer cette touche a la fenetre qui le porte.
      if (evenement.key === "Escape") return onClose()

      const cible = evenement.target
      if (cible instanceof Node && zonePave.current?.contains(cible)) return

      if (evenement.key === "Enter") {
        // Entree sur un bouton, c'est presser CE bouton : le navigateur en fait
        // deja un clic. Appeler en plus lancerait un appel au moment ou l'on
        // ferme le composeur, ou doublerait l'appel video d'un appel audio.
        if (cible instanceof HTMLElement && cible.closest("button")) return
        // Entree lance un appel audio, le cas courant.
        return appeler("audio")
      }
      if (evenement.key === "Backspace") {
        // Sans cela, certains navigateurs remontent d'une page a la frappe d'un
        // retour arriere hors champ de saisie.
        evenement.preventDefault()
        return effacer()
      }
      if (/^[0-9]$/.test(evenement.key)) taper(evenement.key)
    }
    document.addEventListener("keydown", surFrappe)
    return () => document.removeEventListener("keydown", surFrappe)
  }, [appeler, effacer, onClose, taper])

  return (
    <div className="dialer-root" role="dialog" aria-label={t("a2_dial_dialog")}>
      <button className="dialer-close" onClick={onClose} aria-label={t("a2_close_keypad")}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="dialer-pave" ref={zonePave}>
        {/* `afficherTitulaire` : le NOM COMPLET du titulaire se lit sous les
            chiffres, dans l'ecran du pave. Il remplace la reconnaissance de
            contact que ce fichier faisait lui-meme sur le repertoire local, et
            ne s'y ajoute pas — une seule ligne de nom, sinon deux reponses a la
            meme question se contrediraient des que le repertoire est en retard
            sur le serveur. Ce qu'on y gagne : le repertoire local ne connait que
            les contacts enregistres, la recherche connait tous les comptes, donc
            un numero compose au hasard cesse d'etre annonce « introuvable »
            alors qu'il est parfaitement joignable.

            Pas de `sousLeNumero` ici : ce prop l'emporterait sur la recherche. */}
        <PaveNumerique
          valeur={digits}
          onChange={setDigits}
          onValider={() => appeler("audio")}
          autoFocus
          afficherTitulaire
        />
      </div>

      <div className="dialer-pied">
        {/* L'etat de la SAISIE, qui n'est pas celui du numero : il dit si l'on
            peut appeler, la ou la ligne du titulaire dit qui l'on appelle. */}
        <div className="dialer-hint">
          {digits.length === 0
            ? t("dial_hint_number")
            : valide
              ? t("dial_ready")
              : t("digits_too_short", { n: digits.length })}
        </div>

        {/* Deux appels possibles depuis un numero compose, comme depuis une fiche
            de contact : la voix, ou la video. */}
        <div className="dialer-actions">
          <button
            className="dialer-call audio"
            onClick={() => appeler("audio")}
            disabled={!valide}
            aria-label={t("audio_call")}
            title={valide ? t("audio_call") : t("dial_a_number")}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
          </button>
          <button
            className="dialer-call video"
            onClick={() => appeler("video")}
            disabled={!valide}
            aria-label={t("video_call")}
            title={valide ? t("video_call") : t("dial_a_number")}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
