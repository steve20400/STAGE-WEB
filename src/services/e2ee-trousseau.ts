/**
 * LA SERRURE « TROUSSEAU » — un secret que l'appareil garde à votre place.
 *
 * 🔴 C'EST LA SEULE DES TROIS QUI NE DEMANDE RIEN À RETENIR. Face ID, Touch ID,
 * Windows Hello, un code de verrouillage : le geste que les gens font déjà tous
 * les jours, et qui rend l'archive lisible sans mot de passe ni douze mots.
 *
 * ── COMMENT CELA MARCHE, EN UNE PHRASE ──────────────────────────────
 *
 * WebAuthn sert habituellement à SE CONNECTER. Son extension `prf` sert à autre
 * chose : elle fait calculer à la clé d'accès un secret de 32 octets, dérivé de
 * sa propre clé privée et d'un sel qu'on lui donne.
 *
 *   même clé d'accès + même sel ──▶ TOUJOURS le même secret
 *   clé d'accès absente          ──▶ rien, et rien ne le remplace
 *
 * ⚠️ CE SECRET NE SORT JAMAIS DE L'APPAREIL AUTREMENT. Il n'est stocké nulle
 * part — ni chez nous, ni dans le navigateur. Il est RECALCULÉ à chaque fois, et
 * uniquement après une vérification de l'utilisateur.
 *
 * ── CE QUE CETTE SERRURE APPORTE QUE LES AUTRES N'ONT PAS ───────────
 *
 * 🔴 NOTRE SERVEUR NE PEUT PAS L'OUVRIR, MÊME COMPROMIS. Contrairement à la
 * serrure « mot de passe » — que nous recevons à chaque connexion — ce secret
 * ne nous traverse jamais. C'est la serrure la plus forte des trois.
 *
 * ⚠️ ET CE QU'ELLE NE FAIT PAS : si la clé d'accès est synchronisée (trousseau
 * iCloud, gestionnaire Google), elle suit la personne d'un appareil à l'autre.
 * Si elle ne l'est pas, elle meurt avec l'appareil — d'où l'intérêt de garder
 * une clé de récupération à côté.
 */

/** Le préfixe de sel PRF, fixe pour cette application. */
const SEL_PRF = new TextEncoder().encode("alanya-archive-e2ee-v1")

/**
 * ⚠️ POURQUOI CE SEL EST UNE CONSTANTE, ET NON RANGÉ AVEC LA SERRURE.
 *
 * On a posé plus tôt une règle inverse : les paramètres de dérivation vivent
 * AVEC la serrure, pour pouvoir durcir les réglages sans rendre illisible ce qui
 * existe. Ce sel-ci est différent, et la distinction vaut d'être comprise.
 *
 *   · durcir un coût de dérivation est SOUHAITABLE — on veut pouvoir le faire ;
 *   · changer ce sel ne durcit RIEN. Cela produit simplement un autre secret,
 *     donc une serrure qui n'ouvre plus. Ce n'est pas une amélioration, c'est
 *     une perte.
 *
 * Un paramètre qu'on ne voudra jamais faire évoluer n'a pas besoin de vivre en
 * base. Le ranger suggérerait le contraire à qui lira le code plus tard.
 */

/** Ce que le navigateur sait faire. */
export interface Capacites {
  disponible: boolean
  /** Ce qu'on dit à l'utilisateur quand ça ne l'est pas. */
  raison?: "pas-de-webauthn" | "pas-de-prf" | "hors-contexte-sur"
}

/**
 * Le navigateur sait-il fabriquer cette serrure ?
 *
 * ⚠️ ON NE PROPOSE PAS CE QU'ON NE PEUT PAS TENIR. Afficher un bouton qui
 * échouera après une demande de Face ID est pire que de ne rien afficher : la
 * personne croit avoir raté quelque chose.
 */
export async function capacites(): Promise<Capacites> {
  if (typeof PublicKeyCredential === "undefined") {
    return { disponible: false, raison: "pas-de-webauthn" }
  }
  /*
   * ⚠️ WEBAUTHN EXIGE UN CONTEXTE SÛR. En HTTP simple (hors `localhost`), l'appel
   * lève une erreur qui parle de « SecurityError » sans dire pourquoi — on le
   * détecte ici plutôt que de laisser chercher.
   */
  if (!window.isSecureContext) {
    return { disponible: false, raison: "hors-contexte-sur" }
  }

  /*
   * ⚠️ `getClientCapabilities` EST RÉCENT, et son absence ne veut pas dire que
   * PRF manque. On ne conclut au refus que s'il répond explicitement `false` ;
   * sinon on tente, et c'est l'appel réel qui tranchera.
   */
  const lire = (
    PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<Record<string, boolean>>
    }
  ).getClientCapabilities
  if (typeof lire === "function") {
    try {
      const caps = await lire.call(PublicKeyCredential)
      if (caps["extension:prf"] === false) {
        return { disponible: false, raison: "pas-de-prf" }
      }
    } catch {
      // Indisponible : on tente quand même.
    }
  }

  return { disponible: true }
}

/** Le résultat PRF, encodé — c'est le « secret » de la serrure. */
function versB64(buf: ArrayBuffer): string {
  const o = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < o.length; i++) s += String.fromCharCode(o[i])
  return btoa(s)
}

function extraireSecret(cred: PublicKeyCredential | null): string | null {
  const ext = cred?.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer | Uint8Array } }
  }
  const brut = ext?.prf?.results?.first
  if (!brut) return null
  return versB64(brut instanceof Uint8Array ? (brut.buffer as ArrayBuffer) : brut)
}

/**
 * Crée la clé d'accès, et rend le secret qu'elle dérive.
 *
 * ⚠️ `residentKey: "required"` — UNE CLÉ DÉCOUVRABLE, et ce n'est pas un détail.
 * Sans cela, il faudrait connaître l'identifiant de la clé pour la redemander,
 * donc le ranger sur le serveur, donc gérer une table de plus. Une clé
 * découvrable se retrouve toute seule : le navigateur sait laquelle proposer.
 *
 * ⚠️ DEUX APPELS, ET C'EST VOULU. Certains navigateurs ne rendent pas le
 * résultat PRF au moment de la création. On crée, puis on demande — le chemin
 * qui marche partout, au prix d'une vérification de plus, UNE SEULE FOIS.
 */
export async function creerTrousseau(opts: {
  userId: string
  nom: string
}): Promise<string> {
  const defi = crypto.getRandomValues(new Uint8Array(32))

  const cree = (await navigator.credentials.create({
    publicKey: {
      challenge: defi,
      rp: { name: "Alanya", id: window.location.hostname },
      user: {
        id: new TextEncoder().encode(opts.userId),
        name: opts.nom,
        displayName: opts.nom,
      },
      /*
       * ⚠️ ES256 ET RS256, DANS CET ORDRE. Le premier est ce que produisent les
       * authentificateurs modernes ; le second est là pour les plus anciens.
       * N'en proposer qu'un exclurait du matériel encore en service.
       */
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        /*
         * ⚠️ `platform` : le trousseau DE CET APPAREIL, pas une clé USB. C'est
         * le sens de cette serrure — Face ID, Touch ID, Windows Hello.
         */
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null

  if (!cree) throw new Error("La création de la clé d'accès a été annulée.")

  const secret = await ouvrirTrousseau()
  if (!secret) {
    throw new Error(
      "La clé d'accès a été créée mais ne sait pas dériver de secret sur cet appareil.",
    )
  }
  return secret
}

/**
 * Demande à la clé d'accès de recalculer le secret.
 *
 * ⚠️ REND `null` PLUTÔT QUE DE LEVER QUAND L'UTILISATEUR ANNULE. Refuser Face ID
 * n'est pas une panne : c'est une réponse. La traiter comme une erreur ferait
 * afficher un message rouge à quelqu'un qui a simplement changé d'avis.
 */
export async function ouvrirTrousseau(): Promise<string | null> {
  const defi = crypto.getRandomValues(new Uint8Array(32))

  try {
    const obtenu = (await navigator.credentials.get({
      publicKey: {
        challenge: defi,
        rpId: window.location.hostname,
        /*
         * ⚠️ LISTE VIDE : on laisse le navigateur trouver la clé découvrable. Lui
         * imposer un identifiant supposerait qu'on l'ait rangé quelque part.
         */
        allowCredentials: [],
        userVerification: "required",
        timeout: 60_000,
        extensions: {
          prf: { eval: { first: SEL_PRF } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null

    return extraireSecret(obtenu)
  } catch (e) {
    /*
     * ⚠️ ON DISTINGUE L'ANNULATION DU RESTE. `NotAllowedError` couvre à la fois
     * « l'utilisateur a refusé » et « le délai a expiré » : dans les deux cas il
     * n'y a rien à signaler comme un défaut.
     */
    if (e instanceof DOMException && e.name === "NotAllowedError") return null
    throw e
  }
}
