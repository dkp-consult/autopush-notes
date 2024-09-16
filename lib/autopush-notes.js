'use babel';

const AutopushNotesMessageDialog = require('./autopush-notes-message-dialog');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

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
    const notesArray = allNotes.docs; // acess via docs propriety

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

  // Push notes to GitHub
  async pushNotesToGitHub() {
    const githubToken = inkdrop.config.get('autopush-notes.githubToken');
    const githubRepo = inkdrop.config.get('autopush-notes.githubRepo');

    if (!githubToken || !githubRepo) {
      console.error("GitHub token or repository is not configured !");
      return;
    }

    const exportPath = inkdrop.config.get('autopush-notes.localExportPath');
    const files = fs.readdirSync(exportPath);

    for (const file of files) {
      const filePath = path.join(exportPath, file);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      await this.pushNoteToGitHub(githubToken, githubRepo, file, fileContent);
    }

    console.log("Notes pushed to GitHub !");
  },

  // Push a specific note to GitHub
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
        sha = fileData.sha;
      }
    } catch (error) {
      console.log(`Fichier ${fileName} n'existe pas encore, il sera créé.`);
    }

    const response = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Backup note ${fileName}`,
        content: Buffer.from(fileContent).toString('base64'),
        sha: sha,
        committer: {
          name: "Inkdrop User", // TODO: Get user name and email
          email: "user@example.com"
        }
      })
    });

    if (!response.ok) {
      const errorMessage = await response.text();
      console.error(`Error during saving ${fileName} on GitHub : ${errorMessage}`);
    } else {
      console.log(`Note ${fileName} saved successfully on GitHub !`);
    }
  }
};