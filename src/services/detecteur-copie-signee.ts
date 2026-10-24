/**
 * UNE COPIE SIGNÉE NE REPART PAS EN « SENSIBLE » (24/10/2026, demande du
 * user) — jumeau de `lib/core/detecteur_copie_signee.dart` du mobile.
 *
 * A envoie un document sensible à B ; B le télécharge, la copie porte son
 * empreinte. Renvoyée en « sensible » (à un faux compte, par exemple), elle
 * serait re-signée au nom du destinataire suivant, et la trace de B — le vrai
 * fuiteur — serait perdue. Une copie signée ne repart donc qu'en document
 * ORDINAIRE, qui garde ses métadonnées.
 *
 * On la reconnaît aux noms de champs que la signature écrit en clair :
 * « Empreinte numerique », « Empreinte#20numerique » (Info d'un PDF), et pour
 * les copies du 22 au 24/10 « AlanyaTrace » et « com.alanya237.work ».
 *
 * Le fichier est lu par tranches de 4 Mo (avec un recouvrement, pour une
 * marque à cheval sur deux tranches) : une vidéo de 300 Mo n'est jamais
 * chargée entière.
 */

const MARQUES = ["Empreinte numerique", "Empreinte#20numerique", "AlanyaTrace", "com.alanya237.work"].map((m) =>
  Uint8Array.from(m, (c) => c.charCodeAt(0)),
)
const TRANCHE = 4 * 1024 * 1024
const RECOUVREMENT = Math.max(...MARQUES.map((m) => m.length)) - 1

function contient(d: Uint8Array, m: Uint8Array): boolean {
  const fin = d.length - m.length
  for (let i = 0; i <= fin; i++) {
    if (d[i] !== m[0]) continue
    let j = 1
    while (j < m.length && d[i + j] === m[j]) j++
    if (j === m.length) return true
  }
  return false
}

export async function estCopieSignee(fichier: Blob): Promise<boolean> {
  for (let debut = 0; debut < fichier.size; debut += TRANCHE) {
    const fin = Math.min(fichier.size, debut + TRANCHE + RECOUVREMENT)
    const tranche = new Uint8Array(await fichier.slice(debut, fin).arrayBuffer())
    if (MARQUES.some((m) => contient(tranche, m))) return true
  }
  return false
}
