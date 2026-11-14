import { useEffect, useState } from "react"
import { loadContacts } from "../data/contacts"
import { normalizeAlanyaNumber } from "../lib/alanya-number"
import { getMyUserId } from "../data/session-user"
import { fetchContactsDuServeur } from "../services/contacts-service"

/**
 * CE NUMÉRO EST-IL DANS MES CONTACTS ? — pour le bandeau « cette personne ne
 * fait pas partie de vos contacts » (`components/enregistrer-inconnu.tsx`).
 *
 * ⚠️ ON N'AFFIRME RIEN SUR UN DOUTE. Le cache local peut être vide (premier
 * passage sur cet appareil) ou en retard (contact ajouté depuis le
 * téléphone) : ne pas y trouver quelqu'un ne prouve rien. La réponse « non »
 * vient donc du répertoire DU SERVEUR, lu une fois par chargement de page ;
 * serveur injoignable, la réponse reste « je ne sais pas ».
 */

const chiffres = (numero: string) => normalizeAlanyaNumber(numero)

/** Lecture du répertoire du serveur, faite UNE fois par chargement de page. */
let lecture: Promise<Set<string>> | null = null
/** Numéros enregistrés depuis : la lecture ci-dessus ne les connaît pas. */
const ajoutes = new Set<string>()
const auditeurs = new Set<() => void>()
/**
 * Le compte pour lequel tout cela vaut. ⚠️ Se déconnecter ne recharge pas la
 * page : sans cette garde, le compte suivant hériterait du répertoire du
 * précédent, et le bandeau se tairait devant ses vrais inconnus.
 */
let compte: string | null = null

function memeCompte() {
  const actuel = getMyUserId() ?? null
  if (actuel === compte) return
  compte = actuel
  lecture = null
  ajoutes.clear()
}

function numerosDuServeur(): Promise<Set<string>> {
  memeCompte()
  if (!lecture) {
    lecture = fetchContactsDuServeur()
      .then((contacts) => new Set(contacts.map((c) => chiffres(c.phone))))
      .catch((err) => {
        // Pas de mémoire d'un échec : la prochaine discussion réessaiera.
        lecture = null
        throw err
      })
  }
  return lecture
}

/** Un contact vient d'être enregistré : tous les écrans qui le guettent le savent. */
export function signalerAjout(numero: string) {
  memeCompte()
  ajoutes.add(chiffres(numero))
  auditeurs.forEach((f) => f())
}

function dansLeCache(numero: string): boolean {
  return loadContacts().some((c) => chiffres(c.phone) === numero)
}

/**
 * Ce numéro est-il dans mes contacts ? `true`, `false`, ou `null` tant qu'on
 * ne SAIT pas — et `null` ne doit rien faire afficher.
 */
export function useEstContact(numero: string | null | undefined): boolean | null {
  const n = numero ? chiffres(numero) : ""
  const [etat, setEtat] = useState<boolean | null>(() =>
    n && (ajoutes.has(n) || dansLeCache(n)) ? true : null
  )

  useEffect(() => {
    if (!n) {
      setEtat(null)
      return
    }
    memeCompte()
    // Présent dans le cache : c'est un contact. Le contraire, lui, se vérifie.
    if (ajoutes.has(n) || dansLeCache(n)) {
      setEtat(true)
      return
    }
    setEtat(null)
    let vivant = true
    numerosDuServeur()
      .then((connus) => {
        if (vivant) setEtat(connus.has(n) || ajoutes.has(n))
      })
      .catch(() => undefined)
    const suivre = () => {
      if (vivant && ajoutes.has(n)) setEtat(true)
    }
    auditeurs.add(suivre)
    return () => {
      vivant = false
      auditeurs.delete(suivre)
    }
  }, [n])

  return etat
}
