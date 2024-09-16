'use babel';

const AutopushNotesMessageDialog = require('./autopush-notes-message-dialog');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

module.exports = {

  activate() {
    // Enregistrement de la modal
    inkdrop.components.registerClass(AutopushNotesMessageDialog);
    inkdrop.layouts.addComponentToLayout(
      'modal',
      'AutopushNotesMessageDialog'
    );

    // Démarrer la sauvegarde automatique
    this.startBackup();

    // Optionnel : lancer l'automatisation pour la sauvegarde régulière
    this.backupInterval = setInterval(() => {
      this.startBackup();
    }, 5 * 60 * 1000); // Sauvegarde toutes les 5 minutes
  },

  deactivate() {
    // Nettoyage lors de la désactivation du plugin
    inkdrop.layouts.removeComponentFromLayout(
      'modal',
      'AutopushNotesMessageDialog'
    );
    inkdrop.components.deleteClass(AutopushNotesMessageDialog);

    // Arrêter l'intervalle de sauvegarde
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }
  },

  async startBackup() {
    console.log("Démarrage de l'exportation des notes...");
    await this.exportNotesLocally();
    await this.pushNotesToGitHub();
  },

  async exportNotesLocally() {
    const exportPath = inkdrop.config.get('autopush-notes.localExportPath');
    const { notes } = require('inkdrop').models;
    const db = inkdrop.main.dataStore.getLocalDB()
    const allNotes = await db.notes.all({ limit : 100});
    const notesArray = allNotes.docs; // accéder via docs proprerty
    console.log(notesArray);
    
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

  async pushNotesToGitHub() {
    const githubToken = inkdrop.config.get('autopush-notes.githubToken');
    const githubRepo = inkdrop.config.get('autopush-notes.githubRepo');

    if (!githubToken || !githubRepo) {
      console.error("Le token GitHub ou le dépôt GitHub n'est pas configuré !");
      return;
    }

    const exportPath = inkdrop.config.get('autopush-notes.localExportPath');
    const files = fs.readdirSync(exportPath);

    for (const file of files) {
      const filePath = path.join(exportPath, file);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      await this.pushNoteToGitHub(githubToken, githubRepo, file, fileContent);
    }

    console.log("Notes poussées sur GitHub !");
  },

  async pushNoteToGitHub(token, repo, fileName, fileContent) {
    const filePath = `notes/${fileName}`;  // Chemin du fichier dans le dépôt
  
    // Étape 1 : Vérifier si le fichier existe déjà
    let sha = null;
    let existingContent = null;
    const checkFileUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  
    try {
      const checkResponse = await fetch(checkFileUrl, {
        method: 'GET',
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
  
      // Si le fichier existe, on récupère le `sha` et le contenu existant
      if (checkResponse.ok) {
        const fileData = await checkResponse.json();
        sha = fileData.sha;  // On stocke le `sha` pour la mise à jour
        existingContent = Buffer.from(fileData.content, 'base64').toString('utf8');  // Convertir le contenu de base64 en texte
      }
  
    } catch (error) {
      console.log(`Fichier ${fileName} n'existe pas encore, il sera créé.`);
    }
  
    // Étape 2 : Comparer le contenu
    if (existingContent === fileContent) {
      console.log(`Aucune modification détectée pour la note ${fileName}.`);
      return;  // Ne rien faire si le contenu n'a pas changé
    }
  
    // Étape 3 : Pousser le fichier (création ou mise à jour)
    const response = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Backup note ${fileName}`,
        content: Buffer.from(fileContent).toString('base64'),  // Convertir en base64
        sha: sha,  // Inclure `sha` si le fichier existe
        committer: {
          name: "Inkdrop User",
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
  }
  
  
};
