import { useCallback, useEffect, useRef, useState } from "react"

import { useToast } from "../../../src/components/toast"
import { useTranslation } from "../../../src/i18n"
import { formatAlanyaNumber } from "../../../src/lib/alanya-number"
import { startOutgoingCall } from "../../../src/services/call-manager"
import { createPrivateChat } from "../../../src/services/chats-service"
import {
  chercherEntreprises,
  entreprisesDuPays,
  entreprisesDuType,
  listerPaysDisponibles,
  type PaysAnnuaire,
  estVocal,
  ficheEntreprise,
  listerTypes,
  type CentreEntreprise,
  type Entreprise,
  type FicheEntreprise,
  type TypeEntreprise,
} from "../../../src/services/entreprises-service"
import "./entreprises-page.css"

/**
 * ANNUAIRE DES ENTREPRISES — pendant web de l'onglet mobile.
 *
 * Quatre niveaux, plus un raccourci :
 *   1. les types d'entreprise, avec leur effectif dans mon pays ;
 *   2. les entreprises d'un type ;
 *   3. la fiche : sa description, puis deux entrées — centres d'appel, centres
 *      vocaux ;
 *   4. les centres d'un genre, avec le numéro à composer.
 *   +  une RECHERCHE qui traverse tout.
 *
 * 🔴 LA RECHERCHE IGNORE LE FILTRE PAR PAYS, et ce n'est pas une incohérence.
 * La navigation par type ne montre que les entreprises de mon pays ; celles dont
 * le pays n'est pas renseigné ne sont donc atteignables QUE par la recherche.
 * Lui ajouter le filtre « pour être cohérent » les rendrait introuvables.
 *
 * 🔴 LA DESCRIPTION D'ABORD, LES CENTRES ENSUITE (demande du user, 26/08/2026).
 * On ouvre une entreprise pour savoir ce qu'elle fait ; on choisit ensuite le
 * genre de standard. Les deux entrées s'affichent MÊME VIDES, avec leur
 * explication et un mot disant que ce n'est pas encore disponible : une entrée
 * absente laisserait croire que le genre n'existe pas.
 *
 * ⚠️ LES QUATRE NIVEAUX VIVENT DANS UNE SEULE PAGE, avec un état, plutôt que
 * dans quatre routes. Revenir en arrière retrouve la liste déjà chargée au lieu
 * de la relire au serveur pour afficher exactement la même chose. C'est le même
 * parti que la page Collègues.
 *
 * ⚠️ Aucun emoji ni sticker — règle du projet.
 */

/** Où l'on se trouve dans l'annuaire. */
/**
 * CE QUE MONTRE LE VOLET GAUCHE — une liste, toujours.
 *
 * Separe du detail, et c'est tout le decoupage : un seul etat forcait la liste
 * a DISPARAITRE des qu'on ouvrait une fiche, puisque le meme champ portait les
 * deux. La page ne pouvait donc pas etre a deux volets.
 */
type Liste =
  | { niveau: "types" }
  | { niveau: "entreprises"; type: TypeEntreprise }
  /**
   * Une recherche affichée.
   *
   * 🔴 `parPays` DISTINGUE DEUX CHOSES QUI PARTAGEAIENT UN SEUL ÉTAT. Saisir
   * « Cameroun » affiche les entreprises DU PAYS ; saisir « Orange » cherche
   * dans les raisons sociales. Les deux aboutissaient au même `niveau`, donc on
   * ne pouvait plus savoir laquelle rejouer quand le filtre change — et rejouer
   * la mauvaise vide la liste, puisque aucune entreprise ne s'appelle
   * « Cameroun ».
   */
  | { niveau: "recherche"; parPays: boolean }

/** CE QUE MONTRE LE VOLET DROIT, ou `null` quand rien n'est choisi. */
type Detail =
  | { niveau: "fiche"; entreprise: Entreprise }
  | { niveau: "centres"; entreprise: Entreprise; vocal: boolean }
  | null

export default function EntreprisesPage() {
  const { t } = useTranslation()
  const { error } = useToast()

  const [voletGauche, setVoletGauche] = useState<Liste>({ niveau: "types" })
  const [detail, setDetail] = useState<Detail>(null)
  const [types, setTypes] = useState<TypeEntreprise[] | null>(null)
  const [liste, setListe] = useState<Entreprise[] | null>(null)
  const [fiche, setFiche] = useState<FicheEntreprise | null>(null)
  const [requete, setRequete] = useState("")
  /**
   * Les pays proposes par le filtre — ceux qui ont au moins une entreprise.
   *
   * 🔴 VIENNENT DU SERVEUR, jamais de la table des pays : construire le menu
   * depuis celle-ci proposerait des pays vides, et l'ecran promettrait des
   * entreprises qui n'existent pas.
   */
  const [paysDispo, setPaysDispo] = useState<PaysAnnuaire[]>([])
  /**
   * Pays retenu, ou `null` pour celui du compte.
   *
   * ⚠️ `null` N'EST PAS « TOUS LES PAYS ». Le serveur n'a pas cette notion : il
   * n'y a que « le mien » — ce qu'il applique quand on ne lui envoie rien — ou
   * « celui-ci ». Envoyer `0` ou une chaine vide se ferait refuser.
   */
  const [paysChoisi, setPaysChoisi] = useState<number | null>(null)
  const [echec, setEchec] = useState(false)
  const [occupe, setOccupe] = useState(false)

  /**
   * NUMÉRO DE LA DEMANDE EN COURS.
   *
   * 🐛 UNE RÉPONSE EN RETARD ÉCRASAIT LA PLUS RÉCENTE. On change de pays deux
   * fois de suite — ou l'on revient sur le premier — et rien ne garantit que
   * les réponses reviennent dans l'ordre : celle du pays ABANDONNÉ pouvait
   * arriver en dernier et s'afficher sous le filtre du nouveau. La liste
   * paraissait alors « ne pas suivre le filtre », de façon intermittente et
   * impossible à reproduire à volonté.
   *
   * Chaque demande prend un numéro ; seule la dernière a le droit d'écrire.
   */
  const demande = useRef(0)

  /*
   * CE QUE L'ÉCRAN REGARDE, LISIBLE SANS DEVENIR UNE DÉPENDANCE.
   *
   * ⚠️ DES `ref`, PAS DES DÉPENDANCES. Mettre `voletGauche` et `requete` dans les
   * dépendances de l'effet ci-dessous le relancerait à chaque frappe et à chaque
   * clic — donc rejouerait le pays sans qu'on ait changé de pays. On veut lire
   * leur valeur COURANTE au moment où le pays change, pas réagir à elles.
   */
  const vueCourante = useRef(voletGauche)
  vueCourante.current = voletGauche
  const requeteCourante = useRef(requete)
  requeteCourante.current = requete
  /** La liste qu'affichait le volet avant la recherche, pour y revenir. */
  const avantRecherche = useRef<Liste | null>(null)

  /**
   * CHANGER DE PAYS REJOUE TOUT CE QUI EST À L'ÉCRAN.
   *
   * 🐛 IL NE REJOUAIT QUE LE MENU DE GAUCHE. Signalé par le user le 26/09/2026 :
   * « on applique un filtre pour un pays et les résultats ne correspondent pas ».
   *
   * On regarde les Telecom du Cameroun, on passe au Burkina : le menu de gauche
   * se mettait à jour, et la liste de droite restait celle du Cameroun. Rien ne
   * le disait — les deux volets affirmaient deux pays différents à la même
   * seconde, et celui qu'on lit est celui qui a tort.
   *
   * ⚠️ TROIS VUES EN DÉPENDENT, et l'app mobile le disait déjà noir sur blanc
   * (`entreprises_tab.dart`, `_appliquePays`) : les types, les entreprises du
   * type ouvert, et la recherche en cours. N'en rafraîchir qu'une laisse les
   * autres afficher le pays précédent.
   *
   * ⚠️ UN SEUL NUMÉRO POUR TOUTE LA SÉQUENCE. En prendre un par requête ferait
   * qu'un changement de pays en cours de route invaliderait ses propres étapes
   * suivantes — c'est le défaut que porte encore la version mobile, corrigé là-bas
   * dans le même lot.
   */
  useEffect(() => {
    const mien = ++demande.current
    void (async () => {
      setEchec(false)

      // 1. Le menu de gauche.
      try {
        const recus = await listerTypes(paysChoisi)
        if (demande.current !== mien) return
        setTypes(recus)
      } catch {
        if (demande.current !== mien) return
        /*
         * ⚠️ LA LISTE EST VIDÉE, PAS CONSERVÉE. Garder celle d'avant sous un
         * nouveau filtre afficherait des données qui ne correspondent ni au
         * filtre demandé ni à ce que dit la base : mieux vaut une erreur visible
         * qu'une liste plausible et fausse.
         */
        setTypes([])
        setEchec(true)
        return
      }

      // 2. Ce que montre le volet droit, s'il montre quelque chose.
      const vue = vueCourante.current
      if (vue.niveau === "types") return

      setListe(null)
      try {
        let recus: Entreprise[]
        if (vue.niveau === "entreprises") {
          recus = await entreprisesDuType(vue.type.id, paysChoisi)
        } else if (vue.parPays) {
          /*
           * La liste venait d'un NOM DE PAYS saisi. Le filtre qu'on vient de
           * changer est le geste le plus récent et le plus délibéré : c'est lui
           * qui gagne. Rejouer la recherche textuelle « Cameroun » ne trouverait
           * rien — aucune entreprise ne porte ce nom — et viderait la liste.
           */
          if (paysChoisi === null) return
          recus = await entreprisesDuPays(paysChoisi)
        } else {
          const q = requeteCourante.current.trim()
          if (q === "") return
          recus = await chercherEntreprises(q, paysChoisi)
        }
        if (demande.current !== mien) return
        setListe(recus)
      } catch {
        if (demande.current !== mien) return
        setListe([])
        setEchec(true)
      }
    })()
  }, [paysChoisi])

  // La liste des pays ne depend ni du type regarde ni du pays courant : une
  // seule fois suffit, et la recharger a chaque changement serait du travail
  // pour rien.
  useEffect(() => {
    void listerPaysDisponibles()
      .then(setPaysDispo)
      .catch(() => setPaysDispo([]))
  }, [])

  const ouvrirType = useCallback(
    async (type: TypeEntreprise) => {
      setListe(null)
      setVoletGauche({ niveau: "entreprises", type })
      setDetail(null)
      const mien = ++demande.current
      try {
        const recus = await entreprisesDuType(type.id, paysChoisi)
        if (demande.current !== mien) return
        setListe(recus)
      } catch {
        if (demande.current !== mien) return
        setListe([])
        setEchec(true)
      }
    },
    [paysChoisi],
  )

  /**
   * La recherche répond à DEUX questions avec un seul champ.
   *
   * 🔴 UN NOM DE PAYS EST RECONNU AVANT TOUT. « Cameroun » veut dire « montre-moi
   * ce qu'il y a là-bas », pas « cherche une entreprise appelée Cameroun ». Le
   * serveur ne peut pas faire cette distinction : il fouille les raisons sociales
   * et les mots-clés, et ne connaît pas les pays de la recherche. L'écran, lui,
   * a déjà la liste des pays pour son filtre — elle ne coûte donc rien à
   * consulter.
   *
   * ⚠️ COMPARAISON SANS ACCENTS NI CASSE. « cameroun » et « Cameroun » désignent
   * le même pays, et personne ne tape les accents dans un champ de recherche.
   * Sans cette normalisation, la reconnaissance ne marcherait que pour qui écrit
   * exactement comme la base.
   *
   * ⚠️ LE PAYS RECONNU DEVIENT LE FILTRE. Sinon l'écran montrerait les
   * entreprises d'un pays tout en affichant un autre dans son menu — deux
   * affirmations contradictoires à la même seconde.
   */
  const lancerRecherche = useCallback(async () => {
    const q = requete.trim()
    if (q === "") return

    /*
     * 🔴 CE CHEMIN ÉCRIVAIT SANS GARDE, ET IL EST LE PLUS EXPOSÉ DES TROIS.
     *
     * 🐛 Signalé par le user le 26/09/2026 : « les résultats qui s'affichent ne
     * correspondent pas exactement ». Trois chemins écrivent dans `liste` —
     * `listerTypes`, `entreprisesDuType` et celui-ci. Les deux premiers prenaient
     * un numéro de demande ; celui-ci écrivait ce qui revenait, quand ça revenait.
     *
     * Or c'est LUI qu'on déclenche en tapant, donc lui qui lance le plus de
     * requêtes concurrentes. Taper « Ban » puis « Banque » lance deux recherches :
     * si la première met plus longtemps, elle écrase la seconde. L'écran affiche
     * alors le résultat d'une requête que l'utilisateur a déjà remplacée — et rien
     * ne le signale, puisque les deux réponses sont valides.
     *
     * ⚠️ IL RACE AUSSI AVEC L'EFFET DU PAYS. Quand la saisie reconnaît un nom de
     * pays, on appelle `setPaysChoisi`, ce qui réveille l'effet qui recharge les
     * types — lequel prend un numéro. Sans numéro ici, les deux écrivaient dans
     * le même état sans arbitre.
     *
     * L'app mobile règle le même problème autrement (`entreprises_tab.dart` :
     * elle compare le texte courant à celui qu'elle a envoyé). Le résultat est
     * équivalent ; on garde le numéro de demande, déjà en place dans ce fichier —
     * deux mécanismes concurrents pour un même but se contrediraient un jour.
     */
    const mien = ++demande.current
    // On retient d'où l'on vient : effacer la saisie y ramène, comme le mobile
    // qui garde le type ouvert SOUS la recherche.
    if (vueCourante.current.niveau !== "recherche") avantRecherche.current = vueCourante.current
    setListe(null)
    setDetail(null)

    const nu =(texte: string) =>
      texte
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim()

    const cherche = nu(q)
    // ⚠️ LE NOM EXACT SEULEMENT, plus le préfixe (02/10/2026). La recherche
    // part désormais pendant la frappe : avec le préfixe, taper « Cam » en
    // route vers « Camtel » basculait le filtre sur le Cameroun au troisième
    // caractère — un changement de pays que personne n'a demandé.
    const paysTrouve = paysDispo.find((p) => nu(p.libelle) === cherche)

    try {
      if (paysTrouve) {
        setVoletGauche({ niveau: "recherche", parPays: true })
        /*
         * 🐛 LE RÉSULTAT SE PERDAIT QUAND LE PAYS CHANGEAIT. Changer de pays
         * réveille l'effet du pays, qui prend un NOUVEAU numéro : la réponse
         * attendue ici revenait périmée et n'était jamais posée. On laisse donc
         * l'effet charger — il sait rejouer une liste `parPays` — et l'on ne
         * charge soi-même que si le pays était déjà le bon.
         */
        if (paysTrouve.idPays !== paysChoisi) {
          setPaysChoisi(paysTrouve.idPays)
          return
        }
        const recus = await entreprisesDuPays(paysTrouve.idPays)
        // ⚠️ APRÈS L'ATTENTE, PAS AVANT : c'est en revenant qu'on peut être
        // périmé. Contrôler en partant ne contrôle rien.
        if (demande.current !== mien) return
        setListe(recus)
        return
      }
      const recus = await chercherEntreprises(q, paysChoisi)
      if (demande.current !== mien) return
      setVoletGauche({ niveau: "recherche", parPays: false })
      setListe(recus)
    } catch {
      // ⚠️ MÊME UN ÉCHEC DOIT SE TAIRE S'IL EST PÉRIMÉ. Sans ce contrôle, une
      // recherche abandonnée qui échoue afficherait « échec » par-dessus les
      // résultats valides de la suivante.
      if (demande.current !== mien) return
      setListe([])
      setEchec(true)
    }
  }, [requete, paysDispo, paysChoisi])

  /*
   * LA RECHERCHE PART PENDANT LA FRAPPE, comme sur le mobile (02/10/2026).
   *
   * Le web attendait Entrée ou le bouton « Rechercher » : on tapait, rien ne
   * bougeait, et rien ne disait qu'il fallait valider.
   *
   * ⚠️ 350 ms DE PAUSE, le même délai que le mobile et que la page Collègues :
   * sans lui, chaque caractère lance une requête dont presque toutes sont
   * périmées à leur arrivée.
   *
   * ⚠️ LA FONCTION PASSE PAR UNE `ref`. Dépendre de `lancerRecherche` relancerait
   * l'effet à chaque changement de PAYS (elle en dépend) — et l'effet du pays
   * rejoue déjà la recherche : deux requêtes pour un seul geste.
   */
  const lancerCourante = useRef(lancerRecherche)
  lancerCourante.current = lancerRecherche
  const ouvrirTypeCourant = useRef(ouvrirType)
  ouvrirTypeCourant.current = ouvrirType
  useEffect(() => {
    if (requete.trim() === "") {
      // Saisie effacée : on revient là d'où la recherche était partie.
      if (vueCourante.current.niveau !== "recherche") return
      const avant = avantRecherche.current ?? { niveau: "types" as const }
      avantRecherche.current = null
      if (avant.niveau === "entreprises") {
        void ouvrirTypeCourant.current(avant.type)
      } else {
        ++demande.current
        setVoletGauche(avant)
        setListe(null)
      }
      return
    }
    const id = window.setTimeout(() => void lancerCourante.current(), 350)
    return () => window.clearTimeout(id)
  }, [requete])

  const ouvrirFiche = useCallback(async (entreprise: Entreprise) => {
    setFiche(null)
    setDetail({ niveau: "fiche", entreprise })
    try {
      setFiche(await ficheEntreprise(entreprise.id))
    } catch {
      setEchec(true)
    }
  }, [])

  /**
   * Appelle un standard par son ALANYA ID.
   *
   * ⚠️ La conversation est obtenue d'abord — c'est elle qui porte l'appel —
   * puis l'appel démarre. Même enchaînement que depuis la page Collègues : le
   * dupliquer autrement ferait diverger les deux.
   */
  const appeler = useCallback(
    async (centre: CentreEntreprise) => {
      if (occupe) return
      setOccupe(true)
      try {
        const conversation = await createPrivateChat(centre.alanyaId)
        await startOutgoingCall(conversation.id, "audio", centre.nom)
      } catch {
        error(t("core_server_unreachable"))
      } finally {
        setOccupe(false)
      }
    },
    [occupe, error, t],
  )

  // ── Rendus ─────────────────────────────────────────────────────────────
  //
  // 🔴 LES CARTES DU MOBILE, une par ligne : pastille ronde à l'icône du genre
  // (type, entreprise, centre), libellé en gras, précision dessous, chevron.
  // Le web affichait des lignes de texte nues — rien ne disait qu'elles
  // s'ouvraient, ni ce qu'elles représentaient (signalé le 02/10/2026).
  const rendreTypes = () => {
    if (echec && types === null) {
      return <p className="s-hint ent-message">{t("core_server_unreachable")}</p>
    }
    if (types === null) {
      return <p className="s-hint ent-message">{t("loading")}</p>
    }
    if (types.length === 0) {
      return <p className="s-hint ent-message">{t("company_no_type")}</p>
    }
    return (
      <ul className="ent-cartes">
        {types.map((ty) => (
          <li key={ty.id}>
            <button type="button" className="ent-carte" onClick={() => void ouvrirType(ty)}>
              <span className="ent-pastille">
                <IconeDomaine />
              </span>
              <span className="ent-carte-texte">
                <span className="ent-carte-titre">{ty.libelle}</span>
                <span className="ent-carte-sous">
                  {/* Le compte est celui du pays retenu — le dire évite de
                      croire à un annuaire mondial tronqué. */}
                  {ty.nbEntreprises === 0
                    ? t("company_count_none")
                    : ty.nbEntreprises === 1
                      ? t("company_count_one")
                      : t("company_count_many", { n: String(ty.nbEntreprises) })}
                </span>
              </span>
              <Chevron />
            </button>
          </li>
        ))}
      </ul>
    )
  }

  const rendreEntreprises = (vide: string) => {
    if (liste === null) {
      return <p className="s-hint ent-message">{t("loading")}</p>
    }
    if (liste.length === 0) {
      return <p className="s-hint ent-message">{vide}</p>
    }
    return (
      <ul className="ent-cartes">
        {liste.map((e) => {
          // « Ville, Pays », comme le mobile : le point médian se lisait comme
          // un séparateur de menu.
          const lieu = [e.ville, e.pays].filter(Boolean).join(", ")
          const ouverte = detail !== null && detail.entreprise.id === e.id
          return (
            <li key={e.id}>
              <button
                type="button"
                className={`ent-carte${ouverte ? " ouverte" : ""}`}
                aria-current={ouverte ? "true" : undefined}
                onClick={() => void ouvrirFiche(e)}
              >
                <span className="ent-pastille">
                  <IconeEntreprise />
                </span>
                <span className="ent-carte-texte">
                  <span className="ent-carte-titre">{e.libelle}</span>
                  {lieu ? <span className="ent-carte-sous">{lieu}</span> : null}
                </span>
                <Chevron />
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  const rendreFiche = (entreprise: Entreprise) => {
    const centres = fiche?.centres ?? []
    const nbAppel = centres.filter((c) => !estVocal(c)).length
    const nbVocal = centres.filter((c) => estVocal(c)).length
    const lieu = [entreprise.ville, entreprise.pays].filter(Boolean).join(", ")

    return (
      // Pas de gouttiere ici : `.ent-detail` la porte deja.
      <div className="ent-fiche">
        {/* L'EN-TÊTE DE LA FICHE : qui elle est, ce qu'elle fait, où elle est.
            LA DESCRIPTION D'ABORD : on ouvre une entreprise pour savoir ce
            qu'elle fait, avant de choisir un standard. */}
        <section className="ent-fiche-tete">
          <span className="ent-pastille ent-pastille-grande">
            <IconeEntreprise />
          </span>
          <div className="ent-fiche-identite">
            <h2>{entreprise.libelle}</h2>
            {entreprise.description ? (
              <p className="ent-fiche-description">{entreprise.description}</p>
            ) : null}
            {entreprise.adresse ? (
              <p className="ent-fiche-ligne">
                <IconeLieu />
                <span>{entreprise.adresse}</span>
              </p>
            ) : null}
            {lieu ? (
              <p className="ent-fiche-ligne">
                <IconeGlobe />
                <span>{lieu}</span>
              </p>
            ) : null}
          </div>
        </section>

        {fiche === null ? (
          <p className="s-hint">{t("loading")}</p>
        ) : (
          /* LES DEUX ENTRÉES S'AFFICHENT MÊME VIDES : une entrée absente
             laisserait croire que le genre de standard n'existe pas. */
          <ul className="ent-cartes">
            {[
              { vocal: false, nombre: nbAppel },
              { vocal: true, nombre: nbVocal },
            ].map(({ vocal, nombre }) => (
              <li key={String(vocal)}>
                <button
                  type="button"
                  className="ent-carte"
                  onClick={() => setDetail({ niveau: "centres", entreprise, vocal })}
                >
                  <span className="ent-pastille">
                    {vocal ? <IconeOnde /> : <IconeCasque />}
                  </span>
                  <span className="ent-carte-texte">
                    <span className="ent-carte-titre">
                      {t(vocal ? "company_vocal_centers" : "company_call_centers")}
                    </span>
                    <span className="ent-carte-sous">
                      {t(vocal ? "company_vocal_center_short" : "company_call_center_short")}
                    </span>
                  </span>
                  {/* Le nombre dans une pastille, éteinte à zéro, comme le
                      mobile : un « 0 » nu se lisait comme une erreur. */}
                  <span className={`ent-compte${nombre === 0 ? " zero" : ""}`}>{nombre}</span>
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const rendreCentres = (vocal: boolean) => {
    const centres = (fiche?.centres ?? []).filter((c) => estVocal(c) === vocal)
    return (
      <div>
        {/* L'EXPLICATION EN TÊTE, dans un encadré, et elle reste même quand la
            liste est vide : c'est elle qui apprend ce qu'est un centre d'appel
            ou un serveur vocal. */}
        <div className="ent-explication">
          {vocal ? <IconeOnde /> : <IconeCasque />}
          <p>{vocal ? t("company_vocal_center_desc") : t("company_call_center_desc")}</p>
        </div>

        {centres.length === 0 ? (
          <p className="s-hint ent-message">{t("company_type_unavailable")}</p>
        ) : (
          <ul className="ent-cartes">
            {centres.map((c) => (
              <li key={c.alanyaId} className="ent-centre">
                <div className="ent-centre-haut">
                  <span className="ent-centre-icone">
                    {vocal ? <IconeOnde /> : <IconeCasque />}
                  </span>
                  <div className="ent-carte-texte">
                    <span className="ent-carte-titre">{c.nom}</span>
                    {/* L'Alanya ID FORMATÉ : c'est le numéro qu'on compose,
                        et c'est sous cette forme qu'il se lit et se recopie. */}
                    <span className="ent-carte-sous">{formatAlanyaNumber(c.alanyaId)}</span>
                  </div>
                </div>

                {c.services.length > 0 ? (
                  <div className="ent-touches">
                    <div className="ent-touches-titre">{t("company_services")}</div>
                    <ul>
                      {c.services.map((s) => (
                        <li key={s.touche}>
                          <span className="ent-touche">{s.touche}</span>
                          {/* « Sans nom » traduit, jamais un libellé fabriqué :
                              « Touche 2 » ressemblerait à un vrai intitulé. */}
                          <span className={s.nom ? undefined : "ent-touche-sans-nom"}>
                            {s.nom ?? t("company_service_unnamed")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="ent-appeler"
                  onClick={() => void appeler(c)}
                  disabled={occupe}
                >
                  <IconeAppel />
                  <span>{t("call")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // ── Les deux en-tetes : chaque volet nomme ce qu'il montre ─────────────
  const titreGauche =
    voletGauche.niveau === "types"
      ? t("companies")
      : voletGauche.niveau === "entreprises"
        ? voletGauche.type.libelle
        : t("company_search_hint")

  const titreDroite =
    detail === null
      ? ""
      : detail.niveau === "fiche"
        ? detail.entreprise.libelle
        : detail.vocal
          ? t("company_vocal_centers")
          : t("company_call_centers")

  /**
   * Retour DANS LE VOLET GAUCHE. D'une recherche, on efface la saisie — l'effet
   * de la recherche ramène alors là d'où elle était partie ; d'une liste
   * d'entreprises, on revient aux types.
   */
  const retourListe = () => {
    setDetail(null)
    if (voletGauche.niveau === "recherche") {
      setRequete("")
      return
    }
    setVoletGauche({ niveau: "types" })
  }

  /**
   * Retour DANS LE VOLET DROIT. Les centres reviennent a leur fiche ; une fiche
   * se referme et rend la main a la liste — sur telephone, c'est ce geste qui
   * ramene au volet gauche.
   */
  const retourDetail = () => {
    if (detail?.niveau === "centres") setDetail({ niveau: "fiche", entreprise: detail.entreprise })
    else setDetail(null)
  }

  const paysAffiche = paysDispo.find((p) => p.idPays === paysChoisi)?.libelle ?? t("company_country_mine")

  return (
    <div className={`ent-page${detail ? " detail-ouvert" : ""}`}>
      {/*
        LE VOLET GAUCHE. Il porte SON en-tete et SA recherche : elles vivaient
        au-dessus de toute la page et s'etendaient sur la largeur de l'ecran
        pour commander une liste large de 360 px.
      */}
      <div className="ent-volet-gauche">
        <header className="ent-head">
          {voletGauche.niveau !== "types" ? (
            <button type="button" className="ent-back" onClick={retourListe} aria-label={t("back")}>
              {/* Une fleche, pas le mot traduit : le libelle changeait la largeur
                  du bouton d'une langue a l'autre et poussait le titre. */}
              <FlecheRetour />
            </button>
          ) : null}
          <h1>{titreGauche}</h1>
        </header>

        {/*
          LA RECHERCHE ET LE FILTRE PAYS SUR UNE MÊME RANGÉE, comme le mobile.

          🐛 LE FILTRE DISPARAISSAIT DÈS QU'ON OUVRAIT UN TYPE (signalé le
          02/10/2026 : « le filtrage pays ne sort pas sur le web »). Il n'était
          rendu qu'au niveau des types et de la recherche — or c'est précisément
          en lisant les entreprises d'un type qu'on veut changer de pays. Il est
          désormais là à tous les niveaux, et l'effet du pays rejoue la liste
          ouverte.
        */}
        <div className="ent-outils">
          <div className="ent-champ">
            <IconeLoupe />
            <input
              type="text"
              value={requete}
              placeholder={t("company_search_hint")}
              aria-label={t("company_search_hint")}
              onChange={(e) => setRequete(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setRequete("")
              }}
            />
            {requete !== "" ? (
              <button
                type="button"
                className="ent-champ-effacer"
                onClick={() => setRequete("")}
                title={t("search_clear")}
                aria-label={t("search_clear")}
              >
                <IconeCroix />
              </button>
            ) : null}
          </div>

          {/* ══════════════ Le filtre par pays ══════════════
              🔴 IL N'Y A PAS D'OPTION « TOUS LES PAYS », et ce n'est pas un
              oubli : le serveur ne connaît pas cette notion. Il n'y a que « le
              mien » — ce qu'il applique quand on ne lui envoie rien — ou
              « celui-ci ».

              ⚠️ UN VRAI `<select>`, HABILLÉ EN PASTILLE. Il est posé, invisible,
              par-dessus la pastille du mobile (globe, pays, flèche) : le clavier,
              le lecteur d'écran et la liste native du téléphone restent ceux du
              navigateur, et l'on n'a pas à réécrire un menu déroulant.

              Absent tant qu'aucun pays n'a d'entreprise : un menu sans entrée
              ne choisit rien. */}
          {paysDispo.length > 0 ? (
            <label className={`ent-pays${paysChoisi !== null ? " actif" : ""}`} title={t("company_country")}>
              <IconeGlobe />
              <span className="ent-pays-nom">{paysAffiche}</span>
              <IconeFlecheBas />
              <select
                value={paysChoisi ?? ""}
                aria-label={t("company_country")}
                onChange={(e) => {
                  const valeur = e.target.value
                  // La fiche ouverte appartenait peut-être à l'ancien pays : on
                  // la referme. La LISTE, elle, est rejouée par l'effet du pays
                  // — on ne la jette plus pour revenir aux types.
                  setDetail(null)
                  setPaysChoisi(valeur === "" ? null : Number(valeur))
                }}
              >
                <option value="">{t("company_country_mine")}</option>
                {paysDispo.map((pays) => (
                  <option key={pays.idPays} value={pays.idPays}>
                    {pays.libelle}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="ent-liste">
          {voletGauche.niveau === "types" && rendreTypes()}
          {voletGauche.niveau === "entreprises" && rendreEntreprises(t("company_none_here"))}
          {voletGauche.niveau === "recherche" && rendreEntreprises(t("company_no_match"))}
        </div>
      </div>

      {/* LE VOLET DROIT. Vide tant que rien n'est choisi — et il le DIT, au lieu
          de laisser une moitie d'ecran blanche. */}
      <div className="ent-volet-droit">
        {detail === null ? (
          <div className="ent-vide">
            <div className="ent-vide-badge" aria-hidden="true">
              <IconeEntreprise />
            </div>
            <div className="ent-vide-titre">{t("companies")}</div>
            <div className="ent-vide-sous">{t("ent_pick_company")}</div>
          </div>
        ) : (
          <>
            <header className="ent-head">
              <button type="button" className="ent-back" onClick={retourDetail} aria-label={t("back")}>
                <FlecheRetour />
              </button>
              <h1>{titreDroite}</h1>
            </header>
            <div className="ent-detail">
              {detail.niveau === "fiche" && rendreFiche(detail.entreprise)}
              {detail.niveau === "centres" && rendreCentres(detail.vocal)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/*
 * ICÔNES DESSINÉES, reprises des icônes Material du mobile — même sens au même
 * endroit : `domain` pour un type, `business` pour une entreprise,
 * `headset_mic` et `graphic_eq` pour les deux genres de standard.
 */
function Svg({ children, epaisseur = 1.8 }: { children: React.ReactNode; epaisseur?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={epaisseur}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

function IconeDomaine() {
  return (
    <Svg>
      <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 9h3a2 2 0 0 1 2 2v10" />
      <path d="M8.5 7h3M8.5 11h3M8.5 15h3M17.5 13v.01M17.5 17v.01" />
    </Svg>
  )
}

function IconeEntreprise() {
  return (
    <Svg>
      <path d="M3 21h18M5 21V7l7-4 7 4v14" />
      <path d="M9 21v-5h6v5M9 9h.01M15 9h.01M9 12.5h.01M15 12.5h.01" />
    </Svg>
  )
}

function IconeCasque() {
  return (
    <Svg>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v5H5a1 1 0 0 1-1-1v-4ZM20 14h-3v5h2a1 1 0 0 0 1-1v-4Z" />
      <path d="M17 19c0 1.1-1.3 2-3 2h-2" />
    </Svg>
  )
}

function IconeOnde() {
  return (
    <Svg epaisseur={2}>
      <path d="M3 12h1M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />
    </Svg>
  )
}

function IconeGlobe() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </Svg>
  )
}

function IconeLieu() {
  return (
    <Svg>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </Svg>
  )
}

function IconeLoupe() {
  return (
    <Svg epaisseur={2}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </Svg>
  )
}

function IconeCroix() {
  return (
    <Svg epaisseur={2.2}>
      <path d="M18 6L6 18M6 6l12 12" />
    </Svg>
  )
}

function IconeFlecheBas() {
  return (
    <Svg epaisseur={2.2}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  )
}

function IconeAppel() {
  return (
    <Svg epaisseur={2}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
    </Svg>
  )
}

function Chevron() {
  return (
    <span className="ent-chevron">
      <Svg epaisseur={2.2}>
        <path d="M9 18l6-6-6-6" />
      </Svg>
    </span>
  )
}

function FlecheRetour() {
  return (
    <Svg epaisseur={2}>
      <path d="M15 18l-6-6 6-6" />
    </Svg>
  )
}
