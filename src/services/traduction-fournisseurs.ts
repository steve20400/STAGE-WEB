import { apiRequest } from "../lib/api-client"
import { traduire, type Cle, type LanguageCode } from "../i18n"

/**
 * Les moteurs de traduction proposables, et ce que le serveur en dit.
 *
 * POURQUOI CE FICHIER. Le choix du moteur est devenu un reglage : les
 * Parametres affichent la liste des moteurs avec leur prix, l'utilisateur en
 * designe un, et c'est celui-la qui traduit. Deux choses ne peuvent pas etre
 * ecrites en dur ici :
 *  - la DISPONIBILITE. Un moteur dont la cle manque cote serveur echouerait au
 *    premier message ; seul le serveur sait lesquels sont configures.
 *  - le PRIX. Les tarifs bougent. Les figer dans le client obligerait a
 *    redeployer le web pour corriger un chiffre, et un prix faux affiche a
 *    l'utilisateur est pire qu'un prix absent.
 *
 * Ce que le client possede, en revanche, c'est la LISTE COMPLETE des moteurs
 * que l'application connait, et les libelles. Elle sert a montrer desactive,
 * avec sa raison, un moteur que le serveur n'annonce pas : masquer une option
 * en silence laisserait croire qu'elle n'existe pas.
 */

/* ---------------------------------------------------------------- Moteurs */

export type CodeMoteur = "navigateur" | "azure" | "google" | "deepl" | "libretranslate"

/**
 * Ordre de repli, du plus recommandable au moins : il ne sert qu'aux moteurs
 * que le serveur n'annonce pas, ceux-la n'ayant ni prix ni rang a donner.
 * L'ordre d'affichage reel vient du serveur, prix croissant.
 */
export const MOTEURS_CONNUS: readonly CodeMoteur[] = [
  "navigateur",
  "azure",
  "google",
  "deepl",
  "libretranslate",
] as const

/**
 * Le moteur du navigateur est le defaut, et le serveur l'annonce comme tel.
 * Cette constante n'est qu'un repli hors ligne : gratuit ET rien ne sort de
 * l'appareil, c'est le seul choix qui gagne sur les deux tableaux.
 */
export const MOTEUR_PAR_DEFAUT: CodeMoteur = "navigateur"

export function estCodeMoteur(valeur: unknown): valeur is CodeMoteur {
  return typeof valeur === "string" && (MOTEURS_CONNUS as readonly string[]).includes(valeur)
}

/** Vrai pour les moteurs qui tournent sur l'appareil et ne passent pas par le relais. */
export function moteurSurAppareil(moteur: CodeMoteur): boolean {
  return moteur === "navigateur"
}

/* ---------------------------------------------------------------- Libelles */

const CLE_NOM: Record<CodeMoteur, Cle> = {
  navigateur: "trad_engine_name_navigateur",
  azure: "trad_engine_name_azure",
  google: "trad_engine_name_google",
  deepl: "trad_engine_name_deepl",
  libretranslate: "trad_engine_name_libretranslate",
}

const CLE_NOTE: Record<CodeMoteur, Cle> = {
  navigateur: "trad_engine_note_navigateur",
  azure: "trad_engine_note_azure",
  google: "trad_engine_note_google",
  deepl: "trad_engine_note_deepl",
  libretranslate: "trad_engine_note_libretranslate",
}

/** Nom affichable d'un moteur. La langue est passee, jamais figee a l'import. */
export function nomMoteur(moteur: CodeMoteur, langue: LanguageCode): string {
  return traduire(langue, CLE_NOM[moteur])
}

/** Ce qu'il faut savoir avant de choisir ce moteur : cout, trajet, qualite. */
export function noteMoteur(moteur: CodeMoteur): Cle {
  return CLE_NOTE[moteur]
}

/* ------------------------------------------------------- Liste du serveur */

/** Un moteur tel que le serveur l'annonce : voir GET /api/translate/providers. */
export interface FournisseurAnnonce {
  id: CodeMoteur
  surAppareil: boolean
  gratuit: boolean
  /** Dollars par million de caracteres, tels que le serveur les publie. */
  prixParMillion: number
  devise: string
}

export interface CatalogueFournisseurs {
  defaut: CodeMoteur
  fournisseurs: FournisseurAnnonce[]
}

interface ReponseFournisseurs {
  defaut?: unknown
  fournisseurs?: unknown
}

function lireFournisseur(brut: unknown): FournisseurAnnonce | null {
  if (!brut || typeof brut !== "object") return null
  const entree = brut as Record<string, unknown>
  if (!estCodeMoteur(entree.id)) return null
  const prix = typeof entree.prixParMillion === "number" ? entree.prixParMillion : 0
  return {
    id: entree.id,
    surAppareil: entree.surAppareil === true,
    gratuit: entree.gratuit === true || prix === 0,
    prixParMillion: prix,
    devise: typeof entree.devise === "string" ? entree.devise : "USD",
  }
}

/**
 * La liste ne change qu'au redeploiement du serveur : une lecture par session
 * suffit, et la promesse est partagee pour que deux ouvertures des Parametres
 * ne fassent pas deux requetes.
 */
let enVol: Promise<CatalogueFournisseurs> | null = null

export function chargerFournisseurs(): Promise<CatalogueFournisseurs> {
  if (!enVol) {
    enVol = (async () => {
      try {
        const reponse = await apiRequest<ReponseFournisseurs>("/api/translate/providers")
        const fournisseurs = Array.isArray(reponse?.fournisseurs)
          ? reponse.fournisseurs
              .map(lireFournisseur)
              .filter((f): f is FournisseurAnnonce => f !== null)
          : []
        return {
          defaut: estCodeMoteur(reponse?.defaut) ? reponse.defaut : MOTEUR_PAR_DEFAUT,
          fournisseurs,
        }
      } catch (erreur) {
        // Un echec ne doit pas rester en cache : l'ecran suivant doit pouvoir
        // reessayer. C'est la seule raison pour laquelle la promesse est
        // relachee ici et non dans un `finally`.
        enVol = null
        throw erreur
      }
    })()
  }
  return enVol
}

/** Force une relecture, pour le bouton « reessayer » des Parametres. */
export function oublierFournisseurs(): void {
  enVol = null
}
