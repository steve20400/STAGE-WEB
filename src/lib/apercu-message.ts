/**
 * DÉCRIRE UN MESSAGE EN UNE LIGNE — le point de vérité unique.
 *
 * Un message se résume à plusieurs endroits : le bandeau de réponse au-dessus de
 * la saisie, le bloc de citation dans la bulle, l'aperçu du dernier message dans
 * la liste des discussions, un message épinglé, un résultat de recherche. Chacun
 * de ces endroits avait sa propre logique, et elles ne disaient pas la même
 * chose du même message.
 *
 * D'où le défaut rapporté : un message vocal cité affichait le NOM DU FICHIER
 * tel qu'il est rangé en base — « vocal-1756492013.webm » — parce que le repli
 * sur `fileName` passait AVANT le test du type. Le nom avait pourtant déjà été
 * retiré de la bulle ; il restait dans la citation, qui suivait un autre chemin.
 *
 * Tout ce qui décrit un message passe désormais par ici.
 */

import type { ChatMessageMock as Message } from "../mocks/chat-data"

/** Ce que le catalogue doit savoir traduire pour décrire un message. */
type Traducteur = (cle: string, params?: Record<string, string | number>) => string

/**
 * Durée d'un média, en `m:ss` — et `h:mm:ss` au-delà d'une heure.
 *
 * Rend `null` quand la durée est inconnue, et c'est un cas courant : un message
 * reçu d'un client qui ne la transmet pas, un vocal encore en téléversement, un
 * ancien message d'avant que le champ existe. `null` fait afficher « Message
 * vocal » tout court — jamais « (0:00) », qui décrirait un vocal vide, ni
 * « (--:--) », qui a l'air d'une panne.
 */
export function formaterDuree(ms?: number | null): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, "0")
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`
  return `${m}:${ss}`
}

export interface DescriptionMessage {
  /** Pictogramme, ou chaîne vide pour un message de texte. */
  icone: string
  /**
   * Libellé prêt à afficher, TOUJOURS traduit.
   *
   * Jamais un nom de fichier pour un vocal, une image ou une vidéo ; jamais une
   * URL ; jamais du JSON de charge structurée.
   */
  texte: string
}

/**
 * Le nom de fichier a-t-il un sens pour l'utilisateur ?
 *
 * OUI pour un document : « contrat-2026.pdf » est précisément ce qu'on cherche
 * dans une liste, et toutes les messageries l'affichent.
 *
 * NON pour un vocal, une photo ou une vidéo : leur nom est fabriqué par
 * l'appareil qui les a produits — « vocal-1756492013.webm », « IMG_0042.jpg » —
 * et ne décrit rien. C'est ce mélange qui a créé le défaut.
 */
function nomDeFichierUtile(type: string | undefined): boolean {
  return type === "file"
}

/**
 * Décrit un message en une ligne.
 *
 * `apercuStructure` (fiche de contact, position) est passé en paramètre plutôt
 * qu'importé : il vit dans le miroir exact du backend, que ce module ne doit pas
 * entraîner dans ses dépendances.
 */
export function decrireMessage(
  msg: Pick<Message, "type" | "content" | "fileName" | "durationMs" | "isDeleted">,
  t: Traducteur,
  apercuStructure?: (msg: unknown) => string | null
): DescriptionMessage {
  if (msg.isDeleted) return { icone: "", texte: t("message_deleted") }

  // Une charge structurée (fiche de contact, position) porte son propre libellé,
  // déjà traduit et déjà préfixé de son pictogramme.
  const structure = apercuStructure?.(msg)
  if (structure) return { icone: "", texte: structure }

  const type = msg.type
  const legende = msg.content?.trim()

  // UNE LÉGENDE PRIME SUR LE TYPE : quelqu'un qui a pris la peine d'écrire sous
  // sa photo a dit mieux que « Photo » ce que la photo montre.
  // Sauf pour un vocal, qui n'a pas de légende — son `content` est vide, et s'il
  // ne l'est pas, il porte autre chose que ce que l'auteur a voulu dire.
  if (legende && type !== "audio") return { icone: pictogramme(type), texte: legende }

  switch (type) {
    case "audio": {
      const duree = formaterDuree(msg.durationMs)
      return {
        icone: "🎤",
        texte: duree ? `${t("voice_message")} (${duree})` : t("voice_message"),
      }
    }
    case "image":
      return { icone: "📷", texte: t("photo") }
    case "video": {
      const duree = formaterDuree(msg.durationMs)
      return {
        icone: "🎬",
        texte: duree ? `${t("video_label")} (${duree})` : t("video_label"),
      }
    }
    case "file":
      return {
        icone: "📄",
        texte: nomDeFichierUtile(type) && msg.fileName ? msg.fileName : t("file"),
      }
    default:
      return { icone: "", texte: legende ?? "" }
  }
}

/** Le pictogramme seul, pour les endroits qui composent leur propre ligne. */
function pictogramme(type: string | undefined): string {
  switch (type) {
    case "audio":
      return "🎤"
    case "image":
      return "📷"
    case "video":
      return "🎬"
    case "file":
      return "📄"
    default:
      return ""
  }
}

/** Description sur une seule ligne, pictogramme compris. */
export function decrireMessageEnLigne(
  msg: Parameters<typeof decrireMessage>[0],
  t: Traducteur,
  apercuStructure?: (msg: unknown) => string | null
): string {
  const { icone, texte } = decrireMessage(msg, t, apercuStructure)
  return icone ? `${icone} ${texte}` : texte
}
