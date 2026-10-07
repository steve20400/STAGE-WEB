import { apiRequest } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { identitesChangees as identitesChangeesInternes } from "./e2ee-store"
import { ouvrirCoffre } from "./coffre-chiffre"
import { ecrireCharge, lireCharge, type DescripteurMedia, type GenreCharge } from "./e2ee-media"
import {
  chiffrerPour,
  idAppareil,
  dechiffrer,
  deposer,
  ouvrirSessions,
  relever,
  acquitter,
  type EnveloppeRecue,
} from "./e2ee-service"

/**
 * LE CHIFFREMENT, BRANCHÉ AU FIL DE DISCUSSION.
 *
 * 🔴 CE FICHIER EST LA SEULE COUTURE entre le fil ordinaire et le chiffrement.
 * `messages-service.ts` ne connaît que deux fonctions d'ici — envoyer, et
 * rapprocher ce qu'on a reçu. Tout le reste du fil ignore que le chiffrement
 * existe, et c'est ce qui permet de ne pas réécrire l'écran.
 *
 * ── L'ORDRE DES DEUX ÉCRITURES, ET POURQUOI IL EST DANS CE SENS ─────────
 *
 * Un message chiffré s'écrit en DEUX temps : la ligne du fil, puis les
 * enveloppes qui portent le texte. On crée donc la ligne D'ABORD, pour en
 * connaître l'identifiant, et on y rattache les enveloppes ensuite.
 *
 * ⚠️ IL EXISTE DONC UN INSTANT où la ligne existe sans son contenu. Si le
 * dépôt des enveloppes échoue, le destinataire voit un message vide. C'est
 * assumé, et c'est le moindre mal : l'inverse — déposer puis créer la ligne —
 * laisserait des enveloppes orphelines qu'aucun fil ne réclamerait jamais, et
 * que personne ne verrait pour les corriger. Un message vide se voit et se
 * renvoie.
 */

/* ══════════════════ SAVOIR SI ÇA CHIFFRE ══════════════════ */

/**
 * Les conversations dont on sait qu'elles sont chiffrées.
 *
 * Alimentée par la liste des conversations et par `lireEtatE2ee`, qui portent
 * `e2eeActif`. Elle évite un aller-retour par message.
 */
const chiffrees = new Map<string, boolean>()

/*
 * ══════════════ UN FIL CHIFFRÉ LE RESTE — LE CLIENT S'EN SOUVIENT ══════════════
 *
 * 🐛 LE SERVEUR ÉTAIT SEUL JUGE. Sa réponse n'était gardée qu'en mémoire, vide
 * à chaque rechargement : un serveur compromis qui répondait `e2eeActif: false`
 * faisait repartir les messages EN CLAIR, sans rien à l'écran. Prouvé par
 * `scripts/e2ee-etat-memorise.mjs` ③ le 28/09/2026.
 *
 * 🔴 UN FIL VU CHIFFRÉ UNE FOIS NE REDESCEND JAMAIS. Aucune route du serveur ne
 * désactive le chiffrement d'un fil : un « non chiffré » après un « chiffré »
 * n'a pas d'explication honnête. On garde donc « chiffré », et l'envoi échoue
 * ouvertement (le serveur refuse le dépôt) au lieu de partir en clair.
 *
 * ⚠️ EN `localStorage`, PAR COMPTE. Ce n'est pas un secret — la menace est le
 * serveur, pas l'appareil —, et la lecture doit rester SYNCHRONE : `estChiffree`
 * est appelé partout. La clé commence par `alanya.e2ee.` : la déconnexion la
 * retire avec le reste (`oublierCetAppareil`).
 */
function cleMemoire(): string | null {
  const moi = getMyUserId()
  return moi ? `alanya.e2ee.fils-chiffres.${moi}` : null
}

function filsMemorises(): Set<string> {
  const cle = cleMemoire()
  if (!cle) return new Set()
  try {
    const brut = localStorage.getItem(cle)
    return new Set(brut ? (JSON.parse(brut) as string[]) : [])
  } catch {
    return new Set()
  }
}

function memoriser(convId: string): void {
  const cle = cleMemoire()
  if (!cle) return
  const fils = filsMemorises()
  if (fils.has(convId)) return
  fils.add(convId)
  try {
    localStorage.setItem(cle, JSON.stringify([...fils]))
  } catch {
    // Stockage refusé : on garde au moins la mémoire de la page.
  }
}

export function noteEtatChiffrement(convId: string, actif: boolean): void {
  if (actif) {
    chiffrees.set(convId, true)
    memoriser(convId)
    return
  }
  if (estChiffree(convId)) {
    console.warn(
      `[e2ee] le serveur dit « non chiffré » pour un fil chiffré (${convId.slice(0, 8)}) — ignoré.`,
    )
    return
  }
  chiffrees.set(convId, false)
}

/**
 * Connaît-on l'état de ce fil — par le serveur dans cette page, ou par la
 * mémoire du client ? Tant que non, on ne doit pas envoyer de texte en clair.
 */
export function etatConnu(convId: string): boolean {
  return chiffrees.has(convId) || filsMemorises().has(convId)
}

/**
 * Combien de conversations de ce compte sont chiffrées ?
 *
 * ⚠️ SERT À DÉCIDER S'IL Y A QUELQUE CHOSE À PERDRE avant une déconnexion.
 * Zéro conversation chiffrée, et il n'y a rien à avertir : tout le reste est
 * sur le serveur et reviendra à la prochaine connexion.
 *
 * ⚠️ LIT LE CACHE, PAS LE SERVEUR. Il est alimenté par la liste des
 * conversations à chaque chargement — demander au serveur ferait attendre
 * quelqu'un qui veut justement partir vite.
 */
export function conversationsChiffrees(): number {
  // La mémoire compte aussi : après un rechargement, la table de la page est
  // vide jusqu'à la liste des conversations.
  const tous = filsMemorises()
  for (const [id, actif] of chiffrees) if (actif) tous.add(id)
  return tous.size
}

export function estChiffree(convId: string): boolean {
  return chiffrees.get(convId) === true || filsMemorises().has(convId)
}

export interface EtatE2ee {
  e2eeActif: boolean
  activable: boolean
  motif: "HORS_PERIMETRE" | "GROUPE_NON_SUPPORTE" | "CLES_MANQUANTES" | null
  sansCles: string[]
}

export async function lireEtatE2ee(convId: string): Promise<EtatE2ee> {
  const r = await apiRequest<EtatE2ee>(
    `/api/conversations/${encodeURIComponent(convId)}/e2ee`,
    { cache: "no-store" },
  )
  noteEtatChiffrement(convId, r.e2eeActif)
  return r
}

export async function activerE2ee(convId: string): Promise<void> {
  await apiRequest(`/api/conversations/${encodeURIComponent(convId)}/e2ee`, {
    method: "POST",
  })
  noteEtatChiffrement(convId, true)
}

/* ══════════════════ ENVOYER ══════════════════ */

interface MessageCree {
  id: string
  createdAt: string
}

/**
 * Qui est en face, dans une conversation à deux ?
 *
 * ⚠️ L'APPELANT NE LE SAIT PAS. `sendChatMessage` ne reçoit qu'un identifiant
 * de conversation — c'est tout ce dont le fil en clair a besoin, le serveur
 * se chargeant de la distribution. Le chiffrement, lui, doit savoir POUR QUI
 * il chiffre : c'est la différence de fond entre les deux régimes, et elle
 * remonte jusqu'ici.
 */
export async function correspondant(convId: string): Promise<string> {
  const moi = getMyUserId()
  const r = await apiRequest<{ members: { id: string }[] }>(
    `/api/conversations/${encodeURIComponent(convId)}/members`,
  )
  const autres = r.members.map((m) => m.id).filter((id) => id !== moi)
  /*
   * ⚠️ EXACTEMENT UN AUTRE, sans quoi on refuse. Zéro, c'est la conversation
   * avec soi-même ; plusieurs, c'est un groupe — et le serveur a déjà refusé
   * de chiffrer l'un comme l'autre. Deviner ici contredirait sa décision.
   */
  if (autres.length !== 1) {
    throw new Error(
      "Le chiffrement ne couvre que les conversations entre deux personnes.",
    )
  }
  return autres[0]
}

/**
 * Envoie un message dans une conversation chiffrée.
 *
 * ⚠️ PAR LA ROUTE REST, ET NON PAR LE WEBSOCKET. Le chemin WebSocket
 * transporte le contenu et le fait suivre ; l'adapter demanderait de toucher
 * `ws-server.mjs`, qui n'a rien à voir avec le chiffrement. Un message chiffré
 * emprunte donc le repli REST, déjà éprouvé. On y perd la remise instantanée —
 * le destinataire recevra à sa prochaine relève — et c'est la dette la plus
 * visible de ce premier jet.
 */
export async function envoyerChiffre(
  convId: string,
  texte: string,
  /**
   * 🐛 LA RÉPONSE ET LE CONTACT N'EXISTAIENT PAS DANS UN FIL CHIFFRÉ (user,
   * 06/10/2026). La citation n'était jamais transmise ; un contact partait en
   * clair et le serveur le refusait. `genre` dit ce que `texte` porte : la
   * fiche JSON d'un CONTACT, voyagée dans l'enveloppe.
   */
  options: { genre?: GenreCharge; replyToId?: string } = {},
): Promise<MessageCree> {
  const destinataireId = await correspondant(convId)

  /*
   * ⚠️ LA LISTE DES APPAREILS EST RELUE À CHAQUE ENVOI : un appareil que le
   * correspondant vient d'ajouter doit recevoir le message. Mais une session
   * ne s'ouvre QUE là où il en manque une.
   *
   * 🐛 CE COMMENTAIRE AFFIRMAIT QUE « LA BIBLIOTHÈQUE NE REFAIT PAS LE TRAVAIL
   * SI LA SESSION EXISTE DÉJÀ ». C'était faux : chaque envoi refaisait un
   * X3DH et consommait une pré-clé du correspondant. Voir `ouvrirSessions`.
   */
  const devices = await ouvrirSessions(destinataireId)
  if (devices.length === 0) {
    throw new Error("Ce correspondant n'a aucun appareil capable de déchiffrer.")
  }

  // 1. La ligne du fil, SANS contenu. Le serveur la refuserait autrement.
  const message = await apiRequest<MessageCree>(
    `/api/conversations/${encodeURIComponent(convId)}/messages`,
    {
      method: "POST",
      body: {
        type: options.genre ?? "TEXT",
        chiffre: true,
        ...(options.replyToId ? { replyToId: options.replyToId } : {}),
      },
    },
  )

  /*
   * 2. Les enveloppes, rattachées à cette ligne.
   *
   * 🔴 LE TEXTE PART EN CHARGE v2, AVEC L'IDENTIFIANT DU MESSAGE DEDANS
   * (lot D, chapitre 26). En v1, l'identifiant ne voyageait QU'À CÔTÉ du
   * chiffré : le serveur pouvait rattacher le texte de Bob à un AUTRE message
   * de Bob du même fil. Chiffré avec le texte, il est hors de sa portée, et
   * `lireCharge` refuse une enveloppe rattachée au mauvais message.
   *
   * ⚠️ LES DEUX LECTEURS SAVENT LIRE LE v2 DEPUIS LE LOT A (médias) : le web
   * en production, le téléphone depuis son APK du lot A. Un téléphone plus
   * ancien afficherait la charge brute — d'où le déploiement APRÈS la mise à
   * jour des téléphones.
   */
  const charge = ecrireCharge(message.id, texte, undefined, {
    reponseA: options.replyToId,
    genre: options.genre,
  })
  const enveloppes = await chiffrerPour(destinataireId, devices, charge)

  /*
   * 3. Et une pour chacun de MES AUTRES appareils.
   *
   * 🐛 ON NE CHIFFRAIT QUE POUR LE CORRESPONDANT. Un message écrit depuis ce
   * navigateur n'arrivait jamais sur le téléphone du même compte — sauf plus
   * tard, par l'archive, si elle était ouverte là-bas. Prouvé par l'étape ⑩ de
   * `scripts/e2ee-releve-multifil.mjs` (0 enveloppe vers l'autre appareil).
   *
   * ⚠️ CET appareil est exclu : il a déjà le texte, et s'ouvrir une session
   * vers lui-même consommerait une de ses pré-clés pour rien.
   *
   * ⚠️ UN ÉCHEC ICI N'EMPÊCHE PAS L'ENVOI. Le correspondant doit recevoir son
   * message même si mon autre appareil est injoignable ; celui-ci le
   * rattrapera par l'archive.
   */
  const moi = getMyUserId()
  if (moi && moi !== destinataireId) {
    try {
      const miens = await ouvrirSessions(moi, idAppareil())
      if (miens.length > 0) enveloppes.push(...(await chiffrerPour(moi, miens, charge)))
    } catch (err) {
      console.warn("[e2ee] copie vers mes autres appareils impossible :", err)
    }
  }

  await deposer(convId, enveloppes, message.id)

  return message
}

/**
 * MODIFIE un message chiffré déjà envoyé — cours, chapitre 29.
 *
 * Le serveur n'a pas le texte : il ne peut pas le remplacer. Le nouveau texte
 * part donc comme un message, dans des ENVELOPPES rattachées au MÊME message,
 * avec `modifie: true` DANS la charge. Le serveur, lui, ne fait que dater la
 * modification. Même protocole que le mobile (`E2eeFil.modifier`).
 *
 * ⚠️ DANS CET ORDRE : la date d'abord, les enveloppes ensuite. Le
 * destinataire relève dès la sonnette qui suit le dépôt ; la ligne doit déjà
 * dire « modifié ». Et si le serveur refuse — délai de 2 h dépassé —, aucune
 * enveloppe n'est partie.
 *
 * Rend la date de modification du serveur.
 */
export async function modifierChiffre(
  convId: string,
  messageId: string,
  texte: string,
): Promise<Date | null> {
  const destinataireId = await correspondant(convId)
  const devices = await ouvrirSessions(destinataireId)
  if (devices.length === 0) {
    throw new Error("Ce correspondant n'a aucun appareil capable de déchiffrer.")
  }
  const r = await apiRequest<{ editedAt?: string }>(
    `/api/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "PATCH", body: { chiffre: true } },
  )
  const charge = ecrireCharge(messageId, texte, undefined, { modifie: true })
  const enveloppes = await chiffrerPour(destinataireId, devices, charge)
  // Mes autres appareils aussi — même règle, et même tolérance, qu'à l'envoi.
  const moi = getMyUserId()
  if (moi && moi !== destinataireId) {
    try {
      const miens = await ouvrirSessions(moi, idAppareil())
      if (miens.length > 0) enveloppes.push(...(await chiffrerPour(moi, miens, charge)))
    } catch (err) {
      console.warn("[e2ee] copie de la modification vers mes autres appareils impossible :", err)
    }
  }
  await deposer(convId, enveloppes, messageId)
  const date = r.editedAt ? new Date(r.editedAt) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

/* ══════════════════ RECEVOIR ══════════════════ */

/** Un message relevé et déchiffré, prêt à être rangé dans SON fil. */
export interface ClairRecu {
  messageId: string
  convId: string
  expediteurId: string
  texte: string
  /** Heure du dépôt de l'enveloppe, en millisecondes. */
  quand: number
  /**
   * Le média chiffré que porte ce message (charge v2), avec sa clé. Absent
   * pour un texte. Voir `e2ee-media.ts` et le chapitre 23 du cours.
   */
  media?: DescripteurMedia
  /** Le message auquel celui-ci répond, lu DANS la charge (06/10/2026). */
  reponseA?: string
  /** CONTACT ou LOCATION : `texte` porte alors la fiche JSON. */
  genre?: GenreCharge
  /** Ce texte REMPLACE celui du message (modification, chapitre 29). */
  modifie?: boolean
}

/**
 * Le texte relevé pour ce message — s'il est bien de son expéditeur et de son
 * fil, `undefined` sinon.
 *
 * 🐛 L'IDENTIFIANT DU MESSAGE VIENT DU SERVEUR, HORS DU CHIFFRÉ. Le texte était
 * appliqué à n'importe quelle ligne portant cet identifiant : un serveur
 * malveillant faisait parler Alice avec les mots de Bob. Prouvé par
 * `scripts/e2ee-etat-memorise.mjs` ⑤ le 28/09/2026.
 *
 * ⚠️ L'EXPÉDITEUR EST SÛR — c'est sa session qui a déchiffré —, donc exiger
 * qu'il soit l'auteur de la ligne suffit à ce qu'on ne fasse parler personne
 * d'autre. Le fil aussi doit correspondre. Ce qui restait possible au serveur
 * (attacher le texte de Bob à un AUTRE message de Bob du même fil) est fermé
 * par la charge v2 (lot D) : l'identifiant est chiffré avec le texte, et
 * `lireCharge` le vérifie. Seuls les messages v1 — envoyés par d'anciens
 * clients — y restent exposés.
 *
 * @param expediteurAffiche l'expéditeur tel que l'écran le porte (« me » pour soi).
 */
export function clairPour(
  clairs: Map<string, ClairRecu>,
  messageId: string,
  expediteurAffiche: string,
  convId: string,
): string | undefined {
  const c = clairs.get(messageId)
  if (!c) return undefined
  const expediteur = expediteurAffiche === "me" ? getMyUserId() : expediteurAffiche
  if (c.expediteurId !== expediteur || c.convId !== convId) {
    console.warn(`[e2ee] texte relevé pour ${messageId.slice(0, 8)} écarté : expéditeur ou fil ne correspond pas.`)
    return undefined
  }
  return c.texte
}

/**
 * Comme `clairPour`, mais rend tout ce que porte l'enveloppe : le texte ET le
 * média chiffré. Mêmes vérifications — expéditeur et fil.
 */
export function chargePour(
  clairs: Map<string, ClairRecu>,
  messageId: string,
  expediteurAffiche: string,
  convId: string,
): ClairRecu | undefined {
  const texte = clairPour(clairs, messageId, expediteurAffiche, convId)
  return texte === undefined ? undefined : clairs.get(messageId)
}

/**
 * Relève tout ce qui attend cet appareil et rend le clair, par message.
 *
 * 🔴 ON N'ACQUITTE QU'APRÈS AVOIR TENTÉ, ET JAMAIS SI LE COFFRE EST FERMÉ.
 * Une panne de notre côté ne coûte aucun message : rien n'est acquitté. Un
 * échec sur le message lui-même — session perdue, appareil réinstallé, message
 * déjà ouvert — est définitif, et l'enveloppe est acquittée : la garder ne la
 * rendrait pas lisible, et elle bloquerait la file.
 *
 * ⚠️ UNE ENVELOPPE ILLISIBLE N'ARRÊTE PAS LES AUTRES : on continue.
 *
 * 🔴 `ranger` PASSE AVANT L'ACQUITTEMENT, et c'est tout son objet.
 *
 * 🐛 LA RELÈVE RAMÈNE LES ENVELOPPES DE TOUS LES FILS, et chaque appelant ne
 * rangeait que le texte du fil qu'il affichait. Le reste était acquitté PUIS
 * jeté : le serveur ne l'avait plus, la clé du message était consommée par le
 * cliquet, et le fil concerné affichait « indisponible sur cet appareil ».
 * Prouvé par `scripts/e2ee-releve-multifil.mjs` le 28/09/2026.
 *
 * ⚠️ UN MESSAGE DÉCHIFFRÉ NE SE DÉCHIFFRE PAS DEUX FOIS. Ce n'est donc pas
 * l'acquittement qui protège le texte — une enveloppe non acquittée serait
 * illisible au tour suivant —, c'est le rangement. D'où son ordre.
 */
export async function releverEtDechiffrer(
  ranger?: (recus: ClairRecu[]) => Promise<void>,
): Promise<Map<string, ClairRecu>> {
  const parMessage = new Map<string, ClairRecu>()
  let recues: EnveloppeRecue[] = []
  try {
    recues = await relever()
  } catch {
    // Pas de relève possible : on n'a rien à ajouter, l'écran reste en l'état.
    return parMessage
  }

  /*
   * ⚠️ LE COFFRE S'OUVRE ICI, HORS DE LA BOUCLE, et c'est ce qui départage les
   * échecs. S'il ne s'ouvre pas, la panne est de notre côté et passagère : on
   * n'acquitte RIEN, la prochaine relève lira tout. S'il s'ouvre, un échec dans
   * la boucle tient au message lui-même — et celui-là ne s'ouvrira jamais.
   */
  try {
    await ouvrirCoffre()
  } catch {
    return parMessage
  }

  const acquittables: string[] = []
  for (const e of recues) {
    try {
      const clair = await dechiffrer(e)
      if (e.messageId) {
        /*
         * 🔴 LA CHARGE EST LUE ICI, ET VÉRIFIÉE (cours, chapitre 23). Un texte
         * nu (v1) passe tel quel ; une charge v2 doit annoncer CE message — un
         * serveur qui l'aurait rattachée à un autre est démasqué, et
         * l'enveloppe tombe dans le `catch` : illisible, acquittée.
         */
        const charge = lireCharge(clair, e.messageId)
        const recu: ClairRecu = {
          messageId: e.messageId,
          convId: e.convId,
          expediteurId: e.expediteurId,
          texte: charge.texte,
          quand: new Date(e.createdAt).getTime(),
          ...(charge.media ? { media: charge.media } : {}),
          ...(charge.reponseA ? { reponseA: charge.reponseA } : {}),
          ...(charge.genre ? { genre: charge.genre } : {}),
          ...(charge.modifie ? { modifie: true } : {}),
        }
        parMessage.set(e.messageId, recu)
        /*
         * 🔴 RANGÉ AUSSITÔT, AVANT LE MESSAGE SUIVANT.
         *
         * 🐛 TOUT LE LOT ÉTAIT DÉCHIFFRÉ, PUIS RANGÉ D'UN COUP — jusqu'à deux
         * cents messages. Un onglet fermé entre les deux perdait tous les
         * textes déjà ouverts : le cliquet avait avancé, ils ne se
         * déchiffreraient plus, et rien ne les avait écrits. Ranger message
         * par message réduit cette fenêtre à un seul. Prouvé par
         * `scripts/e2ee-onglets.mjs` ⑥ le 28/09/2026.
         *
         * ⚠️ UN RANGEMENT RATÉ N'EMPÊCHE PAS L'ACQUITTEMENT. Garder l'enveloppe
         * ne sauverait rien — elle ne se relirait plus — et la laisserait en
         * tête de file, relevée et refusée à chaque tour. Le texte reste au
         * moins dans ce que rend la fonction, pour l'écran.
         */
        if (ranger) {
          await ranger([recu]).catch((err) => {
            console.warn("[e2ee] rangement d'un message relevé impossible :", err)
          })
        }
      }
      acquittables.push(e.id)
    } catch (err) {
      /*
       * 🔴 UNE ILLISIBLE EST ACQUITTÉE.
       *
       * 🐛 ELLE NE L'ÉTAIT JAMAIS, « pour ne pas la perdre ». Mais un message
       * dont la session ou la clé n'existe plus ne se lira pas mieux demain :
       * la garder ne sauvait rien. Elle revenait à chaque relève, et la relève
       * n'en rend que 200 — deux cents illisibles en tête de file, et plus
       * aucun message n'arrivait sur cet appareil. Prouvé par l'étape ⑥ de
       * `scripts/e2ee-releve-multifil.mjs`.
       *
       * ⚠️ UN MESSAGE DÉJÀ OUVERT échoue aussi (compteur répété) ; l'acquitter
       * est alors simplement juste.
       */
      acquittables.push(e.id)
      console.warn(`[e2ee] enveloppe ${e.id.slice(0, 8)} illisible — acquittée.`, err)
    }
  }

  await acquitter(acquittables).catch(() => undefined)
  return parMessage
}

/* ══════════════════ LA BANNIÈRE ══════════════════ */

/**
 * À partir de quel message le fil est-il chiffré ?
 *
 * 🔴 LES ANCIENS MESSAGES RESTENT LISIBLES, et c'est une décision, pas un
 * oubli : le serveur ne peut pas les chiffrer rétroactivement — il faudrait
 * qu'un client les relise, les chiffre et les repose, ce qui suppose qu'il les
 * ait tous, et que personne n'ait changé d'appareil depuis.
 *
 * ⚠️ IL FAUT DONC LE DIRE. Un fil où la moitié des messages est protégée et
 * l'autre non, sans rien qui marque la frontière, laisse croire que TOUT l'est.
 * La bannière est la seule chose qui empêche ce malentendu.
 */
export interface Frontiere {
  /** L'identifiant du premier message chiffré, ou `null` s'il n'y en a pas. */
  premierChiffre: string | null
}

/**
 * Trouve la frontière dans une liste de messages déjà triée par date.
 *
 * ⚠️ ON SE FIE AU RATTACHEMENT D'ENVELOPPE, PAS À L'ABSENCE DE CONTENU : un
 * message en clair peut légitimement n'avoir aucun texte — un média sans
 * légende. Les confondre placerait la bannière avant la première photo du fil.
 */
export function frontiereChiffrement(
  messages: { id: string; chiffre?: boolean }[],
): Frontiere {
  const premier = messages.find((m) => m.chiffre === true)
  return { premierChiffre: premier?.id ?? null }
}

/* ══════════════════ L'AVERTISSEMENT DE CLÉ ══════════════════ */

export { identitesChangees, oublierAvertissement } from "./e2ee-store"

/**
 * La clé de ce correspondant a-t-elle changé depuis l'ouverture ?
 *
 * 🔴 LE SEUL SIGNAL QUI PUISSE RÉVÉLER UNE INTERPOSITION. Réinstallation ou
 * interception : les deux se ressemblent, et seul l'utilisateur peut trancher
 * — en comparant un code de sécurité hors de ce canal.
 */
export function cleAChange(userId: string): boolean {
  return identitesChangeesInternes().includes(userId)
}
