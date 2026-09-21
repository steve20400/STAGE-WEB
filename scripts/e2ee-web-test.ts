/**
 * BANC D'ESSAI DES VRAIS MODULES DU CLIENT WEB.
 *
 * 🔴 CE QUE CE BANC AJOUTE À CELUI DU BACKEND. Le banc de `backend-alanya`
 * RÉIMPLÉMENTE la logique cliente : il prouve que le protocole et les routes
 * fonctionnent, mais pas que NOTRE code client est correct. Un défaut dans
 * `e2ee-service.ts` — exactement comme l'inversion des types 1 et 3 — y passerait
 * inaperçu.
 *
 * Celui-ci importe `e2ee-service.ts` et `e2ee-store.ts` TELS QUELS, ceux que le
 * navigateur exécutera. C'est la seule façon de les éprouver sans piloter un
 * navigateur.
 *
 * ⚠️ IL FAUT LE COMPILER PAR VITE (`--ssr`) : ces modules lisent
 * `import.meta.env`, que Node ne connaît pas. Le lancer directement échouerait
 * sur une erreur qui n'a rien à voir avec le chiffrement.
 *
 * Voir `scripts/e2ee-web.mjs` pour le lancement.
 */

import {
  envoyerChiffre,
  lireEtatE2ee,
  noteEtatChiffrement,
  releverEtDechiffrer,
} from "../src/services/e2ee-fil"
import {
  acquitter,
  chiffrerPour,
  dechiffrer,
  deposer,
  idAppareil,
  ouvrirSessions,
  preparerCetAppareil,
  relever,
} from "../src/services/e2ee-service"

let echecs = 0
function verifier(condition: boolean, quoi: string) {
  console.log(`  ${condition ? "✓" : "✗"} ${quoi}`)
  if (!condition) echecs++
}

/**
 * Le scénario, mené par le module réel.
 *
 * `jeton` et `moi` viennent du banc appelant : ouvrir une session suppose deux
 * comptes, et les créer est le travail du backend, pas du client.
 */
export async function scenario(opts: {
  moi: string
  autre: string
  convId: string
  attendPrekeys: number
}): Promise<number> {
  console.log(`\n── Modules web réels, appareil ${idAppareil()} ──`)

  console.log("\n① preparerCetAppareil()")
  const pub = await preparerCetAppareil()
  verifier(pub.deviceId === idAppareil(), "l'appareil publié est bien le nôtre")
  verifier(
    pub.prekeysRestantes >= opts.attendPrekeys,
    `${pub.prekeysRestantes} pré-clés en stock`,
  )

  console.log("\n② preparerCetAppareil() est idempotente")
  /*
   * ⚠️ LE CONTRÔLE QUI COMPTE LE PLUS ICI. Cette fonction est appelée au
   * démarrage de l'application : si elle régénérait l'identité, chaque
   * rechargement de page ferait perdre toutes les sessions — et les
   * correspondants continueraient d'écrire à un appareil qui ne lit plus rien.
   */
  const encore = await preparerCetAppareil()
  verifier(encore.deviceId === pub.deviceId, "le même appareil, pas un neuf")

  console.log("\n③ ouvrirSessions()")
  const devices = await ouvrirSessions(opts.autre)
  verifier(devices.length >= 1, `session(s) ouverte(s) : ${devices.join(", ")}`)

  console.log("\n④ chiffrerPour() puis deposer()")
  const SECRET = "Message écrit par le VRAI module du navigateur"
  const enveloppes = await chiffrerPour(opts.autre, devices, SECRET)
  verifier(enveloppes.length === devices.length, "une enveloppe par appareil")
  verifier(
    !enveloppes[0].corps.includes("navigateur"),
    "le corps produit ne laisse pas voir le texte",
  )
  const n = await deposer(opts.convId, enveloppes)
  verifier(n === enveloppes.length, `${n} enveloppe(s) déposée(s)`)

  return echecs
}

/** La relève et le déchiffrement, joués par l'autre côté. */
export async function scenarioReception(attendu: string): Promise<number> {
  console.log("\n⑤ relever() puis dechiffrer()")
  const recues = await relever()
  verifier(recues.length >= 1, `${recues.length} enveloppe(s) relevée(s)`)

  /*
   * 🔴 LE CONTRÔLE QUI AURAIT ATTRAPÉ L'INVERSION DES TYPES. `dechiffrer` choisit
   * sa méthode d'après `e.type` ; se tromper donne « No record for device », un
   * message qui désigne l'appareil et envoie chercher ailleurs.
   */
  const clair = await dechiffrer(recues[0])
  verifier(clair === attendu, `le texte revient identique : « ${clair} »`)

  await acquitter([recues[0].id])
  const apres = await relever()
  verifier(
    apres.length < recues.length,
    "l'accusé de réception a bien retiré l'enveloppe",
  )
  return echecs
}

/**
 * LA COUTURE AVEC LE FIL — ce que le navigateur fera vraiment.
 *
 * 🔴 C'EST LA COUCHE LA PLUS NEUVE, donc la moins éprouvée. Les scénarios
 * précédents testent la cryptographie ; celui-ci teste le RACCORD : la ligne
 * du fil créée sans contenu, les enveloppes rattachées, et le contenu qui
 * revient se poser sur le bon message.
 */
export async function scenarioFil(convId: string): Promise<number> {
  console.log("\n⑥ lireEtatE2ee() puis envoyerChiffre()")

  const etat = await lireEtatE2ee(convId)
  verifier(etat.e2eeActif === true, "la conversation est bien chiffrée")

  const TEXTE = "Message parti par la couture du fil"
  const cree = await envoyerChiffre(convId, TEXTE)
  verifier(!!cree.id, `la ligne du fil est créée : ${cree.id.slice(0, 8)}…`)

  return echecs
}

/** La réception, vue par la couture : le clair revient indexé par message. */
export async function scenarioFilReception(
  convId: string,
  attendu: string,
): Promise<number> {
  console.log("\n⑦ releverEtDechiffrer()")
  noteEtatChiffrement(convId, true)
  const clairs = await releverEtDechiffrer()
  verifier(clairs.size >= 1, `${clairs.size} message(s) déchiffré(s)`)

  /*
   * ⚠️ LE CLAIR EST INDEXÉ PAR IDENTIFIANT DE MESSAGE, et c'est tout l'objet
   * du rattachement : sans lui, on aurait du texte sans savoir sur quelle
   * ligne du fil le poser.
   */
  const trouve = [...clairs.values()].includes(attendu)
  verifier(trouve, `le texte revient et se rattache : « ${attendu} »`)
  return echecs
}
