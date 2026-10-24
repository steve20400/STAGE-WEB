import { useEffect, useSyncExternalStore } from "react"

import { API_BASE_URL } from "../config/runtime"
import { getMyUserId } from "../data/session-user"
import { apiRequest } from "../lib/api-client"

/**
 * LES STICKERS (24/10/2026, demande du user : « comme WhatsApp ») — jumeau de
 * `alanya/lib/features/stickers/stickers_service.dart`.
 *
 * - le CATALOGUE (`GET /api/stickers`) : ce que la console a publié ;
 * - MON PANNEAU (`GET /api/stickers/me`) : mes packs dans mon ordre, et mes
 *   favoris, communs à mes appareils ;
 * - les RÉCENTS : dans ce navigateur seulement, par compte.
 *
 * Fermés par la console, les stickers disparaissent de l'interface ; les
 * messages déjà reçus s'affichent toujours.
 */

export interface Sticker {
  id: number
  assetId: number
  packCode: string
  emoji: string
  url: string
  nom: Record<string, string>
  anime: boolean
}

export interface PackStickers {
  id: number
  code: string
  nom: Record<string, string>
  description: Record<string, string>
  auteur: string | null
  couverture: string | null
  stickers: Sticker[]
}

export interface EtatStickers {
  ouverts: boolean
  catalogue: PackStickers[]
  /** Mes packs, dans l'ordre du panneau. */
  mesPacks: number[]
  /** Mes favoris, le plus récent d'abord. */
  favoris: number[]
  /** Les derniers envoyés depuis ce navigateur. */
  recents: number[]
}

const MAX_RECENTS = 30

/** La charge d'un message STICKER — mêmes clés, même ordre que le serveur et le mobile. */
export function chargeSticker(s: Sticker): string {
  return JSON.stringify({ v: 1, pack: s.packCode, sid: s.id, asset: s.assetId, emoji: s.emoji, w: 512, h: 512, a: s.anime ? 1 : 0 })
}

/** Ce que porte un message STICKER reçu ; `null` si la charge est illisible. */
export interface ChargeSticker {
  sid: number
  assetId: number
  pack: string
  emoji: string
  url: string
}

export function lireChargeSticker(content: string | null | undefined): ChargeSticker | null {
  if (!content) return null
  try {
    const j = JSON.parse(content) as Record<string, unknown>
    if (!j || j.v !== 1) return null
    const { sid, asset, pack } = j
    if (!Number.isSafeInteger(sid) || !Number.isSafeInteger(asset) || typeof pack !== "string") return null
    return {
      sid: sid as number,
      assetId: asset as number,
      pack,
      emoji: typeof j.emoji === "string" ? j.emoji : "",
      url: `${API_BASE_URL}/api/stickers/fichier/${asset as number}`,
    }
  } catch {
    return null
  }
}

/** Le nom dans la langue demandée, sinon l'anglais, sinon le français. */
export function nomDans(t: Record<string, string>, langue: string, repli = ""): string {
  return t[langue] ?? t.en ?? t.fr ?? Object.values(t)[0] ?? repli
}

const traductions = (brut: unknown): Record<string, string> => {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return {}
  return Object.fromEntries(
    Object.entries(brut as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""),
  )
}

function lirePack(brut: unknown): PackStickers | null {
  const p = brut as Record<string, unknown> | null
  if (!p || typeof p.id !== "number" || typeof p.code !== "string") return null
  const code = p.code
  const stickers: Sticker[] = []
  for (const s of (p.stickers as unknown[]) ?? []) {
    const x = s as Record<string, unknown>
    if (typeof x?.id !== "number" || typeof x.assetId !== "number" || typeof x.url !== "string") continue
    stickers.push({
      id: x.id,
      assetId: x.assetId,
      packCode: code,
      emoji: typeof x.emoji === "string" ? x.emoji : "",
      url: x.url,
      nom: traductions(x.nom),
      anime: x.anime === true,
    })
  }
  return {
    id: p.id,
    code,
    nom: traductions(p.nom),
    description: traductions(p.description),
    auteur: typeof p.auteur === "string" ? p.auteur : null,
    couverture: typeof p.couverture === "string" ? p.couverture : null,
    stickers,
  }
}

/** La vignette d'un pack : sa couverture, sinon son premier sticker. */
export const vignette = (p: PackStickers): string | null => p.couverture ?? p.stickers[0]?.url ?? null

// ── L'état, partagé par tous les composants ─────────────────────────────────

const CLE_CATALOGUE = "alanya.stickers.catalogue"
const cleRecents = () => `alanya.stickers.recents.${getMyUserId() ?? "-"}`
const cleMoi = () => `alanya.stickers.moi.${getMyUserId() ?? "-"}`

function lireStockage<T>(cle: string, defaut: T): T {
  try {
    const brut = localStorage.getItem(cle)
    return brut ? (JSON.parse(brut) as T) : defaut
  } catch {
    return defaut
  }
}
function ecrireStockage(cle: string, valeur: unknown) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur))
  } catch {
    /* stockage refusé : un confort perdu, rien de plus */
  }
}

function etatDepuisCatalogue(cat: unknown): Pick<EtatStickers, "ouverts" | "catalogue"> {
  const c = cat as { enabled?: unknown; packs?: unknown[] } | null
  return {
    ouverts: c?.enabled === true,
    catalogue: (c?.packs ?? []).map(lirePack).filter((p): p is PackStickers => p !== null),
  }
}

function etatInitial(): EtatStickers {
  const moi = lireStockage<{ packs?: number[]; favorites?: number[] }>(cleMoi(), {})
  return {
    ...etatDepuisCatalogue(lireStockage(CLE_CATALOGUE, null)),
    mesPacks: moi.packs ?? [],
    favoris: moi.favorites ?? [],
    recents: lireStockage<number[]>(cleRecents(), []),
  }
}

let etat: EtatStickers = etatInitial()
let compte: string | null = getMyUserId()
let charge = false
let enCours: Promise<void> | null = null
const abonnes = new Set<() => void>()

function changer(patch: Partial<EtatStickers>) {
  etat = { ...etat, ...patch }
  abonnes.forEach((f) => f())
}

/** Un autre compte s'est connecté dans ce navigateur : on oublie le panneau du précédent. */
function suivreCompte() {
  const actuel = getMyUserId()
  if (actuel === compte) return
  compte = actuel
  charge = false
  etat = etatInitial()
}

async function charger(): Promise<void> {
  try {
    const cat = await apiRequest<unknown>("/api/stickers")
    ecrireStockage(CLE_CATALOGUE, cat)
    const base = etatDepuisCatalogue(cat)
    if (base.ouverts) {
      const moi = await apiRequest<{ packs?: Array<{ id: number }>; favorites?: number[] }>("/api/stickers/me")
      const mesPacks = (moi.packs ?? []).map((p) => p.id)
      const favoris = moi.favorites ?? []
      ecrireStockage(cleMoi(), { packs: mesPacks, favorites: favoris })
      changer({ ...base, mesPacks, favoris })
    } else {
      changer(base)
    }
    charge = true
  } catch {
    // Hors ligne : on garde ce qui était dans ce navigateur.
  }
}

/** Charge une fois ; [force] recharge (retour dans la boutique). */
export function assurerStickers(force = false): Promise<void> {
  suivreCompte()
  if (charge && !force) return Promise.resolve()
  enCours ??= charger().finally(() => {
    enCours = null
  })
  return enCours
}

export function useStickers(): EtatStickers {
  const e = useSyncExternalStore(
    (f) => {
      abonnes.add(f)
      return () => abonnes.delete(f)
    },
    () => etat,
  )
  useEffect(() => {
    void assurerStickers()
  }, [])
  return e
}

// ── Lecture ─────────────────────────────────────────────────────────────────

export const packParId = (e: EtatStickers, id: number) => e.catalogue.find((p) => p.id === id) ?? null
export const packParCode = (e: EtatStickers, code: string) => e.catalogue.find((p) => p.code === code) ?? null
export function stickerParId(e: EtatStickers, id: number): Sticker | null {
  for (const p of e.catalogue) for (const s of p.stickers) if (s.id === id) return s
  return null
}
export const packsInstalles = (e: EtatStickers) =>
  e.mesPacks.map((id) => packParId(e, id)).filter((p): p is PackStickers => p !== null)
export const stickersDe = (e: EtatStickers, ids: number[]) =>
  ids.map((id) => stickerParId(e, id)).filter((s): s is Sticker => s !== null)

/** La recherche de WhatsApp : par émoji ou par nom, toutes langues, dans mes packs. */
export function chercherStickers(e: EtatStickers, requete: string): Sticker[] {
  const q = requete.trim().toLowerCase()
  if (!q) return []
  return packsInstalles(e).flatMap((p) =>
    p.stickers.filter((s) => s.emoji.includes(q) || Object.values(s.nom).some((n) => n.toLowerCase().includes(q))),
  )
}

// ── Écriture : l'écran change tout de suite, un refus remet l'état d'avant ──

function memoriserMoi() {
  ecrireStockage(cleMoi(), { packs: etat.mesPacks, favorites: etat.favoris })
}

async function optimiste(patch: Partial<EtatStickers>, appel: () => Promise<unknown>) {
  const avant = etat
  changer(patch)
  try {
    await appel()
    memoriserMoi()
  } catch (e) {
    etat = avant
    abonnes.forEach((f) => f())
    throw e
  }
}

export function installerPack(id: number) {
  if (etat.mesPacks.includes(id)) return Promise.resolve()
  return optimiste({ mesPacks: [...etat.mesPacks, id] }, () => apiRequest(`/api/stickers/me/packs/${id}`, { method: "PUT" }))
}

export function retirerPack(id: number) {
  return optimiste({ mesPacks: etat.mesPacks.filter((x) => x !== id) }, () =>
    apiRequest(`/api/stickers/me/packs/${id}`, { method: "DELETE" }),
  )
}

export function ordonnerPacks(ids: number[]) {
  return optimiste({ mesPacks: ids }, () => apiRequest("/api/stickers/me/packs/order", { method: "PUT", body: { ids } }))
}

export function basculerFavori(id: number) {
  const ajout = !etat.favoris.includes(id)
  return optimiste(
    { favoris: ajout ? [id, ...etat.favoris] : etat.favoris.filter((x) => x !== id) },
    () => apiRequest(`/api/stickers/me/favorites/${id}`, { method: ajout ? "PUT" : "DELETE" }),
  )
}

export function noterRecent(id: number) {
  const recents = [id, ...etat.recents.filter((x) => x !== id)].slice(0, MAX_RECENTS)
  changer({ recents })
  ecrireStockage(cleRecents(), recents)
}
