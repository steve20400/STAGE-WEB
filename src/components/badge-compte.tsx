/**
 * Le badge a cote d'un nom, tel que le serveur l'envoie (`badge` de la
 * conversation, backend `src/lib/badges.ts`).
 *
 * ⚠️ LE CLIENT NE DECIDE RIEN (decision du user, 16/10/2026) : ni qui a un
 * badge, ni son image, ni son libelle. On dessine l'image, le libelle en
 * info-bulle ; tout se change depuis la console, sans redeployer le client.
 */
export type BadgeCompte = { type: string; image: string; libelle: string }

export function BadgeCompteImage({ badge, taille = 16 }: { badge: BadgeCompte; taille?: number }) {
  return (
    <img
      src={badge.image}
      alt={badge.libelle}
      title={badge.libelle}
      width={taille}
      height={taille}
      style={{ display: "inline-block", marginLeft: 4, verticalAlign: "middle", flexShrink: 0 }}
      // Image injoignable : on la retire, le nom reste lisible.
      onError={(e) => {
        e.currentTarget.style.display = "none"
      }}
    />
  )
}
