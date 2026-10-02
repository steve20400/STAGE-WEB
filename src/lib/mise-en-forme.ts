/**
 * MISE EN FORME DU TEXTE — miroir exact du mobile.
 *
 * Portage ligne à ligne de `alanya/lib/core/whatsapp_text_parser.dart` et
 * `whatsapp_format_logic.dart`. Les deux clients doivent lire un même message
 * de la même façon : un texte gras sur le téléphone ne peut pas arriver avec
 * ses astérisques sur le web (signalé le 02/10/2026).
 *
 * | Saisie          | Rendu       |
 * |-----------------|-------------|
 * | `*texte*`       | gras        |
 * | `_texte_`       | italique    |
 * | `~texte~`       | barré       |
 * | `__texte__`     | souligné    |
 * | `` `texte` ``   | manuscrit   |
 *
 * ⚠️ PAS DE BLOC ```code```, retiré du mobile à la demande du user.
 *
 * ⚠️ L'ORDRE EST UNE PRIORITÉ : `__` avant `_`, sinon `__mot__` se lirait
 * `_` + `_mot_` + `_`.
 *
 * ⚠️ LES ESPACES SONT AUTORISÉS autour du contenu (`* mot *` est gras), comme
 * sur le mobile. Le texte stocké et envoyé reste le texte BRUT, marqueurs
 * compris : la mise en forme n'existe qu'à l'affichage.
 */

export type StyleTexte = "gras" | "italique" | "barre" | "souligne" | "manuscrit"

export type NoeudTexte =
  | { texte: string }
  | { style: StyleTexte; enfants: NoeudTexte[] }

const DEFS: ReadonlyArray<{ code: string; style: StyleTexte }> = [
  { code: "__", style: "souligne" },
  { code: "*", style: "gras" },
  { code: "_", style: "italique" },
  { code: "~", style: "barre" },
  { code: "`", style: "manuscrit" },
]

/** Le marqueur fermant, après AU MOINS un caractère intérieur ; -1 sinon. */
function chercheFermeture(s: string, code: string, ouverture: number, fin: number): number {
  const n = code.length
  if (ouverture + n + 1 > fin - n) return -1
  for (let j = ouverture + n + 1; j <= fin - n; j++) {
    if (s.startsWith(code, j)) return j
  }
  return -1
}

function analyse(s: string, debut: number, fin: number): NoeudTexte[] {
  const noeuds: NoeudTexte[] = []
  let tampon = ""
  const vider = () => {
    if (tampon !== "") {
      noeuds.push({ texte: tampon })
      tampon = ""
    }
  }

  let i = debut
  while (i < fin) {
    let trouve = false
    for (const def of DEFS) {
      if (i + def.code.length <= fin && s.startsWith(def.code, i)) {
        const fermeture = chercheFermeture(s, def.code, i, fin)
        if (fermeture !== -1) {
          vider()
          // Récursion : les styles s'imbriquent (`*_gras italique_*`).
          noeuds.push({ style: def.style, enfants: analyse(s, i + def.code.length, fermeture) })
          i = fermeture + def.code.length
          trouve = true
          break
        }
      }
    }
    if (trouve) continue
    tampon += s[i]
    i++
  }
  vider()
  return noeuds
}

/** Découpe `source` en arbre de fragments stylés. */
export function analyseMiseEnForme(source: string): NoeudTexte[] {
  return analyse(source, 0, source.length)
}

/**
 * Le texte SANS ses marqueurs, pour les endroits qui ne savent pas afficher de
 * style : citation d'une réponse, message épinglé, notification, titre
 * d'onglet. Y montrer `*coucou*` exposerait la mécanique au lieu du message.
 */
export function sansMarqueurs(source: string): string {
  let sortie = ""
  const parcourir = (noeuds: NoeudTexte[]) => {
    for (const n of noeuds) {
      if ("texte" in n) sortie += n.texte
      else parcourir(n.enfants)
    }
  }
  parcourir(analyseMiseEnForme(source))
  return sortie
}

/** Les cinq boutons de la barre de mise en forme, dans l'ordre du mobile. */
export const MARQUEURS: ReadonlyArray<{ code: string; style: StyleTexte; cle: string }> = [
  { code: "*", style: "gras", cle: "format_bold" },
  { code: "_", style: "italique", cle: "format_italic" },
  { code: "~", style: "barre", cle: "format_strike" },
  { code: "__", style: "souligne", cle: "format_underline" },
  { code: "`", style: "manuscrit", cle: "format_handwritten" },
]

/**
 * Applique — ou retire — `code` autour de la plage `[debut, fin[`.
 *
 * Portage de `calculeMarqueur` (mobile), mêmes trois cas :
 *   1. simple curseur : insère les deux marqueurs, curseur ENTRE les deux ;
 *   2. plage déjà entourée (dedans ou juste autour) : les marqueurs sont
 *      RETIRÉS — le bouton bascule au lieu d'empiler `**gras**` ;
 *   3. sinon : la plage est enveloppée et reste sélectionnée.
 */
export function appliquerMarqueur(
  texte: string,
  debutBrut: number,
  finBrut: number,
  code: string,
): { texte: string; debut: number; fin: number } {
  let debut = debutBrut
  let fin = finBrut
  if (debut < 0 || debut > texte.length) debut = texte.length
  if (fin < debut || fin > texte.length) fin = debut

  const avant = texte.slice(0, debut)
  const choix = texte.slice(debut, fin)
  const apres = texte.slice(fin)
  const n = code.length

  if (choix === "") {
    return { texte: avant + code + code + apres, debut: debut + n, fin: debut + n }
  }
  if (choix.length > 2 * n && choix.startsWith(code) && choix.endsWith(code)) {
    const nu = choix.slice(n, choix.length - n)
    return { texte: avant + nu + apres, debut, fin: debut + nu.length }
  }
  if (avant.endsWith(code) && apres.startsWith(code)) {
    return {
      texte: avant.slice(0, avant.length - n) + choix + apres.slice(n),
      debut: debut - n,
      fin: debut - n + choix.length,
    }
  }
  return { texte: avant + code + choix + code + apres, debut: debut + n, fin: debut + n + choix.length }
}
