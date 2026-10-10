import { apiRequest, ApiError } from "../lib/api-client"
import { API_BASE_URL } from "../config/runtime"
import { uploadMedia } from "./media-service"

/**
 * ENVOYER UN FICHIER EN MORCEAUX, depuis le navigateur — lot 5 (cours,
 * chapitre 46). Jumeau web de `lib/features/chat/envoi_morceaux/` du mobile,
 * sur les routes `/api/media/envois` du serveur (chapitre 42).
 *
 * Le fichier est découpé en morceaux de 1 Mio (taille décidée par le serveur),
 * envoyés TROIS À LA FOIS : sur une connexion lente ou instable, plusieurs
 * connexions vont plus vite qu'une seule, et une coupure ne coûte que le
 * morceau en vol — réessayé seul, pas le fichier entier.
 *
 * ⚠️ L'ONGLET DOIT RESTER OUVERT. Un navigateur ne sait pas continuer un envoi
 * page fermée ; c'est la différence avec le téléphone, où Android prend le
 * relais. Le message, lui, part d'ici une fois le fichier arrivé : pas besoin
 * de publication différée.
 *
 * ⚠️ PETITS FICHIERS : UN SEUL BLOC. Sous un mébioctet, réserver puis envoyer
 * ferait deux requêtes là où une suffit ; on garde `POST /api/media`.
 */

const SEUIL_MORCEAUX = 1024 * 1024
const EN_PARALLELE = 3
const REESSAIS = 5

interface Reservation {
  id: string
  jeton: string
  tailleMorceau: number
  nbMorceaux: number
  mediaId?: string
}

export interface OptionsEnvoi {
  nom: string
  mime: string
  /** Fichier chiffré de bout en bout : nom et type neutres côté serveur. */
  chiffre?: boolean
  dureeMs?: number
  /** SHA-256 (hexadécimal) du fichier, vérifié par le serveur à l'assemblage. */
  empreinteHex?: string
  /** Avancement, de 0 à 1 — jamais 1 avant que le serveur ait tout assemblé. */
  onProgression?: (fraction: number) => void
}

/** SHA-256 en hexadécimal. */
export async function empreinteHex(octets: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", octets as Uint8Array<ArrayBuffer>))
  return Array.from(h, (o) => o.toString(16).padStart(2, "0")).join("")
}

/**
 * Téléverse [fichier] et rend l'identifiant du média.
 *
 * En morceaux au-delà d'un mébioctet ; d'un seul bloc en deçà, ou si le
 * serveur ne connaît pas encore les envois en morceaux (404 à la réservation).
 */
export async function televerser(fichier: Blob, o: OptionsEnvoi): Promise<{ id: string }> {
  if (fichier.size <= SEUIL_MORCEAUX) return unBloc(fichier, o)

  let r: Reservation
  try {
    r = await apiRequest<Reservation>("/api/media/envois", {
      method: "POST",
      body: {
        taille: fichier.size,
        nom: o.chiffre ? "chiffre.bin" : o.nom,
        mime: o.chiffre ? "application/octet-stream" : o.mime,
        chiffre: o.chiffre === true,
        ...(o.dureeMs && Number.isFinite(o.dureeMs) ? { durationMs: Math.round(o.dureeMs) } : {}),
        ...(o.empreinteHex ? { empreinte: o.empreinteHex } : {}),
      },
    })
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return unBloc(fichier, o)
    throw err
  }

  const avance = new Map<number, number>()
  const tailles = new Map<number, number>()
  for (let n = 0; n < r.nbMorceaux; n++) {
    tailles.set(n, Math.min(r.tailleMorceau, fichier.size - n * r.tailleMorceau))
  }
  const signaler = () => {
    let faits = 0
    avance.forEach((f, n) => (faits += f * (tailles.get(n) ?? 0)))
    // Plafonné à 99 % : les octets partis, restent l'assemblage du serveur.
    o.onProgression?.(Math.min(0.99, faits / fichier.size))
  }

  let termine = false
  const file = Array.from({ length: r.nbMorceaux }, (_, n) => n)
  const ouvrier = async () => {
    for (let n = file.shift(); n !== undefined; n = file.shift()) {
      const debut = n * r.tailleMorceau
      const morceau = fichier.slice(debut, debut + (tailles.get(n) ?? 0))
      const reponse = await envoyerMorceau(r, n, morceau, (f) => {
        if (f > (avance.get(n) ?? 0)) avance.set(n, f)
        signaler()
      })
      avance.set(n, 1)
      signaler()
      if (reponse?.termine === true) termine = true
    }
  }
  await Promise.all(Array.from({ length: Math.min(EN_PARALLELE, r.nbMorceaux) }, ouvrier))

  /*
   * ⚠️ PERSONNE N'A DIT « TERMINÉ » : deux morceaux ont fini ensemble et c'est
   * l'autre qui a assemblé, ou l'assemblage a échoué un instant. On demande au
   * serveur — `terminer` relance l'assemblage si tout est là.
   */
  if (!termine) {
    const etat = await avecJeton<{ statut?: string }>(r, "POST", `/api/media/envois/${r.id}/terminer`)
    if (etat.statut !== "termine") throw new Error("Le serveur n'a pas pu assembler le fichier.")
  }
  o.onProgression?.(1)
  return { id: r.mediaId ?? r.id }
}

async function unBloc(fichier: Blob, o: OptionsEnvoi): Promise<{ id: string }> {
  if (!o.chiffre) {
    const m = await uploadMedia(fichier, o.nom, o.dureeMs)
    o.onProgression?.(1)
    return m
  }
  const form = new FormData()
  form.append("file", fichier, "chiffre.bin")
  form.append("chiffre", "1")
  const m = await apiRequest<{ id: string }>("/api/media", { method: "POST", body: form })
  o.onProgression?.(1)
  return m
}

/**
 * Un morceau, avec ses réessais. `XMLHttpRequest` et non `fetch` : seul lui
 * donne l'avancement d'un ENVOI (`upload.onprogress`).
 *
 * ⚠️ UN REFUS DU SERVEUR (4xx) N'EST PAS RÉESSAYÉ : jeton faux, envoi expiré,
 * morceau inconnu ne s'arrangeront pas en insistant. Une coupure ou un 5xx,
 * si : 1, 2, 4, 8 puis 16 secondes d'attente.
 */
async function envoyerMorceau(
  r: Reservation,
  n: number,
  morceau: Blob,
  onAvance: (fraction: number) => void,
): Promise<{ termine?: boolean } | null> {
  for (let essai = 0; ; essai++) {
    try {
      return await new Promise((ok, ko) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", `${API_BASE_URL}/api/media/envois/${r.id}/morceaux/${n}`)
        xhr.setRequestHeader("X-Envoi-Jeton", r.jeton)
        xhr.setRequestHeader("Content-Type", "application/octet-stream")
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) onAvance(e.loaded / e.total)
        }
        xhr.onload = () => {
          let corps: unknown = null
          try {
            corps = JSON.parse(xhr.responseText)
          } catch {
            /* corps illisible : on ne garde que le statut */
          }
          if (xhr.status >= 200 && xhr.status < 300) ok(corps as { termine?: boolean } | null)
          else ko(new ApiError(`Morceau ${n} refusé (${xhr.status})`, xhr.status, corps))
        }
        xhr.onerror = () => ko(new ApiError(`Morceau ${n} : réseau`, 0))
        xhr.send(morceau)
      })
    } catch (err) {
      const statut = err instanceof ApiError ? err.status : 0
      const definitif = statut >= 400 && statut < 500
      if (definitif || essai >= REESSAIS) throw err
      onAvance(0)
      await new Promise((attendre) => setTimeout(attendre, 1000 * 2 ** essai))
    }
  }
}

async function avecJeton<T>(r: Reservation, methode: string, chemin: string): Promise<T> {
  const rep = await fetch(`${API_BASE_URL}${chemin}`, {
    method: methode,
    headers: { "X-Envoi-Jeton": r.jeton },
  })
  const corps = await rep.json().catch(() => ({}))
  if (!rep.ok) throw new ApiError(`Envoi ${r.id} : ${rep.status}`, rep.status, corps)
  return corps as T
}
