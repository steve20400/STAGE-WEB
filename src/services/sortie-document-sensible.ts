import { apiRequest } from "../lib/api-client"
import type { DescripteurMedia } from "./e2ee-media"
import {
  appareilNavigateur,
  nouvelleSignature,
  signerCopie,
  type CopieSignee,
  type GesteSortie,
  type SignatureSortie,
} from "./signature-document"

/**
 * FAIRE SORTIR UN DOCUMENT SENSIBLE (22/10/2026) — pendant web de
 * `lib/features/chat/sortie_document_sensible.dart`.
 *
 * Jusqu'au 22/10, le navigateur n'ouvrait pas un document sensible. Le user a
 * levé l'interdiction de télécharger et de partager ; en échange, CHAQUE copie
 * qui sort est signée (bords, métadonnées, code de trace) et le geste est noté
 * par le serveur avec ce code.
 */

const ROUTE_TRACE = "/api/documents-sensibles/consultations"

export function nomDuDocument(d: DescripteurMedia): string {
  return d.nom ?? `Alanya_${d.id}`
}

/** La copie signée de `clair`, au nom de `alanyaId`. Le geste est noté dans tous les cas. */
export async function copieSignee(o: {
  clair: Blob
  d: DescripteurMedia
  geste: GesteSortie
  alanyaId: string
  convId?: string
  expediteurId?: string
}): Promise<CopieSignee> {
  const s = nouvelleSignature({
    geste: o.geste,
    alanyaId: o.alanyaId,
    expediteurId: o.expediteurId,
    mediaId: o.d.id,
  })
  const copie = await signerCopie(o.clair, nomDuDocument(o.d), o.d.mime, s)
  void noterSortie(s, o.d, o.convId)
  return copie
}

/** La lecture, notée au serveur (sans code : rien ne sort). */
export function noterConsultation(d: DescripteurMedia, convId?: string): void {
  void apiRequest(ROUTE_TRACE, {
    method: "POST",
    body: { mediaId: d.id, ...(convId ? { convId } : {}), appareil: appareilNavigateur() },
  }).catch(() => {})
}

/** Ne bloque jamais le geste : hors ligne, la copie garde ses métadonnées. */
async function noterSortie(s: SignatureSortie, d: DescripteurMedia, convId?: string): Promise<void> {
  try {
    await apiRequest(ROUTE_TRACE, {
      method: "POST",
      body: {
        mediaId: d.id,
        ...(convId ? { convId } : {}),
        appareil: s.appareil,
        action: s.geste,
        codeTrace: s.code,
      },
    })
  } catch {
    // La trace manque côté serveur ; le fichier, lui, porte la sienne.
  }
}

/** Fait télécharger `fichier` par le navigateur. */
export function telechargerFichier(fichier: File): void {
  const url = URL.createObjectURL(fichier)
  const lien = document.createElement("a")
  lien.href = url
  lien.download = fichier.name
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
