import type { LanguageCode } from "./catalogue"
import type { CodeMoteur } from "../services/traduction-fournisseurs"

/**
 * Les fiches « ce que ce moteur fait de vos donnees », une par moteur de
 * traduction, dans les neuf langues.
 *
 * POURQUOI UN MODULE A PART. Ces textes sont des PARAGRAPHES, pas des
 * etiquettes. Cinq fiches de plusieurs paragraphes en neuf langues posees dans
 * `catalogue-web.ts` y ajouteraient plus de volume que les 961 cles existantes
 * n'en occupent, et on ne retrouverait plus une cle d'interface au milieu. Le
 * catalogue garde donc ce qui se lit d'un coup d'oeil ; ce fichier garde ce qui
 * se lit assis.
 *
 * CE QUI N'EST PAS ICI : les quatre QUESTIONS. Elles sont identiques d'une
 * fiche a l'autre et viennent du catalogue (`docs_trad_q_sortie`,
 * `docs_trad_q_destinataire`, `docs_trad_q_duree`, `docs_trad_q_entrainement`),
 * affichees par la visionneuse elle-meme. Un redacteur n'a donc ni a les
 * ecrire, ni a les repeter en tete de sa reponse : la structure les pose.
 *
 * Repli identique a `traduire()` : la langue demandee, puis le francais, puis
 * rien. Une fiche absente ne casse pas la visionneuse, elle affiche
 * `docs_trad_missing`.
 */

/* ------------------------------------------------------------- Structure */

/**
 * Les quatre questions, DANS L'ORDRE OU ELLES SE LISENT. Cet ordre n'est pas
 * arbitraire : il va du plus concret — ce qui sort de l'appareil — au plus
 * lointain — ce qu'on en fait ensuite. La visionneuse parcourt ce tableau ;
 * changer l'ordre ici change l'ordre a l'ecran, et nulle part ailleurs.
 *
 *  1. `sortie`        — qu'est-ce qui quitte votre appareil ?
 *  2. `destinataire`  — qui le recoit ?
 *  3. `duree`         — combien de temps est-ce conserve ?
 *  4. `entrainement`  — cela sert-il a entrainer des modeles ?
 */
export const SECTIONS_FICHE = ["sortie", "destinataire", "duree", "entrainement"] as const

export type SectionFiche = (typeof SECTIONS_FICHE)[number]

/**
 * La couleur de la reponse. Elle ne remplace pas le texte — un daltonien et un
 * lecteur d'ecran doivent comprendre sans elle, et la visionneuse annonce donc
 * le ton en toutes lettres — mais elle permet de balayer une fiche et de voir
 * tout de suite ou est le probleme.
 *
 *  - `sur`        : rien ne sort, ou rien qui vous identifie. Vert.
 *  - `vigilance`  : cela sort, mais dans un cadre annonce et borne. Orange.
 *  - `risque`     : cela sort, et l'usage qui en est fait vous depasse. Rouge.
 *
 * Choisir `sur` par confort est le seul vrai defaut possible dans ce fichier :
 * une fiche rassurante a tort vaut moins que pas de fiche du tout.
 */
export type TonReponse = "sur" | "vigilance" | "risque"

/** La reponse a UNE des quatre questions. */
export interface ReponseFiche {
  /** Voir {@link TonReponse}. Pilote la couleur et l'annonce vocale. */
  ton: TonReponse
  /**
   * La reponse en UNE phrase, lisible seule : c'est la seule ligne que
   * beaucoup liront. Affirmative, sans « il se peut que ». Viser 90 caracteres,
   * ne pas depasser 140 — au-dela elle passe a la ligne et cesse d'etre un
   * verdict. Ne repete PAS la question.
   */
  verdict: string
  /**
   * Le detail, de un a trois paragraphes. Texte brut : ni Markdown, ni HTML,
   * ni lien — chaque entree devient un <p>. Phrases courtes, presque pas de
   * jargon ; « chiffre de bout en bout » se dit, « TLS 1.3 » ne se dit pas.
   * Un tableau vide est licite quand le verdict se suffit.
   */
  paragraphes: string[]
}

/** Une fiche complete, pour un moteur et une langue. */
export interface FicheMoteur {
  /**
   * Deux ou trois phrases en tete, avant les questions : ce qu'est ce moteur,
   * et la chose a retenir si l'on ne lit que ca. C'est un chapeau de presse,
   * pas une introduction — pas de « dans ce document, nous verrons ».
   */
  resume: string
  /**
   * Les quatre reponses. Le type les exige toutes les quatre : une fiche qui
   * repond a trois questions sur quatre laisse croire que la quatrieme est sans
   * objet, et c'est justement la derniere — l'entrainement — qu'on omettrait.
   */
  reponses: Record<SectionFiche, ReponseFiche>
  /**
   * D'ou vient ce qui est ecrit ici : une phrase complete, traduite comme le
   * reste. Par exemple « D'apres les conditions d'utilisation publiees par
   * DeepL. » Pas d'URL : la fiche s'ouvre dans l'application, un lien en
   * sortirait. Optionnel, mais son absence se remarque.
   */
  source?: string
  /**
   * Quand ces informations ont ete verifiees, ecrit comme on le dirait dans la
   * langue de la fiche — « aout 2026 », « August 2026 », « 2026年8月 ». La
   * visionneuse l'entoure de `docs_trad_updated`. Optionnel.
   */
  maj?: string
}

/* --------------------------------------------------------------- Contenu */

/**
 * Les fiches, indexees par moteur puis par langue.
 *
 * A REMPLIR. Chaque moteur a les neuf langues a servir ; le francais fait foi
 * et sert de repli, les huit autres en sont la traduction. Une langue absente
 * retombe sur le francais, ce qui est acceptable un temps ; un moteur dont
 * meme le francais manque affiche « pas encore disponible » et vaut aveu.
 *
 * Un exemple de la forme attendue, a copier :
 *
 * ```ts
 * navigateur: {
 *   fr: {
 *     resume: "…",
 *     reponses: {
 *       sortie: { ton: "sur", verdict: "…", paragraphes: ["…"] },
 *       destinataire: { ton: "sur", verdict: "…", paragraphes: ["…"] },
 *       duree: { ton: "sur", verdict: "…", paragraphes: [] },
 *       entrainement: { ton: "sur", verdict: "…", paragraphes: ["…"] },
 *     },
 *     source: "…",
 *     maj: "aout 2026",
 *   },
 * },
 * ```
 */
const FICHES: Record<CodeMoteur, Partial<Record<LanguageCode, FicheMoteur>>> = {
  navigateur: {},
  azure: {},
  google: {},
  deepl: {},
  libretranslate: {},
}

/* ----------------------------------------------------------------- Lecture */

/** Langue de repli, la meme que celle du catalogue. */
const REPLI: LanguageCode = "fr"

/**
 * La fiche d'un moteur dans la langue demandee, a defaut en francais, a defaut
 * `null` — a la visionneuse alors de le dire, pas de faire semblant.
 */
export function ficheMoteur(moteur: CodeMoteur, langue: LanguageCode): FicheMoteur | null {
  const parLangue = FICHES[moteur]
  return parLangue?.[langue] ?? parLangue?.[REPLI] ?? null
}
