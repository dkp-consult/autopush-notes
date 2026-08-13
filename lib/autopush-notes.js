"use babel";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");

// db.notes.all() defaults to limit: 20, so every read must page explicitly.
const NOTE_PAGE_SIZE = 500;

// Versions before the "~" fix wrote here, relative to the Inkdrop process CWD.
const LEGACY_EXPORT_PATH = "~/Documents/InkdropNotes";

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

    this.warnAboutLegacyExportPath();
  },

  // Earlier versions never expanded "~", so notes landed in a stray directory.
  // Point the user at it instead of moving it: its .git/config holds a cleartext
  // token, and relocating that silently is not ours to decide.
  warnAboutLegacyExportPath() {
    const legacyPath = this.findLegacyExportPath();
    if (!legacyPath) return;

    this.showNotificationSafely(
      `Autopush Notes now resolves "~" correctly, so backups moved to the path you configured. ` +
        `Your previous export is still at ${legacyPath}. Its .git/config contains your GitHub ` +
        `token in cleartext — delete the directory once you have checked its contents.`,
      "warning",
    );
  },

  findLegacyExportPath() {
    try {
      const legacyPath = path.resolve(LEGACY_EXPORT_PATH);
      if (legacyPath === this.resolveExportPath()) return null;
      return fs.existsSync(legacyPath) ? legacyPath : null;
    } catch (error) {
      console.error("Could not check for a legacy export directory:", error);
      return null;
    }
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
    const next = !this.autoBackupEnabled;

    if (next) {
      const intervalInMinutes = inkdrop.config.get(
        "autopush-notes.backupInterval",
      );
      console.log(
        "Auto backup enabled with an interval of",
        intervalInMinutes,
        "minutes.",
      );
      this.enableAutoBackup(intervalInMinutes);
    } else {
      this.disableAutoBackup();
    }

    this.autoBackupEnabled = next;
    inkdrop.config.set("autopush-notes.autoBackupEnabled", next);
    this.showNotificationSafely(`Auto backup ${next ? "enabled" : "disabled"}`);
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
    }
  },

  // Helper function to display notifications safely
  showNotificationSafely(message, type = "info") {
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
          type: type,
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

  // Node's fs API does not expand "~" — that is a shell convention. Resolve it
  // here, once, so every call site agrees on where the export lives.
  resolveExportPath() {
    const configured = inkdrop.config.get("autopush-notes.localExportPath");

    if (typeof configured !== "string" || configured.trim() === "") {
      throw new Error("Export path is not configured");
    }

    const trimmed = configured.trim();

    if (trimmed === "~" || trimmed.startsWith("~/")) {
      return path.resolve(path.join(os.homedir(), trimmed.slice(1)));
    }

    // "~user" needs a passwd lookup we cannot do; refuse rather than mishandle.
    if (trimmed.startsWith("~")) {
      throw new Error(
        `Unsupported "~user" syntax in the export path: ${trimmed}. Use an absolute path.`,
      );
    }

    return path.resolve(trimmed);
  },

  // Read the whole note database, page by page. totalRows lets us prove the read
  // was complete instead of assuming it because nothing threw.
  async fetchAllNotes(db) {
    const notes = [];
    let expectedTotal = null;
    let skip = 0;

    for (;;) {
      const page = await db.notes.all({ limit: NOTE_PAGE_SIZE, skip });

      if (expectedTotal === null) expectedTotal = page.totalRows;
      notes.push(...page.docs);

      if (page.docs.length < NOTE_PAGE_SIZE) break;
      skip += NOTE_PAGE_SIZE;
    }

    if (typeof expectedTotal === "number" && notes.length !== expectedTotal) {
      throw new Error(
        `Incomplete read from the note database: got ${notes.length} of ${expectedTotal} notes`,
      );
    }

    return notes;
  },

  // Export notes locally and clean up deleted notes
  async exportNotesLocally() {
    const exportPath = this.resolveExportPath();
    console.log("Exporting notes locally to:", exportPath);

    const db = inkdrop.main.dataStore.getLocalDB();

    // Read everything before touching the disk. A failure midway must not leave a
    // partial export behind, because cleanup treats the written set as authoritative.
    const notesArray = await this.fetchAllNotes(db);

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

    console.log(`Notes export completed: ${currentNoteFiles.size} files.`);

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
    const exportPath = this.resolveExportPath();

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
