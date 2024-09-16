'use babel';

const AutopushNotesMessageDialog = require('./autopush-notes-message-dialog');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { exec } = require('child_process');

module.exports = {
  backupInterval: null,  // Stocker autosaving interval

  activate() {
    // Register modal
    inkdrop.components.registerClass(AutopushNotesMessageDialog);
    inkdrop.layouts.addComponentToLayout('modal', 'AutopushNotesMessageDialog');

    // Read plugin options
    const autoBackupEnabled = inkdrop.config.get('autopush-notes.autoBackupEnabled');
    const intervalInMinutes = inkdrop.config.get('autopush-notes.backupInterval');

    // Start autosaving if enabled in options
    if (autoBackupEnabled) {
      this.enableAutoBackup(intervalInMinutes);
    }

    // Add command to manually backup notes via menu
    inkdrop.commands.add(document.body, {
      'autopush-notes:startBackup': () => this.startBackup(),
      'autopush-notes:toggle': () => {
        inkdrop.commands.dispatch(document.body, 'autopush-notes:openModal');
      }
    });
  },

  deactivate() {
    inkdrop.layouts.removeComponentFromLayout('modal', 'AutopushNotesMessageDialog');
    inkdrop.components.deleteClass(AutopushNotesMessageDialog);

    this.disableAutoBackup();  // Stop autosaving when deactivating
  },

  // Start manual backup
  async startBackup() {
    console.log("Start notes export...");
    try {
      await this.exportNotesLocally();
      await this.pushNotesToGitHub();
    } catch (error) {
      console.error("Error during notes export or push : ", error);
    }
  },

  // Enable autosaving with a defined interval
  enableAutoBackup(intervalInMinutes) {
    if (!this.backupInterval) {
      const intervalInMilliseconds = intervalInMinutes * 60 * 1000;  // Convert to milliseconds
      this.backupInterval = setInterval(() => {
        console.log("Start autosaving...");
        this.startBackup();
      }, intervalInMilliseconds);  // Use user defined interval
      console.log(`Autosaving enabled with an interval of ${intervalInMinutes} minutes.`);
    }
  },

  // Disable autosaving
  disableAutoBackup() {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
      console.log("Autosaving disabled.");
    }
  },

  // Export notes locally
  async exportNotesLocally() {
    const exportPath = inkdrop.config.get('autopush-notes.localExportPath');
    const { notes } = require('inkdrop').models;
    const db = inkdrop.main.dataStore.getLocalDB();
    const allNotes = await db.notes.all({ limit: 100 });
    const notesArray = allNotes.docs; // access via docs property

    if (!fs.existsSync(exportPath)) {
      fs.mkdirSync(exportPath, { recursive: true });
    }

    notesArray.forEach(note => {
      const noteTitle = note.title.replace(/[/\\?%*:|"<>]/g, '-'); // Replace non authorized characters
      const notePath = path.join(exportPath, `${noteTitle}.md`);
      fs.writeFileSync(notePath, note.body, 'utf8');
    });

    console.log("Notes export finished !");
  },

  // Push notes to GitHub using Git for version control
  async pushNotesToGitHub() {
    const githubToken = inkdrop.config.get('autopush-notes.githubToken');
    const githubRepo = inkdrop.config.get('autopush-notes.githubRepo');
    const exportPath = inkdrop.config.get('autopush-notes.localExportPath');

    if (!githubToken || !githubRepo) {
      console.error("GitHub token or repository is not configured !");
      return;
    }

    // Initialiser le dépôt Git si nécessaire
    if (!fs.existsSync(path.join(exportPath, '.git'))) {
      console.log("Initialisation du dépôt Git...");
      await this.runCommand(`git init`, exportPath);
      const remoteUrl = `https://${githubToken}@github.com/${githubRepo}.git`;
      await this.runCommand(`git remote add origin ${remoteUrl}`, exportPath);
    }

    // Ajouter toutes les modifications dans Git
    await this.runCommand('git add .', exportPath);

    // Vérifier s'il y a des changements à committer
    const status = await this.runCommand('git status --porcelain', exportPath);
    if (status) {
      // S'il y a des changements, committer et pousser en une seule fois
      await this.runCommand(`git commit -m "Backup notes"`, exportPath);
      await this.runCommand(`git push origin main`, exportPath);
      console.log("Notes poussées sur GitHub !");
    } else {
      console.log("Aucune modification détectée, rien à pousser.");
    }
  },

  // Helper pour exécuter des commandes Git
  runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
      exec(command, { cwd }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Erreur lors de l'exécution de la commande "${command}": ${stderr}`);
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  },

  // Push a specific note to GitHub (old method, kept in case of need for individual note pushes)
  async pushNoteToGitHub(token, repo, fileName, fileContent) {
    const filePath = `notes/${fileName}`;
    let sha = null;
  
    const checkFileUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  
    try {
      const checkResponse = await fetch(checkFileUrl, {
        method: 'GET',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
  
      if (checkResponse.ok) {
        const fileData = await checkResponse.json();
        sha = fileData.sha;  // Store the sha if the file exists for updating
      } else if (checkResponse.status === 404) {
        console.log(`Le fichier ${fileName} n'existe pas encore sur GitHub, il sera créé.`);
      } else {
        console.error(`Erreur lors de la vérification de l'existence de ${fileName} sur GitHub : ${checkResponse.statusText}`);
        return;
      }
    } catch (error) {
      console.error(`Erreur lors de la vérification de ${fileName} :`, error);
    }
  
    // Pousser la note sur GitHub (créer ou mettre à jour le fichier)
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Backup note ${fileName}`,
          content: Buffer.from(fileContent).toString('base64'),  // Convert to base64
          sha: sha,  // Include `sha` for updating, omit if creating
          committer: {
            name: "Inkdrop User",  // Replace with actual user information
            email: "user@example.com"
          }
        })
      });
  
      if (!response.ok) {
        const errorMessage = await response.text();
        console.error(`Erreur lors de la sauvegarde de ${fileName} sur GitHub : ${errorMessage}`);
      } else {
        console.log(`Note ${fileName} sauvegardée avec succès sur GitHub !`);
      }
    } catch (error) {
      console.error(`Erreur lors de la sauvegarde de ${fileName} :`, error);
    }
  }
};