# autopush-notes

## English

An Inkdrop plugin to export your notes locally in Markdown (.md) format and automatically save them in a GitHub repository.

### Features

- Exports your Inkdrop notes as `.md` files.
- Automatically backs up your notes to a GitHub repository.
- Easy configuration via Inkdrop's user interface (plugin preferences).

### Prerequisites

1. **A GitHub account**: Make sure you have a GitHub account. [Create a GitHub account here](https://github.com/signup).

2. **Inkdrop**: This plugin only works with the [Inkdrop](https://www.inkdrop.app) note-taking application.

3. **A GitHub token**: This plugin requires a GitHub personal access token to authenticate requests to the GitHub API.

### Installation

1. **Install the plugin via Inkdrop**:
   Go to the Inkdrop application, open the plugins menu, and search for `autopush-notes`. Install it.

2. **Configure the plugin**:
   After installation, you will need to provide the following information in the plugin's user interface under **Preferences > Plugins > autopush-notes**:

   - **GitHub Token**: A GitHub personal access token.
   - **GitHub Repository Name**: The name of the repository where you want to save your notes.
   - **Local Folder Path**: The path where notes will be exported locally.

### Step 1: Create a GitHub Repository

Follow these steps to create a GitHub repository where your notes will be saved:

1. Log in to your GitHub account.
2. Click the **New repository** button or go directly to [https://github.com/new](https://github.com/new).
3. Fill in the following information:
   - **Repository name**: Choose a name for your repository (e.g., `inkdrop-backup`).
   - **Description**: Add a description if you want.
   - **Public/Private**: Choose whether you want your repository to be public or private.
   - **Initialize this repository with a README**: You can check this option to initialize the repository with a `README.md` file.
4. Click **Create repository** to create the repository.

### Step 2: Generate a GitHub Token

The plugin requires a **GitHub personal access token** to interact with the GitHub API and save files. Here's how to create a token:

1. Log in to your GitHub account.
2. Go to your account settings by clicking on your profile icon, then **Settings**.
3. In the left column, click on **Developer settings**.
4. Then click on **Personal access tokens** and choose **Tokens (classic)**.
5. Click on **Generate new token**.
6. Give your token a name (e.g., `Inkdrop Backup`), set an expiration if necessary, and check the following permissions:
   - **repo**: To read and write to your GitHub repositories.
7. Click **Generate token** and **copy the generated token**.

⚠️ **Warning**: The token will only be displayed once, make sure to copy and store it in a safe place.

### Step 3: Configure the Plugin in Inkdrop

1. Open Inkdrop.
2. Go to **Preferences > Plugins > autopush-notes**.
3. Enter the following information in the corresponding fields:
   - **GitHub Token**: Paste the GitHub token you generated.
   - **GitHub Repository Name**: Enter the name of the GitHub repository you created (e.g., `my-username/inkdrop-backup`).
   - **Local Folder Path**: Specify a local path for exporting your notes (e.g., `~/Documents/InkdropNotes`).

### Usage

Once configured, the plugin will automatically export your notes to the specified local folder and push them to GitHub at regular intervals. Files will be saved as Markdown files (`.md`).

#### Automatic Backup

The plugin automatically performs a backup every 15 minutes, or when you manually activate the plugin. It is possible to modify this interval from the plugin preferences.

### Known Issues

- If you encounter an error when saving to GitHub, make sure your GitHub token is valid and that you have the necessary permissions on the repository.
- Verify that the local export path is correct and writable.
- Changing the interval between backups only takes effect after restarting the plugin.
- After using the enable/disable toggle, there is no visual feedback other than console logs in Inkdrop.

### Upcoming Features

- Optimize the visual feedback for enabling and disabling the plugin.

### Support

If you encounter any issues, feel free to [create an issue](https://github.com/dkp-consult/autopush-notes/issues).

### Author

[![GitHub](https://img.shields.io/badge/GitHub-100000?logo=github&logoColor=white)](https://github.com/dkp-consult) [![Twitter](https://img.shields.io/badge/Twitter-1DA1F2?logo=twitter&logoColor=white)](https://x.com/dkp_consult)

### Contribution

Contributions are welcome! If you want to improve this plugin, feel free to fork this project and submit a Pull Request.

### License

This project is licensed under the MIT License.

---

## Français

# autopush-notes

Un plugin Inkdrop pour exporter vos notes localement au format Markdown (.md) et les sauvegarder automatiquement dans un dépôt GitHub.

### Fonctionnalités

- Exporte vos notes d'Inkdrop en fichiers `.md`.
- Sauvegarde automatique de vos notes dans un dépôt GitHub.
- Configuration facile via l'interface utilisateur d'Inkdrop (préférences du plugin).

### Prérequis

1. **Un compte GitHub** : Assurez-vous d'avoir un compte GitHub. [Créer un compte GitHub ici](https://github.com/signup).

2. **Inkdrop** : Ce plugin fonctionne uniquement avec l'application de prise de notes [Inkdrop](https://www.inkdrop.app).

3. **Un token GitHub** : Ce plugin nécessite un token d'accès personnel GitHub pour authentifier les requêtes vers l'API GitHub.

### Installation

1. **Installer le plugin via Inkdrop** :
   Allez dans l'application Inkdrop, ouvrez le menu des plugins et recherchez `autopush-notes`. Installez-le.

2. **Configurer le plugin** :
   Après l'installation, vous devrez fournir les informations suivantes dans l'interface utilisateur (UI) du plugin sous **Preferences > Plugins > autopush-notes** :

   - **GitHub Token** : Un token d'accès personnel GitHub.
   - **Nom du dépôt GitHub** : Le nom du dépôt où vous souhaitez sauvegarder vos notes.
   - **Chemin du dossier local** : Le chemin où les notes seront exportées localement.

### Étape 1 : Créer un dépôt GitHub

Suivez ces étapes pour créer un dépôt GitHub où vos notes seront sauvegardées :

1. Connectez-vous à votre compte GitHub.
2. Cliquez sur le bouton **New repository** (nouveau dépôt) ou allez directement à [https://github.com/new](https://github.com/new).
3. Remplissez les informations suivantes :
   - **Repository name** : Choisissez un nom pour votre dépôt (ex. : `inkdrop-backup`).
   - **Description** : Ajoutez une description si vous le souhaitez.
   - **Public/Private** : Choisissez si vous souhaitez que votre dépôt soit public ou privé.
   - **Initialize this repository with a README** : Vous pouvez cocher cette option pour initialiser le dépôt avec un fichier `README.md`.
4. Cliquez sur **Create repository** pour créer le dépôt.

### Étape 2 : Générer un token GitHub

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

### Étape 3 : Configurer le plugin dans Inkdrop

1. Ouvrez Inkdrop.
2. Accédez à **Preferences > Plugins > autopush-notes**.
3. Entrez les informations suivantes dans les champs correspondants :
   - **GitHub Token** : Collez le token GitHub que vous avez généré.
   - **Nom du dépôt GitHub** : Entrez le nom du dépôt GitHub que vous avez créé (ex. : `mon-utilisateur/inkdrop-backup`).
   - **Chemin du dossier local** : Spécifiez un chemin local pour l'exportation de vos notes (par ex. : `~/Documents/InkdropNotes`).

### Utilisation

Une fois configuré, le plugin exportera automatiquement vos notes dans le dossier local spécifié et les enverra à GitHub à intervalles réguliers. Les fichiers seront sauvegardés sous forme de fichiers Markdown (`.md`).

#### Sauvegarde automatique

Le plugin effectue automatiquement une sauvegarde toutes les 15 minutes, ou lorsque vous activez manuellement le plugin. Il est possible de modifier ce délai depuis les préférences du plugin.

### Problèmes connus

- Si vous rencontrez une erreur lors de la sauvegarde sur GitHub, assurez-vous que votre token GitHub est valide et que vous avez les permissions nécessaires sur le dépôt.
- Vérifiez que le chemin local d'exportation est correct et accessible en écriture.
- Le changement de délai entre deux sauvegardes ne se fait qu'au redémarrage du plugin.
- Après utilisation du toggle enable / disable, il n'y a pas de retour visuel autre que des consoles logs dans Inkdrop.

### Features à venir

- Optimiser le retour visuel de l'activation et de la désactivation du plugin.

### Support

En cas de problème, vous pouvez [créer un issue](https://github.com/dkp-consult/autopush-notes/issues).

### Auteur

[![GitHub](https://img.shields.io/badge/GitHub-100000?logo=github&logoColor=white)](https://github.com/dkp-consult) [![Twitter](https://img.shields.io/badge/Twitter-1DA1F2?logo=twitter&logoColor=white)](https://x.com/dkp_consult)

### Contribution

Les contributions sont les bienvenues ! Si vous souhaitez améliorer ce plugin, n'hésitez pas à forker ce projet et soumettre une Pull Request.

### Licence

Ce projet est sous licence MIT.