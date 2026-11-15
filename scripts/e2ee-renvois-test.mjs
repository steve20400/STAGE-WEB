/**
 * LE RENVOI PAR L'EXPÉDITEUR, CÔTÉ WEB (piste B, 15/11/2026).
 *
 * Éprouve `creerRenvois` (`src/services/e2ee-renvois-coeur.ts`) avec Node
 * seul : le serveur, le cache et le chiffrement sont simulés ; l'écriture de
 * la charge est la VRAIE (`e2ee-media.ts`), et la charge renvoyée est relue
 * par le vrai `lireCharge`, comme le ferait l'appareil demandeur.
 *
 *   ① demander envoie l'appareil et rend le nombre de demandes ;
 *   ② servir rechiffre MON message pour le SEUL appareil demandeur ;
 *   ③ la réponse citée, le genre et le média voyagent dans la charge ;
 *   ④ rien n'est servi sans le clair, ni pour le message d'un autre ;
 *   ⑤ un appareil qui n'est plus publié n'est pas servi ;
 *   ⑥ une demande qui échoue n'arrête pas les autres ;
 *   ⑦ deux services lancés ensemble ne servent pas deux fois ;
 *   ⑧ un serveur sans la route ne fait rien lever.
 *
 * Lancer : node scripts/e2ee-renvois-test.mjs
 */
import { creerRenvois } from "../src/services/e2ee-renvois-coeur.ts"
import { lireCharge } from "../src/services/e2ee-media.ts"

let ok = 0
let ko = 0
function verifie(nom, condition, detail = "") {
  if (condition) {
    ok++
    console.log(`  ✓ ${nom}`)
  } else {
    ko++
    console.log(`  ✗ ${nom} ${detail}`)
  }
}
const titre = (t) => console.log(`\n${t}`)

/** Un faux monde : serveur, cache d'Alice, sessions publiées. */
function monde({ demandes = [], cache = {}, appareils = { bob: [1, 2] }, panne = null } = {}) {
  const appels = []
  const chiffres = []
  const deps = {
    api: async (chemin, options = {}) => {
      appels.push({ chemin, ...options })
      await new Promise((r) => setTimeout(r, 0))
      if (panne) throw new Error(panne)
      if (chemin === "/api/e2ee/renvois" && options.method === "POST") return { demandes: 3 }
      if (chemin === "/api/e2ee/renvois") return { demandes }
      if (chemin === "/api/e2ee/renvois/servir") return { servi: true }
      throw new Error(`route inconnue ${chemin}`)
    },
    monAppareil: () => 7,
    moi: () => "alice",
    lireMessages: async (convId) => cache[convId] ?? [],
    ouvrirSessions: async (userId) => appareils[userId] ?? [],
    chiffrerPour: async (userId, devs, charge) => {
      chiffres.push({ userId, devs, charge })
      return devs.map((d) => ({ destinataireId: userId, destinataireDevice: d, type: 1, corps: `chiffre:${d}` }))
    },
  }
  const servis = () => appels.filter((a) => a.chemin === "/api/e2ee/renvois/servir")
  return { deps, appels, chiffres, servis }
}

const demande = (n, extra = {}) => ({
  id: `r${n}`,
  messageId: `m${n}`,
  convId: "fil-ab",
  demandeurId: "bob",
  demandeurDevice: 2,
  ...extra,
})
const msg = (n, extra = {}) => ({ id: `m${n}`, senderId: "alice", content: `texte ${n}`, type: "TEXT", ...extra })

titre("① Demander")
{
  const w = monde()
  const n = await creerRenvois(w.deps).demander()
  verifie("rend le nombre du serveur", n === 3)
  verifie(
    "envoie POST /api/e2ee/renvois avec cet appareil",
    w.appels[0]?.method === "POST" && w.appels[0]?.body?.deviceId === 7,
    JSON.stringify(w.appels[0]),
  )
}

titre("② Servir : mon message, rechiffré pour le seul appareil demandeur")
{
  const w = monde({ demandes: [demande(1)], cache: { "fil-ab": [msg(1)] } })
  const n = await creerRenvois(w.deps).servir()
  verifie("une demande servie", n === 1)
  verifie(
    "chiffré pour Bob, appareil 2 SEULEMENT",
    w.chiffres.length === 1 && w.chiffres[0].userId === "bob" && JSON.stringify(w.chiffres[0].devs) === "[2]",
    JSON.stringify(w.chiffres),
  )
  const c = lireCharge(w.chiffres[0].charge, "m1")
  verifie("la charge se relit, sous le même message", c.texte === "texte 1" && c.idAnnonce === "m1", JSON.stringify(c))
  const s = w.servis()[0]?.body
  verifie(
    "déposé avec la demande, mon appareil et l'enveloppe",
    s?.id === "r1" && s?.deviceId === 7 && s?.type === 1 && s?.corps === "chiffre:2",
    JSON.stringify(s),
  )
}

titre("③ Réponse citée, genre et média voyagent")
{
  // Clé AES-256 et empreinte SHA-256 de la bonne taille : la lecture de la
  // charge refuse un descripteur mal formé.
  const cle = Buffer.alloc(32, 7).toString("base64")
  const media = { id: "media-1", cle, empreinte: Buffer.alloc(32, 9).toString("base64"), taille: 12, mime: "image/jpeg" }
  const w = monde({
    demandes: [demande(1), demande(2), demande(3)],
    cache: {
      "fil-ab": [
        msg(1, { replyToId: "m0" }),
        msg(2, { type: "LOCATION", content: '{"lat":3.8,"lng":11.5}' }),
        msg(3, { type: "IMAGE", content: "légende", mediaChiffre: media }),
      ],
    },
  })
  await creerRenvois(w.deps).servir()
  const [c1, c2, c3] = w.chiffres.map((x, i) => lireCharge(x.charge, `m${i + 1}`))
  verifie("la réponse garde sa citation", c1?.reponseA === "m0", JSON.stringify(c1))
  verifie("une position garde son genre", c2?.genre === "LOCATION", JSON.stringify(c2))
  verifie(
    "un média garde sa clé, sans genre",
    c3?.media?.id === "media-1" && c3?.media?.cle === cle && c3?.genre === undefined && c3?.texte === "légende",
    JSON.stringify(c3),
  )
}

titre("④ Rien sans le clair, rien pour le message d'un autre")
{
  const w = monde({
    demandes: [demande(1), demande(2), demande(3)],
    cache: { "fil-ab": [msg(2, { senderId: "bob" }), msg(3, { content: "" })] },
  })
  const n = await creerRenvois(w.deps).servir()
  verifie("aucune servie", n === 0 && w.servis().length === 0 && w.chiffres.length === 0, `${n}`)
}

titre("⑤ Un appareil qui n'est plus publié n'est pas servi")
{
  const w = monde({ demandes: [demande(1)], cache: { "fil-ab": [msg(1)] }, appareils: { bob: [1] } })
  const n = await creerRenvois(w.deps).servir()
  verifie("rien chiffré, rien déposé", n === 0 && w.chiffres.length === 0 && w.servis().length === 0)
}

titre("⑥ Une demande qui échoue n'arrête pas les autres")
{
  const w = monde({ demandes: [demande(1), demande(2)], cache: { "fil-ab": [msg(1), msg(2)] } })
  const chiffrer = w.deps.chiffrerPour
  let premier = true
  w.deps.chiffrerPour = async (...args) => {
    if (premier) {
      premier = false
      throw new Error("session cassée")
    }
    return chiffrer(...args)
  }
  w.deps.avertir = () => undefined
  const n = await creerRenvois(w.deps).servir()
  verifie("la seconde est servie", n === 1 && w.servis()[0]?.body?.id === "r2", JSON.stringify(w.servis()))
}

titre("⑦ Deux services lancés ensemble ne servent pas deux fois")
{
  const w = monde({ demandes: [demande(1)], cache: { "fil-ab": [msg(1)] } })
  const r = creerRenvois(w.deps)
  const [a, b] = await Promise.all([r.servir(), r.servir()])
  verifie("une seule fois", a + b === 1 && w.servis().length === 1, `${a} + ${b}`)
}

titre("⑧ Un serveur sans la route ne fait rien lever")
{
  const w = monde({ panne: "404" })
  const r = creerRenvois(w.deps)
  let leve = false
  let n1 = -1
  let n2 = -1
  try {
    n1 = await r.demander()
    n2 = await r.servir()
  } catch {
    leve = true
  }
  verifie("ni demander ni servir ne lèvent, et rendent 0", !leve && n1 === 0 && n2 === 0)
}

console.log(`\n${ok} vérifications passées, ${ko} en échec.`)
process.exitCode = ko === 0 ? 0 : 1
