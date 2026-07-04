# Setup Backend Alanya — Guide pour cloner et lancer

## Prerequis (a installer une fois)

### 1. Java 17

Telecharge **Temurin 17** : https://adoptium.net/

- Choisis le `.msi` Windows x64
- Pendant l'install, coche **"Set JAVA_HOME"** et **"Add to PATH"**

Verifie :

```
java -version
```

Tu dois voir `openjdk version "17.x"`.

### 2. Maven

Telecharge `apache-maven-3.9.x-bin.zip` : https://maven.apache.org/download.cgi

- Dezippe dans `C:\maven`
- Ajoute `C:\maven\bin` au PATH Windows (Variables d'environnement utilisateur)

Verifie (dans un **nouveau** terminal) :

```
mvn -version
```

### 3. MySQL Server

Telecharge MySQL Installer : https://dev.mysql.com/downloads/installer/

- Choisis **"Server only"**
- Pendant le setup, **note bien ton mot de passe root**.

Verifie :

```
mysql -u root -p
```

Si tu rentres dans le prompt `mysql>`, c'est bon.

---

## Setup du projet (a faire une seule fois apres le clone)

### Etape 1 — Cloner le repo

```
git clone <url-du-repo>
cd ALANYA
```

### Etape 2 — Creer la base de donnees

```
mysql -u root -p -e "CREATE DATABASE alanya_db CHARACTER SET utf8mb4;"
```

(Si la base existe deja avec un schema different : `DROP DATABASE alanya_db;` puis recree-la.)

### Etape 3 — Configurer ton mot de passe MySQL

**Important** : ce fichier n'est pas dans Git (il contient ton mot de passe).

Cree le fichier `ALANYA/src/main/resources/application-local.properties` avec ce contenu (remplace `TonMotDePasseMysql` par ton vrai mdp root MySQL) :

```properties
spring.datasource.password=TonMotDePasseMysql
```

Si tu ne mets pas de mdp sur ton MySQL local, laisse vide :

```properties
spring.datasource.password=
```

---

## Lancer le backend

Depuis le dossier `ALANYA` :

```
mvn spring-boot:run
```

**Premier lancement** : Maven telecharge toutes les dependances (~3-5 min).

Tu sais que ca marche quand tu vois :

```
Tomcat started on port 8080 (http) with context path '/api'
Started AlanyaApplication in X seconds
```

Le backend repond sur `http://localhost:8080/api`.

### Verification rapide

Dans un autre terminal :

```
curl http://localhost:8080/api/users/me
```

Tu dois recevoir :

```json
{ "message": "Authentification requise." }
```

(C'est normal et bon signe : ca veut dire que le filtre JWT marche.)

---

## Problemes courants

| Erreur                                    | Cause                   | Solution                                                                    |
| ----------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `Access denied for user 'root'`           | Mauvais mdp MySQL       | Verifie `application-local.properties`                                      |
| `Communications link failure`             | MySQL pas demarre       | Touche Windows -> "Services" -> trouve `MySQL80` -> Demarrer                |
| `Unknown database 'alanya_db'`            | Etape 2 oubliee         | Cree la base avec la commande de l'etape 2                                  |
| `Port 8080 was already in use`            | Autre process sur 8080  | Ajoute `server.port=8081` dans `application-local.properties`               |
| `mvn n'est pas reconnu`                   | PATH pas pris en compte | Ferme et rouvre ton terminal                                                |
| `FlywayException: Found non-empty schema` | Base existante non vide | `DROP DATABASE alanya_db; CREATE DATABASE alanya_db CHARACTER SET utf8mb4;` |
| `Validation failed for column X`          | Decalage entites / BDD  | Pareil : drop + recreer la base                                             |

---

## Endpoints disponibles

Une fois le backend lance, ces routes sont disponibles :

```
AUTH
  POST   /api/auth/login              { identifier, password }
  POST   /api/auth/register           { name, phone, email, password }
  POST   /api/auth/register-otp       { name, phone, email, password }
  POST   /api/auth/logout

USER
  GET    /api/users/me
  PATCH  /api/users/me
  DELETE /api/users/me

CONTACTS
  GET    /api/contacts
  POST   /api/contacts                { phone }
  DELETE /api/contacts/{friendId}

CHATS
  GET    /api/chats
  POST   /api/chats                   { contactId }  ou  { name, memberIds }
  GET    /api/chats/{id}/messages
  POST   /api/chats/{id}/messages     { content, type }
  POST   /api/chats/{id}/read

CALLS
  GET    /api/calls
  POST   /api/calls                   { contactId, type }

WEBSOCKET (STOMP)
  /api/ws                              endpoint de connexion (SockJS)
  /topic/chats/{id}                    nouveaux messages
  /topic/chats/{id}/typing             evenements "en train d'ecrire"
  /topic/chats/{id}/status             accuses de lecture
  /app/chats/{id}/typing               destination pour publier typing
```

---

## En cas de blocage

Lance ces 3 commandes et envoie la sortie complete :

```
java -version
mvn -version
mysql -u root -p -e "SHOW DATABASES;"
```

Plus l'erreur exacte de `mvn spring-boot:run` (les dernieres lignes rouges).
