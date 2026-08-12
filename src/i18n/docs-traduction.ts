import type { LanguageCode } from "./catalogue"
import type { CodeMoteur } from "../services/traduction-fournisseurs"

/**
 * Les fiches « ce que ce moteur fait de vos donnees », une par moteur de
 * traduction, dans les neuf langues.
 *
 * POURQUOI UN MODULE A PART. Ces textes sont des PARAGRAPHES, pas des
 * etiquettes. Cinq fiches de plusieurs paragraphes en neuf langues posees dans
 * `catalogue-web.ts` y ajouteraient plus de volume que les 961 cles existantes
 * n'en occupent, et on ne retrouverait plus une cle d'interface au milieu. Le
 * catalogue garde donc ce qui se lit d'un coup d'oeil ; ce fichier garde ce qui
 * se lit assis.
 *
 * CE QUI N'EST PAS ICI : les quatre QUESTIONS. Elles sont identiques d'une
 * fiche a l'autre et viennent du catalogue (`docs_trad_q_sortie`,
 * `docs_trad_q_destinataire`, `docs_trad_q_duree`, `docs_trad_q_entrainement`),
 * affichees par la visionneuse elle-meme. Un redacteur n'a donc ni a les
 * ecrire, ni a les repeter en tete de sa reponse : la structure les pose.
 *
 * Repli identique a `traduire()` : la langue demandee, puis le francais, puis
 * rien. Une fiche absente ne casse pas la visionneuse, elle affiche
 * `docs_trad_missing`.
 */

/* ------------------------------------------------------------- Structure */

/**
 * Les quatre questions, DANS L'ORDRE OU ELLES SE LISENT. Cet ordre n'est pas
 * arbitraire : il va du plus concret — ce qui sort de l'appareil — au plus
 * lointain — ce qu'on en fait ensuite. La visionneuse parcourt ce tableau ;
 * changer l'ordre ici change l'ordre a l'ecran, et nulle part ailleurs.
 *
 *  1. `sortie`        — qu'est-ce qui quitte votre appareil ?
 *  2. `destinataire`  — qui le recoit ?
 *  3. `duree`         — combien de temps est-ce conserve ?
 *  4. `entrainement`  — cela sert-il a entrainer des modeles ?
 */
export const SECTIONS_FICHE = ["sortie", "destinataire", "duree", "entrainement"] as const

export type SectionFiche = (typeof SECTIONS_FICHE)[number]

/**
 * La couleur de la reponse. Elle ne remplace pas le texte — un daltonien et un
 * lecteur d'ecran doivent comprendre sans elle, et la visionneuse annonce donc
 * le ton en toutes lettres — mais elle permet de balayer une fiche et de voir
 * tout de suite ou est le probleme.
 *
 *  - `sur`        : rien ne sort, ou rien qui vous identifie. Vert.
 *  - `vigilance`  : cela sort, mais dans un cadre annonce et borne. Orange.
 *  - `risque`     : cela sort, et l'usage qui en est fait vous depasse. Rouge.
 *
 * Choisir `sur` par confort est le seul vrai defaut possible dans ce fichier :
 * une fiche rassurante a tort vaut moins que pas de fiche du tout.
 */
export type TonReponse = "sur" | "vigilance" | "risque"

/** La reponse a UNE des quatre questions. */
export interface ReponseFiche {
  /** Voir {@link TonReponse}. Pilote la couleur et l'annonce vocale. */
  ton: TonReponse
  /**
   * La reponse en UNE phrase, lisible seule : c'est la seule ligne que
   * beaucoup liront. Affirmative, sans « il se peut que ». Viser 90 caracteres,
   * ne pas depasser 140 — au-dela elle passe a la ligne et cesse d'etre un
   * verdict. Ne repete PAS la question.
   */
  verdict: string
  /**
   * Le detail, de un a trois paragraphes. Texte brut : ni Markdown, ni HTML,
   * ni lien — chaque entree devient un <p>. Phrases courtes, presque pas de
   * jargon ; « chiffre de bout en bout » se dit, « TLS 1.3 » ne se dit pas.
   * Un tableau vide est licite quand le verdict se suffit.
   */
  paragraphes: string[]
}

/** Une fiche complete, pour un moteur et une langue. */
export interface FicheMoteur {
  /**
   * Deux ou trois phrases en tete, avant les questions : ce qu'est ce moteur,
   * et la chose a retenir si l'on ne lit que ca. C'est un chapeau de presse,
   * pas une introduction — pas de « dans ce document, nous verrons ».
   */
  resume: string
  /**
   * Les quatre reponses. Le type les exige toutes les quatre : une fiche qui
   * repond a trois questions sur quatre laisse croire que la quatrieme est sans
   * objet, et c'est justement la derniere — l'entrainement — qu'on omettrait.
   */
  reponses: Record<SectionFiche, ReponseFiche>
  /**
   * D'ou vient ce qui est ecrit ici : une phrase complete, traduite comme le
   * reste. Par exemple « D'apres les conditions d'utilisation publiees par
   * DeepL. » Pas d'URL : la fiche s'ouvre dans l'application, un lien en
   * sortirait. Optionnel, mais son absence se remarque.
   */
  source?: string
  /**
   * Quand ces informations ont ete verifiees, ecrit comme on le dirait dans la
   * langue de la fiche — « aout 2026 », « August 2026 », « 2026年8月 ». La
   * visionneuse l'entoure de `docs_trad_updated`. Optionnel.
   */
  maj?: string
}

/* --------------------------------------------------------------- Contenu */

/**
 * Les fiches, indexees par moteur puis par langue.
 *
 * ---------------------------------------------------------------------------
 * D'OU VIENNENT CES AFFIRMATIONS
 * ---------------------------------------------------------------------------
 * Chaque phrase de ces fiches a ete relue contre une source publique, verifiee
 * en aout 2026. Les liens vivent ICI, en commentaire, et jamais dans le texte
 * affiche : la fiche s'ouvre dans l'application, un lien en sortirait.
 *
 * Navigateur (API integree)
 *   https://developer.chrome.com/docs/ai/translator-api
 *     — Chrome 138+ et Edge, sur ORDINATEUR uniquement : « These APIs don't
 *       work on mobile devices ». Modele embarque, execution sur l'appareil,
 *       paquets de langue telecharges a la demande.
 *   https://developer.chrome.com/docs/ai/translate-on-device
 *     — Le premier usage d'une langue attend un telechargement qui peut
 *       prendre une a deux minutes.
 *   Le passage par l'anglais des couples sans anglais est deja dit dans le
 *   catalogue (`trad_pairs_note`), constate a l'usage : un couple fr>es
 *   telecharge deux composants.
 *
 * Azure AI Translator
 *   https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/translator/data-privacy-security
 *     — « Translator doesn't retain customer data submitted for text
 *       translation », aucune ecriture en stockage persistant, et pas
 *       d'utilisation pour l'entrainement.
 *   https://azure.microsoft.com/en-us/pricing/details/translator/
 *     — Niveau S1 : 10 $ par million de caracteres.
 *   https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/reference
 *     — Le point d'acces GLOBAL (celui que le relais utilise par defaut) est
 *       traite par le centre de donnees le plus proche, et peut basculer hors
 *       de la geographie en cas de panne. Seuls les points d'acces regionaux
 *       confinent le traitement.
 *
 * Google Cloud Translation
 *   https://cloud.google.com/translate/pricing
 *     — 20 $ par million de CARACTERES, 500 000 caracteres offerts par mois.
 *     — ⚠️ L'unite est le CARACTERE, pas l'octet : un ideogramme chinois et
 *       une lettre cyrillique comptent chacun pour UN, comme une lettre
 *       latine. Espaces et retours a la ligne sont comptes. L'erreur inverse
 *       — facturer au poids en octets — ferait annoncer un cout deux a trois
 *       fois trop eleve aux utilisateurs russes et chinois.
 *   https://docs.cloud.google.com/translate/data-usage
 *     — « Google does not use the content you send to train and improve our
 *       Google Translation features » ; le texte est tenu « briefly
 *       in-memory ». Aucune duree chiffree n'est publiee.
 *
 * DeepL
 *   https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans
 *   https://www.deepl.com/en/pro-license
 *     — API Pro : textes supprimes immediatement apres la traduction, jamais
 *       utilises pour l'entrainement. API Free : la politique de
 *       confidentialite prevoit au contraire un traitement « for a limited
 *       period of time to train and improve our neural networks ».
 *     — ⚠️ Le relais DEDUIT l'offre du suffixe de la cle (« :fx » = gratuite,
 *       voir `hoteDeepl()` cote backend). L'utilisateur ne voit pas laquelle
 *       est installee. La fiche doit donc le dire, et non supposer la Pro.
 *   https://support.deepl.com/hc/en-us/articles/26380849099932-DeepL-infrastructure-and-data-protection
 *     — Traitement sur les serveurs de DeepL en Allemagne et en Islande ;
 *       depuis 2026, une part du traitement des clients professionnels passe
 *       par l'infrastructure d'Amazon Web Services.
 *
 * LibreTranslate
 *   https://github.com/LibreTranslate/LibreTranslate
 *   https://github.com/argosopentech/argos-translate
 *     — Logiciel libre, bati sur Argos Translate, qui « pivote » par une
 *       langue intermediaire — l'anglais — quand le couple demande n'a pas de
 *       modele direct, « at the cost of some loss of translation quality ».
 *       C'est le cas du suedois, du norvegien et du chinois vers la plupart
 *       des autres langues.
 *     — Rien n'est journalise PAR LE LOGICIEL ; ce que fait la machine qui
 *       l'heberge ne depend que de son exploitant. La fiche ne peut donc pas
 *       promettre mieux que « cela depend de qui heberge ».
 *
 * Trajet cote ALANYA, vrai pour les QUATRE moteurs distants et verifie dans le
 * code du relais (`src/app/api/translate/route.ts`, backend) :
 *   — le client n'appelle jamais le fournisseur directement ; il poste sur
 *     `/api/translate`, et c'est le serveur qui detient les cles ;
 *   — le relais garde les traductions dans un cache EN MEMOIRE, jamais en
 *     base, efface a chaque redemarrage ;
 *   — sa journalisation porte sur le volume, le moteur et la langue cible, et
 *     jamais sur le contenu ;
 *   — cote navigateur, les traductions restent dans le cache local jusqu'a ce
 *     que l'utilisateur les efface depuis les Parametres.
 *
 * Le francais fait foi et sert de repli ; les huit autres langues en sont la
 * traduction. Une langue absente retombe sur le francais ; un moteur dont meme
 * le francais manque affiche « pas encore disponible » et vaut aveu.
 */
const FICHES: Record<CodeMoteur, Partial<Record<LanguageCode, FicheMoteur>>> = {
  /* ------------------------------------------------------------ Navigateur */
  navigateur: {
    fr: {
      resume:
        "Votre navigateur traduit lui-même, sur cet appareil. Aucun message ne part vers un serveur, et rien n'est facturé. En échange : seuls Chrome et Edge récents, sur ordinateur, savent le faire ; la première traduction attend le téléchargement d'un modèle de langue ; et la qualité reste en retrait sur les textes longs, techniques ou pleins de sous-entendus.",
      reponses: {
        sortie: {
          ton: "sur",
          verdict:
            "Aucun texte de message. Seul le modèle de langue est téléchargé, une fois par langue.",
          paragraphes: [
            "Le message est traduit à l'intérieur du navigateur, comme un correcteur d'orthographe corrige sans rien envoyer. Le téléchargement du modèle, lui, passe par le réseau : il indique aux serveurs de l'éditeur du navigateur quelle langue vous installez, jamais ce que vous traduisez. Il peut prendre une à deux minutes la première fois, et occupe ensuite de la place sur votre disque.",
          ],
        },
        destinataire: {
          ton: "sur",
          verdict: "Personne. Ni notre serveur, ni un traducteur extérieur ne voit ces messages.",
          paragraphes: [
            "Le mot « personne » est ici littéral : la traduction ne quitte pas la mémoire du navigateur, et notre serveur ignore même que vous avez traduit quelque chose.",
          ],
        },
        duree: {
          ton: "sur",
          verdict:
            "Sur cet appareil seulement, jusqu'à ce que vous effaciez les traductions enregistrées.",
          paragraphes: [
            "Une traduction déjà calculée est gardée sur l'appareil pour s'afficher aussitôt la fois suivante. Les Paramètres permettent de tout effacer ; les modèles de langue installés par le navigateur, eux, se retirent depuis le navigateur.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "Non. Le modèle est figé : il traduit, il n'apprend rien de vos messages.",
          paragraphes: [
            "Il ne change qu'au rythme des mises à jour du navigateur, les mêmes pour tout le monde.",
          ],
        },
      },
      source: "D'après la documentation de l'API de traduction intégrée de Chrome et d'Edge.",
      maj: "août 2026",
    },
    en: {
      resume:
        "Your browser translates on its own, on this device. No message goes to a server, and nothing is billed. In exchange: only recent Chrome and Edge, on desktop computers, can do it; the first translation waits for a language model to download; and quality falls short on long texts, technical wording or anything left unsaid.",
      reponses: {
        sortie: {
          ton: "sur",
          verdict: "No message text. Only the language model is downloaded, once per language.",
          paragraphes: [
            "The message is translated inside the browser, the way a spell checker corrects without sending anything anywhere. The download does travel over the network: it tells the browser maker's servers which language you are installing, never what you translate. It can take a minute or two the first time, and then takes up room on your disk.",
          ],
        },
        destinataire: {
          ton: "sur",
          verdict:
            "Nobody. Neither our server nor an outside translation service sees these messages.",
          paragraphes: [
            "The word “nobody” is literal here: the translation never leaves the browser's memory, and our server does not even know that you translated anything.",
          ],
        },
        duree: {
          ton: "sur",
          verdict: "On this device only, until you clear the saved translations.",
          paragraphes: [
            "A translation that has already been computed stays on the device so it appears instantly next time. Settings can erase all of them; the language models installed by the browser are removed from the browser itself.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "No. The model is fixed: it translates, it learns nothing from your messages.",
          paragraphes: ["It changes only when the browser updates, in the same way for everyone."],
        },
      },
      source: "Based on the documentation of the built-in translation API in Chrome and Edge.",
      maj: "August 2026",
    },
    es: {
      resume:
        "Tu navegador traduce por sí mismo, en este dispositivo. Ningún mensaje sale hacia un servidor y no se factura nada. A cambio: solo Chrome y Edge recientes, en ordenador, saben hacerlo; la primera traducción espera a que se descargue un modelo de idioma; y la calidad se queda corta en textos largos, técnicos o llenos de sobreentendidos.",
      reponses: {
        sortie: {
          ton: "sur",
          verdict:
            "Ningún texto de mensaje. Solo se descarga el modelo de idioma, una vez por idioma.",
          paragraphes: [
            "El mensaje se traduce dentro del navegador, como un corrector ortográfico corrige sin enviar nada. La descarga sí pasa por la red: indica a los servidores del fabricante del navegador qué idioma instalas, nunca qué traduces. Puede tardar uno o dos minutos la primera vez y luego ocupa espacio en tu disco.",
          ],
        },
        destinataire: {
          ton: "sur",
          verdict: "Nadie. Ni nuestro servidor ni un traductor externo ve estos mensajes.",
          paragraphes: [
            "La palabra «nadie» es literal: la traducción no sale de la memoria del navegador, y nuestro servidor ni siquiera sabe que has traducido algo.",
          ],
        },
        duree: {
          ton: "sur",
          verdict: "Solo en este dispositivo, hasta que borres las traducciones guardadas.",
          paragraphes: [
            "Una traducción ya calculada se guarda en el dispositivo para aparecer al instante la próxima vez. Los Ajustes permiten borrarlas todas; los modelos de idioma instalados por el navegador se quitan desde el navegador.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "No. El modelo es fijo: traduce, no aprende nada de tus mensajes.",
          paragraphes: [
            "Solo cambia con las actualizaciones del navegador, iguales para todo el mundo.",
          ],
        },
      },
      source: "Según la documentación de la API de traducción integrada de Chrome y Edge.",
      maj: "agosto de 2026",
    },
    de: {
      resume:
        "Ihr Browser übersetzt selbst, auf diesem Gerät. Keine Nachricht geht an einen Server, und nichts wird berechnet. Dafür gilt: Nur neuere Versionen von Chrome und Edge auf dem Computer können das, die erste Übersetzung wartet auf den Download eines Sprachmodells, und bei langen, fachlichen oder anspielungsreichen Texten bleibt die Qualität zurück.",
      reponses: {
        sortie: {
          ton: "sur",
          verdict: "Kein Nachrichtentext. Nur das Sprachmodell wird geladen, einmal pro Sprache.",
          paragraphes: [
            "Die Nachricht wird im Browser selbst übersetzt, so wie eine Rechtschreibprüfung korrigiert, ohne etwas zu senden. Der Download läuft dagegen über das Netz: Er verrät den Servern des Browserherstellers, welche Sprache Sie installieren, nie, was Sie übersetzen. Beim ersten Mal kann er ein bis zwei Minuten dauern und belegt danach Platz auf Ihrer Festplatte.",
          ],
        },
        destinataire: {
          ton: "sur",
          verdict:
            "Niemand. Weder unser Server noch ein fremder Übersetzungsdienst sieht diese Nachrichten.",
          paragraphes: [
            "Das Wort „niemand“ ist wörtlich gemeint: Die Übersetzung verlässt den Speicher des Browsers nicht, und unser Server erfährt nicht einmal, dass Sie etwas übersetzt haben.",
          ],
        },
        duree: {
          ton: "sur",
          verdict: "Nur auf diesem Gerät, bis Sie die gespeicherten Übersetzungen löschen.",
          paragraphes: [
            "Eine bereits berechnete Übersetzung bleibt auf dem Gerät, damit sie beim nächsten Mal sofort erscheint. In den Einstellungen lässt sich alles löschen; die vom Browser installierten Sprachpakete entfernen Sie im Browser.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Nein. Das Modell ist festgelegt: Es übersetzt, es lernt nichts aus Ihren Nachrichten.",
          paragraphes: [
            "Es ändert sich nur mit den Aktualisierungen des Browsers, für alle gleich.",
          ],
        },
      },
      source: "Nach der Dokumentation der eingebauten Übersetzungs-API von Chrome und Edge.",
      maj: "August 2026",
    },
    pt: {
      resume:
        "O seu navegador traduz sozinho, neste aparelho. Nenhuma mensagem sai para um servidor e nada é cobrado. Em troca: só o Chrome e o Edge recentes, em computador, o sabem fazer; a primeira tradução espera pela transferência de um modelo de língua; e a qualidade fica aquém em textos longos, técnicos ou cheios de subentendidos.",
      reponses: {
        sortie: {
          ton: "sur",
          verdict:
            "Nenhum texto de mensagem. Só o modelo de língua é transferido, uma vez por língua.",
          paragraphes: [
            "A mensagem é traduzida dentro do navegador, como um corretor ortográfico corrige sem enviar nada. A transferência, essa, passa pela rede: indica aos servidores do fabricante do navegador que língua está a instalar, nunca o que traduz. Pode demorar um a dois minutos da primeira vez e ocupa depois espaço no disco.",
          ],
        },
        destinataire: {
          ton: "sur",
          verdict: "Ninguém. Nem o nosso servidor nem um tradutor exterior vê estas mensagens.",
          paragraphes: [
            "A palavra «ninguém» é literal: a tradução não sai da memória do navegador, e o nosso servidor nem sequer sabe que traduziu alguma coisa.",
          ],
        },
        duree: {
          ton: "sur",
          verdict: "Apenas neste aparelho, até apagar as traduções guardadas.",
          paragraphes: [
            "Uma tradução já calculada fica no aparelho para aparecer de imediato da próxima vez. As Definições permitem apagar tudo; os modelos de língua instalados pelo navegador retiram-se a partir do navegador.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "Não. O modelo é fixo: traduz, não aprende nada com as suas mensagens.",
          paragraphes: [
            "Só muda ao ritmo das atualizações do navegador, iguais para toda a gente.",
          ],
        },
      },
      source: "Segundo a documentação da API de tradução integrada do Chrome e do Edge.",
      maj: "agosto de 2026",
    },
    ru: {
      resume:
        "Браузер переводит сам, прямо на этом устройстве. Ни одно сообщение не уходит на сервер, и ничего не оплачивается. Взамен: это умеют только свежие Chrome и Edge на компьютере, первый перевод ждёт загрузки языковой модели, а на длинных, технических текстах и на намёках качество заметно уступает.",
      reponses: {
        sortie: {
          ton: "sur",
          verdict:
            "Текст сообщений — нет. Загружается только языковая модель, по одному разу на язык.",
          paragraphes: [
            "Сообщение переводится внутри браузера — так же, как проверка орфографии исправляет, ничего никуда не отправляя. Сама загрузка модели идёт по сети: она сообщает серверам разработчика браузера, какой язык вы устанавливаете, но никогда — что вы переводите. В первый раз она может занять одну-две минуты, а потом занимает место на диске.",
          ],
        },
        destinataire: {
          ton: "sur",
          verdict: "Никто. Ни наш сервер, ни сторонняя служба перевода этих сообщений не видит.",
          paragraphes: [
            "Слово «никто» здесь буквально: перевод не покидает память браузера, и наш сервер даже не знает, что вы что-то переводили.",
          ],
        },
        duree: {
          ton: "sur",
          verdict: "Только на этом устройстве — пока вы не удалите сохранённые переводы.",
          paragraphes: [
            "Уже посчитанный перевод хранится на устройстве, чтобы в следующий раз появиться мгновенно. В настройках их можно стереть все; языковые модели, установленные браузером, удаляются из самого браузера.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "Нет. Модель неизменна: она переводит и ничему не учится на ваших сообщениях.",
          paragraphes: ["Она меняется только с обновлениями браузера — одинаково для всех."],
        },
      },
      source: "По документации встроенного API перевода в Chrome и Edge.",
      maj: "август 2026 года",
    },
    zh: {
      resume:
        "浏览器在本设备上自行翻译。没有任何消息发往服务器，也不产生费用。代价是：只有较新的桌面版 Chrome 和 Edge 支持；首次翻译需要等待下载语言模型；遇到长文、专业内容或含蓄的表达时，质量明显不如付费引擎。",
      reponses: {
        sortie: {
          ton: "sur",
          verdict: "没有消息文本离开。只有语言模型会被下载，每种语言一次。",
          paragraphes: [
            "消息在浏览器内部完成翻译，就像拼写检查在本地纠错、不向外发送任何内容。下载模型确实要走网络：它告诉浏览器厂商的服务器您在安装哪种语言，而不会透露您翻译了什么。首次下载可能需要一两分钟，之后会占用磁盘空间。",
          ],
        },
        destinataire: {
          ton: "sur",
          verdict: "没有人。我们的服务器和外部翻译服务都看不到这些消息。",
          paragraphes: [
            "这里的「没有人」是字面意思：翻译不会离开浏览器的内存，我们的服务器甚至不知道您做过翻译。",
          ],
        },
        duree: {
          ton: "sur",
          verdict: "只保存在本设备上，直到您清除已保存的翻译。",
          paragraphes: [
            "已经算过的翻译会留在设备上，下次可以立即显示。在设置中可以全部清除；浏览器安装的语言模型则需在浏览器中卸载。",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "不会。模型是固定的：它只翻译，不会从您的消息中学习。",
          paragraphes: ["它只随浏览器更新而变化，对所有人都一样。"],
        },
      },
      source: "依据 Chrome 与 Edge 内置翻译 API 的官方文档。",
      maj: "2026年8月",
    },
    sv: {
      resume:
        "Webbläsaren översätter själv, på den här enheten. Inga meddelanden skickas till någon server och ingenting debiteras. I gengäld: bara nyare Chrome och Edge på dator klarar det, den första översättningen får vänta på att en språkmodell laddas ner, och kvaliteten räcker inte till för långa, tekniska eller anspelande texter.",
      reponses: {
        sortie: {
          ton: "sur",
          verdict: "Ingen meddelandetext. Bara språkmodellen laddas ner, en gång per språk.",
          paragraphes: [
            "Meddelandet översätts inne i webbläsaren, ungefär som en stavningskontroll rättar utan att skicka något. Nedladdningen går däremot över nätet: den berättar för webbläsartillverkarens servrar vilket språk du installerar, aldrig vad du översätter. Första gången kan den ta en till två minuter och tar sedan plats på hårddisken.",
          ],
        },
        destinataire: {
          ton: "sur",
          verdict:
            "Ingen. Varken vår server eller någon utomstående översättningstjänst ser meddelandena.",
          paragraphes: [
            "Ordet ”ingen” är bokstavligt: översättningen lämnar aldrig webbläsarens minne, och vår server vet inte ens att du har översatt något.",
          ],
        },
        duree: {
          ton: "sur",
          verdict: "Bara på den här enheten, tills du rensar de sparade översättningarna.",
          paragraphes: [
            "En redan uträknad översättning ligger kvar på enheten så att den visas direkt nästa gång. I inställningarna kan allt rensas; språkpaketen som webbläsaren har installerat tas bort i webbläsaren.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Nej. Modellen är låst: den översätter, den lär sig ingenting av dina meddelanden.",
          paragraphes: ["Den ändras bara när webbläsaren uppdateras, likadant för alla."],
        },
      },
      source: "Enligt dokumentationen för det inbyggda översättnings-API:et i Chrome och Edge.",
      maj: "augusti 2026",
    },
    no: {
      resume:
        "Nettleseren oversetter selv, på denne enheten. Ingen meldinger går til noen server, og ingenting koster penger. Til gjengjeld: bare nyere Chrome og Edge på datamaskin får det til, den første oversettelsen må vente på at en språkmodell lastes ned, og kvaliteten holder ikke på lange, faglige eller antydende tekster.",
      reponses: {
        sortie: {
          ton: "sur",
          verdict: "Ingen meldingstekst. Bare språkmodellen lastes ned, én gang per språk.",
          paragraphes: [
            "Meldingen oversettes inne i nettleseren, slik en stavekontroll retter uten å sende noe. Nedlastingen går derimot over nettet: den forteller serverne til nettleserprodusenten hvilket språk du installerer, aldri hva du oversetter. Første gang kan den ta ett til to minutter, og den opptar deretter plass på disken.",
          ],
        },
        destinataire: {
          ton: "sur",
          verdict:
            "Ingen. Verken vår server eller en utenforstående oversettelsestjeneste ser meldingene.",
          paragraphes: [
            "Ordet «ingen» er bokstavelig: oversettelsen forlater aldri nettleserens minne, og vår server vet ikke engang at du har oversatt noe.",
          ],
        },
        duree: {
          ton: "sur",
          verdict: "Bare på denne enheten, til du sletter de lagrede oversettelsene.",
          paragraphes: [
            "En oversettelse som allerede er regnet ut, blir liggende på enheten så den vises med én gang neste gang. I innstillingene kan alt slettes; språkpakkene nettleseren har installert, fjernes fra nettleseren.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "Nei. Modellen er låst: den oversetter, den lærer ingenting av meldingene dine.",
          paragraphes: ["Den endrer seg bare når nettleseren oppdateres, likt for alle."],
        },
      },
      source: "Etter dokumentasjonen for det innebygde oversettelses-API-et i Chrome og Edge.",
      maj: "august 2026",
    },
  },

  /* ----------------------------------------------------------------- Azure */
  azure: {
    fr: {
      resume:
        "Azure AI Translator est le service de traduction de Microsoft. Le texte que vous faites traduire quitte l'appareil : il passe par notre serveur, puis par Microsoft. Microsoft annonce n'en garder aucune trace et ne pas s'en servir pour entraîner ses modèles ; c'est un engagement écrit, pas quelque chose que l'on puisse vérifier de l'extérieur.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Le texte des messages sur lesquels vous appuyez sur Traduire, et rien d'autre.",
          paragraphes: [
            "Vos autres messages, vos photos, les noms de vos correspondants et le reste de la conversation ne partent pas avec. Le trajet est chiffré à chaque étape, mais il n'est pas de bout en bout : notre serveur et Microsoft voient le texte en clair, le temps de le traduire.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Notre serveur d'abord, qui relaie la demande, puis Microsoft.",
          paragraphes: [
            "Le passage par notre serveur n'est pas décoratif : c'est lui qui détient la clé du compte Microsoft et qui compte les caractères. Il enregistre le volume, le moteur et la langue demandée, jamais le contenu. Microsoft traite ensuite la demande dans le centre de données le plus proche, qui n'est pas forcément dans votre pays.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Microsoft n'en garde rien. Notre serveur en garde une copie en mémoire, tant qu'il tourne.",
          paragraphes: [
            "Microsoft indique traiter le texte en mémoire et ne l'écrire nulle part. De notre côté, une traduction déjà payée est réutilisée plutôt que rachetée : elle reste en mémoire du serveur, disparaît à son redémarrage et n'est inscrite dans aucune base. Sur votre appareil, elle reste jusqu'à ce que vous effaciez les traductions enregistrées.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Non. Microsoft s'engage à ne pas utiliser ces textes pour entraîner ses modèles.",
          paragraphes: [
            "Cet engagement vaut pour le service payant, celui que nous appelons. Il tient par contrat : de l'extérieur, personne ne peut le vérifier.",
          ],
        },
      },
      source:
        "D'après la documentation de Microsoft sur les données, la confidentialité et la sécurité d'Azure AI Translator.",
      maj: "août 2026",
    },
    en: {
      resume:
        "Azure AI Translator is Microsoft's translation service. The text you ask to translate leaves the device: it goes through our server, then through Microsoft. Microsoft states that it keeps no trace of it and does not use it to train its models; that is a written commitment, not something anyone outside can verify.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "The text of the messages you tap Translate on, and nothing else.",
          paragraphes: [
            "Your other messages, your photos, the names of the people you talk to and the rest of the conversation do not go with it. The trip is encrypted at every step, but it is not end-to-end: our server and Microsoft see the text in the clear, for as long as it takes to translate it.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Our server first, which relays the request, then Microsoft.",
          paragraphes: [
            "Going through our server is not decoration: it holds the key to the Microsoft account and counts the characters. It logs the volume, the engine and the target language, never the content. Microsoft then handles the request in the nearest data centre, which is not necessarily in your country.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Microsoft keeps none of it. Our server keeps a copy in memory, for as long as it runs.",
          paragraphes: [
            "Microsoft states that the text is handled in memory and written nowhere. On our side, a translation already paid for is reused rather than bought twice: it stays in the server's memory, disappears when the server restarts, and is written to no database. On your device it stays until you clear the saved translations.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "No. Microsoft commits to not using these texts to train its models.",
          paragraphes: [
            "That commitment covers the paid service, the one we call. It holds by contract: from the outside, nobody can check it.",
          ],
        },
      },
      source:
        "Based on Microsoft's documentation on data, privacy and security for Azure AI Translator.",
      maj: "August 2026",
    },
    es: {
      resume:
        "Azure AI Translator es el servicio de traducción de Microsoft. El texto que mandas traducir sale del dispositivo: pasa por nuestro servidor y después por Microsoft. Microsoft afirma que no guarda ningún rastro y que no lo usa para entrenar sus modelos; es un compromiso escrito, no algo que se pueda comprobar desde fuera.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "El texto de los mensajes en los que pulsas Traducir, y nada más.",
          paragraphes: [
            "Tus otros mensajes, tus fotos, los nombres de tus contactos y el resto de la conversación no salen con él. El trayecto va cifrado en cada tramo, pero no es de extremo a extremo: nuestro servidor y Microsoft ven el texto en claro el tiempo necesario para traducirlo.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Primero nuestro servidor, que retransmite la petición, y después Microsoft.",
          paragraphes: [
            "El paso por nuestro servidor no es decorativo: es él quien tiene la clave de la cuenta de Microsoft y quien cuenta los caracteres. Registra el volumen, el motor y el idioma pedido, nunca el contenido. Microsoft trata luego la petición en el centro de datos más cercano, que no está necesariamente en tu país.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Microsoft no guarda nada. Nuestro servidor guarda una copia en memoria mientras está en marcha.",
          paragraphes: [
            "Microsoft indica que trata el texto en memoria y no lo escribe en ninguna parte. Por nuestro lado, una traducción ya pagada se reutiliza en vez de volver a comprarse: queda en la memoria del servidor, desaparece al reiniciarlo y no se escribe en ninguna base de datos. En tu dispositivo permanece hasta que borres las traducciones guardadas.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "No. Microsoft se compromete a no usar estos textos para entrenar sus modelos.",
          paragraphes: [
            "Ese compromiso cubre el servicio de pago, que es el que llamamos. Se sostiene por contrato: desde fuera, nadie puede comprobarlo.",
          ],
        },
      },
      source:
        "Según la documentación de Microsoft sobre datos, privacidad y seguridad de Azure AI Translator.",
      maj: "agosto de 2026",
    },
    de: {
      resume:
        "Azure AI Translator ist der Übersetzungsdienst von Microsoft. Der Text, den Sie übersetzen lassen, verlässt das Gerät: Er läuft über unseren Server und dann über Microsoft. Microsoft erklärt, davon nichts aufzubewahren und es nicht für das Training seiner Modelle zu verwenden; das ist eine schriftliche Zusage, nichts, was sich von außen prüfen ließe.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "Der Text der Nachrichten, bei denen Sie auf Übersetzen tippen, und sonst nichts.",
          paragraphes: [
            "Ihre übrigen Nachrichten, Ihre Fotos, die Namen Ihrer Gesprächspartner und der Rest der Unterhaltung gehen nicht mit. Der Weg ist auf jedem Abschnitt verschlüsselt, aber nicht Ende zu Ende: Unser Server und Microsoft sehen den Text im Klartext, solange die Übersetzung dauert.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Zuerst unser Server, der die Anfrage weiterleitet, dann Microsoft.",
          paragraphes: [
            "Der Umweg über unseren Server ist kein Beiwerk: Dort liegt der Schlüssel zum Microsoft-Konto, und dort werden die Zeichen gezählt. Protokolliert werden Menge, Motor und Zielsprache, nie der Inhalt. Microsoft bearbeitet die Anfrage anschließend im nächstgelegenen Rechenzentrum, das nicht zwingend in Ihrem Land steht.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Microsoft behält nichts. Unser Server behält eine Kopie im Speicher, solange er läuft.",
          paragraphes: [
            "Microsoft gibt an, den Text nur im Arbeitsspeicher zu verarbeiten und nirgends zu schreiben. Auf unserer Seite wird eine bereits bezahlte Übersetzung wiederverwendet statt erneut gekauft: Sie bleibt im Speicher des Servers, verschwindet beim Neustart und wird in keine Datenbank geschrieben. Auf Ihrem Gerät bleibt sie, bis Sie die gespeicherten Übersetzungen löschen.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Nein. Microsoft verpflichtet sich, diese Texte nicht zum Training seiner Modelle zu nutzen.",
          paragraphes: [
            "Diese Zusage gilt für den kostenpflichtigen Dienst, den wir aufrufen. Sie gilt vertraglich: Von außen kann das niemand nachprüfen.",
          ],
        },
      },
      source:
        "Nach der Microsoft-Dokumentation zu Daten, Datenschutz und Sicherheit von Azure AI Translator.",
      maj: "August 2026",
    },
    pt: {
      resume:
        "O Azure AI Translator é o serviço de tradução da Microsoft. O texto que manda traduzir sai do aparelho: passa pelo nosso servidor e depois pela Microsoft. A Microsoft afirma não guardar qualquer vestígio e não o usar para treinar os seus modelos; é um compromisso escrito, não algo que se possa verificar de fora.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "O texto das mensagens em que carrega em Traduzir, e mais nada.",
          paragraphes: [
            "As suas outras mensagens, as suas fotografias, os nomes dos seus contactos e o resto da conversa não seguem com ele. O trajeto vai cifrado em cada etapa, mas não é de ponta a ponta: o nosso servidor e a Microsoft veem o texto em claro durante o tempo da tradução.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Primeiro o nosso servidor, que retransmite o pedido, e depois a Microsoft.",
          paragraphes: [
            "A passagem pelo nosso servidor não é decorativa: é ele que detém a chave da conta Microsoft e que conta os carateres. Regista o volume, o motor e a língua pedida, nunca o conteúdo. A Microsoft trata em seguida o pedido no centro de dados mais próximo, que não está forçosamente no seu país.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "A Microsoft não guarda nada. O nosso servidor guarda uma cópia em memória enquanto estiver a funcionar.",
          paragraphes: [
            "A Microsoft indica que trata o texto em memória e não o escreve em lado nenhum. Do nosso lado, uma tradução já paga é reutilizada em vez de ser comprada outra vez: fica na memória do servidor, desaparece quando ele reinicia e não é inscrita em nenhuma base de dados. No seu aparelho, fica até apagar as traduções guardadas.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Não. A Microsoft compromete-se a não usar estes textos para treinar os seus modelos.",
          paragraphes: [
            "Esse compromisso cobre o serviço pago, que é o que chamamos. Vale por contrato: de fora, ninguém o pode verificar.",
          ],
        },
      },
      source:
        "Segundo a documentação da Microsoft sobre dados, privacidade e segurança do Azure AI Translator.",
      maj: "agosto de 2026",
    },
    ru: {
      resume:
        "Azure AI Translator — служба перевода Microsoft. Текст, который вы отправляете на перевод, покидает устройство: он идёт через наш сервер, а затем через Microsoft. Microsoft заявляет, что не сохраняет его и не использует для обучения своих моделей; это письменное обязательство, а не то, что можно проверить со стороны.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Текст тех сообщений, на которых вы нажали «Перевести», и ничего больше.",
          paragraphes: [
            "Остальные сообщения, фотографии, имена собеседников и продолжение переписки с ним не уходят. Путь зашифрован на каждом участке, но это не сквозное шифрование: наш сервер и Microsoft видят текст в открытом виде, пока идёт перевод.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Сначала наш сервер, который передаёт запрос дальше, затем Microsoft.",
          paragraphes: [
            "Проход через наш сервер не для вида: именно он хранит ключ от учётной записи Microsoft и считает символы. В журнал попадают объём, движок и язык перевода — никогда содержание. Дальше Microsoft обрабатывает запрос в ближайшем центре обработки данных, который не обязательно находится в вашей стране.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Microsoft не хранит ничего. Наш сервер держит копию в памяти, пока он работает.",
          paragraphes: [
            "Microsoft указывает, что обрабатывает текст в памяти и никуда его не записывает. С нашей стороны уже оплаченный перевод используется повторно, а не покупается заново: он остаётся в памяти сервера, исчезает при перезапуске и не попадает ни в одну базу данных. На вашем устройстве он хранится, пока вы не удалите сохранённые переводы.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Нет. Microsoft обязуется не использовать эти тексты для обучения своих моделей.",
          paragraphes: [
            "Это обязательство относится к платной службе, которую мы и вызываем. Оно держится на договоре: снаружи проверить его невозможно.",
          ],
        },
      },
      source:
        "По документации Microsoft о данных, конфиденциальности и безопасности Azure AI Translator.",
      maj: "август 2026 года",
    },
    zh: {
      resume:
        "Azure AI Translator 是微软的翻译服务。您要求翻译的文本会离开设备：先经过我们的服务器，再交给微软。微软声明不会留下任何记录，也不会用于训练模型；这是一份书面承诺，外界无法核实。",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "只有您点击「翻译」的那些消息的文本，别无其他。",
          paragraphes: [
            "您的其他消息、照片、联系人姓名以及对话的其余部分都不会一起发送。传输过程每一段都有加密，但并非端到端：在完成翻译之前，我们的服务器和微软都能看到明文。",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "先是我们的服务器转发请求，然后才是微软。",
          paragraphes: [
            "经过我们的服务器不是摆设：微软账号的密钥保存在那里，字符也在那里计数。日志只记录用量、所选引擎和目标语言，绝不记录内容。随后微软会在最近的数据中心处理请求，而该数据中心未必位于您所在的国家。",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict: "微软不保留。我们的服务器在运行期间会在内存中保留一份副本。",
          paragraphes: [
            "微软表示文本仅在内存中处理，不写入任何存储。在我们这边，已经付费的翻译会被复用而不是重复购买：它留在服务器内存中，服务器重启即消失，不写入任何数据库。在您的设备上，它会一直保留，直到您清除已保存的翻译。",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "不会。微软承诺不将这些文本用于训练其模型。",
          paragraphes: ["该承诺适用于我们调用的付费服务。它靠合同约束：从外部无人能够核实。"],
        },
      },
      source: "依据微软关于 Azure AI Translator 数据、隐私与安全的官方文档。",
      maj: "2026年8月",
    },
    sv: {
      resume:
        "Azure AI Translator är Microsofts översättningstjänst. Texten du låter översätta lämnar enheten: den går via vår server och sedan via Microsoft. Microsoft uppger att ingenting sparas och att texten inte används för att träna deras modeller; det är ett skriftligt åtagande, inget som går att kontrollera utifrån.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Texten i de meddelanden du trycker Översätt på, och ingenting annat.",
          paragraphes: [
            "Dina övriga meddelanden, dina bilder, namnen på dem du skriver med och resten av konversationen följer inte med. Färden är krypterad i varje led, men inte från ände till ände: vår server och Microsoft ser texten i klartext så länge översättningen pågår.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Först vår server, som skickar begäran vidare, sedan Microsoft.",
          paragraphes: [
            "Vägen via vår server är inte utsmyckning: det är där nyckeln till Microsoft-kontot finns och där tecknen räknas. Loggen noterar volym, motor och målspråk, aldrig innehållet. Microsoft behandlar sedan begäran i närmaste datacenter, som inte nödvändigtvis ligger i ditt land.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Microsoft sparar ingenting. Vår server håller en kopia i minnet så länge den är igång.",
          paragraphes: [
            "Microsoft uppger att texten hanteras i minnet och inte skrivs någonstans. Hos oss återanvänds en redan betald översättning i stället för att köpas igen: den ligger i serverns minne, försvinner när servern startas om och skrivs inte till någon databas. På din enhet ligger den kvar tills du rensar de sparade översättningarna.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "Nej. Microsoft åtar sig att inte använda texterna för att träna sina modeller.",
          paragraphes: [
            "Åtagandet gäller den betalda tjänsten, den vi anropar. Det håller genom avtal: utifrån kan ingen kontrollera det.",
          ],
        },
      },
      source:
        "Enligt Microsofts dokumentation om data, integritet och säkerhet för Azure AI Translator.",
      maj: "augusti 2026",
    },
    no: {
      resume:
        "Azure AI Translator er Microsofts oversettelsestjeneste. Teksten du får oversatt, forlater enheten: den går via vår server og deretter via Microsoft. Microsoft oppgir at ingenting tas vare på, og at teksten ikke brukes til å trene modellene deres; det er en skriftlig forpliktelse, ikke noe som kan kontrolleres utenfra.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Teksten i de meldingene du trykker Oversett på, og ingenting annet.",
          paragraphes: [
            "De andre meldingene dine, bildene dine, navnene på dem du skriver med og resten av samtalen følger ikke med. Turen er kryptert i hvert ledd, men ikke ende til ende: vår server og Microsoft ser teksten i klartekst så lenge oversettelsen pågår.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Først vår server, som sender forespørselen videre, deretter Microsoft.",
          paragraphes: [
            "Veien om vår server er ikke pynt: det er der nøkkelen til Microsoft-kontoen ligger, og der tegnene telles. Loggen noterer mengde, motor og målspråk, aldri innholdet. Microsoft behandler deretter forespørselen i nærmeste datasenter, som ikke nødvendigvis ligger i landet ditt.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Microsoft beholder ingenting. Vår server beholder en kopi i minnet så lenge den kjører.",
          paragraphes: [
            "Microsoft oppgir at teksten behandles i minnet og ikke skrives noe sted. Hos oss gjenbrukes en allerede betalt oversettelse i stedet for å kjøpes på nytt: den ligger i serverens minne, forsvinner når serveren starter på nytt, og skrives ikke til noen database. På enheten din blir den liggende til du sletter de lagrede oversettelsene.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Nei. Microsoft forplikter seg til ikke å bruke disse tekstene til å trene modellene sine.",
          paragraphes: [
            "Forpliktelsen gjelder den betalte tjenesten, den vi kaller. Den holder gjennom avtale: utenfra kan ingen etterprøve den.",
          ],
        },
      },
      source:
        "Etter Microsofts dokumentasjon om data, personvern og sikkerhet for Azure AI Translator.",
      maj: "august 2026",
    },
  },

  /* ---------------------------------------------------------------- Google */
  google: {
    fr: {
      resume:
        "Google Cloud Translation est le service payant de Google, à ne pas confondre avec le traducteur gratuit ouvert dans un navigateur. Le texte que vous faites traduire quitte l'appareil : il passe par notre serveur, puis par Google. Google déclare ne pas le conserver et ne pas s'en servir pour améliorer ses traducteurs.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "Le texte des messages traduits. Il est compté au caractère, quel que soit l'alphabet.",
          paragraphes: [
            "Un caractère est un caractère : une lettre accentuée, une lettre cyrillique et un idéogramme chinois comptent chacun pour un, exactement comme une lettre latine. Les espaces et les retours à la ligne comptent aussi. Un message écrit en russe ou en chinois ne coûte donc pas plus cher qu'un message français de même longueur.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Notre serveur d'abord, qui relaie la demande, puis Google.",
          paragraphes: [
            "Notre serveur détient la clé du compte Google et compte les caractères ; il enregistre le volume, le moteur et la langue demandée, jamais le contenu. Google traite ensuite le texte dans ses centres de données, qui peuvent se trouver hors de votre pays. Le trajet est chiffré à chaque étape sans être de bout en bout : notre serveur et Google voient le texte en clair.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict: "Google dit ne garder le texte qu'en mémoire, le temps de la traduction.",
          paragraphes: [
            "Sa documentation ne donne ni durée chiffrée, ni détail sur ses journaux techniques : c'est une déclaration, pas une garantie mesurable. Chez nous, la traduction reste en mémoire du serveur jusqu'à son redémarrage, et sur votre appareil jusqu'à ce que vous effaciez les traductions enregistrées.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Non. Google déclare ne pas utiliser ce que vous envoyez pour améliorer ses traducteurs.",
          paragraphes: [
            "Cette règle vaut pour le service payant appelé ici. Elle ne dit rien du traducteur gratuit de Google, ouvert dans un navigateur, qui suit d'autres conditions.",
          ],
        },
      },
      source:
        "D'après la documentation de Google sur l'usage des données de Cloud Translation et sa grille tarifaire.",
      maj: "août 2026",
    },
    en: {
      resume:
        "Google Cloud Translation is Google's paid service, not to be confused with the free translator you open in a browser. The text you ask to translate leaves the device: it goes through our server, then through Google. Google states that it does not keep it and does not use it to improve its translation products.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "The text of the translated messages. It is counted per character, whatever the alphabet.",
          paragraphes: [
            "A character is a character: an accented letter, a Cyrillic letter and a Chinese ideogram each count as one, exactly like a Latin letter. Spaces and line breaks count too. A message written in Russian or Chinese therefore costs no more than a French message of the same length.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Our server first, which relays the request, then Google.",
          paragraphes: [
            "Our server holds the key to the Google account and counts the characters; it logs the volume, the engine and the target language, never the content. Google then handles the text in its data centres, which may sit outside your country. The trip is encrypted at every step without being end-to-end: our server and Google see the text in the clear.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Google says the text is held in memory only, for as long as the translation takes.",
          paragraphes: [
            "Its documentation gives no figure for that duration and no detail about technical logs: it is a statement, not a measurable guarantee. On our side, the translation stays in the server's memory until it restarts, and on your device until you clear the saved translations.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "No. Google states it does not use what you send to improve its translation features.",
          paragraphes: [
            "That rule covers the paid service called here. It says nothing about Google's free translator, opened in a browser, which follows different terms.",
          ],
        },
      },
      source:
        "Based on Google's data usage documentation for Cloud Translation and its pricing page.",
      maj: "August 2026",
    },
    es: {
      resume:
        "Google Cloud Translation es el servicio de pago de Google, que no debe confundirse con el traductor gratuito que se abre en un navegador. El texto que mandas traducir sale del dispositivo: pasa por nuestro servidor y después por Google. Google declara que no lo conserva y que no lo usa para mejorar sus traductores.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "El texto de los mensajes traducidos. Se cuenta por carácter, sea cual sea el alfabeto.",
          paragraphes: [
            "Un carácter es un carácter: una letra acentuada, una letra cirílica y un ideograma chino cuentan cada uno como uno, igual que una letra latina. Los espacios y los saltos de línea también cuentan. Un mensaje escrito en ruso o en chino no cuesta, por tanto, más que un mensaje español de la misma longitud.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Primero nuestro servidor, que retransmite la petición, y después Google.",
          paragraphes: [
            "Nuestro servidor tiene la clave de la cuenta de Google y cuenta los caracteres; registra el volumen, el motor y el idioma pedido, nunca el contenido. Google trata luego el texto en sus centros de datos, que pueden estar fuera de tu país. El trayecto va cifrado en cada tramo sin ser de extremo a extremo: nuestro servidor y Google ven el texto en claro.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Google dice guardar el texto solo en memoria, el tiempo que dura la traducción.",
          paragraphes: [
            "Su documentación no da ninguna duración concreta ni detalle sobre sus registros técnicos: es una declaración, no una garantía medible. Por nuestro lado, la traducción queda en la memoria del servidor hasta que se reinicia, y en tu dispositivo hasta que borres las traducciones guardadas.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "No. Google declara que no usa lo que envías para mejorar sus traductores.",
          paragraphes: [
            "Esa regla cubre el servicio de pago que se llama aquí. No dice nada del traductor gratuito de Google, abierto en un navegador, que sigue otras condiciones.",
          ],
        },
      },
      source:
        "Según la documentación de Google sobre el uso de datos de Cloud Translation y su tarifa pública.",
      maj: "agosto de 2026",
    },
    de: {
      resume:
        "Google Cloud Translation ist der kostenpflichtige Dienst von Google, nicht zu verwechseln mit dem kostenlosen Übersetzer im Browser. Der Text, den Sie übersetzen lassen, verlässt das Gerät: Er läuft über unseren Server und dann über Google. Google erklärt, ihn nicht aufzubewahren und ihn nicht zur Verbesserung seiner Übersetzer zu verwenden.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "Der Text der übersetzten Nachrichten. Abgerechnet wird pro Zeichen, unabhängig vom Alphabet.",
          paragraphes: [
            "Ein Zeichen ist ein Zeichen: Ein Umlaut, ein kyrillischer Buchstabe und ein chinesisches Schriftzeichen zählen jeweils als eines, genau wie ein lateinischer Buchstabe. Leerzeichen und Zeilenumbrüche zählen ebenfalls. Eine Nachricht auf Russisch oder Chinesisch kostet also nicht mehr als eine gleich lange deutsche Nachricht.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Zuerst unser Server, der die Anfrage weiterleitet, dann Google.",
          paragraphes: [
            "Unser Server hält den Schlüssel zum Google-Konto und zählt die Zeichen; protokolliert werden Menge, Motor und Zielsprache, nie der Inhalt. Google verarbeitet den Text anschließend in seinen Rechenzentren, die außerhalb Ihres Landes liegen können. Der Weg ist auf jedem Abschnitt verschlüsselt, aber nicht Ende zu Ende: Unser Server und Google sehen den Klartext.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Google gibt an, den Text nur im Arbeitsspeicher zu halten, solange die Übersetzung dauert.",
          paragraphes: [
            "Die Dokumentation nennt weder eine Dauer noch Einzelheiten zu technischen Protokollen: Das ist eine Aussage, keine messbare Garantie. Bei uns bleibt die Übersetzung bis zum Neustart im Speicher des Servers und auf Ihrem Gerät, bis Sie die gespeicherten Übersetzungen löschen.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Nein. Google erklärt, das Gesendete nicht zur Verbesserung seiner Übersetzer zu nutzen.",
          paragraphes: [
            "Diese Regel gilt für den hier aufgerufenen kostenpflichtigen Dienst. Über den kostenlosen Google-Übersetzer im Browser, für den andere Bedingungen gelten, sagt sie nichts.",
          ],
        },
      },
      source:
        "Nach der Google-Dokumentation zur Datennutzung von Cloud Translation und der öffentlichen Preisliste.",
      maj: "August 2026",
    },
    pt: {
      resume:
        "O Google Cloud Translation é o serviço pago da Google, que não deve ser confundido com o tradutor gratuito aberto num navegador. O texto que manda traduzir sai do aparelho: passa pelo nosso servidor e depois pela Google. A Google declara não o conservar e não o usar para melhorar os seus tradutores.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "O texto das mensagens traduzidas. É contado ao carater, seja qual for o alfabeto.",
          paragraphes: [
            "Um carater é um carater: uma letra acentuada, uma letra cirílica e um ideograma chinês contam cada um como um, tal como uma letra latina. Os espaços e as mudanças de linha também contam. Uma mensagem escrita em russo ou em chinês não custa, portanto, mais do que uma mensagem portuguesa do mesmo comprimento.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Primeiro o nosso servidor, que retransmite o pedido, e depois a Google.",
          paragraphes: [
            "O nosso servidor detém a chave da conta Google e conta os carateres; regista o volume, o motor e a língua pedida, nunca o conteúdo. A Google trata em seguida o texto nos seus centros de dados, que podem situar-se fora do seu país. O trajeto vai cifrado em cada etapa sem ser de ponta a ponta: o nosso servidor e a Google veem o texto em claro.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict: "A Google diz guardar o texto apenas em memória, o tempo que a tradução demora.",
          paragraphes: [
            "A sua documentação não dá qualquer duração concreta nem detalhes sobre os registos técnicos: é uma declaração, não uma garantia mensurável. Do nosso lado, a tradução fica na memória do servidor até ele reiniciar, e no seu aparelho até apagar as traduções guardadas.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "Não. A Google declara não usar o que envia para melhorar os seus tradutores.",
          paragraphes: [
            "Essa regra cobre o serviço pago aqui chamado. Nada diz sobre o tradutor gratuito da Google, aberto num navegador, que segue outras condições.",
          ],
        },
      },
      source:
        "Segundo a documentação da Google sobre a utilização de dados do Cloud Translation e a sua tabela de preços.",
      maj: "agosto de 2026",
    },
    ru: {
      resume:
        "Google Cloud Translation — платная служба Google, которую не следует путать с бесплатным переводчиком в браузере. Текст, который вы отправляете на перевод, покидает устройство: он идёт через наш сервер, а затем через Google. Google заявляет, что не хранит его и не использует для улучшения своих переводчиков.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Текст переведённых сообщений. Счёт идёт по символам, независимо от алфавита.",
          paragraphes: [
            "Символ есть символ: буква с диакритикой, буква кириллицы и китайский иероглиф считаются каждый за один — ровно как латинская буква. Пробелы и переводы строки тоже считаются. Сообщение на русском или китайском обходится не дороже французского той же длины.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Сначала наш сервер, который передаёт запрос дальше, затем Google.",
          paragraphes: [
            "Наш сервер хранит ключ от учётной записи Google и считает символы; в журнал попадают объём, движок и язык перевода, но никогда содержание. Дальше Google обрабатывает текст в своих центрах обработки данных, которые могут находиться за пределами вашей страны. Путь зашифрован на каждом участке, но не сквозным шифрованием: наш сервер и Google видят открытый текст.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict: "Google говорит, что держит текст только в памяти — пока идёт перевод.",
          paragraphes: [
            "В документации нет ни срока в цифрах, ни подробностей о технических журналах: это заявление, а не измеримая гарантия. У нас перевод остаётся в памяти сервера до его перезапуска, а на вашем устройстве — пока вы не удалите сохранённые переводы.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Нет. Google заявляет, что не использует отправленное для улучшения своих переводчиков.",
          paragraphes: [
            "Это правило относится к платной службе, которую мы вызываем. Оно ничего не говорит о бесплатном переводчике Google в браузере — там действуют другие условия.",
          ],
        },
      },
      source:
        "По документации Google об использовании данных Cloud Translation и её публичному прейскуранту.",
      maj: "август 2026 года",
    },
    zh: {
      resume:
        "Google Cloud Translation 是谷歌的付费服务，不同于在浏览器中打开的免费翻译。您要求翻译的文本会离开设备：先经过我们的服务器，再交给谷歌。谷歌声明不会保存这些文本，也不会用它们改进自己的翻译产品。",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "被翻译消息的文本。按字符计费，与使用哪种文字无关。",
          paragraphes: [
            "一个字符就是一个字符：带重音的字母、西里尔字母和汉字都各算一个，与拉丁字母完全相同。空格和换行同样计入。因此，同样长度的俄语或中文消息，费用并不高于法语消息。",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "先是我们的服务器转发请求，然后才是谷歌。",
          paragraphes: [
            "我们的服务器持有谷歌账号的密钥并统计字符；日志只记录用量、所选引擎和目标语言，绝不记录内容。随后谷歌在其数据中心处理文本，这些数据中心可能不在您所在的国家。传输每一段都有加密，但并非端到端：我们的服务器和谷歌都能看到明文。",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict: "谷歌称文本只在内存中停留，仅限翻译所需的时间。",
          paragraphes: [
            "其文档既未给出具体时长，也未说明技术日志的情况：这是一项声明，而非可衡量的保证。在我们这边，翻译留在服务器内存中直到重启，在您的设备上则保留到您清除已保存的翻译为止。",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "不会。谷歌声明不会用您发送的内容改进其翻译产品。",
          paragraphes: [
            "该规则适用于这里调用的付费服务。它并未涉及在浏览器中打开的谷歌免费翻译，后者适用另一套条款。",
          ],
        },
      },
      source: "依据谷歌关于 Cloud Translation 数据使用的文档及其公开价目表。",
      maj: "2026年8月",
    },
    sv: {
      resume:
        "Google Cloud Translation är Googles betaltjänst, som inte ska förväxlas med den gratis översättaren man öppnar i en webbläsare. Texten du låter översätta lämnar enheten: den går via vår server och sedan via Google. Google uppger att texten inte sparas och inte används för att förbättra deras översättningstjänster.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Texten i de översatta meddelandena. Den räknas per tecken, oavsett alfabet.",
          paragraphes: [
            "Ett tecken är ett tecken: en bokstav med accent, en kyrillisk bokstav och ett kinesiskt skrivtecken räknas var för sig som ett, precis som en latinsk bokstav. Mellanslag och radbrytningar räknas också. Ett meddelande på ryska eller kinesiska kostar alltså inte mer än ett lika långt meddelande på svenska.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Först vår server, som skickar begäran vidare, sedan Google.",
          paragraphes: [
            "Vår server har nyckeln till Google-kontot och räknar tecknen; loggen noterar volym, motor och målspråk, aldrig innehållet. Google behandlar sedan texten i sina datacenter, som kan ligga utanför ditt land. Färden är krypterad i varje led utan att vara från ände till ände: vår server och Google ser texten i klartext.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict: "Google säger sig hålla texten enbart i minnet, så länge översättningen pågår.",
          paragraphes: [
            "Dokumentationen anger varken någon tid i siffror eller något om tekniska loggar: det är ett påstående, inte en mätbar garanti. Hos oss ligger översättningen i serverns minne tills den startas om, och på din enhet tills du rensar de sparade översättningarna.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Nej. Google uppger att det du skickar inte används för att förbättra deras översättare.",
          paragraphes: [
            "Regeln gäller den betaltjänst som anropas här. Den säger ingenting om Googles gratis översättare i webbläsaren, som lyder under andra villkor.",
          ],
        },
      },
      source:
        "Enligt Googles dokumentation om dataanvändning i Cloud Translation och deras prislista.",
      maj: "augusti 2026",
    },
    no: {
      resume:
        "Google Cloud Translation er Googles betalte tjeneste, som ikke må forveksles med den gratis oversetteren man åpner i en nettleser. Teksten du får oversatt, forlater enheten: den går via vår server og deretter via Google. Google oppgir at teksten ikke tas vare på og ikke brukes til å forbedre oversettertjenestene deres.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Teksten i de oversatte meldingene. Den telles per tegn, uansett alfabet.",
          paragraphes: [
            "Et tegn er et tegn: en bokstav med aksent, en kyrillisk bokstav og et kinesisk skrifttegn teller ett hver, akkurat som en latinsk bokstav. Mellomrom og linjeskift teller også. En melding på russisk eller kinesisk koster derfor ikke mer enn en like lang melding på norsk.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Først vår server, som sender forespørselen videre, deretter Google.",
          paragraphes: [
            "Vår server har nøkkelen til Google-kontoen og teller tegnene; loggen noterer mengde, motor og målspråk, aldri innholdet. Google behandler deretter teksten i sine datasentre, som kan ligge utenfor landet ditt. Turen er kryptert i hvert ledd uten å være ende til ende: vår server og Google ser teksten i klartekst.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict: "Google sier teksten bare holdes i minnet, så lenge oversettelsen varer.",
          paragraphes: [
            "Dokumentasjonen oppgir verken noen varighet i tall eller noe om tekniske logger: det er en påstand, ikke en målbar garanti. Hos oss ligger oversettelsen i serverens minne til den startes på nytt, og på enheten din til du sletter de lagrede oversettelsene.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Nei. Google oppgir at det du sender, ikke brukes til å forbedre oversetterne deres.",
          paragraphes: [
            "Regelen gjelder den betalte tjenesten som kalles her. Den sier ingenting om Googles gratis oversetter i nettleseren, som følger andre vilkår.",
          ],
        },
      },
      source:
        "Etter Googles dokumentasjon om databruk i Cloud Translation og den offentlige prislisten.",
      maj: "august 2026",
    },
  },

  /* ----------------------------------------------------------------- DeepL */
  deepl: {
    fr: {
      resume:
        "DeepL est le plus cher des moteurs proposés, et souvent le meilleur sur les langues européennes. Le texte que vous faites traduire quitte l'appareil : il passe par notre serveur, puis par DeepL. Le point à connaître : DeepL ne traite pas de la même façon ses clés payantes et ses clés gratuites, et rien dans l'application ne vous dit laquelle notre serveur utilise.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Le texte des messages sur lesquels vous appuyez sur Traduire, et rien d'autre.",
          paragraphes: [
            "Vos autres messages, vos médias et le reste de la conversation ne partent pas. Le trajet est chiffré à chaque étape sans être de bout en bout : notre serveur et DeepL voient le texte en clair.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict:
            "Notre serveur d'abord, qui relaie la demande, puis DeepL, entreprise allemande.",
          paragraphes: [
            "DeepL traite les textes sur ses propres serveurs, en Allemagne et en Islande. Depuis 2026, une partie du traitement de ses clients professionnels s'appuie aussi sur l'infrastructure d'Amazon Web Services.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Avec une clé payante, effacé aussitôt après la traduction. Avec une clé gratuite, gardé un temps.",
          paragraphes: [
            "L'offre payante annonce une suppression immédiate. L'offre gratuite prévoit au contraire une conservation limitée dans le temps, au bénéfice du service. Notre serveur, lui, garde la traduction en mémoire jusqu'à son redémarrage, et votre appareil jusqu'à ce que vous effaciez les traductions enregistrées.",
          ],
        },
        entrainement: {
          ton: "risque",
          verdict:
            "Avec une clé payante, non. Avec une clé gratuite, oui — et vous ne voyez pas laquelle sert.",
          paragraphes: [
            "DeepL réserve à son offre gratuite le droit d'utiliser les textes reçus pour entraîner et améliorer ses réseaux de neurones ; l'offre payante l'exclut. La distinction se joue sur la clé installée sur notre serveur, hors de votre vue et de votre contrôle.",
            "Tant que cette information ne vous est pas montrée, traitez ce moteur comme si vos messages pouvaient servir à l'entraînement.",
          ],
        },
      },
      source:
        "D'après les conditions de DeepL et son centre d'aide, sur les offres d'API, l'infrastructure et la protection des données.",
      maj: "août 2026",
    },
    en: {
      resume:
        "DeepL is the most expensive engine on offer, and often the best on European languages. The text you ask to translate leaves the device: it goes through our server, then through DeepL. The thing to know: DeepL does not treat its paid keys and its free keys the same way, and nothing in the app tells you which one our server uses.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "The text of the messages you tap Translate on, and nothing else.",
          paragraphes: [
            "Your other messages, your media and the rest of the conversation do not go with it. The trip is encrypted at every step without being end-to-end: our server and DeepL see the text in the clear.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Our server first, which relays the request, then DeepL, a German company.",
          paragraphes: [
            "DeepL processes texts on its own servers, in Germany and Iceland. Since 2026, part of the processing for its business customers also runs on Amazon Web Services infrastructure.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "With a paid key, deleted right after translation. With a free key, kept for a while.",
          paragraphes: [
            "The paid plan promises immediate deletion. The free plan, on the contrary, provides for retention for a limited period, for the benefit of the service. Our own server keeps the translation in memory until it restarts, and your device keeps it until you clear the saved translations.",
          ],
        },
        entrainement: {
          ton: "risque",
          verdict:
            "With a paid key, no. With a free key, yes — and you cannot see which one is in use.",
          paragraphes: [
            "DeepL reserves for its free plan the right to use received texts to train and improve its neural networks; the paid plan rules it out. The difference comes down to the key installed on our server, out of your sight and out of your control.",
            "Until that information is shown to you, treat this engine as if your messages could be used for training.",
          ],
        },
      },
      source:
        "Based on DeepL's terms and help centre, on API plans, infrastructure and data protection.",
      maj: "August 2026",
    },
    es: {
      resume:
        "DeepL es el motor más caro de los ofrecidos, y a menudo el mejor en lenguas europeas. El texto que mandas traducir sale del dispositivo: pasa por nuestro servidor y después por DeepL. Lo que conviene saber: DeepL no trata igual sus claves de pago y sus claves gratuitas, y nada en la aplicación te dice cuál usa nuestro servidor.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "El texto de los mensajes en los que pulsas Traducir, y nada más.",
          paragraphes: [
            "Tus otros mensajes, tus archivos y el resto de la conversación no salen. El trayecto va cifrado en cada tramo sin ser de extremo a extremo: nuestro servidor y DeepL ven el texto en claro.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict:
            "Primero nuestro servidor, que retransmite la petición, y después DeepL, empresa alemana.",
          paragraphes: [
            "DeepL trata los textos en sus propios servidores, en Alemania e Islandia. Desde 2026, parte del tratamiento de sus clientes profesionales se apoya además en la infraestructura de Amazon Web Services.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Con una clave de pago, se borra justo después de traducir. Con una clave gratuita, se guarda un tiempo.",
          paragraphes: [
            "El plan de pago anuncia un borrado inmediato. El plan gratuito prevé, al contrario, una conservación limitada en el tiempo, en beneficio del servicio. Nuestro servidor guarda la traducción en memoria hasta que se reinicia, y tu dispositivo hasta que borres las traducciones guardadas.",
          ],
        },
        entrainement: {
          ton: "risque",
          verdict:
            "Con una clave de pago, no. Con una clave gratuita, sí, y no ves cuál se está usando.",
          paragraphes: [
            "DeepL reserva a su plan gratuito el derecho a usar los textos recibidos para entrenar y mejorar sus redes neuronales; el plan de pago lo excluye. La diferencia se juega en la clave instalada en nuestro servidor, fuera de tu vista y de tu control.",
            "Mientras no se te muestre esa información, trata este motor como si tus mensajes pudieran servir para el entrenamiento.",
          ],
        },
      },
      source:
        "Según las condiciones y el centro de ayuda de DeepL, sobre los planes de API, la infraestructura y la protección de datos.",
      maj: "agosto de 2026",
    },
    de: {
      resume:
        "DeepL ist der teuerste der angebotenen Motoren und bei europäischen Sprachen oft der beste. Der Text, den Sie übersetzen lassen, verlässt das Gerät: Er läuft über unseren Server und dann über DeepL. Wichtig zu wissen: DeepL behandelt kostenpflichtige und kostenlose Schlüssel unterschiedlich, und nichts in der App verrät Ihnen, welchen unser Server verwendet.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "Der Text der Nachrichten, bei denen Sie auf Übersetzen tippen, und sonst nichts.",
          paragraphes: [
            "Ihre übrigen Nachrichten, Ihre Medien und der Rest der Unterhaltung gehen nicht mit. Der Weg ist auf jedem Abschnitt verschlüsselt, aber nicht Ende zu Ende: Unser Server und DeepL sehen den Klartext.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict:
            "Zuerst unser Server, der die Anfrage weiterleitet, dann DeepL, ein deutsches Unternehmen.",
          paragraphes: [
            "DeepL verarbeitet Texte auf eigenen Servern in Deutschland und Island. Seit 2026 läuft ein Teil der Verarbeitung für Geschäftskunden zusätzlich über die Infrastruktur von Amazon Web Services.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Mit kostenpflichtigem Schlüssel sofort nach der Übersetzung gelöscht, mit kostenlosem eine Zeit lang behalten.",
          paragraphes: [
            "Der kostenpflichtige Tarif verspricht sofortige Löschung. Der kostenlose Tarif sieht dagegen eine zeitlich begrenzte Aufbewahrung zugunsten des Dienstes vor. Unser Server hält die Übersetzung bis zum Neustart im Speicher, Ihr Gerät bis Sie die gespeicherten Übersetzungen löschen.",
          ],
        },
        entrainement: {
          ton: "risque",
          verdict:
            "Mit kostenpflichtigem Schlüssel nein, mit kostenlosem ja — und Sie sehen nicht, welcher genutzt wird.",
          paragraphes: [
            "DeepL behält sich im kostenlosen Tarif das Recht vor, empfangene Texte zum Trainieren und Verbessern seiner neuronalen Netze zu verwenden; der kostenpflichtige Tarif schließt das aus. Entscheidend ist der Schlüssel auf unserem Server, den Sie weder sehen noch beeinflussen können.",
            "Solange Ihnen diese Angabe nicht gezeigt wird, behandeln Sie diesen Motor so, als könnten Ihre Nachrichten ins Training fließen.",
          ],
        },
      },
      source:
        "Nach den Bedingungen und dem Hilfecenter von DeepL zu API-Tarifen, Infrastruktur und Datenschutz.",
      maj: "August 2026",
    },
    pt: {
      resume:
        "O DeepL é o mais caro dos motores propostos e, muitas vezes, o melhor nas línguas europeias. O texto que manda traduzir sai do aparelho: passa pelo nosso servidor e depois pelo DeepL. O ponto a reter: o DeepL não trata da mesma maneira as chaves pagas e as chaves gratuitas, e nada na aplicação lhe diz qual delas o nosso servidor utiliza.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "O texto das mensagens em que carrega em Traduzir, e mais nada.",
          paragraphes: [
            "As suas outras mensagens, os seus ficheiros e o resto da conversa não seguem. O trajeto vai cifrado em cada etapa sem ser de ponta a ponta: o nosso servidor e o DeepL veem o texto em claro.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict:
            "Primeiro o nosso servidor, que retransmite o pedido, e depois o DeepL, empresa alemã.",
          paragraphes: [
            "O DeepL trata os textos nos seus próprios servidores, na Alemanha e na Islândia. Desde 2026, uma parte do tratamento dos seus clientes profissionais apoia-se também na infraestrutura da Amazon Web Services.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Com uma chave paga, é apagado logo após a tradução. Com uma chave gratuita, fica guardado algum tempo.",
          paragraphes: [
            "O plano pago anuncia uma eliminação imediata. O plano gratuito prevê, pelo contrário, uma conservação limitada no tempo, em benefício do serviço. O nosso servidor guarda a tradução em memória até reiniciar, e o seu aparelho até apagar as traduções guardadas.",
          ],
        },
        entrainement: {
          ton: "risque",
          verdict:
            "Com uma chave paga, não. Com uma chave gratuita, sim — e não vê qual está a ser usada.",
          paragraphes: [
            "O DeepL reserva ao plano gratuito o direito de usar os textos recebidos para treinar e melhorar as suas redes neuronais; o plano pago exclui-o. A diferença joga-se na chave instalada no nosso servidor, fora da sua vista e do seu controlo.",
            "Enquanto essa informação não lhe for mostrada, trate este motor como se as suas mensagens pudessem servir para treino.",
          ],
        },
      },
      source:
        "Segundo as condições e o centro de ajuda do DeepL, sobre os planos de API, a infraestrutura e a proteção de dados.",
      maj: "agosto de 2026",
    },
    ru: {
      resume:
        "DeepL — самый дорогой из предлагаемых движков и часто лучший на европейских языках. Текст, который вы отправляете на перевод, покидает устройство: он идёт через наш сервер, а затем через DeepL. Главное, что нужно знать: DeepL по-разному обходится с платными и бесплатными ключами, и приложение не показывает, какой ключ стоит на нашем сервере.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Текст тех сообщений, на которых вы нажали «Перевести», и ничего больше.",
          paragraphes: [
            "Остальные сообщения, вложения и продолжение переписки не уходят. Путь зашифрован на каждом участке, но это не сквозное шифрование: наш сервер и DeepL видят открытый текст.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict:
            "Сначала наш сервер, который передаёт запрос дальше, затем DeepL — немецкая компания.",
          paragraphes: [
            "DeepL обрабатывает тексты на собственных серверах в Германии и Исландии. С 2026 года часть обработки для корпоративных клиентов идёт также на инфраструктуре Amazon Web Services.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "С платным ключом текст стирается сразу после перевода. С бесплатным — какое-то время хранится.",
          paragraphes: [
            "Платный тариф обещает немедленное удаление. Бесплатный, напротив, допускает хранение в течение ограниченного времени в интересах сервиса. Наш сервер держит перевод в памяти до перезапуска, а ваше устройство — пока вы не удалите сохранённые переводы.",
          ],
        },
        entrainement: {
          ton: "risque",
          verdict:
            "С платным ключом — нет. С бесплатным — да, и вы не видите, какой из них используется.",
          paragraphes: [
            "Право использовать полученные тексты для обучения и улучшения своих нейросетей DeepL оставляет за бесплатным тарифом; платный это исключает. Всё решает ключ, установленный на нашем сервере, — вне вашего поля зрения и вашего контроля.",
            "Пока эти сведения вам не показаны, считайте, что ваши сообщения могут пойти на обучение.",
          ],
        },
      },
      source:
        "По условиям DeepL и его справочному центру — о тарифах API, инфраструктуре и защите данных.",
      maj: "август 2026 года",
    },
    zh: {
      resume:
        "DeepL 是所提供引擎中最贵的一个，在欧洲语言上往往也最好。您要求翻译的文本会离开设备：先经过我们的服务器，再交给 DeepL。需要知道的一点是：DeepL 对付费密钥和免费密钥的处理并不相同，而应用里没有任何地方告诉您我们的服务器用的是哪一种。",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "只有您点击「翻译」的那些消息的文本，别无其他。",
          paragraphes: [
            "您的其他消息、媒体文件以及对话的其余部分都不会发送。传输每一段都有加密，但并非端到端：我们的服务器和 DeepL 都能看到明文。",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "先是我们的服务器转发请求，然后才是德国公司 DeepL。",
          paragraphes: [
            "DeepL 在其位于德国和冰岛的自有服务器上处理文本。自 2026 年起，面向企业客户的部分处理也运行在亚马逊云科技（AWS）的基础设施上。",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict: "使用付费密钥时，翻译完成后立即删除；使用免费密钥时，会保留一段时间。",
          paragraphes: [
            "付费方案承诺立即删除。免费方案则相反，允许在有限时间内保留，用于改进服务。我们的服务器把翻译保留在内存中直到重启，您的设备则保留到您清除已保存的翻译为止。",
          ],
        },
        entrainement: {
          ton: "risque",
          verdict: "付费密钥不会，免费密钥会——而您看不到当前用的是哪一种。",
          paragraphes: [
            "DeepL 把「使用所收到的文本来训练和改进神经网络」这项权利留给了免费方案，付费方案则明确排除。差别取决于装在我们服务器上的那把密钥，您既看不到也管不到。",
            "在这项信息向您公开之前，请把这个引擎当作您的消息可能被用于训练来对待。",
          ],
        },
      },
      source: "依据 DeepL 的条款及帮助中心中关于 API 方案、基础设施与数据保护的说明。",
      maj: "2026年8月",
    },
    sv: {
      resume:
        "DeepL är den dyraste av motorerna och ofta den bästa på europeiska språk. Texten du låter översätta lämnar enheten: den går via vår server och sedan via DeepL. Det du bör veta: DeepL behandlar betalda och gratis nycklar olika, och ingenting i appen visar vilken vår server använder.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Texten i de meddelanden du trycker Översätt på, och ingenting annat.",
          paragraphes: [
            "Dina övriga meddelanden, dina filer och resten av konversationen följer inte med. Färden är krypterad i varje led utan att vara från ände till ände: vår server och DeepL ser texten i klartext.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Först vår server, som skickar begäran vidare, sedan DeepL, ett tyskt företag.",
          paragraphes: [
            "DeepL behandlar texter på egna servrar i Tyskland och på Island. Sedan 2026 sker en del av behandlingen för företagskunder även på Amazon Web Services infrastruktur.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Med en betald nyckel raderas texten direkt efter översättningen. Med en gratisnyckel sparas den en tid.",
          paragraphes: [
            "Den betalda planen utlovar omedelbar radering. Gratisplanen medger tvärtom lagring under begränsad tid, till tjänstens fördel. Vår egen server håller översättningen i minnet tills den startas om, och din enhet tills du rensar de sparade översättningarna.",
          ],
        },
        entrainement: {
          ton: "risque",
          verdict:
            "Med en betald nyckel nej. Med en gratisnyckel ja — och du ser inte vilken som används.",
          paragraphes: [
            "DeepL förbehåller gratisplanen rätten att använda mottagna texter för att träna och förbättra sina neurala nätverk; den betalda planen utesluter det. Skillnaden avgörs av nyckeln på vår server, utom synhåll och utom din kontroll.",
            "Så länge den uppgiften inte visas för dig, behandla den här motorn som om dina meddelanden kan användas till träning.",
          ],
        },
      },
      source: "Enligt DeepLs villkor och hjälpcenter om API-planer, infrastruktur och dataskydd.",
      maj: "augusti 2026",
    },
    no: {
      resume:
        "DeepL er den dyreste av motorene og ofte den beste på europeiske språk. Teksten du får oversatt, forlater enheten: den går via vår server og deretter via DeepL. Det du bør vite: DeepL behandler betalte og gratis nøkler ulikt, og ingenting i appen viser hvilken vår server bruker.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "Teksten i de meldingene du trykker Oversett på, og ingenting annet.",
          paragraphes: [
            "De andre meldingene dine, filene dine og resten av samtalen følger ikke med. Turen er kryptert i hvert ledd uten å være ende til ende: vår server og DeepL ser teksten i klartekst.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict:
            "Først vår server, som sender forespørselen videre, deretter DeepL, et tysk selskap.",
          paragraphes: [
            "DeepL behandler tekster på egne servere i Tyskland og på Island. Siden 2026 går en del av behandlingen for bedriftskunder også på infrastrukturen til Amazon Web Services.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Med en betalt nøkkel slettes teksten straks etter oversettelsen. Med en gratisnøkkel lagres den en tid.",
          paragraphes: [
            "Den betalte planen lover umiddelbar sletting. Gratisplanen åpner tvert imot for lagring i en begrenset periode, til tjenestens fordel. Vår egen server holder oversettelsen i minnet til den startes på nytt, og enheten din til du sletter de lagrede oversettelsene.",
          ],
        },
        entrainement: {
          ton: "risque",
          verdict:
            "Med en betalt nøkkel nei. Med en gratisnøkkel ja — og du ser ikke hvilken som brukes.",
          paragraphes: [
            "DeepL forbeholder gratisplanen retten til å bruke mottatte tekster til å trene og forbedre sine nevrale nett; den betalte planen utelukker det. Forskjellen avgjøres av nøkkelen på vår server, utenfor ditt syn og din kontroll.",
            "Så lenge den opplysningen ikke vises for deg, behandle denne motoren som om meldingene dine kan bli brukt til trening.",
          ],
        },
      },
      source:
        "Etter DeepLs vilkår og hjelpesenter om API-planer, infrastruktur og databeskyttelse.",
      maj: "august 2026",
    },
  },

  /* -------------------------------------------------------- LibreTranslate */
  libretranslate: {
    fr: {
      resume:
        "LibreTranslate est un logiciel libre de traduction, installé sur un serveur plutôt qu'acheté à un fournisseur. Aucune entreprise de traduction n'entre donc dans la boucle : tout dépend de qui héberge l'instance appelée. La qualité est en retrait, surtout en suédois, en norvégien et en chinois, qui passent par l'anglais avant d'arriver à destination.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "Le texte des messages traduits. Il quitte l'appareil, même si aucun géant ne le reçoit.",
          paragraphes: [
            "Gratuit ne veut pas dire local : le calcul se fait sur un serveur, pas sur votre appareil. Un couple de langues sans anglais est traduit en deux temps, vers l'anglais puis vers la langue voulue, et chaque passage abîme un peu le sens — les tournures idiomatiques y survivent mal.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Notre serveur, puis l'instance LibreTranslate qu'il utilise.",
          paragraphes: [
            "Si cette instance est la nôtre, personne d'autre ne voit le texte. Si l'exploitant du service a désigné une instance publique tenue par un tiers, ce tiers voit passer les messages — et l'application ne fait pas la différence entre les deux cas.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Le logiciel n'enregistre rien de lui-même. La machine qui l'héberge, elle, peut tout enregistrer.",
          paragraphes: [
            "La promesse de LibreTranslate porte sur le programme, pas sur le serveur : un exploitant peut activer des journaux, et rien dans la réponse ne le montrerait. Chez nous, la traduction reste en mémoire du serveur jusqu'à son redémarrage, et sur votre appareil jusqu'à ce que vous effaciez les traductions enregistrées.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Non. Les modèles sont installés une fois pour toutes et n'apprennent pas de vos textes.",
          paragraphes: [],
        },
      },
      source:
        "D'après la documentation de LibreTranslate et d'Argos Translate, le moteur qu'il utilise.",
      maj: "août 2026",
    },
    en: {
      resume:
        "LibreTranslate is free translation software, installed on a server rather than bought from a vendor. No translation company is therefore in the loop: everything depends on who hosts the instance being called. Quality is behind the paid engines, especially for Swedish, Norwegian and Chinese, which pass through English on their way.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "The text of the translated messages. It leaves the device, even if no giant receives it.",
          paragraphes: [
            "Free does not mean local: the work happens on a server, not on your device. A language pair without English is translated in two steps, into English and then into the language you want, and each step wears the meaning down a little — idioms rarely survive it.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Our server, then whichever LibreTranslate instance it uses.",
          paragraphes: [
            "If that instance is ours, nobody else sees the text. If whoever runs the service has pointed it at a public instance held by a third party, that third party sees the messages go by — and the app cannot tell the two cases apart.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "The software records nothing by itself. The machine hosting it can record everything.",
          paragraphes: [
            "LibreTranslate's promise covers the program, not the server: an operator can turn logging on, and nothing in the reply would show it. On our side, the translation stays in the server's memory until it restarts, and on your device until you clear the saved translations.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "No. The models are installed once and for all and learn nothing from your texts.",
          paragraphes: [],
        },
      },
      source:
        "Based on the documentation of LibreTranslate and of Argos Translate, the engine it uses.",
      maj: "August 2026",
    },
    es: {
      resume:
        "LibreTranslate es un programa libre de traducción, instalado en un servidor en vez de comprado a un proveedor. Ninguna empresa de traducción entra, pues, en el circuito: todo depende de quién aloje la instancia que se llama. La calidad se queda atrás, sobre todo en sueco, noruego y chino, que pasan por el inglés antes de llegar a destino.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "El texto de los mensajes traducidos. Sale del dispositivo, aunque no lo reciba ningún gigante.",
          paragraphes: [
            "Gratuito no quiere decir local: el cálculo se hace en un servidor, no en tu dispositivo. Un par de idiomas sin inglés se traduce en dos tiempos, hacia el inglés y luego hacia el idioma deseado, y cada paso desgasta un poco el sentido: las expresiones hechas rara vez sobreviven.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Nuestro servidor y, después, la instancia de LibreTranslate que utilice.",
          paragraphes: [
            "Si esa instancia es la nuestra, nadie más ve el texto. Si quien explota el servicio ha señalado una instancia pública en manos de un tercero, ese tercero ve pasar los mensajes, y la aplicación no distingue entre ambos casos.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "El programa no registra nada por sí mismo. La máquina que lo aloja puede registrarlo todo.",
          paragraphes: [
            "La promesa de LibreTranslate cubre el programa, no el servidor: quien lo explota puede activar registros, y nada en la respuesta lo mostraría. Por nuestro lado, la traducción queda en la memoria del servidor hasta que se reinicia, y en tu dispositivo hasta que borres las traducciones guardadas.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "No. Los modelos se instalan de una vez y no aprenden nada de tus textos.",
          paragraphes: [],
        },
      },
      source:
        "Según la documentación de LibreTranslate y de Argos Translate, el motor que utiliza.",
      maj: "agosto de 2026",
    },
    de: {
      resume:
        "LibreTranslate ist freie Übersetzungssoftware, die auf einem Server installiert und nicht bei einem Anbieter gekauft wird. Kein Übersetzungsunternehmen ist also im Spiel: Alles hängt davon ab, wer die aufgerufene Instanz betreibt. Die Qualität liegt zurück, vor allem bei Schwedisch, Norwegisch und Chinesisch, die den Umweg über das Englische nehmen.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "Der Text der übersetzten Nachrichten. Er verlässt das Gerät, auch wenn kein Konzern ihn erhält.",
          paragraphes: [
            "Kostenlos heißt nicht lokal: Gerechnet wird auf einem Server, nicht auf Ihrem Gerät. Ein Sprachpaar ohne Englisch wird in zwei Schritten übersetzt, erst ins Englische, dann in die Zielsprache, und jeder Schritt kostet ein wenig Sinn — Redewendungen überleben ihn selten.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Unser Server und danach die LibreTranslate-Instanz, die er verwendet.",
          paragraphes: [
            "Ist diese Instanz unsere eigene, sieht niemand sonst den Text. Hat der Betreiber des Dienstes dagegen eine öffentliche Instanz eines Dritten eingetragen, sieht dieser Dritte die Nachrichten vorbeiziehen — und die App kann beide Fälle nicht unterscheiden.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Die Software selbst zeichnet nichts auf. Die Maschine, auf der sie läuft, kann alles aufzeichnen.",
          paragraphes: [
            "Das Versprechen von LibreTranslate gilt dem Programm, nicht dem Server: Ein Betreiber kann Protokolle einschalten, und die Antwort verriete davon nichts. Bei uns bleibt die Übersetzung bis zum Neustart im Speicher des Servers und auf Ihrem Gerät, bis Sie die gespeicherten Übersetzungen löschen.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Nein. Die Modelle werden einmal installiert und lernen nichts aus Ihren Texten.",
          paragraphes: [],
        },
      },
      source:
        "Nach der Dokumentation von LibreTranslate und von Argos Translate, der darin genutzten Übersetzungs-Engine.",
      maj: "August 2026",
    },
    pt: {
      resume:
        "O LibreTranslate é um programa livre de tradução, instalado num servidor em vez de comprado a um fornecedor. Nenhuma empresa de tradução entra, portanto, no circuito: tudo depende de quem aloja a instância chamada. A qualidade fica atrás, sobretudo em sueco, norueguês e chinês, que passam pelo inglês antes de chegar ao destino.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "O texto das mensagens traduzidas. Sai do aparelho, mesmo que nenhum gigante o receba.",
          paragraphes: [
            "Gratuito não quer dizer local: o cálculo faz-se num servidor, não no seu aparelho. Um par de línguas sem inglês é traduzido em dois tempos, para inglês e depois para a língua pretendida, e cada passagem gasta um pouco o sentido — as expressões idiomáticas raramente sobrevivem.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "O nosso servidor e, depois, a instância LibreTranslate que ele utiliza.",
          paragraphes: [
            "Se essa instância for a nossa, mais ninguém vê o texto. Se quem explora o serviço apontou para uma instância pública mantida por um terceiro, esse terceiro vê passar as mensagens — e a aplicação não distingue os dois casos.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict: "O programa não regista nada por si. A máquina que o aloja pode registar tudo.",
          paragraphes: [
            "A promessa do LibreTranslate cobre o programa, não o servidor: quem o explora pode ativar registos, e nada na resposta o mostraria. Do nosso lado, a tradução fica na memória do servidor até ele reiniciar, e no seu aparelho até apagar as traduções guardadas.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Não. Os modelos são instalados de uma vez e não aprendem nada com os seus textos.",
          paragraphes: [],
        },
      },
      source: "Segundo a documentação do LibreTranslate e do Argos Translate, o motor que utiliza.",
      maj: "agosto de 2026",
    },
    ru: {
      resume:
        "LibreTranslate — свободная программа перевода, которую ставят на сервер, а не покупают у поставщика. Поэтому в цепочке нет ни одной переводческой компании: всё зависит от того, кто держит вызываемый экземпляр. Качество уступает платным движкам, особенно на шведском, норвежском и китайском, которые идут через английский.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "Текст переведённых сообщений. Он покидает устройство, пусть его и не получает ни один гигант.",
          paragraphes: [
            "Бесплатно не значит локально: расчёт идёт на сервере, а не на вашем устройстве. Пара языков без английского переводится в два приёма — сначала на английский, затем на нужный язык, — и каждый переход немного стирает смысл: идиомы этого почти не переживают.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Наш сервер, а затем тот экземпляр LibreTranslate, который он использует.",
          paragraphes: [
            "Если этот экземпляр наш, текста не видит больше никто. Если же оператор службы указал публичный экземпляр, который держит третья сторона, эта сторона видит проходящие сообщения — и приложение не отличает один случай от другого.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Сама программа ничего не записывает. Машина, на которой она стоит, может записывать всё.",
          paragraphes: [
            "Обещание LibreTranslate относится к программе, а не к серверу: оператор может включить журналы, и в ответе этого не будет видно. У нас перевод остаётся в памяти сервера до перезапуска, а на вашем устройстве — пока вы не удалите сохранённые переводы.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "Нет. Модели ставятся раз и навсегда и ничему не учатся на ваших текстах.",
          paragraphes: [],
        },
      },
      source: "По документации LibreTranslate и Argos Translate — движка, который в нём работает.",
      maj: "август 2026 года",
    },
    zh: {
      resume:
        "LibreTranslate 是一款自由的翻译软件，安装在服务器上，而不是向供应商购买。因此链条里没有任何翻译公司：一切取决于谁托管被调用的实例。质量不及付费引擎，尤其是瑞典语、挪威语和中文，它们要先经过英语再到目标语言。",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict: "被翻译消息的文本。它仍然离开设备，即便接收方不是哪家巨头。",
          paragraphes: [
            "免费不等于本地：运算发生在服务器上，而不是在您的设备上。不含英语的语言组合要分两步翻译，先译成英语，再译成目标语言，每一步都会磨损一点原意——习惯用语很难完整保留。",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "我们的服务器，以及它所使用的那个 LibreTranslate 实例。",
          paragraphes: [
            "如果该实例是我们自己的，就没有其他人看到文本。如果服务运营方指向了由第三方维护的公共实例，那么该第三方就会看到这些消息经过——而应用无法区分这两种情况。",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict: "软件本身不做任何记录。托管它的那台机器却可以记录一切。",
          paragraphes: [
            "LibreTranslate 的承诺针对程序，而不是服务器：运营者可以打开日志，而返回结果里看不出任何迹象。在我们这边，翻译留在服务器内存中直到重启，在您的设备上则保留到您清除已保存的翻译为止。",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict: "不会。模型一次性安装完成，不会从您的文本中学习。",
          paragraphes: [],
        },
      },
      source: "依据 LibreTranslate 及其所用引擎 Argos Translate 的官方文档。",
      maj: "2026年8月",
    },
    sv: {
      resume:
        "LibreTranslate är fri översättningsprogramvara som installeras på en server i stället för att köpas av en leverantör. Inget översättningsföretag är alltså inblandat: allt hänger på vem som driver den instans som anropas. Kvaliteten ligger efter, särskilt för svenska, norska och kinesiska, som går via engelskan på vägen.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "Texten i de översatta meddelandena. Den lämnar enheten, även om ingen jätte tar emot den.",
          paragraphes: [
            "Gratis betyder inte lokalt: beräkningen sker på en server, inte på din enhet. Ett språkpar utan engelska översätts i två steg, först till engelska och sedan till önskat språk, och varje steg nöter bort lite av innebörden — idiom klarar sig sällan.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Vår server, och därefter den LibreTranslate-instans som den använder.",
          paragraphes: [
            "Är instansen vår egen ser ingen annan texten. Har den som driver tjänsten i stället pekat ut en offentlig instans hos tredje part, ser den parten meddelandena passera — och appen skiljer inte de två fallen åt.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Programvaran registrerar ingenting av sig själv. Maskinen som kör den kan registrera allt.",
          paragraphes: [
            "LibreTranslates löfte gäller programmet, inte servern: den som driver den kan slå på loggning, och svaret skulle inte avslöja något. Hos oss ligger översättningen i serverns minne tills den startas om, och på din enhet tills du rensar de sparade översättningarna.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Nej. Modellerna installeras en gång för alla och lär sig ingenting av dina texter.",
          paragraphes: [],
        },
      },
      source:
        "Enligt dokumentationen för LibreTranslate och för Argos Translate, motorn den bygger på.",
      maj: "augusti 2026",
    },
    no: {
      resume:
        "LibreTranslate er fri oversettelsesprogramvare som installeres på en server i stedet for å kjøpes av en leverandør. Ingen oversettelsesbedrift er dermed inne i bildet: alt avhenger av hvem som drifter instansen som kalles. Kvaliteten ligger etter, særlig for svensk, norsk og kinesisk, som går veien om engelsk.",
      reponses: {
        sortie: {
          ton: "vigilance",
          verdict:
            "Teksten i de oversatte meldingene. Den forlater enheten, selv om ingen gigant mottar den.",
          paragraphes: [
            "Gratis betyr ikke lokalt: regnestykket skjer på en server, ikke på enheten din. Et språkpar uten engelsk oversettes i to trinn, først til engelsk og så til ønsket språk, og hvert trinn sliter litt på meningen — faste uttrykk overlever sjelden.",
          ],
        },
        destinataire: {
          ton: "vigilance",
          verdict: "Vår server, og deretter den LibreTranslate-instansen den bruker.",
          paragraphes: [
            "Er instansen vår egen, ser ingen andre teksten. Har den som drifter tjenesten i stedet pekt på en offentlig instans hos en tredjepart, ser denne parten meldingene passere — og appen skiller ikke de to tilfellene fra hverandre.",
          ],
        },
        duree: {
          ton: "vigilance",
          verdict:
            "Programvaren registrerer ingenting av seg selv. Maskinen som kjører den, kan registrere alt.",
          paragraphes: [
            "Løftet fra LibreTranslate gjelder programmet, ikke serveren: den som drifter den, kan slå på logging, og svaret ville ikke røpe noe. Hos oss ligger oversettelsen i serverens minne til den startes på nytt, og på enheten din til du sletter de lagrede oversettelsene.",
          ],
        },
        entrainement: {
          ton: "sur",
          verdict:
            "Nei. Modellene installeres én gang for alle og lærer ingenting av tekstene dine.",
          paragraphes: [],
        },
      },
      source:
        "Etter dokumentasjonen for LibreTranslate og for Argos Translate, motoren den bygger på.",
      maj: "august 2026",
    },
  },
}

/* ----------------------------------------------------------------- Lecture */

/** Langue de repli, la meme que celle du catalogue. */
const REPLI: LanguageCode = "fr"

/**
 * La fiche d'un moteur dans la langue demandee, a defaut en francais, a defaut
 * `null` — a la visionneuse alors de le dire, pas de faire semblant.
 */
export function ficheMoteur(moteur: CodeMoteur, langue: LanguageCode): FicheMoteur | null {
  const parLangue = FICHES[moteur]
  return parLangue?.[langue] ?? parLangue?.[REPLI] ?? null
}
