import { useEffect, useState } from "react"
import {
  activerSauvegarde,
  ajouterUneSerrure,
  lireCoffre,
  ouvrir,
  restaurerTout,
  toutEffacer,
} from "../../../src/services/e2ee-sauvegarde"
import { cacheMessage } from "../../../src/services/indexeddb-cache"
import { useTranslation } from "../../../src/i18n"
import "./e2ee-sauvegarde-panneau.css"

/**
 * LA SAUVEGARDE CHIFFRÉE, DANS LES RÉGLAGES.
 *
 * 🔴 CET ÉCRAN DOIT DIRE CE QU'IL COÛTE AVANT DE LE FAIRE COÛTER. Une
 * sauvegarde dont on perd la clé n'est pas « indisponible » : elle est
 * DÉTRUITE, et personne — nous compris — ne la rouvrira. Une interface qui
 * n'annonce ça qu'après coup a menti par omission.
 *
 * ⚠️ LA CLÉ DE RÉCUPÉRATION NE S'AFFICHE QU'UNE FOIS, et l'écran le dit au
 * moment de la montrer, pas dans une note en bas. Elle n'existe en clair que
 * dans cette seconde-là : ni le serveur ni nous ne pouvons la redonner.
 */

/**
 * ⚠️ TROIS ÉTATS, ET « REFUSÉE » N'EST PAS « ABSENTE ».
 *
 * La sauvegarde s'active d'elle-même à la connexion : « absente » ne dure
 * donc qu'un instant, et signifie « en cours d'installation ». « Refusée »
 * est une décision de l'utilisateur, et l'écran doit la montrer comme telle —
 * pas comme un réglage qu'on aurait oublié de faire.
 */
type Etat = "chargement" | "absente" | "refusee" | "presente"

export function E2eeSauvegardePanneau() {
  const { t } = useTranslation()
  const [etat, setEtat] = useState<Etat>("chargement")
  const [types, setTypes] = useState<string[]>([])
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  /** Affichée UNE SEULE FOIS, juste après sa création. */
  const [cleMontree, setCleMontree] = useState<string | null>(null)

  const [motDePasse, setMotDePasse] = useState("")
  const [secretSaisi, setSecretSaisi] = useState("")
  const [restaure, setRestaure] = useState<{ n: number; illisibles: number } | null>(null)
  const [confirmeEffacement, setConfirmeEffacement] = useState(false)

  async function relire() {
    const { serrures, refusee } = await lireCoffre()
    setTypes(serrures.map((x) => x.type))
    setEtat(serrures.length > 0 ? "presente" : refusee ? "refusee" : "absente")
  }

  useEffect(() => {
    void relire()
  }, [])

  async function avec(travail: () => Promise<void>) {
    setErreur(null)
    setOccupe(true)
    try {
      await travail()
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setOccupe(false)
    }
  }

  /* ── ACTIVER ─────────────────────────────────────────────────────── */

  const activer = () =>
    avec(async () => {
      if (motDePasse.length < 4) {
        throw new Error(t("e2ee_sauv_mdp_requis"))
      }
      const { cleRecuperation } = await activerSauvegarde({
        motDePasse,
        avecCleRecuperation: true,
      })
      setMotDePasse("")
      setCleMontree(cleRecuperation)
      await relire()
    })

  /* ── OUVRIR, SUR UN APPAREIL NEUF ────────────────────────────────── */

  const ouvrirEtRestaurer = (type: "motdepasse" | "recuperation") =>
    avec(async () => {
      const ok = await ouvrir(type, secretSaisi)
      if (!ok) throw new Error(t("e2ee_sauv_mauvais_secret"))

      const { messages, blocsIllisibles } = await restaurerTout()
      /*
       * ⚠️ ON REMPLIT LE CACHE ICI, PAS DANS LE SERVICE. Le service rend les
       * messages ; c'est l'écran qui décide d'en faire quelque chose — et c'est
       * ce qui permet d'annoncer un décompte avant d'écrire quoi que ce soit.
       */
      for (const m of messages) {
        await cacheMessage({
          id: m.id,
          conversationId: m.convId,
          senderId: m.expediteurId,
          content: m.texte,
          type: "TEXT",
          status: "SENT",
          createdAt: m.quand,
        })
      }
      setSecretSaisi("")
      setRestaure({ n: messages.length, illisibles: blocsIllisibles })
    })

  /* ── AJOUTER UNE CLÉ DE RÉCUPÉRATION ─────────────────────────────── */

  const nouvelleCleRecuperation = () =>
    avec(async () => {
      if (!secretSaisi) throw new Error(t("e2ee_sauv_mdp_requis"))
      const { cleRecuperation } = await ajouterUneSerrure(
        secretSaisi,
        "motdepasse",
        "recuperation",
      )
      setSecretSaisi("")
      setCleMontree(cleRecuperation)
      await relire()
    })

  /* ── TOUT EFFACER ────────────────────────────────────────────────── */

  const effacer = () =>
    avec(async () => {
      await toutEffacer()
      setConfirmeEffacement(false)
      setRestaure(null)
      await relire()
    })

  /* ══════════════════ L'AFFICHAGE ══════════════════ */

  if (etat === "chargement") {
    return (
      <div className="s-card">
        <div className="s-card-title">{t("e2ee_sauv_titre")}</div>
        <p className="sauv-attente">{t("e2ee_sauv_chargement")}</p>
      </div>
    )
  }

  return (
    <div className="s-card">
      <div className="s-card-title">{t("e2ee_sauv_titre")}</div>
      <p className="sauv-intro">{t("e2ee_sauv_intro")}</p>

      {/*
        🔴 LA CLÉ, MONTRÉE UNE SEULE FOIS.

        Elle prend toute la place, seule, sans rien d'autre à faire autour :
        c'est le seul instant où elle existe en clair. La noyer au milieu
        d'autres réglages garantirait qu'une partie des gens la manque.
      */}
      {cleMontree && (
        <div className="sauv-cle">
          <div className="sauv-cle-titre">{t("e2ee_sauv_cle_titre")}</div>
          <p className="sauv-cle-avert">{t("e2ee_sauv_cle_avert")}</p>
          <div className="sauv-cle-mots">
            {cleMontree.split(" ").map((mot, i) => (
              <span key={i}>
                <em>{i + 1}</em>
                {mot}
              </span>
            ))}
          </div>
          <div className="sauv-cle-actions">
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(cleMontree)}
            >
              {t("e2ee_sauv_copier")}
            </button>
            <button type="button" className="primaire" onClick={() => setCleMontree(null)}>
              {t("e2ee_sauv_cle_notee")}
            </button>
          </div>
        </div>
      )}

      {/*
        ⚠️ « ABSENTE » NE DURE QU'UN INSTANT : la sauvegarde s'installe à la
        connexion. Afficher un bouton « Activer » ici ferait appuyer sur
        quelque chose qui est déjà en train de se faire.
      */}
      {etat === "absente" && <p className="sauv-attente">{t("e2ee_sauv_installation")}</p>}

      {etat === "refusee" && !cleMontree && (
        <>
          <p className="sauv-explique">{t("e2ee_sauv_refusee")}</p>
          <label className="sauv-champ">
            <span>{t("e2ee_sauv_mdp_label")}</span>
            <input
              type="password"
              autoComplete="off"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              placeholder={t("e2ee_sauv_mdp_place")}
            />
          </label>
          {/*
            ⚠️ CE QUE CETTE SERRURE NE PROTÈGE PAS, écrit ici et pas ailleurs.
            Notre serveur reçoit le mot de passe en clair à chaque connexion :
            il POURRAIT dériver cette clé s'il était compromis. Le taire
            laisserait croire à une garantie qui n'existe pas.
          */}
          <p className="sauv-limite">{t("e2ee_sauv_limite_mdp")}</p>
          <button
            type="button"
            className="sauv-btn primaire"
            disabled={occupe}
            onClick={() => void activer()}
          >
            {occupe ? t("e2ee_sauv_en_cours") : t("e2ee_sauv_activer")}
          </button>
        </>
      )}

      {etat === "presente" && !cleMontree && (
        <>
          <div className="sauv-serrures">
            {(["motdepasse", "recuperation", "trousseau"] as const).map((type) => (
              <div key={type} className={types.includes(type) ? "sauv-serrure on" : "sauv-serrure"}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {types.includes(type) ? (
                    <path d="M20 6 9 17l-5-5" />
                  ) : (
                    <path d="M12 8v5M12 16h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                  )}
                </svg>
                {t(`e2ee_sauv_serrure_${type}`)}
              </div>
            ))}
          </div>

          <label className="sauv-champ">
            <span>{t("e2ee_sauv_secret_label")}</span>
            <input
              type="password"
              autoComplete="off"
              value={secretSaisi}
              onChange={(e) => setSecretSaisi(e.target.value)}
              placeholder={t("e2ee_sauv_secret_place")}
            />
          </label>

          <div className="sauv-actions">
            <button
              type="button"
              className="sauv-btn primaire"
              disabled={occupe || !secretSaisi}
              onClick={() => void ouvrirEtRestaurer("motdepasse")}
            >
              {t("e2ee_sauv_restaurer")}
            </button>
            <button
              type="button"
              className="sauv-btn"
              disabled={occupe || !secretSaisi}
              onClick={() => void ouvrirEtRestaurer("recuperation")}
            >
              {t("e2ee_sauv_restaurer_cle")}
            </button>
            {!types.includes("recuperation") && (
              <button
                type="button"
                className="sauv-btn"
                disabled={occupe || !secretSaisi}
                onClick={() => void nouvelleCleRecuperation()}
              >
                {t("e2ee_sauv_nouvelle_cle")}
              </button>
            )}
          </div>

          {restaure && (
            <p className="sauv-resultat">
              {t("e2ee_sauv_restaure").replace("{n}", String(restaure.n))}
              {/*
                ⚠️ LES BLOCS ILLISIBLES SE DISENT. Une restauration
                silencieusement partielle est pire qu'un échec net : la personne
                croit avoir tout récupéré et s'en aperçoit des mois plus tard.
              */}
              {restaure.illisibles > 0 && (
                <strong>
                  {" "}
                  {t("e2ee_sauv_illisibles").replace("{n}", String(restaure.illisibles))}
                </strong>
              )}
            </p>
          )}

          <div className="sauv-danger">
            {!confirmeEffacement ? (
              <button type="button" className="sauv-lien" onClick={() => setConfirmeEffacement(true)}>
                {t("e2ee_sauv_desactiver")}
              </button>
            ) : (
              <>
                <p>{t("e2ee_sauv_desactiver_avert")}</p>
                <div className="sauv-actions">
                  <button
                    type="button"
                    className="sauv-btn danger"
                    disabled={occupe}
                    onClick={() => void effacer()}
                  >
                    {t("e2ee_sauv_desactiver_oui")}
                  </button>
                  <button
                    type="button"
                    className="sauv-btn"
                    onClick={() => setConfirmeEffacement(false)}
                  >
                    {t("cancel")}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {erreur && <p className="sauv-erreur">{erreur}</p>}
    </div>
  )
}
