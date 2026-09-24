import { useCallback, useEffect, useRef, useState } from "react"
import {
  acquitter,
  chiffrerPour,
  dechiffrer,
  deposer,
  idAppareil,
  ouvrirSessions,
  preparerCetAppareil,
  relever,
} from "../services/e2ee-service"

/**
 * BANC D'ESSAI DU CHIFFREMENT DE BOUT EN BOUT — `/e2ee-test`.
 *
 * 🔴 PAGE DE DÉVELOPPEMENT, PAS UN ÉCRAN DE PRODUIT. Elle existe pour vérifier
 * la chaîne complète à la main : publier ses clés, ouvrir une session, chiffrer,
 * transporter, déchiffrer. Aucun de ces gestes ne doit rester visible quand le
 * chiffrement rejoindra le fil de discussion — c'est précisément ce qu'une
 * messagerie chiffrée ne montre jamais.
 *
 * ━━ COMMENT S'EN SERVIR ━━
 *
 * 1. Ouvrir cette page dans DEUX navigateurs différents (ou un normal et un
 *    privé), connectés à DEUX comptes. Deux onglets du même navigateur ne
 *    suffisent pas : ils partagent le même `localStorage`, donc la même
 *    identité, et l'on croirait se parler à soi-même.
 * 2. Chacun appuie sur « Préparer cet appareil ».
 * 3. Chacun copie l'identifiant de compte de l'autre dans le champ, puis
 *    « Ouvrir les sessions ».
 * 4. L'un écrit, l'autre relève.
 *
 * ⚠️ CE QUI PASSE SUR LE RÉSEAU EST VISIBLE DANS L'ONGLET RÉSEAU du navigateur,
 * et c'est le contrôle qui compte vraiment : le corps des enveloppes doit être
 * illisible. S'il ne l'est pas, rien de ce qui suit n'a de valeur.
 */

interface Ligne {
  quand: string
  texte: string
  ton: "info" | "ok" | "erreur"
}

export default function E2eeTestPage() {
  const [journal, setJournal] = useState<Ligne[]>([])
  const [correspondant, setCorrespondant] = useState("")
  const [convId, setConvId] = useState("")
  const [devices, setDevices] = useState<number[]>([])
  const [message, setMessage] = useState("")
  const [occupe, setOccupe] = useState(false)
  const filDeFer = useRef<HTMLDivElement | null>(null)

  const dire = useCallback((texte: string, ton: Ligne["ton"] = "info") => {
    setJournal((j) => [
      ...j,
      { quand: new Date().toLocaleTimeString(), texte, ton },
    ])
  }, [])

  useEffect(() => {
    filDeFer.current?.scrollTo({ top: filDeFer.current.scrollHeight })
  }, [journal])

  useEffect(() => {
    dire(`Appareil n° ${idAppareil()} — identifiant local, gardé entre deux visites.`)
  }, [dire])

  /** Enveloppe une action : occupe l'écran, et dit ce qui s'est passé. */
  const agir = async (quoi: string, action: () => Promise<void>) => {
    setOccupe(true)
    dire(`${quoi}…`)
    try {
      await action()
    } catch (e) {
      /*
       * ⚠️ ON AFFICHE L'ERREUR TELLE QUELLE. C'est un banc d'essai : une
       * exception avalée ici ferait perdre la seule information utile — et
       * « ça ne marche pas » n'a jamais aidé personne à comprendre pourquoi.
       */
      dire(`${quoi} : ÉCHEC — ${e instanceof Error ? e.message : String(e)}`, "erreur")
    } finally {
      setOccupe(false)
    }
  }

  const preparer = () =>
    agir("Préparation de cet appareil", async () => {
      const r = await preparerCetAppareil()
      dire(
        `Clés publiées. Appareil ${r.deviceId}, ${r.prekeysRestantes} pré-clés en stock.`,
        "ok",
      )
    })

  const ouvrir = () =>
    agir("Ouverture des sessions", async () => {
      const d = await ouvrirSessions(correspondant.trim())
      setDevices(d)
      dire(
        `Sessions ouvertes vers ${d.length} appareil(s) : ${d.join(", ")}. ` +
          "La signature des pré-clés a été vérifiée — sans quoi cette étape aurait levé.",
        "ok",
      )
    })

  const envoyer = () =>
    agir("Chiffrement et dépôt", async () => {
      if (devices.length === 0) throw new Error("Ouvre d'abord les sessions.")
      if (!convId.trim()) throw new Error("Un identifiant de conversation est requis.")
      const enveloppes = await chiffrerPour(correspondant.trim(), devices, message)
      dire(
        `Chiffré en ${enveloppes.length} enveloppe(s) — une par appareil. ` +
          `Aperçu du corps : ${enveloppes[0]?.corps.slice(0, 48)}…`,
      )
      const n = await deposer(convId.trim(), enveloppes)
      dire(`${n} enveloppe(s) déposée(s). Le serveur n'en connaît pas le contenu.`, "ok")
      setMessage("")
    })

  const lire = () =>
    agir("Relève", async () => {
      const recues = await relever()
      if (recues.length === 0) {
        dire("Rien en attente.")
        return
      }
      const acquittables: string[] = []
      for (const e of recues) {
        try {
          const clair = await dechiffrer(e)
          dire(`« ${clair} »  ← de ${e.expediteurId.slice(0, 8)}…`, "ok")
          // ⚠️ ACQUITTÉ SEULEMENT APRÈS SUCCÈS : acquitter puis échouer perdrait
          // le message définitivement, personne d'autre ne l'ayant.
          acquittables.push(e.id)
        } catch (err) {
          dire(
            `Enveloppe ${e.id.slice(0, 8)} illisible — ${err instanceof Error ? err.message : err}. ` +
              "Elle N'EST PAS acquittée : on préfère la garder que la perdre.",
            "erreur",
          )
        }
      }
      await acquitter(acquittables)
    })

  return (
    <div className="e2ee-banc">
      <h1>Chiffrement de bout en bout — banc d'essai</h1>
      <p className="avert">
        Page de développement. Ouvre-la dans <b>deux navigateurs différents</b>,
        connectés à deux comptes : deux onglets du même navigateur partagent le
        même coffre, donc la même identité.
      </p>

      <section>
        <button onClick={preparer} disabled={occupe}>
          1. Préparer cet appareil
        </button>
      </section>

      <section>
        <label>
          Identifiant du correspondant
          <input
            value={correspondant}
            onChange={(e) => setCorrespondant(e.target.value)}
            placeholder="uuid du compte"
          />
        </label>
        <button onClick={ouvrir} disabled={occupe || !correspondant.trim()}>
          2. Ouvrir les sessions
        </button>
      </section>

      <section>
        <label>
          Identifiant de conversation
          <input
            value={convId}
            onChange={(e) => setConvId(e.target.value)}
            placeholder="uuid d'une conversation commune"
          />
        </label>
        <label>
          Message
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="ce que le serveur ne lira pas"
          />
        </label>
        <button onClick={envoyer} disabled={occupe || !message.trim()}>
          3. Chiffrer et envoyer
        </button>
      </section>

      <section>
        <button onClick={lire} disabled={occupe}>
          4. Relever et déchiffrer
        </button>
      </section>

      <div className="journal" ref={filDeFer}>
        {journal.map((l, i) => (
          <div key={i} className={`ligne ${l.ton}`}>
            <span className="quand">{l.quand}</span> {l.texte}
          </div>
        ))}
      </div>

      <style>{`
        .e2ee-banc { max-width: 760px; margin: 0 auto; padding: 24px 16px 40px;
                     font-family: system-ui, sans-serif; color: #2b2b2b; }
        .e2ee-banc h1 { font-size: 20px; margin: 0 0 8px; }
        .avert { background: #fff4e5; border: 1px solid #f0d5b8; border-radius: 10px;
                 padding: 10px 12px; font-size: 13px; line-height: 1.45; }
        section { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;
                  margin: 16px 0; }
        label { display: flex; flex-direction: column; gap: 4px; font-size: 12px;
                flex-grow: 1; min-width: 220px; }
        input { padding: 9px 10px; border: 1px solid #d5c7b6; border-radius: 8px;
                font-size: 14px; }
        button { padding: 10px 16px; border: 0; border-radius: 20px; cursor: pointer;
                 background: #b85c38; color: #fffcf8; font-size: 14px; font-weight: 600; }
        button:disabled { opacity: .45; cursor: not-allowed; }
        .journal { margin-top: 20px; border: 1px solid #e0d0ba; border-radius: 10px;
                   background: #fffcf8; padding: 10px; height: 300px; overflow: auto;
                   font-size: 12.5px; line-height: 1.5; }
        .ligne { padding: 2px 0; }
        .quand { color: #9a8577; margin-right: 6px; }
        .ok { color: #2d6a4f; }
        .erreur { color: #b3261e; }
      `}</style>
    </div>
  )
}
