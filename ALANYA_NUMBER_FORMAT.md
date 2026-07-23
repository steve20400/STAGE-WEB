# Format des numéros Alanya

Le format est centralisé dans `src/lib/alanya-number.ts`. Il est utilisé uniquement dans les champs et affichages de **numéro Alanya** ; il ne s'applique pas au texte de discussion, aux messages, ni aux numéros téléphoniques ordinaires.

| Chiffres saisis | Affichage |
|---:|---|
| 1 à 3 | `123` |
| 4 | `12 34` |
| 5 | `12 34 5` |
| 6 | `123 456` |
| 7 | `123 456 7` |
| 8 | `12 34 56 78` |
| 9 | `123 456 789` |
| 10 | `1 234 567 890` |

Les espaces sont uniquement visuels. Avant tout appel API, `normalizeAlanyaNumber()` retire les espaces et tous les caractères non numériques. La validation backend actuelle conserve les longueurs autorisées de 6 ou 8 chiffres ; le support de saisie/affichage jusqu'à 10 chiffres prépare les évolutions futures sans modifier cette règle de validation.
