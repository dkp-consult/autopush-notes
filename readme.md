# autopush-notes

Un plugin Inkdrop pour exporter vos notes localement au format Markdown (.md) et les sauvegarder automatiquement dans un dépôt GitHub.

## Fonctionnalités

- Exporte vos notes d'Inkdrop en fichiers `.md`.
- Sauvegarde automatique de vos notes dans un dépôt GitHub.
- Configuration facile via l'interface utilisateur d'Inkdrop (préférences du plugin).

## Prérequis

1. **Un compte GitHub** : Assurez-vous d'avoir un compte GitHub. [Créer un compte GitHub ici](https://github.com/signup).

2. **Inkdrop** : Ce plugin fonctionne uniquement avec l'application de prise de notes [Inkdrop](https://www.inkdrop.app).

3. **Un token GitHub** : Ce plugin nécessite un token d'accès personnel GitHub pour authentifier les requêtes vers l'API GitHub.

## Installation

1. **Installer le plugin via Inkdrop** :
   Allez dans l'application Inkdrop, ouvrez le menu des plugins et recherchez `autopush-notes`. Installez-le.

2. **Configurer le plugin** :
   Après l'installation, vous devrez fournir les informations suivantes dans l'interface utilisateur (UI) du plugin sous **Preferences > Plugins > autopush-notes** :
   
   - **GitHub Token** : Un token d'accès personnel GitHub.
   - **Nom du dépôt GitHub** : Le nom du dépôt où vous souhaitez sauvegarder vos notes.
   - **Chemin du dossier local** : Le chemin où les notes seront exportées localement.

## Étape 1 : Créer un dépôt GitHub

Suivez ces étapes pour créer un dépôt GitHub où vos notes seront sauvegardées :

1. Connectez-vous à votre compte GitHub.
2. Cliquez sur le bouton **New repository** (nouveau dépôt) ou allez directement à [https://github.com/new](https://github.com/new).
3. Remplissez les informations suivantes :
   - **Repository name** : Choisissez un nom pour votre dépôt (ex. : `inkdrop-backup`).
   - **Description** : Ajoutez une description si vous le souhaitez.
   - **Public/Private** : Choisissez si vous souhaitez que votre dépôt soit public ou privé.
   - **Initialize this repository with a README** : Vous pouvez cocher cette option pour initialiser le dépôt avec un fichier `README.md`.
4. Cliquez sur **Create repository** pour créer le dépôt.

## Étape 2 : Générer un token GitHub

Le plugin nécessite un **token d'accès personnel GitHub** pour interagir avec l'API GitHub et sauvegarder les fichiers. Voici comment créer un token :

1. Connectez-vous à votre compte GitHub.
2. Accédez aux paramètres de votre compte en cliquant sur votre icône de profil, puis **Settings**.
3. Dans la colonne de gauche, cliquez sur **Developer settings**.
4. Cliquez ensuite sur **Personal access tokens** et choisissez **Tokens (classic)**.
5. Cliquez sur **Generate new token**.
6. Donnez un nom à votre token (par ex. : `Inkdrop Backup`), définissez une expiration si nécessaire, et cochez les permissions suivantes :
   - **repo** : Pour pouvoir lire et écrire dans vos dépôts GitHub.
7. Cliquez sur **Generate token** et **copiez le token généré**.

⚠️ **Attention** : Le token ne sera affiché qu'une seule fois, assurez-vous de le copier et de le stocker dans un endroit sûr.

## Étape 3 : Configurer le plugin dans Inkdrop

1. Ouvrez Inkdrop.
2. Accédez à **Preferences > Plugins > autopush-notes**.
3. Entrez les informations suivantes dans les champs correspondants :
   - **GitHub Token** : Collez le token GitHub que vous avez généré.
   - **Nom du dépôt GitHub** : Entrez le nom du dépôt GitHub que vous avez créé (ex. : `mon-utilisateur/inkdrop-backup`).
   - **Chemin du dossier local** : Spécifiez un chemin local pour l'exportation de vos notes (par ex. : `~/Documents/InkdropNotes`).

## Utilisation

Une fois configuré, le plugin exportera automatiquement vos notes dans le dossier local spécifié et les enverra à GitHub à intervalles réguliers. Les fichiers seront sauvegardés sous forme de fichiers Markdown (`.md`).

### Sauvegarde automatique

Le plugin effectue automatiquement une sauvegarde toutes les 15 minutes, ou lorsque vous activez manuellement le plugin.

### Commandes

- **AutopushNotes:toggle** : Permet de déclencher manuellement la sauvegarde et l'export des notes.

## Problèmes connus

- Si vous rencontrez une erreur lors de la sauvegarde sur GitHub, assurez-vous que votre token GitHub est valide et que vous avez les permissions nécessaires sur le dépôt.
- Vérifiez que le chemin local d'exportation est correct et accessible en écriture.

## Contribution

Les contributions sont les bienvenues ! Si vous souhaitez améliorer ce plugin, n'hésitez pas à forker ce projet et soumettre une Pull Request.

## Licence

Ce projet est sous licence MIT.
