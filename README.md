# Veille Info Studio

Site de veille informationnelle moderne, responsive et fonctionnel pour centraliser des contenus RSS/Atom, suivre des sources, filtrer les articles et analyser les tendances.

## Fonctionnalités

- Agrégation automatique de flux RSS/Atom
- Ajout manuel de sources via URL
- Classement par catégories : cybersécurité, IA, développement, hardware, jeux vidéo, actualités tech, réseaux
- Recherche instantanée
- Filtres par date, catégorie, source, non lus et favoris
- Marquage lu / non lu
- Favoris
- Historique des consultations
- Notifications de nouvelles publications importantes
- Import / export OPML
- Mode sombre et clair
- Actualisation automatique des flux
- Vues analytiques avec graphiques simples
- Score de pertinence calculé à partir des catégories et mots-clés
- Stockage local des préférences utilisateur

## Stack

- Frontend : HTML, CSS, JavaScript
- UI : design inspiré dashboard premium, responsive
- Backend : Node.js + Express
- Base de données : SQLite embarqué via `sql.js`

## Lancer le projet

### 1. Installer les dépendances

```bash
npm install
```

### 2. Démarrer le serveur

```bash
npm start
```

### 3. Ouvrir l'application

Ouvrez ensuite :

```text
http://localhost:3000
```

## Utilisation

- La page charge automatiquement plusieurs flux RSS préconfigurés.
- Vous pouvez ajouter vos propres sources dans la section **Sources surveillées**.
- Les préférences d'affichage, les filtres et le thème sont conservés localement dans le navigateur.
- Le fichier OPML peut être exporté pour sauvegarder vos sources ou importé pour en ajouter d'un coup.

## Données

- Le fichier SQLite est persistant dans `data/veille.db`.
- Les articles sont récupérés automatiquement au démarrage puis via l'actualisation manuelle ou périodique.

## API locale

- `GET /api/bootstrap` : état initial, statistiques et tendances
- `GET /api/articles` : liste des articles
- `GET /api/sources` : sources surveillées
- `POST /api/sources` : ajout d'une source
- `PATCH /api/sources/:id` : activation / désactivation d'une source
- `DELETE /api/sources/:id` : suppression d'une source
- `PATCH /api/articles/:id` : marquer lu / non lu ou favori
- `POST /api/refresh` : synchronisation des flux
- `GET /api/history` : historique
- `GET /api/opml` : export OPML

## Remarques

- Certaines sources RSS publiques peuvent imposer des limites ou changer de format.
- Si une source remonte une erreur, il suffit généralement de l'éditer ou de la remplacer.
