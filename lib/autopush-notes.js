'use babel';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { exec } = require('child_process');

module.exports = {
  backupInterval: null,  // Stocker autosaving interval
  autoBackupEnabled: false,  // Stocker l'état de la sauvegarde automatique

  activate() {
    // Lire les options du plugin
    this.autoBackupEnabled = inkdrop.config.get('autopush-notes.autoBackupEnabled');
    const intervalInMinutes = inkdrop.config.get('autopush-notes.backupInterval');
    
    console.log("Activation du plugin avec autoBackupEnabled:", this.autoBackupEnabled);

    // Start autosaving if enabled in options
    if (this.autoBackupEnabled) {
      this.enableAutoBackup(intervalInMinutes);
    }

    // Add commands to manually backup notes via menu
    inkdrop.commands.add(document.body, {
      'autopush-notes:exportLocal': () => this.exportNotesLocally(),
      'autopush-notes:exportAndPush': () => this.exportAndPushNotes(),
      'autopush-notes:toggle': () => this.toggleAutoBackup()
    });
  },

  deactivate() {
    this.disableAutoBackup();  // Stop autosaving when deactivating
  },

  // Start manual backup
  async startBackup() {
    console.log("Démarrage de l'export des notes...");
    try {
      await this.exportNotesLocally();
      await this.pushNotesToGitHub();
    } catch (error) {
      console.error("Erreur lors de l'export ou du push des notes : ", error);
    }
  },

  // Toggle auto backup on/off
  toggleAutoBackup() {
    console.log("Toggling auto backup. État actuel : ", this.autoBackupEnabled);
    if (this.autoBackupEnabled) {
      this.disableAutoBackup();
      this.autoBackupEnabled = false;
      inkdrop.config.set('autopush-notes.autoBackupEnabled', false);
      this.showNotificationSafely('Auto backup disabled');
    } else {
      const intervalInMinutes = inkdrop.config.get('autopush-notes.backupInterval');
      console.log("Auto backup activé avec un interval de", intervalInMinutes, "minutes.");
      this.enableAutoBackup(intervalInMinutes);
      this.autoBackupEnabled = true;
      inkdrop.config.set('autopush-notes.autoBackupEnabled', true);
      this.showNotificationSafely('Auto backup enabled');
    }
  },

  // Enable autosaving with a defined interval
  enableAutoBackup(intervalInMinutes) {
    console.log("Tentative d'activation de la sauvegarde automatique avec un intervalle de :", intervalInMinutes);
    if (!this.backupInterval) {
      const intervalInMilliseconds = intervalInMinutes * 60 * 1000;  // Convertir en millisecondes
      this.backupInterval = setInterval(() => {
        console.log("Démarrage de la sauvegarde automatique...");
        this.startBackup();
      }, intervalInMilliseconds);  // Utiliser l'intervalle défini par l'utilisateur
      console.log(`Sauvegarde automatique activée avec un intervalle de ${intervalInMinutes} minutes.`);
    }
  },

  // Disable autosaving
  disableAutoBackup() {
    console.log("Tentative de désactivation de la sauvegarde automatique.");
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
      console.log("Sauvegarde automatique désactivée.");
      this.showNotificationSafely('Auto backup disabled');
    }
  },

  // Helper function to display notifications safely
  showNotificationSafely(message) {
    try {
      console.log("Tentative d'affichage de la notification avec le message : ", message);
      // Ajout d'une validation avant d'afficher une notification
      if (typeof message !== 'string' || message.trim() === '') {
        console.error('Message de notification invalide');
        return;
      }

      if (inkdrop && inkdrop.notifications) {
        inkdrop.notifications.add({
          message: message,
          type: 'info',
          dismissable: true  // Rendre la notification fermable
        });
      } else {
        console.error('Impossible d\'afficher la notification, inkdrop.notifications est indéfini.');
      }
    } catch (error) {
      console.error('Erreur lors de l\'affichage de la notification :', error);
    }
  },

  // Export notes locally
  async exportNotesLocally() {
    const exportPath = inkdrop.config.get('autopush-notes.localExportPath');
    console.log("Exportation des notes localement vers :", exportPath);

    const { notes } = require('inkdrop').models;
    const db = inkdrop.main.dataStore.getLocalDB();
    const allNotes = await db.notes.all({ limit: 100 });
    const notesArray = allNotes.docs; // accès via la propriété docs

    if (!fs.existsSync(exportPath)) {
      fs.mkdirSync(exportPath, { recursive: true });
    }

    notesArray.forEach(note => {
      const noteTitle = note.title.replace(/[/\\?%*:|"<>]/g, '-'); // Remplacer les caractères non autorisés
      const notePath = path.join(exportPath, `${noteTitle}.md`);
      fs.writeFileSync(notePath, note.body, 'utf8');
    });

    console.log("Export des notes terminé !");
  },

  // Export and push notes to GitHub
  async exportAndPushNotes() {
    await this.exportNotesLocally(); // Export d'abord
    await this.pushNotesToGitHub();  // Puis push sur GitHub
  },

  // Push notes to GitHub using Git for version control
  async pushNotesToGitHub() {
    const githubToken = inkdrop.config.get('autopush-notes.githubToken');
    const githubRepo = inkdrop.config.get('autopush-notes.githubRepo');
    const exportPath = inkdrop.config.get('autopush-notes.localExportPath');

    if (!githubToken || !githubRepo) {
      console.error("Le token GitHub ou le dépôt n'est pas configuré !");
      return;
    }

    console.log("Tentative de push des notes sur GitHub vers :", githubRepo);

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
  }
};