import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  CATALOGUE,
  LANGUAGE_CODES,
  type LanguageCode,
  type TranslationKey,
} from "./catalogue"
import { WEB_CATALOGUE, type WebTranslationKey } from "./catalogue-web"

export { LANGUAGE_CODES }

/**
 * Nom de chaque langue dans sa propre langue, comme dans tout selecteur de
 * langue : un utilisateur russophone cherche « Русский », pas « Russe ».
 *
 * Ces noms vivent ici et non dans le catalogue genere : ils ne viennent pas du
 * mobile, et une resynchronisation ne doit pas les effacer.
 */
export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  fr: "Français",
  en: "English",
  es: "Español",
  de: "Deutsch",
  pt: "Português",
  ru: "Русский",
  zh: "中文",
  sv: "Svenska",
  no: "Norsk",
}
export type { LanguageCode }

/**
 * Cle de traduction : celles portees du mobile, plus le complement propre au web.
 * Les deux ensembles sont disjoints par construction.
 */
export type Cle = TranslationKey | WebTranslationKey

/**
 * Langue de l'interface.
 *
 * Le choix ne traduit pas seulement les messages : il traduit toute
 * l'application, jusqu'aux mentions courtes du genre « Connecte » ou « En train
 * de sonner ». Le catalogue vient du mobile, a l'identique.
 *
 * La langue est une preference d'appareil, pas une donnee de compte : elle
 * survit a la deconnexion, comme le theme.
 */
const STORAGE_KEY = "alanya-language"

/** Langue de repli, celle du catalogue de reference. */
const FALLBACK: LanguageCode = "fr"

function estSupportee(code: string | null | undefined): code is LanguageCode {
  return Boolean(code) && (LANGUAGE_CODES as readonly string[]).includes(code as string)
}

/**
 * Langue de depart : le choix enregistre s'il existe, sinon celle du navigateur
 * quand le catalogue la connait, sinon le francais.
 */
export function langueInitiale(): LanguageCode {
  try {
    const enregistree = localStorage.getItem(STORAGE_KEY)
    if (estSupportee(enregistree)) return enregistree
  } catch {
    // stockage indisponible : on continue sur la langue du navigateur
  }
  for (const preferee of navigator.languages ?? [navigator.language]) {
    const court = preferee?.slice(0, 2).toLowerCase()
    if (estSupportee(court)) return court
  }
  return FALLBACK
}

/**
 * Traduit une cle. Repli identique a celui du mobile — langue courante, puis
 * francais, puis la cle elle-meme — pour qu'une cle manquante degrade au lieu de
 * laisser un vide.
 *
 * `variables` remplace les marqueurs `{nom}` du catalogue.
 */
export function traduire(
  langue: LanguageCode,
  cle: Cle,
  variables?: Record<string, string | number>
): string {
  const brut =
    CATALOGUE[langue]?.[cle as TranslationKey] ??
    WEB_CATALOGUE[langue]?.[cle as WebTranslationKey] ??
    CATALOGUE[FALLBACK]?.[cle as TranslationKey] ??
    WEB_CATALOGUE[FALLBACK]?.[cle as WebTranslationKey] ??
    cle
  if (!variables) return brut
  return brut.replace(/\{(\w+)\}/g, (entier, nom: string) =>
    nom in variables ? String(variables[nom]) : entier
  )
}

interface LanguageContextValue {
  language: LanguageCode
  setLanguage: (code: LanguageCode) => void
  t: (cle: Cle, variables?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(langueInitiale)

  // L'attribut lang du document sert au navigateur : cesure, correction
  // orthographique des champs de saisie, synthese vocale, moteurs de recherche.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const setLanguage = useCallback((code: LanguageCode) => {
    if (!estSupportee(code)) return
    setLanguageState(code)
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      // stockage indisponible : le choix ne survivra pas a la session
    }
  }, [])

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (cle, variables) => traduire(language, cle, variables),
    }),
    [language, setLanguage]
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

/**
 * Traduction dans un composant. Utilisable hors fournisseur — elle retombe alors
 * sur la langue enregistree — pour qu'un ecran isole, comme une page d'erreur,
 * ne casse pas.
 */
export function useTranslation(): LanguageContextValue {
  const contexte = useContext(LanguageContext)
  if (contexte) return contexte
  const langue = langueInitiale()
  return {
    language: langue,
    setLanguage: () => undefined,
    t: (cle, variables) => traduire(langue, cle, variables),
  }
}
