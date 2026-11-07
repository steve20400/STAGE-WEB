/**
 * LES NOMS QUE J'AI DONNÉS À MES CONTACTS, APPLIQUÉS PARTOUT.
 *
 * 🔴 DEMANDE DU PATRON (18/10/2026) : « ce nom-là, quand tu m'écris, c'est ce
 * nom-là qui doit s'afficher. Quand tu m'appelles, c'est ce nom-là. » Le nom
 * donné dans la fiche d'un contact (`Contact.alias`) ne servait ici qu'à
 * l'écran des contacts — le mobile l'applique partout depuis le 18/10, le web
 * était en retard.
 *
 * Règle unique, la même que `lib/core/noms_donnes.dart` côté mobile : le nom
 * que J'AI donné s'il existe, sinon le nom du profil. Elle vaut pour les titres
 * des discussions, les noms dans les groupes, les appels et les statuts.
 *
 * ⚠️ CE QUI SORT DE L'APPLICATION GARDE LE NOM DU PROFIL : une mention écrite,
 * un contact partagé, ce qu'on envoie au serveur. Le nom donné est PRIVÉ — il
 * n'appartient qu'à celui qui l'a choisi, et le révéler serait une fuite.
 *
 * ⚠️ UN COMPTE QUI REFUSE D'ÊTRE RENOMMÉ : le serveur ne renvoie pas son nom
 * donné (`alias: null`, voir `User.nomVerrouille`), il n'entre donc jamais ici.
 * Le filtrage se fait au serveur, et c'est la seule place sûre.
 *
 * Gardé dans le navigateur : il sert dès le premier affichage, avant que la
 * liste des contacts n'arrive. Effacé à la déconnexion par `session-reset`.
 */

/** ⚠️ À tenir en accord avec `ACCOUNT_CACHE_KEYS` de `session-reset.ts`. */
export const CLE_NOMS_DONNES = "alanya-noms-donnes-v1"

let noms: Record<string, string> = lireLeStock()

/** Les écrans qui veulent se redessiner quand un nom change. */
const auditeurs = new Set<() => void>()

function lireLeStock(): Record<string, string> {
  try {
    const brut = localStorage.getItem(CLE_NOMS_DONNES)
    if (!brut) return {}
    const m: unknown = JSON.parse(brut)
    if (!m || typeof m !== "object") return {}
    const propre: Record<string, string> = {}
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) propre[k] = v
    }
    return propre
  } catch {
    // Navigation privée, quota, copie illisible : les noms reviendront avec
    // la liste des contacts. Ne jamais faire échouer un affichage pour ça.
    return {}
  }
}

function garder(): void {
  for (const f of auditeurs) {
    try {
      f()
    } catch {
      /* un auditeur fautif n'empêche pas les autres */
    }
  }
  try {
    localStorage.setItem(CLE_NOMS_DONNES, JSON.stringify(noms))
  } catch {
    /* le registre vit quand même en mémoire pour cette session */
  }
}

/** Le nom donné à [userId], ou `null`. */
export function de(userId?: string | null): string | null {
  if (!userId) return null
  return noms[userId] ?? null
}

/** Le nom à afficher : le nom donné, sinon [nomDuProfil]. */
export function nomPour(userId: string | null | undefined, nomDuProfil: string): string {
  return de(userId) ?? nomDuProfil
}

/** La liste des contacts vient d'arriver du serveur : elle fait foi. */
export function depuisContacts(
  contacts: ReadonlyArray<{ alias?: string | null; user?: { id?: string | null } | null }>,
): void {
  const nouveaux: Record<string, string> = {}
  for (const c of contacts) {
    const id = c.user?.id
    const alias = c.alias?.trim()
    if (id && alias) nouveaux[id] = alias
  }
  const memes =
    Object.keys(nouveaux).length === Object.keys(noms).length &&
    Object.entries(nouveaux).every(([k, v]) => noms[k] === v)
  if (memes) return
  noms = nouveaux
  garder()
}

/** Un nom vient d'être donné, ou retiré si [nom] est vide. */
export function poser(userId: string | null | undefined, nom?: string | null): void {
  if (!userId) return
  const n = nom?.trim() ?? ""
  if (!n) {
    if (!(userId in noms)) return
    const { [userId]: _retire, ...reste } = noms
    noms = reste
  } else {
    if (noms[userId] === n) return
    noms = { ...noms, [userId]: n }
  }
  garder()
}

/** Déconnexion : le compte suivant ne doit rien voir du précédent. */
export function vider(): void {
  if (Object.keys(noms).length === 0) return
  noms = {}
  garder()
}

/** S'abonner aux changements ; rend la fonction de désabonnement. */
export function surChangement(f: () => void): () => void {
  auditeurs.add(f)
  return () => auditeurs.delete(f)
}
