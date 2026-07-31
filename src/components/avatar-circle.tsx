import type { CSSProperties, ReactNode } from "react"
import { avatarDisplaySrc } from "../lib/avatar"

/**
 * Cercle representant une personne : sa photo de profil si elle existe, ses
 * initiales sinon.
 *
 * Le meme bloc de six lignes — tester l'avatar, resoudre son URL, retomber sur
 * les initiales — etait recopie a chaque endroit, et manquait a plusieurs :
 * historique des appels, choix d'un correspondant, en-tete d'infos de
 * conversation. Il vit desormais ici.
 *
 * Passer par `avatarDisplaySrc` n'est pas optionnel : le backend stocke les
 * avatars sous forme d'URL relative `/api/media/{id}`, qui exige le jeton de
 * session. Une balise `img` branchee directement sur la valeur stockee affiche
 * une image cassee.
 */
export function AvatarCircle({
  avatar,
  initials,
  className,
  style,
  alt = "",
  children,
}: {
  avatar?: string | null
  initials: string
  className?: string
  style?: CSSProperties
  /** Texte alternatif : vide par defaut, le nom etant deja affiche a cote. */
  alt?: string
  /** Decorations posees par l'appelant, par exemple la pastille « en ligne ». */
  children?: ReactNode
}) {
  const src = avatarDisplaySrc(avatar)

  return (
    <div
      className={className}
      // Le rognage ne s'applique qu'en presence d'une photo : sans lui, les
      // pastilles debordantes des cercles d'initiales seraient coupees.
      style={src ? { overflow: "hidden", ...style } : style}
    >
      {src ? (
        <img src={src} alt={alt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        initials
      )}
      {children}
    </div>
  )
}
