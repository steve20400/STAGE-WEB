import "./brand-name.css"

interface MarqueProps {
  /**
   * Fond sur lequel le logotype est pose. « marque » designe la barre
   * terracotta — l'entete mobile et le haut de la barre laterale — ou le vert
   * du logo ne ressortirait pas.
   */
  sur?: "surface" | "marque"
  /** Classe du contexte : c'est elle qui fixe la taille et la graisse. */
  className?: string
}

/**
 * Logotype « Alanya Work ».
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
      className={`marque${sur === "marque" ? " sur-marque" : ""}${className ? ` ${className}` : ""}`}
    >
      Alanya<span className="marque-second">Work</span>
    </span>
  )
}
