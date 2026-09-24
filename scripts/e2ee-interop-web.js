/**
 * LE CÔTÉ WEB DU BANC D'INTEROPÉRABILITÉ.
 *
 * 🔴 CE FICHIER EST LA MOITIÉ D'UNE PREUVE. L'autre moitié est en Dart, dans
 * `alanya/interop/bin/mobile.dart`. Ensemble, ils répondent à la seule question
 * qui pouvait encore faire tomber le lot 4 : est-ce que la bibliothèque du web
 * et celle du mobile parlent LA MÊME LANGUE sur le fil ?
 *
 * ⚠️ NE SE LANCE PAS DIRECTEMENT — voir `scripts/e2ee-interop.mjs`.
 */

import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from "@privacyresearch/libsignal-protocol-typescript"

/* ══════════════════ OUTILS ══════════════════ */

function versB64(buf) {
  const o = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < o.length; i++) s += String.fromCharCode(o[i])
  return btoa(s)
}

function depuisB64(b64) {
  const s = atob(b64)
  const o = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i)
  return o.buffer
}

/**
 * Le magasin d'Alice, en mémoire.
 *
 * ⚠️ RÉDUIT À CE QUE LE BANC UTILISE. Le vrai magasin du produit vit dans
 * `e2ee-store.ts`, adossé au coffre chiffré ; le recopier ici n'apporterait rien
 * et ferait diverger deux implémentations du même contrat.
 */
class MagasinAlice {
  constructor(identite, registrationId) {
    this.identite = identite
    this.registrationId = registrationId
    this.sessions = new Map()
    this.identites = new Map()
  }
  getIdentityKeyPair() {
    return Promise.resolve(this.identite)
  }
  getLocalRegistrationId() {
    return Promise.resolve(this.registrationId)
  }
  isTrustedIdentity() {
    return Promise.resolve(true)
  }
  saveIdentity(id, cle) {
    const avant = this.identites.get(id)
    this.identites.set(id, cle)
    return Promise.resolve(avant !== undefined && versB64(avant) !== versB64(cle))
  }
  loadIdentityKey(id) {
    return Promise.resolve(this.identites.get(id))
  }
  loadPreKey() {
    return Promise.resolve(undefined)
  }
  removePreKey() {
    return Promise.resolve()
  }
  loadSignedPreKey() {
    return Promise.resolve(undefined)
  }
  loadSession(id) {
    return Promise.resolve(this.sessions.get(id))
  }
  storeSession(id, s) {
    this.sessions.set(id, s)
    return Promise.resolve()
  }
}

/* ══════════════════ LES ÉTAPES ══════════════════ */

/**
 * ② Alice ouvre une session vers Bob à partir du paquet que le MOBILE a produit,
 * puis chiffre le premier message.
 *
 * 🔴 C'EST LE PASSAGE CRITIQUE. `processPreKey` vérifie la SIGNATURE de la
 * pré-clé signée avec la clé d'identité de Bob. Si les deux bibliothèques
 * n'encodaient pas les clés pareil, cette vérification échouerait ici — et c'est
 * tant mieux : mieux vaut un refus net qu'une session bancale.
 */
export async function alicePrepareEtChiffre(bundleDuMobile, texte) {
  const identite = await KeyHelper.generateIdentityKeyPair()
  const registrationId = await KeyHelper.generateRegistrationId()
  const magasin = new MagasinAlice(identite, registrationId)

  const bob = new SignalProtocolAddress("bob", bundleDuMobile.deviceId)
  const constructeur = new SessionBuilder(magasin, bob)

  await constructeur.processPreKey({
    registrationId: bundleDuMobile.registrationId,
    identityKey: depuisB64(bundleDuMobile.identityKey),
    signedPreKey: {
      keyId: bundleDuMobile.signedPreKeyId,
      publicKey: depuisB64(bundleDuMobile.signedPreKeyPublic),
      signature: depuisB64(bundleDuMobile.signedPreKeySignature),
    },
    preKey: {
      keyId: bundleDuMobile.preKeyId,
      publicKey: depuisB64(bundleDuMobile.preKeyPublic),
    },
  })

  const chiffreur = new SessionCipher(magasin, bob)
  const enveloppe = await chiffreur.encrypt(new TextEncoder().encode(texte).buffer)

  return {
    magasin,
    chiffreur,
    type: enveloppe.type,
    corps: btoa(enveloppe.body),
    identiteAlice: versB64(identite.pubKey),
  }
}

/**
 * ⑤ Alice déchiffre la réponse du mobile.
 *
 * ⚠️ C'EST UN MESSAGE ORDINAIRE, pas un `PreKeySignalMessage` : la session est
 * ouverte. Les deux formes sont donc éprouvées — l'établissement ET la suite.
 */
export async function aliceDechiffre(chiffreur, corpsB64) {
  const brut = atob(corpsB64)
  const clair = await chiffreur.decryptWhisperMessage(brut, "binary")
  return new TextDecoder().decode(new Uint8Array(clair))
}

/**
 * Le code de sécurité, côté web — tel que le produit le calcule.
 *
 * ⚠️ ON RÉIMPLÉMENTE ICI PLUTÔT QUE D'APPELER `e2ee-empreinte.ts` : ce module
 * lit le coffre local et la session, qui n'existent pas dans ce banc. Ce qui est
 * comparé, c'est l'ALGORITHME — et il est écrit deux fois, exprès, pour que le
 * banc échoue si l'un des deux dérive.
 */
export async function empreinteWeb(cleLocale, idLocal, cleDistante, idDistant) {
  const a = await moitie(cleLocale, idLocal)
  const b = await moitie(cleDistante, idDistant)
  return [a, b].sort().join("")
}

async function moitie(cleB64, identifiant) {
  const cle = new Uint8Array(depuisB64(cleB64))
  const id = new TextEncoder().encode(identifiant)

  let donnee = new Uint8Array([0x00, 0x00, ...cle, ...id])
  for (let i = 0; i < 5200; i++) {
    const joint = new Uint8Array(donnee.length + cle.length)
    joint.set(donnee, 0)
    joint.set(cle, donnee.length)
    donnee = new Uint8Array(await crypto.subtle.digest("SHA-512", joint))
  }

  let sortie = ""
  for (let i = 0; i < 6; i++) {
    let n = 0
    for (let j = 0; j < 5; j++) n = n * 256 + donnee[i * 5 + j]
    sortie += String(n % 100000).padStart(5, "0")
  }
  return sortie
}
