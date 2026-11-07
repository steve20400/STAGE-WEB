import { useState } from "react"
import "./documentation.css"

/*
 * LA DOCUMENTATION DE LA CONSOLE DÉVELOPPEUR (refaite le 07/11/2026, demande
 * du user).
 *
 * 🔴 AUCUN COMMENTAIRE DANS LES BLOCS DE CODE. Chaque bloc a son bouton
 * « Copier » : ce qui est copié doit pouvoir être collé et lancé tel quel. Les
 * explications sont écrites AUTOUR des blocs, jamais dedans.
 *
 * Les exemples lisent la clé dans une variable d'environnement
 * (`ALANYA_API_KEY`) plutôt que de l'écrire en dur : une clé collée dans un
 * fichier finit tôt ou tard dans un dépôt de code.
 *
 * La référence complète reste `backend-alanya/docs/2026-08-21-api-v1-integration.md`.
 */

type Onglet = "demarrer" | "messages" | "fichiers" | "codes" | "webhook" | "erreurs"

const ONGLETS: { id: Onglet; titre: string }[] = [
  { id: "demarrer", titre: "Démarrer" },
  { id: "messages", titre: "Messages" },
  { id: "fichiers", titre: "Fichiers" },
  { id: "codes", titre: "Codes de vérification" },
  { id: "webhook", titre: "Webhook" },
  { id: "erreurs", titre: "Erreurs et limites" },
]

function BlocCode({ titre, langage, code }: { titre: string; langage: string; code: string }) {
  const [copie, setCopie] = useState(false)

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopie(true)
      window.setTimeout(() => setCopie(false), 1800)
    } catch {
      // Presse-papiers refusé (contexte non sécurisé) : le texte reste sélectionnable.
    }
  }

  return (
    <div className="dev-doc-bloc">
      <div className="dev-doc-bloc-tete">
        <span>
          {titre} · {langage}
        </span>
        <button type="button" className="dev-doc-copier" onClick={() => void copier()} aria-label={`Copier : ${titre}`}>
          {copie ? "Copié ✓" : "Copier"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

function Route({ methode, chemin }: { methode: string; chemin: string }) {
  return (
    <p>
      <span className="dev-doc-methode">{methode}</span>
      <code>{chemin}</code>
    </p>
  )
}

/* ─── Les exemples ─────────────────────────────────────────────────────── */

const CLE_BASH = String.raw`export ALANYA_API_KEY="ak_live_votre_cle"`

const PREMIER_MESSAGE = String.raw`curl -X POST https://alanyavox.com/api/v1/messages \
  -H "X-Api-Key: $ALANYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"destinataire": "12345678", "texte": "Bonjour depuis Alanya"}'`

const REPONSE_MESSAGE = String.raw`{
  "id": "3f9a1c2e-7b4d-4e8a-9c1f-2d5e6f7a8b9c",
  "statut": "ENVOYE",
  "destinataire": "12345678",
  "conversationId": "8c21d4e0-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
  "type": "TEXT",
  "medias": [],
  "envoyeA": "2026-11-07T14:02:11.482Z"
}`

const MESSAGE_NODE = String.raw`const reponse = await fetch("https://alanyavox.com/api/v1/messages", {
  method: "POST",
  headers: {
    "X-Api-Key": process.env.ALANYA_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ destinataire: "12345678", texte: "Bonjour depuis Alanya" }),
});

if (!reponse.ok) {
  const { error } = await reponse.json();
  throw new Error(error.code + " : " + error.message);
}

const message = await reponse.json();`

const MESSAGE_PYTHON = String.raw`import os
import requests

reponse = requests.post(
    "https://alanyavox.com/api/v1/messages",
    headers={"X-Api-Key": os.environ["ALANYA_API_KEY"]},
    json={"destinataire": "12345678", "texte": "Bonjour depuis Alanya"},
    timeout=10,
)
reponse.raise_for_status()
message = reponse.json()`

const MESSAGE_FICHIER = String.raw`curl -X POST https://alanyavox.com/api/v1/messages \
  -H "X-Api-Key: $ALANYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"destinataire": "12345678", "type": "FILE", "texte": "Votre facture", "mediaIds": ["b7d0a1c2-3e4f-4a5b-8c6d-7e8f9a0b1c2d"]}'`

const MESSAGE_BOUTONS = String.raw`curl -X POST https://alanyavox.com/api/v1/messages \
  -H "X-Api-Key: $ALANYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"destinataire": "12345678", "texte": "Confirmez-vous le rendez-vous de demain ?", "options": ["OUI", "NON"]}'`

const MESSAGE_POSITION = String.raw`curl -X POST https://alanyavox.com/api/v1/messages \
  -H "X-Api-Key: $ALANYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"destinataire": "12345678", "type": "LOCATION", "texte": "{\"v\":1,\"lat\":3.848,\"lon\":11.502,\"nom\":\"Agence de Yaoundé\"}"}'`

const TELEVERSER = String.raw`curl -X POST https://alanyavox.com/api/v1/media \
  -H "X-Api-Key: $ALANYA_API_KEY" \
  -F "file=@facture.pdf"`

const REPONSE_TELEVERSER = String.raw`{
  "id": "b7d0a1c2-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
  "url": "/api/media/b7d0a1c2-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
  "nomFichier": "facture.pdf",
  "typeMime": "application/pdf",
  "octets": 48213,
  "dureeMs": null
}`

const ENVOYER_CODE = String.raw`curl -X POST https://alanyavox.com/api/v1/verifications \
  -H "X-Api-Key: $ALANYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"finalite": "AUTH_2FA", "destination": "client@exemple.com", "canal": "EMAIL", "langue": "fr"}'`

const REPONSE_ENVOYER_CODE = String.raw`{
  "id": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
  "finalite": "AUTH_2FA",
  "canal": "EMAIL",
  "destination": "client@exemple.com",
  "expireA": "2026-11-07T14:07:11.000Z",
  "livraison": "REMIS"
}`

const VERIFIER_CODE = String.raw`curl -X POST https://alanyavox.com/api/v1/verifications/check \
  -H "X-Api-Key: $ALANYA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"finalite": "AUTH_2FA", "destination": "client@exemple.com", "code": "042518"}'`

const REPONSE_CODE_BON = String.raw`{ "verifie": true }`

const REPONSE_CODE_REFUSE = String.raw`{ "verifie": false, "essaisRestants": 2 }`

const CHARGE_WEBHOOK = String.raw`{
  "evenement": "message.statut",
  "emisA": "2026-11-07T14:02:11.482Z",
  "donnees": {
    "messageId": "3f9a1c2e-7b4d-4e8a-9c1f-2d5e6f7a8b9c",
    "statut": "ENVOYE",
    "destinataire": "12345678"
  }
}`

const SIGNATURE_NODE = String.raw`import crypto from "node:crypto";

export function signatureValide(corpsBrut, entete) {
  const attendu =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.ALANYA_WEBHOOK_SECRET)
      .update(corpsBrut)
      .digest("hex");
  const recu = Buffer.from(entete ?? "");
  const calcule = Buffer.from(attendu);
  return recu.length === calcule.length && crypto.timingSafeEqual(recu, calcule);
}`

const SIGNATURE_PYTHON = String.raw`import hashlib
import hmac
import os


def signature_valide(corps_brut: bytes, entete: str | None) -> bool:
    secret = os.environ["ALANYA_WEBHOOK_SECRET"].encode()
    attendu = "sha256=" + hmac.new(secret, corps_brut, hashlib.sha256).hexdigest()
    return hmac.compare_digest(attendu, entete or "")`

const ERREUR = String.raw`{
  "error": {
    "message": "Trop de requêtes. Attendez avant de réessayer.",
    "code": "RATE_LIMITED"
  }
}`

/* ─── Les tableaux ─────────────────────────────────────────────────────── */

const CHAMPS_MESSAGE: [string, string, string][] = [
  ["destinataire", "oui", "Numéro Alanya ou numéro de mobile de la personne."],
  ["texte", "selon le cas", "Le message, ou la légende d'un fichier. 500 caractères au plus, boutons compris."],
  ["type", "non", "TEXT (par défaut), IMAGE, VIDEO, AUDIO, FILE, CONTACT ou LOCATION."],
  ["mediaIds", "selon le cas", "Jusqu'à 10 identifiants rendus par l'envoi de fichiers."],
  ["options", "non", "Boutons de réponse rapide : de 1 à 10 libellés."],
]

const ERREURS: [string, string, string][] = [
  ["API_KEY_MISSING", "401", "Aucune clé dans la requête."],
  ["API_KEY_INVALID", "401", "Clé inconnue ou révoquée."],
  ["INVALID_REQUEST", "400", "Corps illisible ou au mauvais format."],
  ["VALIDATION", "422", "Un champ manque ou sort des limites. Le détail est dans error.details."],
  ["RECIPIENT_NOT_FOUND", "404", "Ce numéro n'a pas de compte Alanya."],
  ["RECIPIENT_BLOCKED", "403", "Blocage entre l'enseigne et la personne. Inutile de réessayer."],
  ["MESSAGE_REFUSED", "409", "Message refusé pour une autre raison, donnée dans error.message."],
  ["MEDIA_FORBIDDEN", "403", "Fichier inconnu ou téléversé par une autre enseigne."],
  ["MEDIA_TYPE_REJECTED", "415", "Type de fichier non accepté."],
  ["MEDIA_TOO_LARGE", "413", "Fichier trop gros."],
  ["RATE_LIMITED", "429", "Trop d'appels : attendez le nombre de secondes indiqué par Retry-After."],
  ["VERIFICATION_NOT_DELIVERED", "502", "Le code n'a pas pu être remis à la destination."],
  ["STORAGE_UNAVAILABLE", "502", "Notre stockage de fichiers n'a pas répondu : réessayez."],
  ["INTERNAL_ERROR", "500", "Erreur de notre côté : réessayez plus tard."],
]

const PLAFONDS: [string, string][] = [
  ["Envoyer un message", "60 par minute"],
  ["Téléverser un fichier", "30 par minute"],
  ["Vérifier un code", "30 par minute"],
  ["Envoyer un code", "20 par minute ; pour une même destination, 5 par heure (connexion) ou 3 (autres finalités)"],
]

function Tableau({ entetes, lignes, premiereEnCode = false }: { entetes: string[]; lignes: string[][]; premiereEnCode?: boolean }) {
  return (
    <div className="dev-doc-defile">
      <table className="dev-doc-tableau">
        <thead>
          <tr>
            {entetes.map((e) => (
              <th key={e}>{e}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l[0]}>
              {l.map((cellule, i) => (
                <td key={i}>{i === 0 && premiereEnCode ? <code>{cellule}</code> : cellule}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ─── La page ──────────────────────────────────────────────────────────── */

export default function Documentation({ numeroEnseigne }: { numeroEnseigne?: string }) {
  const [onglet, setOnglet] = useState<Onglet>("demarrer")

  return (
    <div className="dev-doc">
      <div className="dev-doc-onglets" role="tablist" aria-label="Sections de la documentation">
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={onglet === o.id}
            className="dev-doc-onglet"
            onClick={() => setOnglet(o.id)}
          >
            {o.titre}
          </button>
        ))}
      </div>

      {onglet === "demarrer" && (
        <>
          <section className="dev-doc-section">
            <h3>Le principe</h3>
            <p>
              Votre serveur appelle l'API Alanya avec une clé. Les messages partent du numéro de votre enseigne
              {numeroEnseigne ? (
                <>
                  {" "}
                  (<strong>{numeroEnseigne}</strong>)
                </>
              ) : null}
              , vers n'importe quel utilisateur d'Alanya.
            </p>
            <ul>
              <li>
                Adresse de l'API : <code>https://alanyavox.com/api/v1</code>
              </li>
              <li>
                Authentification : l'en-tête <code>X-Api-Key</code> avec votre clé.
              </li>
              <li>Corps des requêtes et des réponses : JSON, sauf l'envoi de fichiers.</li>
            </ul>
            <p className="dev-doc-note">
              Appelez l'API depuis votre serveur, jamais depuis une page web ou une application : une clé présente dans
              du code envoyé aux utilisateurs peut être lue par n'importe qui.
            </p>
          </section>

          <section className="dev-doc-section">
            <h3>1. Gardez votre clé dans une variable</h3>
            <p>
              Créez une clé dans l'onglet <strong>Clés d'API</strong>, puis rangez-la dans une variable d'environnement de
              votre serveur. Tous les exemples de cette documentation la lisent sous ce nom.
            </p>
            <BlocCode titre="Terminal" langage="bash" code={CLE_BASH} />
          </section>

          <section className="dev-doc-section">
            <h3>2. Envoyez votre premier message</h3>
            <p>
              Remplacez <code>12345678</code> par votre propre numéro Alanya : vous recevrez le message dans votre
              application.
            </p>
            <BlocCode titre="Requête" langage="curl" code={PREMIER_MESSAGE} />
            <p>
              La réponse arrive avec le statut <code>201</code>. <code>id</code> identifie le message ; c'est la même
              valeur que dans le webhook.
            </p>
            <BlocCode titre="Réponse" langage="json" code={REPONSE_MESSAGE} />
          </section>

          <section className="dev-doc-section">
            <h3>3. Depuis votre code</h3>
            <BlocCode titre="Node.js 18 et plus" langage="javascript" code={MESSAGE_NODE} />
            <BlocCode titre="Python" langage="python" code={MESSAGE_PYTHON} />
          </section>
        </>
      )}

      {onglet === "messages" && (
        <>
          <section className="dev-doc-section">
            <h3>Envoyer un message</h3>
            <Route methode="POST" chemin="/api/v1/messages" />
            <Tableau entetes={["Champ", "Obligatoire", "Description"]} lignes={CHAMPS_MESSAGE} premiereEnCode />
            <p>
              Il faut au moins un <code>texte</code> ou un fichier. Un texte trop long est refusé, jamais coupé.
            </p>
          </section>

          <section className="dev-doc-section">
            <h4>Un message avec un fichier</h4>
            <p>
              Téléversez d'abord le fichier (onglet <strong>Fichiers</strong>), puis donnez son identifiant dans{" "}
              <code>mediaIds</code>. Le <code>texte</code> sert alors de légende.
            </p>
            <BlocCode titre="Requête" langage="curl" code={MESSAGE_FICHIER} />
          </section>

          <section className="dev-doc-section">
            <h4>Des boutons de réponse rapide</h4>
            <p>
              La personne voit votre question avec un bouton par option. Un appui envoie le libellé du bouton comme un
              message ordinaire : la réponse vaut exactement <code>OUI</code> ou <code>NON</code>.
            </p>
            <BlocCode titre="Requête" langage="curl" code={MESSAGE_BOUTONS} />
            <ul>
              <li>De 1 à 10 options ; 2 ou 3 se lisent mieux.</li>
              <li>24 caractères au plus par libellé, sans crochet.</li>
              <li>Pas de boutons sur une position ni sur un contact.</li>
              <li>La réponse de la personne ne vous parvient pas encore par webhook.</li>
            </ul>
            <p className="dev-doc-note">
              Tout texte entre crochets devient un bouton, même sans <code>options</code> : « commande [12345] prête »
              afficherait un bouton « 12345 ». N'utilisez pas de crochets dans vos textes.
            </p>
          </section>

          <section className="dev-doc-section">
            <h4>Une position</h4>
            <p>
              Le type <code>LOCATION</code> porte sa position en JSON dans <code>texte</code> : la latitude{" "}
              <code>lat</code>, la longitude <code>lon</code> et, si vous voulez, un <code>nom</code>.
            </p>
            <BlocCode titre="Requête" langage="curl" code={MESSAGE_POSITION} />
          </section>
        </>
      )}

      {onglet === "fichiers" && (
        <section className="dev-doc-section">
          <h3>Téléverser un fichier</h3>
          <Route methode="POST" chemin="/api/v1/media" />
          <p>
            Le corps est un formulaire <code>multipart/form-data</code> avec le fichier dans le champ <code>file</code>.
            Pour un son ou une vidéo, vous pouvez ajouter sa durée en millisecondes dans le champ{" "}
            <code>durationMs</code>.
          </p>
          <BlocCode titre="Requête" langage="curl" code={TELEVERSER} />
          <BlocCode titre="Réponse" langage="json" code={REPONSE_TELEVERSER} />
          <p>
            Donnez ensuite <code>id</code> dans <code>mediaIds</code> en envoyant le message. Une enseigne ne peut joindre
            que les fichiers qu'elle a téléversés elle-même.
          </p>
        </section>
      )}

      {onglet === "codes" && (
        <>
          <section className="dev-doc-section">
            <h3>Envoyer un code</h3>
            <Route methode="POST" chemin="/api/v1/verifications" />
            <p>Alanya tire un code à 6 chiffres et le livre lui-même. Il ne figure jamais dans la réponse.</p>
            <ul>
              <li>
                <code>finalite</code> : <code>AUTH_2FA</code> (connexion), <code>CREATION_AGENT</code> ou{" "}
                <code>VALIDATION_CONTACT</code>.
              </li>
              <li>
                <code>canal</code> : <code>EMAIL</code> (par défaut pour <code>AUTH_2FA</code>) ou <code>ALANYA</code>{" "}
                (un message dans l'application, au numéro donné en destination).
              </li>
              <li>
                <code>langue</code> (facultatif) : <code>fr</code>, <code>en</code>, <code>es</code>, <code>de</code>,{" "}
                <code>pt</code>, <code>ru</code>, <code>zh</code>, <code>sv</code> ou <code>no</code>.
              </li>
            </ul>
            <BlocCode titre="Requête" langage="curl" code={ENVOYER_CODE} />
            <BlocCode titre="Réponse" langage="json" code={REPONSE_ENVOYER_CODE} />
            <p>
              <code>livraison: "REMIS"</code> veut dire que le code est réellement parti. S'il n'a pas pu l'être, vous
              recevez une erreur <code>502 VERIFICATION_NOT_DELIVERED</code>. Demander un nouveau code remplace le
              précédent que votre enseigne avait envoyé à cette personne.
            </p>
          </section>

          <section className="dev-doc-section">
            <h3>Vérifier un code</h3>
            <Route methode="POST" chemin="/api/v1/verifications/check" />
            <BlocCode titre="Requête" langage="curl" code={VERIFIER_CODE} />
            <p>Code bon :</p>
            <BlocCode titre="Réponse" langage="json" code={REPONSE_CODE_BON} />
            <p>Code refusé :</p>
            <BlocCode titre="Réponse" langage="json" code={REPONSE_CODE_REFUSE} />
            <p>
              Un refus ne dit pas pourquoi (code faux, expiré ou déjà utilisé) : c'est voulu. Affichez{" "}
              <code>essaisRestants</code> à la personne. Un code vaut 5 minutes et 3 essais pour la connexion.
            </p>
          </section>
        </>
      )}

      {onglet === "webhook" && (
        <>
          <section className="dev-doc-section">
            <h3>Ce que reçoit votre serveur</h3>
            <p>
              Réglez l'adresse dans l'onglet <strong>Webhook</strong>. Elle doit commencer par <code>https://</code> et être
              joignable sur Internet. Alanya l'appelle en <code>POST</code> quand un message de votre enseigne part, et
              attend au plus 5 secondes.
            </p>
            <BlocCode titre="Corps reçu" langage="json" code={CHARGE_WEBHOOK} />
            <p>
              Aujourd'hui, seul l'événement <code>message.statut</code> existe. Vérifiez quand même{" "}
              <code>evenement</code> : d'autres viendront.
            </p>
          </section>

          <section className="dev-doc-section">
            <h3>Vérifier qu'un envoi vient d'Alanya</h3>
            <p>
              Chaque envoi porte l'en-tête <code>X-Alanya-Signature</code>, calculé avec le secret de votre webhook
              (bouton <strong>Afficher</strong> de l'onglet Webhook). Rangez ce secret dans la variable{" "}
              <code>ALANYA_WEBHOOK_SECRET</code>.
            </p>
            <ol>
              <li>Calculez la signature sur le corps brut reçu, avant de le lire comme du JSON.</li>
              <li>Comparez avec une fonction à temps constant, comme ci-dessous.</li>
              <li>Refusez tout envoi sans signature valable.</li>
            </ol>
            <BlocCode titre="Node.js" langage="javascript" code={SIGNATURE_NODE} />
            <BlocCode titre="Python" langage="python" code={SIGNATURE_PYTHON} />
          </section>
        </>
      )}

      {onglet === "erreurs" && (
        <>
          <section className="dev-doc-section">
            <h3>Forme d'une erreur</h3>
            <p>
              Une erreur a toujours cette forme. Branchez votre code sur <code>code</code>, qui ne change pas ;{" "}
              <code>message</code> est fait pour être lu et peut être reformulé.
            </p>
            <BlocCode titre="Réponse" langage="json" code={ERREUR} />
            <Tableau entetes={["Code", "HTTP", "Que faire"]} lignes={ERREURS} premiereEnCode />
          </section>

          <section className="dev-doc-section">
            <h3>Limites</h3>
            <p>
              L'API est gratuite et sans quota de volume. Seule la cadence est limitée, par clé et par route : une rafale
              de messages ne bloque pas vos codes de vérification.
            </p>
            <Tableau entetes={["Route", "Plafond"]} lignes={PLAFONDS} />
            <p>
              Au-delà, la réponse est <code>429</code> avec l'en-tête <code>Retry-After</code> : attendez ce nombre de
              secondes, puis réessayez. C'est la seule erreur pour laquelle réessayer a un sens.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
