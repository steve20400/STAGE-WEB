import type { ControleTransfert } from "./controle-envoi"

/**
 * TÉLÉCHARGER UN FICHIER EN POUVANT S'ARRÊTER ET REPRENDRE — web.
 *
 * 🔴 DEMANDE DU USER, 25/11/2026 : « on doit pouvoir mettre pause à un envoi
 * ou même à un téléchargement ». Un média chiffré venait d'un seul
 * `fetch().arrayBuffer()` : aucun avancement affiché, aucune reprise, et une
 * coupure à 95 % renvoyait au début. Avec un plafond à 500 Mo, c'est la moitié
 * d'un forfait perdue pour rien.
 *
 * Le corps est lu EN FLUX, morceau par morceau : c'est ce qui permet à la fois
 * d'annoncer l'avancement et de garder ce qui est déjà arrivé quand on coupe.
 *
 * ══════ POURQUOI LE PREMIER ESSAI NE DEMANDE JAMAIS DE PLAGE ══════
 *
 * 🔴 UN EN-TÊTE `Range` CHANGE LA NATURE DE LA REQUÊTE. Sans lui, le navigateur
 * envoie une requête « simple » ; avec lui, il exige d'abord une permission du
 * stockage (requête préalable CORS). Si le seau n'autorise pas cet en-tête, la
 * requête échoue AVANT d'avoir commencé — et ce serait tout le téléchargement
 * des médias chiffrés qui tomberait, pas seulement la reprise.
 *
 * Le premier essai est donc exactement la requête d'avant, octet pour octet.
 * `Range` n'apparaît qu'à la REPRISE, et s'il est refusé on repart de zéro :
 * on retrouve le comportement d'avant, jamais moins bien.
 */

const REESSAIS = 5

/** Le serveur nous refuse ce fichier, ou ne l'a plus : insister est inutile. */
export class RefusTelechargement extends Error {
  constructor(readonly statut: number) {
    super(`téléchargement refusé (${statut})`)
  }
}

export interface OptionsTelechargement {
  entetes?: Record<string, string>
  /**
   * Avancement. [total] vaut 0 quand le serveur ne l'annonce pas : l'appelant
   * affiche alors ce qui est reçu, sans pourcentage.
   */
  onProgression?: (recu: number, total: number) => void
  /** La pause — voir `controle-envoi.ts`. */
  controle?: ControleTransfert
  /**
   * Réessayer même quand RIEN n'est encore arrivé ?
   *
   * 🔴 FAUX PAR DÉFAUT, ET C'EST IMPORTANT. Un échec à zéro octet veut
   * généralement dire que la requête n'est jamais passée — origine refusée par
   * le stockage, fichier absent, réseau d'entreprise qui le bloque. Insister
   * cinq fois ferait attendre une demi-minute avant d'essayer le repli, alors
   * que c'est précisément le cas où il faut y aller tout de suite.
   *
   * Un échec APRÈS des octets, lui, est une coupure : celui-là se reprend
   * toujours, quel que soit ce réglage.
   */
  insisterAZero?: boolean
}

export async function telechargerAvecReprise(
  adresse: string,
  o: OptionsTelechargement = {},
): Promise<Uint8Array> {
  let morceaux: Uint8Array[] = []
  let recu = 0
  let total = 0
  let essai = 0

  for (;;) {
    await o.controle?.point()
    const abandon = new AbortController()
    let coupeParPause = false
    const retirer = o.controle?.inscrire(() => {
      coupeParPause = true
      abandon.abort()
    })
    const reprise = recu > 0
    try {
      const entetes: Record<string, string> = { ...(o.entetes ?? {}) }
      if (reprise) entetes.Range = `bytes=${recu}-`
      const r = await fetch(adresse, { headers: entetes, signal: abandon.signal })
      if (!r.ok) {
        if (r.status === 403 || r.status === 404 || r.status === 410) {
          throw new RefusTelechargement(r.status)
        }
        throw new Error(`téléchargement : ${r.status}`)
      }
      /*
       * ⚠️ UN SERVEUR QUI IGNORE `Range` RÉPOND 200 ET RENVOIE TOUT. Coller ce
       * corps derrière ce qu'on avait déjà donnerait un fichier plus LONG que
       * l'original : son empreinte ne tomberait pas juste et l'utilisateur
       * verrait « ce fichier n'est pas celui qui a été envoyé ». On jette donc
       * ce qu'on gardait et on recommence proprement.
       */
      if (reprise && r.status !== 206) {
        morceaux = []
        recu = 0
      }
      total = tailleTotale(r, recu) || total
      recu = await lireFlux(r, morceaux, recu, total, o.onProgression)
      return assembler(morceaux, recu)
    } catch (err) {
      retirer?.()
      // Une pause n'use aucun réessai : on attend, on n'échoue pas.
      if (coupeParPause) continue
      if (err instanceof RefusTelechargement) throw err
      const rienRecu = recu === 0
      /*
       * ⚠️ UNE REPRISE QUI ÉCHOUE RETOMBE SUR UN TÉLÉCHARGEMENT ENTIER. C'est
       * le cas du stockage qui n'autorise pas `Range` : sa requête préalable
       * est refusée et l'erreur ne dit pas pourquoi. Repartir de zéro coûte la
       * bande passante déjà dépensée — mais le fichier arrive, au lieu de ne
       * jamais arriver.
       */
      if (reprise) {
        morceaux = []
        recu = 0
      }
      if (rienRecu && !o.insisterAZero) throw err
      if (essai >= REESSAIS) throw err
      await new Promise((attendre) => setTimeout(attendre, 1000 * 2 ** essai))
      essai++
    } finally {
      retirer?.()
    }
  }
}

/**
 * La taille du fichier ENTIER.
 *
 * ⚠️ `Content-Range` N'EST PAS LISIBLE D'OFFICE sur une réponse d'un autre
 * domaine — il faut que le stockage l'expose. `Content-Length`, lui, l'est
 * toujours : le premier essai annonce donc le total, et la reprise garde celui
 * qu'elle connaît déjà.
 */
function tailleTotale(r: Response, dejaRecu: number): number {
  const plage = r.headers.get("Content-Range")
  const fin = plage ? /\/(\d+)\s*$/.exec(plage) : null
  if (fin) return Number(fin[1])
  const longueur = Number(r.headers.get("Content-Length") ?? 0)
  return longueur > 0 ? dejaRecu + longueur : 0
}

async function lireFlux(
  r: Response,
  morceaux: Uint8Array[],
  dejaRecu: number,
  total: number,
  onProgression?: (recu: number, total: number) => void,
): Promise<number> {
  let recu = dejaRecu
  // Pas de flux (vieux navigateur) : tout d'un coup, comme avant.
  if (!r.body) {
    const tout = new Uint8Array(await r.arrayBuffer())
    morceaux.push(tout)
    recu += tout.length
    onProgression?.(recu, total || recu)
    return recu
  }
  const lecteur = r.body.getReader()
  for (;;) {
    const { done, value } = await lecteur.read()
    if (done) break
    if (!value || value.length === 0) continue
    morceaux.push(value)
    recu += value.length
    onProgression?.(recu, total)
  }
  return recu
}

function assembler(morceaux: Uint8Array[], taille: number): Uint8Array {
  if (morceaux.length === 1) return morceaux[0]
  const tout = new Uint8Array(taille)
  let place = 0
  for (const m of morceaux) {
    tout.set(m, place)
    place += m.length
  }
  return tout
}
