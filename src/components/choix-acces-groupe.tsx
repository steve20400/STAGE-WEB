import { useTranslation } from "../i18n"
import type { AccesGroupe } from "../services/groupe-service"
import { Icone } from "./icone"
import "./groupe-lien.css"

/**
 * PRIVÉ OU PUBLIC (18/11/2026) : ce que fait le lien du groupe. Privé, il
 * envoie une demande aux admins ; public, il fait entrer directement. Le même
 * choix à la création et dans les réglages du groupe (admins).
 */
export function ChoixAccesGroupe({
  valeur,
  onChange,
  desactive = false,
}: {
  valeur: AccesGroupe
  onChange: (acces: AccesGroupe) => void
  desactive?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="gl-acces">
      <div className="gl-segments" role="radiogroup" aria-label={t("grp_type_title")}>
        {(["prive", "public"] as const).map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={valeur === a}
            className={valeur === a ? "actif" : undefined}
            disabled={desactive}
            onClick={() => onChange(a)}
          >
            <Icone nom={a === "public" ? "globe" : "cadenas"} taille={15} />
            {t(a === "public" ? "grp_type_public" : "grp_type_private")}
          </button>
        ))}
      </div>
      <small>{t(valeur === "public" ? "grp_type_public_sub" : "grp_type_private_sub")}</small>
    </div>
  )
}
