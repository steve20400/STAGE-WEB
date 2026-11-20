import "./brand-name.css"

interface MarqueProps {
  /**
   * Fond sur lequel le logotype est pose. « marque » designe la barre
   * terracotta — l'entete mobile et le haut de la barre laterale — ou le vert
   * du logo ne ressortirait pas. « nuit » : la barre chocolat des pages
   * publiques, ou le nom s'inverse — « Alanya » en vert, « Work » en clair.
   */
  sur?: "surface" | "marque" | "nuit"
  /** Classe du contexte : c'est elle qui fixe la taille et la graisse. */
  className?: string
}

/**
 * Logotype « ALANYA WORK », identique a celui du mobile (20/11/2026).
 *
 * Un composant plutot qu'un texte recopie dans six ecrans : le nom s'ecrit au
 * meme endroit une seule fois, et la coupure entre les deux mots — celle qui
 * porte la couleur — ne peut pas diverger d'une page a l'autre.
 *
 * Le nom n'est pas traduit : c'est une marque, elle s'ecrit pareil dans les
 * neuf langues.
 */
export function BrandName({ sur = "surface", className }: MarqueProps) {
  return (
    <span
      className={`marque${sur === "marque" ? " sur-marque" : sur === "nuit" ? " sur-nuit" : ""}${className ? ` ${className}` : ""}`}
    >
      {/* Comme le logotype du mobile (alanya_wordmark.dart) : « ALANY » dans le
          vert du logo, le dernier « A » et « WORK » en terre cuite. Les
          capitales viennent de la feuille de style : le texte reste « Alanya
          Work » pour les lecteurs d'écran et la copie. */}
      <span className="marque-vert">Alany</span>
      <span className="marque-terre">a</span>
      <span className="marque-second">Work</span>
    </span>
  )
}
