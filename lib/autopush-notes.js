"use babel";

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

module.exports = {
  backupInterval: null, // Store autosaving interval
  autoBackupEnabled: false, // Store auto backup state

  activate() {
    // Read plugin options
    this.autoBackupEnabled = inkdrop.config.get(
      "autopush-notes.autoBackupEnabled",
    );
    const intervalInMinutes = inkdrop.config.get(
      "autopush-notes.backupInterval",
    );

    console.log(
      "Plugin activation with autoBackupEnabled:",
      this.autoBackupEnabled,
    );

    // Start autosaving if enabled in options
    if (this.autoBackupEnabled) {
      this.enableAutoBackup(intervalInMinutes);
    }

    // Add commands to manually backup notes via menu
    inkdrop.commands.add(document.body, {
      "autopush-notes:exportLocal": () => this.exportNotesLocally(),
      "autopush-notes:exportAndPush": () => this.exportAndPushNotes(),
      "autopush-notes:toggle": () => this.toggleAutoBackup(),
    });
  },

  deactivate() {
    this.disableAutoBackup(); // Stop autosaving when deactivating
  },

  // Start manual backup
  async startBackup() {
    console.log("Starting notes export...");
    try {
      await this.exportNotesLocally();
      await this.pushNotesToGitHub();
    } catch (error) {
      console.error("Error during export or push of notes: ", error);
    }
  },

  // Toggle auto backup on/off
  toggleAutoBackup() {
    console.log(
      "Toggling auto backup. Current state: ",
      this.autoBackupEnabled,
    );
    if (this.autoBackupEnabled) {
      this.disableAutoBackup();
      this.autoBackupEnabled = false;
      inkdrop.config.set("autopush-notes.autoBackupEnabled", false);
      this.showNotificationSafely("Auto backup disabled");
    } else {
      const intervalInMinutes = inkdrop.config.get(
        "autopush-notes.backupInterval",
      );
      console.log(
        "Auto backup enabled with an interval of",
        intervalInMinutes,
        "minutes.",
      );
      this.enableAutoBackup(intervalInMinutes);
      this.autoBackupEnabled = true;
      inkdrop.config.set("autopush-notes.autoBackupEnabled", true);
      this.showNotificationSafely("Auto backup enabled");
    }
  },

  // Enable autosaving with a defined interval
  enableAutoBackup(intervalInMinutes) {
    console.log(
      "Attempting to enable automatic backup with an interval of:",
      intervalInMinutes,
    );
    if (!this.backupInterval) {
      const intervalInMilliseconds = intervalInMinutes * 60 * 1000; // Convert to milliseconds
      this.backupInterval = setInterval(() => {
        console.log("Starting automatic backup...");
        this.startBackup();
      }, intervalInMilliseconds); // Use user-defined interval
      console.log(
        `Automatic backup enabled with an interval of ${intervalInMinutes} minutes.`,
      );
    }
  },

  // Disable autosaving
  disableAutoBackup() {
    console.log("Attempting to disable automatic backup.");
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
      console.log("Automatic backup disabled.");
      this.showNotificationSafely("Auto backup disabled");
    }
  },

  // Helper function to display notifications safely
  showNotificationSafely(message) {
    try {
      console.log("Attempting to display notification with message: ", message);
      // Add validation before displaying notification
      if (typeof message !== "string" || message.trim() === "") {
        console.error("Invalid notification message");
        return;
      }

      if (inkdrop && inkdrop.notifications) {
        inkdrop.notifications.add({
          message: message,
          type: "info",
          dismissable: true, // Make notification dismissable
        });
      } else {
        console.error(
          "Cannot display notification, inkdrop.notifications is undefined.",
        );
      }
    } catch (error) {
      console.error("Error displaying notification:", error);
    }
  },

  // Export notes locally and clean up deleted notes
  async exportNotesLocally() {
    const exportPath = inkdrop.config.get("autopush-notes.localExportPath");
    console.log("Exporting notes locally to:", exportPath);

    const db = inkdrop.main.dataStore.getLocalDB();
    const allNotes = await db.notes.all({ limit: 100 });
    const notesArray = allNotes.docs; // access via docs property

    if (!fs.existsSync(exportPath)) {
      fs.mkdirSync(exportPath, { recursive: true });
    }

    // Create a set of current note filenames
    const currentNoteFiles = new Set();

    // Export all current notes
    notesArray.forEach((note) => {
      const noteTitle = note.title.replace(/[/\\?%*:|"<>]/g, "-"); // Replace invalid characters
      const filename = `${noteTitle}.md`;
      const notePath = path.join(exportPath, filename);
      fs.writeFileSync(notePath, note.body, "utf8");
      currentNoteFiles.add(filename);
    });

    console.log("Notes export completed!");

    // Clean up deleted notes - remove .md files that don't correspond to current notes
    this.cleanupDeletedNotes(exportPath, currentNoteFiles);
  },

  // Remove local files for notes that no longer exist in the database
  cleanupDeletedNotes(exportPath, currentNoteFiles) {
    try {
      const files = fs.readdirSync(exportPath);
      const mdFiles = files.filter((file) => file.endsWith(".md"));

      mdFiles.forEach((file) => {
        if (!currentNoteFiles.has(file)) {
          const filePath = path.join(exportPath, file);
          console.log("Removing deleted note file:", file);
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      console.error("Error cleaning up deleted notes:", error);
    }
  },

  // Export and push notes to GitHub
  async exportAndPushNotes() {
    await this.exportNotesLocally(); // Export first
    await this.pushNotesToGitHub(); // Then push to GitHub
  },

  // Push notes to GitHub using Git for version control
  async pushNotesToGitHub() {
    const githubToken = inkdrop.config.get("autopush-notes.githubToken");
    const githubRepo = inkdrop.config.get("autopush-notes.githubRepo");
    const exportPath = inkdrop.config.get("autopush-notes.localExportPath");

    if (!githubToken || !githubRepo) {
      console.error("GitHub token or repository is not configured!");
      return;
    }

    console.log("Attempting to push notes to GitHub to:", githubRepo);

    // Initialize Git repository if necessary
    if (!fs.existsSync(path.join(exportPath, ".git"))) {
      console.log("Initializing Git repository...");
      await this.runCommand(`git init`, exportPath);
      const remoteUrl = `https://${githubToken}@github.com/${githubRepo}.git`;
      await this.runCommand(`git remote add origin ${remoteUrl}`, exportPath);
    }

    // Add all changes to Git
    await this.runCommand("git add .", exportPath);

    // Check if there are changes to commit
    const status = await this.runCommand("git status --porcelain", exportPath);
    if (status) {
      // If there are changes, commit and push in one go
      await this.runCommand(`git commit -m "Backup notes"`, exportPath);
      await this.runCommand(`git push origin main`, exportPath);
      console.log("Notes pushed to GitHub!");
    } else {
      console.log("No changes detected, nothing to push.");
    }
  },

  // Helper to execute Git commands
  runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
      exec(command, { cwd }, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing command "${command}": ${stderr}`);
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  },
};
