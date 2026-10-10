import { apiRequest, ApiError } from "../lib/api-client"
import { getMyUserId } from "../data/session-user"
import { ouvrirCoffre, lireSecret, ecrireSecret, effacerSecret, coffreEcrit } from "./coffre-chiffre"
import {
  chiffrerPour,
  deposer,
  identiteConnue,
  idAppareil,
  maPaireIdentite,
  ouvrirSessions,
} from "./e2ee-service"
import {
  chiffrerMessageGroupe,
  dechiffrerMessageGroupe,
  ecrireDemandeTrousseau,
  fusionnerTrousseau,
  ouvrirBoite,
  GroupeInvalide,
  lireChargeTrousseau,
  lireDemandeTrousseau,
  type VersionCle,
} from "./e2ee-groupe"
import { ecrireCharge, lireCharge, type DescripteurMedia, type GenreCharge } from "./e2ee-media"

/**
 * LE GROUPE CHIFFRÉ, BRANCHÉ AU FIL — lot 4 (web), cours chapitre 34.
 *
 * Le pendant de `e2ee-fil.ts` pour les GROUPES. La différence de fond :
 *
 *   · en tête-à-tête, le texte voyage dans des ENVELOPPES (une par appareil),
 *     consommées à la lecture : c'est le cache local qui garde le clair ;
 *   · en groupe, UN SEUL chiffré par message, rangé par le serveur AVEC la
 *     ligne et jamais consommé. Chaque membre le relit quand il veut, avec la
 *     clé du groupe de la bonne version (le « trousseau »).
 *
 * Le trousseau arrive d'appareil à appareil dans une enveloppe Signal
 * ordinaire, hors fil (`\u0000G1`, `recevoirTrousseau`). Il est rangé dans le
 * COFFRE chiffré de cet appareil, comme les clés Signal.
 *
 * 🔴 LA SIGNATURE SE VÉRIFIE AVEC UNE CLÉ D'IDENTITÉ DÉJÀ CONNUE (chapitre 32),
 * celle de la session Signal à deux avec cet appareil. Inconnue, on ouvre la
 * session d'abord : c'est le chemin habituel, avec son alerte « clé changée ».
 */

/* ══════════════════ LE TROUSSEAU LOCAL ══════════════════ */

interface VersionRangee {
  n: number
  cle: string
  creeLe: number
}

const cleCoffre = (convId: string) => `groupe.cles.${convId}`

function versB64(o: Uint8Array): string {
  let s = ""
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000))
  return btoa(s)
}

function depuisB64(b: string): Uint8Array {
  const s = atob(b)
  const o = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i)
  return o
}

/** Les versions connues de ce groupe, de la plus ancienne à la plus récente. */
export async function trousseauLocal(convId: string): Promise<VersionCle[]> {
  await ouvrirCoffre()
  const rangees = lireSecret<VersionRangee[]>(cleCoffre(convId)) ?? []
  return rangees.map((v) => ({ n: v.n, cle: depuisB64(v.cle), creeLe: v.creeLe })).sort((a, b) => a.n - b.n)
}

/**
 * Ajoute des versions au trousseau de ce groupe.
 *
 * ⚠️ `fusionnerTrousseau` REFUSE de remplacer une clé connue : un faux
 * trousseau ne peut ni rendre illisible ce qu'on lit, ni faire accepter une
 * clé détenue par un autre sous un numéro existant.
 */
export async function rangerTrousseau(
  convId: string,
  recues: VersionCle[],
  o: { deposerCopie?: boolean } = {},
): Promise<VersionCle[]> {
  const connues = await trousseauLocal(convId)
  const fusion = fusionnerTrousseau(connues, recues)
  if (fusion.length === connues.length) return fusion
  ecrireSecret(
    cleCoffre(convId),
    fusion.map((v) => ({ n: v.n, cle: versB64(v.cle), creeLe: v.creeLe })),
  )
  await coffreEcrit()
  /*
   * 🔴 LA COPIE PERSONNELLE SUIT CHAQUE CHANGEMENT (lot 6, chapitre 35) : une
   * version reçue et pas recopiée serait perdue au changement de téléphone.
   * Import différé : la copie dépend de l'archive, qui dépend du fil.
   */
  if (o.deposerCopie !== false) {
    void import("./e2ee-trousseau-perso").then((m) => m.deposerCopie(convId, fusion))
  }
  return fusion
}

/** Dernière tentative de restauration, par groupe — pour ne pas boucler. */
const restaurations = new Map<string, number>()
const REPOS_RESTAURATION_MS = 30_000

/**
 * Le trousseau local, COMPLÉTÉ PAR MA COPIE quand il manque quelque chose
 * (lot 6) : rien du tout (nouveau téléphone), ou la version [voulue].
 *
 * ⚠️ UNE TENTATIVE PAR GROUPE ET PAR DEMI-MINUTE : une copie qui n'a pas la
 * version cherchée ne doit pas déclencher une requête par message affiché.
 */
export async function trousseauAvecRepli(convId: string, voulue?: number): Promise<VersionCle[]> {
  const local = await trousseauLocal(convId)
  const manque = local.length === 0 || (voulue !== undefined && !local.some((v) => v.n === voulue))
  if (!manque) return local
  const derniere = restaurations.get(convId) ?? 0
  if (Date.now() - derniere < REPOS_RESTAURATION_MS) return local
  restaurations.set(convId, Date.now())
  /*
   * 🔴 D'ABORD MA BOÎTE PERMANENTE (chapitre 39) : déposée par l'administrateur
   * pour CET appareil, elle se relit sans personne en ligne.
   */
  try {
    await releverBoites(convId)
    const apres = await trousseauLocal(convId)
    const ok = apres.length > 0 && (voulue === undefined || apres.some((v) => v.n === voulue))
    if (ok) return apres
  } catch (err) {
    console.warn(`[e2ee] boîte du groupe ${convId.slice(0, 8)} illisible :`, err)
  }
  try {
    const { lireCopie } = await import("./e2ee-trousseau-perso")
    const copie = await lireCopie(convId)
    // La copie vient de moi : pas la peine de la redéposer telle quelle.
    const repris = copie ? await rangerTrousseau(convId, copie, { deposerCopie: false }) : local
    const encoreManquant =
      repris.length === 0 || (voulue !== undefined && !repris.some((v) => v.n === voulue))
    /*
     * 🔴 LE REPLI « APPAREIL » (chapitre 37) : pas de copie (archive fermée,
     * jamais ouverte ici), ou une copie en retard. On demande à MES AUTRES
     * appareils ; leur réponse arrive par la relève, et la sonnette
     * `e2ee_trousseau` rouvre le fil.
     */
    if (encoreManquant) void demanderAMesAppareils(convId)
    return repris
  } catch (err) {
    console.warn(`[e2ee] restauration du trousseau de ${convId.slice(0, 8)} impossible :`, err)
    void demanderAMesAppareils(convId)
    return local
  }
}

/* ══════════════════ LE REPLI « APPAREIL » ══════════════════ */

/** Dernière demande envoyée, et dernière réponse donnée, par groupe. */
const demandes = new Map<string, number>()
const reponses = new Map<string, number>()
const REPOS_DEMANDE_MS = 60_000

/**
 * Demande le trousseau de ce groupe à MES AUTRES appareils ET AUX
 * ADMINISTRATEURS du groupe (hors fil).
 *
 * 🐛 POURQUOI AUSSI LES ADMINISTRATEURS (10/10/2026, constaté par le user). Un
 * téléphone resté sur l'ANCIENNE application à l'activation a reçu la clé…
 * et l'a rangée comme un message : elle était perdue. Ses autres appareils,
 * anciens, ne répondaient pas ; il redemandait chaque minute, sans fin. Les
 * administrateurs ont la clé, et c'est eux qui l'auraient envoyée à l'ajout :
 * ils peuvent la renvoyer à un membre qui l'a perdue.
 *
 * ⚠️ UNE DEMANDE PAR GROUPE ET PAR MINUTE : un fil plein de bulles « en
 * attente » ne doit pas en envoyer une par bulle.
 */
export async function demanderAMesAppareils(convId: string): Promise<boolean> {
  const moi = getMyUserId()
  if (!moi) return false
  const derniere = demandes.get(convId) ?? 0
  if (Date.now() - derniere < REPOS_DEMANDE_MS) return false
  demandes.set(convId, Date.now())
  try {
    const demande = ecrireDemandeTrousseau(convId)
    const enveloppes = []
    const miens = await ouvrirSessions(moi, idAppareil())
    if (miens.length > 0) enveloppes.push(...(await chiffrerPour(moi, miens, demande)))
    const r = await apiRequest<{ members: { id: string; role?: string; joinedAt?: string }[] }>(
      `/api/conversations/${encodeURIComponent(convId)}/members`,
    )
    for (const m of r.members ?? []) {
      if (m.id === moi || !estAdministrateur(r.members, m.id)) continue
      try {
        const appareils = await ouvrirSessions(m.id)
        if (appareils.length > 0) enveloppes.push(...(await chiffrerPour(m.id, appareils, demande)))
      } catch {
        // Un administrateur injoignable n'empêche pas de demander aux autres.
      }
    }
    if (enveloppes.length === 0) return false
    await deposer(convId, enveloppes)
    return true
  } catch (err) {
    console.warn(`[e2ee] demande du trousseau de ${convId.slice(0, 8)} impossible :`, err)
    return false
  }
}

/**
 * Quelqu'un me demande le trousseau d'un groupe. Je le lui envoie si :
 *
 *   · c'est un de MES appareils (motif APPAREIL) ;
 *   · OU je suis ADMINISTRATEUR du groupe et il en est MEMBRE ACTIF (motif
 *     AJOUT) — exactement ce que j'aurais fait en l'ajoutant.
 *
 * 🔴 L'EXPÉDITEUR EST SÛR — c'est sa session Signal qui a déchiffré la
 * demande. Un simple membre ne répond qu'à ses propres appareils ; un ancien
 * membre (parti, exclu) n'obtient rien. La liste des membres vient du serveur,
 * comme pour l'ajout : c'est la limite du chapitre 31, que la vérification du
 * code de sécurité lève.
 *
 * ⚠️ UNE RÉPONSE PAR DEMANDEUR, PAR GROUPE ET PAR DEMI-MINUTE.
 */
export async function repondreADemande(
  convIdEnveloppe: string,
  expediteurId: string,
  clair: string,
): Promise<boolean> {
  const moi = getMyUserId()
  const convId = lireDemandeTrousseau(clair, convIdEnveloppe)
  if (expediteurId !== moi) {
    const r = await apiRequest<{ members: { id: string; role?: string; joinedAt?: string }[] }>(
      `/api/conversations/${encodeURIComponent(convId)}/members`,
    )
    if (!moi || !estAdministrateur(r.members ?? [], moi)) {
      throw new GroupeInvalide("demande de trousseau d'un autre compte, et je n'administre pas le groupe")
    }
    if (!(r.members ?? []).some((m) => m.id === expediteurId)) {
      throw new GroupeInvalide("demande de trousseau d'un compte qui n'est pas membre")
    }
  }
  const versions = await trousseauLocal(convId)
  if (versions.length === 0) return false
  const cle = `${convId}:${expediteurId}`
  const derniere = reponses.get(cle) ?? 0
  if (Date.now() - derniere < REPOS_RESTAURATION_MS) return false
  reponses.set(cle, Date.now())
  // Import différé : le module d'administration importe celui-ci.
  const { distribuerTrousseau } = await import("./e2ee-groupe-admin")
  await distribuerTrousseau(convId, expediteurId === moi ? "APPAREIL" : "AJOUT", versions, [expediteurId])
  return true
}

/**
 * Relit MES boîtes permanentes (toutes, ou celles d'un groupe), et range les
 * trousseaux qu'elles portent. Rend le nombre de boîtes acceptées.
 *
 * 🔴 MÊMES CONTRÔLES QU'UNE ENVELOPPE : la signature avec l'identité DÉJÀ
 * connue de l'appareil déposant (session ouverte d'abord s'il est inconnu),
 * le groupe écrit dans le clair = celui de la boîte, et le déposant doit
 * ADMINISTRER le groupe, ou être moi. Une boîte refusée est ignorée.
 */
export async function releverBoites(convId?: string): Promise<number> {
  const moi = getMyUserId()
  if (!moi) return 0
  const appareil = idAppareil()
  const r = await apiRequest<{
    boites: { convId: string; expediteurId: string; expediteurDevice: number; corps: string }[]
  }>(`/api/e2ee/boites?deviceId=${appareil}${convId ? `&convId=${encodeURIComponent(convId)}` : ""}`, {
    cache: "no-store",
  })
  const { priv } = await maPaireIdentite()
  let n = 0
  for (const b of r.boites ?? []) {
    try {
      const signataire = await cleSignataire(b.expediteurId, b.expediteurDevice)
      if (!signataire) continue
      const clair = await ouvrirBoite(
        b.corps,
        priv,
        {
          convId: b.convId,
          destinataireId: moi,
          destinataireDevice: appareil,
          expediteurId: b.expediteurId,
          expediteurDevice: b.expediteurDevice,
        },
        signataire,
      )
      await recevoirTrousseau(b.convId, b.expediteurId, clair)
      ;(await import("./e2ee-fil")).noteEtatChiffrement(b.convId, true)
      n++
    } catch (err) {
      console.warn(`[e2ee] boîte du groupe ${b.convId.slice(0, 8)} refusée :`, err)
    }
  }
  return n
}

/**
 * Nouvel appareil : reprend TOUTES mes copies d'un coup (après l'ouverture de
 * l'archive), puis toutes mes boîtes. Rend le nombre de groupes repris.
 */
export async function restaurerTousLesTrousseaux(): Promise<number> {
  await releverBoites().catch((err) => console.warn("[e2ee] boîtes illisibles :", err))
  const { lireToutesLesCopies } = await import("./e2ee-trousseau-perso")
  let n = 0
  for (const [convId, versions] of await lireToutesLesCopies()) {
    try {
      await rangerTrousseau(convId, versions, { deposerCopie: false })
      noteGroupe(convId, true)
      // Import différé : `e2ee-fil` importe ce module.
      ;(await import("./e2ee-fil")).noteEtatChiffrement(convId, true)
      n++
    } catch (err) {
      console.warn(`[e2ee] copie du trousseau de ${convId.slice(0, 8)} non reprise :`, err)
    }
  }
  return n
}

/**
 * Oublie le trousseau de ce groupe : on l'a quitté, ou on en a été exclu
 * (décision du user : les messages DÉJÀ LUS restent dans le cache local).
 */
export async function oublierTrousseau(convId: string): Promise<void> {
  await ouvrirCoffre()
  effacerSecret(cleCoffre(convId))
  await coffreEcrit()
}

/* ══════════════════ SAVOIR SI C'EST UN GROUPE ══════════════════ */

const groupes = new Map<string, boolean>()

/** Alimenté par `lireEtatE2ee` (`e2ee-fil.ts`) et par la liste des conversations. */
export function noteGroupe(convId: string, estGroupe: boolean): void {
  groupes.set(convId, estGroupe)
}

/** Ce fil chiffré est-il un GROUPE ? Demandé au serveur une fois, puis retenu. */
export async function estGroupe(convId: string): Promise<boolean> {
  const connu = groupes.get(convId)
  if (connu !== undefined) return connu
  const r = await apiRequest<{ groupe?: boolean }>(
    `/api/conversations/${encodeURIComponent(convId)}/e2ee`,
    { cache: "no-store" },
  )
  const g = r.groupe === true
  groupes.set(convId, g)
  return g
}

/* ══════════════════ ENVOYER ══════════════════ */

/** Le message n'est pas parti : la clé du groupe manque ou a changé. */
export class CleGroupeAbsente extends Error {
  constructor() {
    super("Clé du groupe pas encore reçue : le message n'est pas parti. Réessayez dans un instant.")
  }
}

export interface MessageGroupeCree {
  id: string
  createdAt: string
}

/**
 * Envoie un message dans un groupe chiffré : texte, contact, position ou média.
 *
 * 1. l'appareil tire l'identifiant du message (il est signé dans le chiffré) ;
 * 2. il chiffre la charge v2 avec la version la PLUS RÉCENTE qu'il connaît ;
 * 3. un seul envoi : la ligne et son chiffré.
 *
 * ⚠️ `VERSION_PERIMEE` : la clé a changé (exclusion, changement manuel) et le
 * nouveau trousseau n'est pas encore arrivé. Le message ne part pas, et on le
 * dit — on ne l'envoie surtout pas avec l'ancienne clé, que l'exclu connaît.
 */
export async function envoyerDansGroupe(
  convId: string,
  texte: string,
  o: {
    genre?: GenreCharge
    replyToId?: string
    media?: DescripteurMedia
    type?: string
  } = {},
): Promise<MessageGroupeCree> {
  const versions = await trousseauAvecRepli(convId)
  const courante = versions[versions.length - 1]
  if (!courante) throw new CleGroupeAbsente()
  const moi = getMyUserId()
  if (!moi) throw new Error("Session inconnue")

  const id = crypto.randomUUID()
  const appareil = idAppareil()
  const charge = ecrireCharge(id, texte, o.media, { reponseA: o.replyToId, genre: o.genre })
  const { priv } = await maPaireIdentite()
  const corps = await chiffrerMessageGroupe(
    charge,
    courante.cle,
    { convId, messageId: id, version: courante.n, expediteurId: moi, deviceId: appareil },
    priv,
  )

  try {
    return await apiRequest<MessageGroupeCree>(
      `/api/conversations/${encodeURIComponent(convId)}/messages`,
      {
        method: "POST",
        body: {
          id,
          type: o.type ?? o.genre ?? "TEXT",
          chiffre: true,
          ...(o.media ? { mediaIds: [o.media.id] } : {}),
          ...(o.replyToId ? { replyToId: o.replyToId } : {}),
          groupe: { version: courante.n, appareil, corps },
        },
      },
    )
  } catch (err) {
    if (codeErreur(err) === "VERSION_PERIMEE") throw new CleGroupeAbsente()
    throw err
  }
}

/**
 * Modifie un message de groupe : un NOUVEAU chiffré remplace l'ancien, avec la
 * version courante (le serveur l'exige). Rend la date de modification.
 */
export async function modifierDansGroupe(
  convId: string,
  messageId: string,
  texte: string,
): Promise<Date | null> {
  const versions = await trousseauAvecRepli(convId)
  const courante = versions[versions.length - 1]
  if (!courante) throw new CleGroupeAbsente()
  const moi = getMyUserId()
  if (!moi) throw new Error("Session inconnue")
  const appareil = idAppareil()
  const charge = ecrireCharge(messageId, texte, undefined, { modifie: true })
  const { priv } = await maPaireIdentite()
  const corps = await chiffrerMessageGroupe(
    charge,
    courante.cle,
    { convId, messageId, version: courante.n, expediteurId: moi, deviceId: appareil },
    priv,
  )
  try {
    const r = await apiRequest<{ editedAt?: string }>(
      `/api/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "PATCH", body: { chiffre: true, groupe: { version: courante.n, appareil, corps } } },
    )
    const date = r.editedAt ? new Date(r.editedAt) : null
    return date && !Number.isNaN(date.getTime()) ? date : null
  } catch (err) {
    if (codeErreur(err) === "VERSION_PERIMEE") throw new CleGroupeAbsente()
    throw err
  }
}

function codeErreur(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined
  return (err.payload as { error?: { code?: string } } | undefined)?.error?.code
}

/* ══════════════════ LIRE ══════════════════ */

/** Le chiffré tel que le serveur le rend avec chaque message de groupe. */
export interface ChiffreGroupe {
  version: number
  expediteurAppareil: number
  corps: string
}

/** Pourquoi un message de groupe ne s'est pas ouvert. */
export type EchecGroupe = "CLE_ABSENTE" | "EXPEDITEUR_INCONNU" | "INVALIDE"

export interface ClairGroupe {
  texte: string
  media?: DescripteurMedia
  reponseA?: string
  genre?: GenreCharge
  modifie?: boolean
}

/**
 * La clé d'identité de l'appareil qui a signé.
 *
 * ⚠️ D'ABORD CELLE QU'ON CONNAÎT DÉJÀ. Inconnue — un membre à qui l'on n'a
 * jamais écrit —, on ouvre une session à deux avec ses appareils : c'est le
 * chemin ordinaire, qui vérifie les pré-clés signées et retient l'identité
 * (avec l'alerte « clé changée » si elle bouge plus tard). On ne prend JAMAIS
 * une clé que le serveur servirait juste pour vérifier ce message.
 */
async function cleSignataire(userId: string, deviceId: number): Promise<Uint8Array | undefined> {
  const moi = getMyUserId()
  if (userId === moi && deviceId === idAppareil()) return (await maPaireIdentite()).pub
  const connue = await identiteConnue(userId, deviceId)
  if (connue) return connue
  try {
    await ouvrirSessions(userId, userId === moi ? idAppareil() : undefined)
  } catch {
    return undefined
  }
  return identiteConnue(userId, deviceId)
}

/**
 * Ouvre un message de groupe : signature d'abord, déchiffrement ensuite,
 * charge v2 vérifiée (elle doit annoncer CE message).
 */
export async function lireMessageGroupe(
  convId: string,
  messageId: string,
  expediteurId: string,
  g: ChiffreGroupe,
): Promise<ClairGroupe | EchecGroupe> {
  const versions = await trousseauAvecRepli(convId, g.version)
  const version = versions.find((v) => v.n === g.version)
  if (!version) return "CLE_ABSENTE"
  const cle = await cleSignataire(expediteurId, g.expediteurAppareil)
  if (!cle) return "EXPEDITEUR_INCONNU"
  try {
    const clair = await dechiffrerMessageGroupe(
      g.corps,
      version.cle,
      { convId, messageId, version: g.version, expediteurId, deviceId: g.expediteurAppareil },
      cle,
    )
    const charge = lireCharge(clair, messageId)
    return {
      texte: charge.texte,
      ...(charge.media ? { media: charge.media } : {}),
      ...(charge.reponseA ? { reponseA: charge.reponseA } : {}),
      ...(charge.genre ? { genre: charge.genre } : {}),
      ...(charge.modifie ? { modifie: true } : {}),
    }
  } catch (err) {
    console.warn(`[e2ee] message de groupe ${messageId.slice(0, 8)} refusé :`, err)
    return "INVALIDE"
  }
}

/* ══════════════════ RECEVOIR UN TROUSSEAU ══════════════════ */

/**
 * La règle du serveur (`isGroupAdmin`), à l'identique : un ADMIN, ou — dans
 * un ancien groupe qui n'en a aucun — le premier arrivé.
 */
export function estAdministrateur(
  membres: { id: string; role?: string; joinedAt?: string }[],
  userId: string,
): boolean {
  if (membres.some((m) => m.role === "ADMIN")) {
    return membres.some((m) => m.id === userId && m.role === "ADMIN")
  }
  const premier = [...membres].sort(
    (a, b) => new Date(a.joinedAt ?? 0).getTime() - new Date(b.joinedAt ?? 0).getTime(),
  )[0]
  return premier?.id === userId
}

/**
 * Un trousseau arrivé dans une enveloppe hors fil.
 *
 * 🔴 TROIS CONTRÔLES, ET L'ORDRE COMPTE (conception § 2.3) :
 *   1. le groupe écrit DANS le chiffré est celui de l'enveloppe ;
 *   2. l'expéditeur est un ADMINISTRATEUR du groupe, ou MOI (mes autres
 *      appareils) — n'importe quel membre ne distribue pas de clé ;
 *   3. aucune version connue n'est remplacée.
 *
 * ⚠️ LE RÔLE VIENT DU SERVEUR. Il pourrait mentir — mais il connaît déjà la
 * liste des membres et peut y ajouter qui il veut : c'est la limite assumée
 * du chapitre 31, que seule une vérification par membre lèvera.
 *
 * Lève `GroupeInvalide` si le trousseau est refusé.
 */
export async function recevoirTrousseau(
  convIdEnveloppe: string,
  expediteurId: string,
  clair: string,
): Promise<VersionCle[]> {
  const t = lireChargeTrousseau(clair, convIdEnveloppe)
  const moi = getMyUserId()
  if (expediteurId !== moi) {
    const r = await apiRequest<{ members: { id: string; role?: string; joinedAt?: string }[] }>(
      `/api/conversations/${encodeURIComponent(t.convId)}/members`,
    )
    if (!estAdministrateur(r.members, expediteurId)) throw new GroupeInvalide("trousseau envoyé par quelqu'un qui n'administre pas le groupe")
  }
  noteGroupe(t.convId, true)
  return rangerTrousseau(t.convId, t.versions)
}
